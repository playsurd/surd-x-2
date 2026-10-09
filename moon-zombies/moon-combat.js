import * as THREE from 'three';
import { ViewWeapon, loadModel } from './animation.js';
import { MoonAudio } from './moon-audio.js';
import { MoonPowerups } from './moon-powerups.js';
import { MoonSession } from './moon-session.js';
import { MoonEnemies } from './moon-enemies.js';
import { PerkDrink } from './perk-drink.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { disposeSkeletons } from './runtime-assets.js';

const up=new THREE.Vector3(0,1,0),lerp=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
const pickupNames={full_ammo:'Max Ammo',double_points:'Double Points',insta_kill:'Insta-Kill',nuke:'Nuke',carpenter:'Carpenter',fire_sale:'Fire Sale',minigun:'Death Machine',free_perk:'Free Perk',random_weapon:'Random Weapon',bonus_points_player:'Bonus Points',bonus_points_team:'Bonus Points',lose_points_team:'Lose Points',lose_perk:'Lose Perk',empty_clip:'Empty Clip'};
// Bone capsules approximating T5 hit locations: [location, from, to, radius]. Upper and lower limbs, hands and feet
// keep the weapon files' separate loc* multipliers (arm/leg are the upper segments).
const HITBOXES=[['head','j_head','j_head_end',6.5],['neck','j_neck','j_head',4.5],['torso_upper','j_spineupper','j_neck',10],['torso_lower','j_mainroot','j_spineupper',10],
  ['arm','j_shoulder_le','j_elbow_le',4],['arm_lower','j_elbow_le','j_wrist_le',3.5],['hand','j_wrist_le','j_mid_le_1',3],['arm','j_shoulder_ri','j_elbow_ri',4],['arm_lower','j_elbow_ri','j_wrist_ri',3.5],['hand','j_wrist_ri','j_mid_ri_1',3],
  ['leg','j_hip_le','j_knee_le',5.5],['leg_lower','j_knee_le','j_ankle_le',4.5],['foot','j_ankle_le','j_ball_le',3.5],['leg','j_hip_ri','j_knee_ri',5.5],['leg_lower','j_knee_ri','j_ankle_ri',4.5],['foot','j_ankle_ri','j_ball_ri',3.5]];
// View kick per weapon-file unit: the port's 0.012 rad hip kick for the M14's average of 60, so guns keep their relative kick.
const KICK=.012/60;
function rayCapsule(origin,dir,far,a,b,r){
  const d1=dir.clone().multiplyScalar(far),d2=b.clone().sub(a),w=origin.clone().sub(a),aa=d1.dot(d1),e=d2.dot(d2),f=d2.dot(w),c=d1.dot(w),bb=d1.dot(d2),denom=aa*e-bb*bb;
  let s=denom>1e-9?clamp((bb*f-c*e)/denom,0,1):0,t=e>1e-9?(bb*s+f)/e:0;
  if(t<0){t=0;s=clamp(-c/aa,0,1);}else if(t>1){t=1;s=clamp((bb-c)/aa,0,1);}
  const p=origin.clone().addScaledVector(d1,s),dist=p.distanceTo(a.clone().addScaledVector(d2,t));
  return dist>r?null:{distance:Math.max(0,s*far-Math.sqrt(r*r-dist*dist))};
}

export class MoonCombat {
  constructor(scene,camera,world,{notice,end,feet}) {
    Object.assign(this,{scene,camera,world,notice,end,feet});this.enabled=true;this.primary=false;this.pressed=false;this.ads=false;
    this.audio=new MoonAudio();
    // Common combat cues are reusable; Kino's looping theater ambience is not.
    this.audio.music={stop(){}};
    this.viewScene=new THREE.Scene();this.viewCamera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200);
    this.viewScene.add(new THREE.AmbientLight(0xdce4ef,2.6));const light=new THREE.DirectionalLight(0xffefdb,2);light.position.set(0,4,2);this.viewScene.add(light);
    this.muzzle=new THREE.PointLight(0xffc276,0,200,1);scene.add(this.muzzle);
    this.particles=[];this.grenades=[];this.projectiles=[];this.mines=[];this.blades=[];this.pendingMelee=null;this.lastReload=0;this.burst=0;this.hitAt=-Infinity;this.hitSoundAt=-Infinity;this.lastShot=null;this.lastRound=0;this.cooking=null;this.spin=0;this.wasAds=false;
  }
  async load(){
    const response=await fetch('moon/combat-data.json');if(!response.ok)throw new Error('Missing Moon combat assets; rebuild Moon.');
    this.data=await response.json();this.session=new MoonSession(this.data);this.audio.session=this.session;this.session.onAction=id=>this.onAction(id);
    this.view=new ViewWeapon(this.viewScene,this.data,(name,def)=>this.audio.notify(name,def));
    this.enemies=new MoonEnemies(this.scene,this.world,this.data,this.session,{damage:n=>this.damage(n),kill:z=>this.onKill(z),hit:(z,head,cause)=>this.hit(z,head,cause),sound:(kind,p)=>this.audio.play(kind,Math.max(0,1-p.distanceTo(this.camera.position)/1000))});
    this.enemies.lureTarget=z=>this.lure(z);
    this.pickups=new MoonPowerups(this.scene,this.data,this.audio,(type,position,item)=>this.collect(type,position,item));
    this.perkDrink=new PerkDrink(this.viewScene,this.data,this.audio);this.equipmentModels={};this.models={};
    const urls=new Set([...Object.values(this.data.weapons).flatMap(d=>[d.projectileModel,d.upgrade?.projectileModel,d.blade,d.upgrade?.blade]),...Object.values(this.data.lethal??{}).map(d=>d.projectileModel)].filter(Boolean));
    await Promise.all([this.audio.load(),this.enemies.load(),this.pickups.load(),this.equip(),this.perkDrink.load(),
      ...Object.entries(this.data.equipment).map(async([id,d])=>this.equipmentModels[id]=await loadModel(d.worldModel)),
      ...[...urls].map(async url=>this.models[url]=await loadModel(url))]);
  }
  model(url,color=0xffe699,size=3){const source=url&&this.models[url];if(source){const m=clone(source);m.userData.shared=true;return m;}return new THREE.Mesh(new THREE.SphereGeometry(size,8,6),new THREE.MeshBasicMaterial({color}));}
  viewKey(def){return def.id+(def.upgraded?':upgraded':'')+(def.attachmentActive?':attachment':'');}
  viewDef(){
    const s=this.session;if(s.hackerOut&&this.data.hacker)return {...this.data.hacker,id:'equip_hacker_zm'};
    const def={...s.def};if(this.features?.state.suit)def.handsModel=this.data.props.viewmodel_zom_pressure_suit_arms;return def;
  }
  async equip(){
    // A weapon change first plays the old gun's dropAnim for its dropTime; a new gun then uses firstRaiseAnim.
    const s=this.session,sw=s.switching;
    if(sw&&!this.dropping&&sw.drop>0&&this.view.ready&&this.view.rig?.actions.dropAnim){this.dropping=s.time+sw.drop;this.view.mode='drop';this.view.rig.play('dropAnim',false,this.view.clipSpeed('dropAnim',sw.drop),.04);return;}
    if(this.dropping&&s.time<this.dropping)return;
    this.dropping=0;s.switching=null;
    const suit=!!this.features?.state.suit;
    if(suit!==this.handSuit){this.view.currentId=null;this.handSuit=suit;}
    const def=this.viewDef();
    await this.view.equip(def,{first:!!sw?.first&&!s.hackerOut});if(this.view.ready&&!this.session.hackerOut)this.audio.warmWeapon(this.session.def);
  }
  clearInput(){this.primary=false;this.pressed=false;this.secondary=false;this.secondaryPressed=false;this.ads=false;this.burst=0;this.cooking=null;this.spin=0;}
  pause(){this.clearInput();this.audio.pause();}
  resume(){if(this.enabled){this.audio.start();this.audio.warmWeapon(this.session.def);}}
  enterArea(lunar){this.enemies.enterArea(lunar);this.pickups.reset();this.clearTransient();this.session.enterArea(lunar);this.session.spawned=this.session.killed;this.world.navigation.area=lunar?'moon':'earth';this.lastRound=0;}
  clearTransient(){
    this.perkDrink?.stop();
    this.pendingMelee=null;this.lunge=null;this.dropping=0;this.session.meleeLeft=0;this.clearInput();
    for(const list of [this.particles,this.grenades,this.projectiles,this.mines,this.blades]){for(const p of [...list])this.removeEffect(list,p);}
  }
  async reset(){this.clearTransient();this.audio.reset();this.session.reset();this.enemies.reset();this.pickups.reset();this.view.currentId=null;this.lastRound=0;this.lastReload=0;await this.equip();}
  damage(n,opts={}){
    const s=this.session;if(!this.enabled||!s.damage(n,opts))return;
    this.audio.play('hit');
    if(s.phase==='gameover'){this.pendingMelee=null;this.clearInput();this.end();return;}
    if(s.lastStand){this.pendingMelee=null;this.clearInput();this.notice('Last stand · reviving in 10 seconds',4);this.equip().catch(console.error);}
  }
  key(code){
    if(!this.enabled)return;
    if(code==='KeyR')this.reload();if(code==='KeyV')this.melee();if(code==='KeyG')this.startGrenade();if(code==='KeyX')this.throwEquipment();if(code==='Digit4')this.placeClaymore();
    if(code==='KeyB'&&this.session.toggleAlt()){this.view.currentId=null;this.equip().catch(console.error);}
    if(['Digit1','Digit2','Digit3'].includes(code))this.switchWeapon(Number(code.at(-1))-1);
    if(code==='KeyM'){this.audio.enabled=!this.audio.enabled;this.notice(this.audio.enabled?'Sound on':'Sound off');}
  }
  keyUp(code){if(code==='KeyG'&&this.cooking)this.grenade();}
  // The pullout and putaway notetracks: evt_moon_hacker_open 0.233 s in, evt_moon_hacker_close 0.167 s in.
  toggleHacker(){const s=this.session;if(!s.toggleHacker())return false;this.clearInput();const a=this.audio,H='moon/evt/zombie_moon/hack/evt_moon_hacker_';
    if(s.hackerLowering){this.view.rig?.play('dropAnim',false,this.view.clipSpeed('dropAnim',s.hackerSwap),.04);a.later?.(.167,()=>a.sound?.(H+'close'));}
    else{this.equip().catch(console.error);a.later?.(.233,()=>a.sound?.(H+'open'));}return true;}
  // _zombiemode_equip_gasmask.gsc: the P.E.S. is an equipment weapon used under increment_is_drinking. The gun drops
  // (dropTime); on reaching the mask (weapon_change) protection toggles, then equip_gasmask_zm raises for 1.6 s before
  // the visor overlay appears, or lower_equip_gasmask_zm for 1 s with the overlay off after 0.05 s, and the gun returns.
  toggleSuit(){
    const s=this.session,st=this.features?.state,id=st?.suit?'pes_off':'pes_on',mask=this.data.perkDrinks?.[id];
    if(!st?.hasSuit||!mask||this.suitChange||s.hackerOut||s.hackerSwap||s.meleeLeft||s.effects.death_machine>s.time||!s.startAction(id))return false;
    const drop=this.view.ready?s.def?.dropTime||0:0;s.drinkLeft=drop+mask.raiseTime;this.clearInput();this.pendingMelee=null;
    st.overlay=st.suit;this.suitChange={id,on:!st.suit,switchAt:s.time+drop,overlayAt:s.time+drop+(st.suit?.05:mask.raiseTime),started:false};
    if(drop&&this.view.rig?.actions.dropAnim){this.view.mode='drop';this.view.rig.play('dropAnim',false,this.view.clipSpeed('dropAnim',drop),.04);}
    return true;
  }
  updateSuit(){
    const c=this.suitChange,s=this.session,st=this.features?.state;if(!c||!st)return;
    if(!c.started&&s.drinking===c.id&&s.time>=c.switchAt){c.started=true;st.suit=c.on;this.perkDrink.start(c.id,this.view,{sound:false});}
    if(c.started&&s.time>=c.overlayAt)st.overlay=c.on;
    // Done, or cut short by a down: the overlay follows the protection again.
    if(s.drinking!==c.id){this.suitChange=null;st.overlay=undefined;}
  }
  // lowreadywatcher: the Hacker lowers while hacking (viewmodel_zom_hacker_fire / hold_fire / detonate), with
  // evt_moon_hacker_pen_out 1.067 s into the in clip and evt_moon_hacker_pen_in 0.667 s into the out clip.
  hackerLowReady(on){const a=this.audio,H='moon/evt/zombie_moon/hack/evt_moon_hacker_';if(!this.session.hackerOut||!this.view.lowReady?.(on))return;
    const token=this.lowReadyToken=(this.lowReadyToken??0)+1;a.later?.(on?1.067:.667,()=>{if(token===this.lowReadyToken)a.sound?.(H+(on?'pen_out':'pen_in'));});}
  switchWeapon(slot){
    if(!this.enabled)return;
    const previous=this.session.slot;this.session.switchWeapon(slot);
    if(previous===this.session.slot)return;
    this.pendingMelee=null;this.burst=0;this.equip().catch(console.error);
  }
  reload(){if(!this.view.ready)return;const empty=this.session.weapon?.mag===0;if(this.session.reload()){this.burst=0;this.ads=false;this.lastReload=this.session.reloadSerial;this.view.reload(empty,this.session.reloadDuration,this.session.reloadStage);}}
  // Weapon-file spread in degrees: hip min→max by the accumulated spread fraction, ADS adsSpread; Deadshot assumed at MP's 0.65 multiplier.
  aimDirection(forward,d,spreadFraction){
    const sp=d.spread??{},crouch=this.crouched?.(),hip=crouch?lerp(sp.duckMin??0,sp.duckMax??0,spreadFraction):lerp(sp.hipMin??0,sp.hipMax??0,spreadFraction);
    let deg=lerp(hip*(this.session.perks.has('specialty_deadshot')?.65:1),sp.ads??0,this.ads?this.view.aim:0);
    if(!(deg>0))return forward.clone();
    const r=Math.random(),theta=Math.random()*Math.PI*2,offset=Math.tan(deg*Math.PI/180)*r,right=new THREE.Vector3().crossVectors(forward,up).normalize(),upv=new THREE.Vector3().crossVectors(right,forward).normalize();
    return forward.clone().addScaledVector(right,Math.cos(theta)*offset).addScaledVector(upv,Math.sin(theta)*offset).normalize();
  }
  // Linear falloff between maxDamageRange and minDamageRange, scaled by the weapon file's loc* multiplier.
  bulletDamage(d,distance,location){
    const far=Math.max(d.range,d.minDamageRange??d.range),damage=distance<=d.range?d.damage:distance>=far?d.minDamage:lerp(d.damage,d.minDamage,(distance-d.range)/(far-d.range));
    return damage*(d.loc?.[location]??(location==='head'?Math.max(1,d.headMultiplier??1):1));
  }
  boneCache(z){
    if(z.boneFrame===this.frame)return z.bones;z.boneFrame=this.frame;z.root.updateMatrixWorld(true);z.bones={};
    for(const [,a,b] of HITBOXES)for(const name of [a,b])if(!z.bones[name]){const bone=z.root.getObjectByName(name);if(bone)z.bones[name]=bone.getWorldPosition(new THREE.Vector3());}
    return z.bones;
  }
  trace(ray,far){
    let best=null;const centre=new THREE.Vector3(),sphere=new THREE.Sphere(centre,70);
    for(const z of this.enemies.list){
      centre.copy(z.root.position).y+=36;if(!ray.intersectsSphere(sphere)||ray.distanceToPoint(centre)>70||centre.distanceTo(ray.origin)>far+70)continue;
      const bones=this.boneCache(z);
      if(!bones.j_spineupper){const hit=this.enemies.rayHit(ray,far);if(hit&&hit.z===z&&(!best||hit.distance<best.distance))best={z,location:hit.head?'head':'torso_upper',point:hit.point,distance:hit.distance};continue;}
      for(const [location,a,b,r] of HITBOXES){if(!bones[a]||!bones[b])continue;const hit=rayCapsule(ray.origin,ray.direction,far,bones[a],bones[b],r);
        if(hit&&(!best||hit.distance<best.distance))best={z,location,distance:hit.distance,point:ray.at(hit.distance,new THREE.Vector3())};}
    }
    return best;
  }
  hurt(z,damage,{location=null,cause='bullet',melee=false,points,noDamagePoints=false}={}){
    if(!this.enemies.list.includes(z))return false;
    // _zombiemode_ai_astro.gsc: the Zap Guns deal 0 and the Wave Gun has no effect; damage callbacks award no hit points.
    if(z.kind==='astronaut'){if(['zap','wave'].includes(cause))return false;noDamagePoints=true;}
    this.session.hitInfo={location,cause,points,noDamagePoints};
    try{this.enemies.hurt(z,damage,location&&location!=='none'?location:false,melee,cause);}finally{this.session.hitInfo=null;}
    return !this.enemies.list.includes(z);
  }
  shot(hand='right'){
    const s=this.session;
    if(!this.view.ready||s.hackerOut||['drop','raise','melee','sprintIn','sprint','sprintOut'].includes(this.view.mode))return false;
    if(s.reloadLeft&&s.def.segmentedReload&&s.weapon.mag){s.interruptReload();return false;}
    const spread=s.spread;
    if(!s.fire(hand)){if((hand==='left'?s.weapon?.leftMag:s.weapon?.mag)===0&&this.pressed)this.audio.weapon('empty',s.def);return false;}
    const d=s.def,stats=hand==='left'&&d.left?{...d,...d.left}:d;
    this.view.shoot({ads:this.ads,empty:(hand==='left'?s.weapon.leftMag:s.weapon.mag)===0,hand});this.audio.weapon('shot',d);this.muzzle.position.copy(this.camera.position);this.muzzle.intensity=160;
    const origin=this.camera.position.clone(),forward=this.camera.getWorldDirection(new THREE.Vector3());
    this.features?.shot(new THREE.Ray(origin.clone(),forward),d.id.startsWith('microwavegun')?'wave':'bullet');
    if(d.id==='microwavegun_zm')this.waveBlast(origin,forward);
    else if(stats.weaponType==='projectile')this.launch(stats,origin,this.aimDirection(forward,d,spread),{hand});
    else for(let i=0;i<Math.max(1,d.weaponClass==='spread'?d.pellets:1);i++)this.bullet(origin,this.aimDirection(forward,d,spread),stats);
    // hip/adsViewKickPitch and Yaw: a random kick inside the weapon file's ranges for each shot.
    const kick=(stats.viewKick??d.viewKick)?.[this.ads?'ads':'hip'],between=(a,b)=>a+(b-a)*Math.random();
    if(kick){this.camera.rotation.x=Math.min(1.48,this.camera.rotation.x+between(kick[0],kick[1])*KICK);this.camera.rotation.y+=between(kick[2],kick[3])*KICK;}
    else this.camera.rotation.x=Math.min(1.48,this.camera.rotation.x+(this.ads?.006:.012));return true;
  }
  bullet(origin,direction,d,attacker='player'){
    const ray=new THREE.Ray(origin.clone(),direction),wall=this.world.raycast(ray,1,8000),hit=this.trace(ray,wall?.distance??8000);
    this.lastShot={target:hit?.z.id,head:hit?.location==='head',location:hit?.location,wall:wall?.distance};
    if(hit)this.hurt(hit.z,this.bulletDamage(d,hit.distance,hit.location),{location:hit.location,cause:'bullet'});
    else if(wall)this.effect(wall.position,0xbbb4a7,3);
    return hit;
  }
  // _zombiemode_weap_microwavegun.gsc: 480-unit cylinder of radius 180 in front of the muzzle, line of sight,
  // health + 666 and fling points 50/30/10 by order; Wave Gun deaths never drop power-ups.
  waveBlast(origin,forward){
    const range=480,radius=180,line=new THREE.Line3(origin,origin.clone().addScaledVector(forward,range));
    const list=this.enemies.list.map(z=>{const c=z.root.position.clone().add(new THREE.Vector3(0,z.kind==='nova'?18:36,0));return {z,c,d:c.distanceTo(origin)};}).filter(o=>o.d<=range).sort((a,b)=>a.d-b.d);
    let index=0;
    for(const {z,c} of list){
      if(c.clone().sub(origin).normalize().dot(forward)<0||line.closestPointToPoint(c,true,new THREE.Vector3()).distanceTo(c)>radius||!this.world.lineClear(origin,c))continue;
      this.hurt(z,z.health+666,{cause:'wave',points:index===0?50:index===1?30:10});index++;
    }
    this.effect(origin.clone().addScaledVector(forward,110),0xccecff,20);
  }
  launch(d,origin,direction,{hand='right',owner='player'}={}){
    const gravity=d.projectileType==='grenade'||d.guided==='Ballistic',zap=d.id?.startsWith('microwavegundw')||d.source?.startsWith('microwavegunlh'),knife=d.id?.startsWith('knife_ballistic');
    const mesh=this.model(knife?d.blade??d.projectileModel:d.projectileModel,d.id==='ray_gun_zm'?0x65ff73:zap?0x9fd8ff:0xffe699,zap?2:3);
    mesh.position.copy(origin);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction);this.scene.add(mesh);
    const velocity=direction.clone().multiplyScalar(d.projectileSpeed||1600).addScaledVector(up,d.projectileSpeedUp||0);
    this.projectiles.push({mesh,def:{...d},velocity,life:d.projectileLifetime||8,gravity,zap,knife,owner,shared:!!mesh.userData.shared});
  }
  // Direct hit: weapon damage at the hit location (Zap Guns: health + 666, 50 points); splash: inner→outer.
  impact(p,hit){
    const d=p.def;
    if(p.zap){if(hit.z.kind!=='astronaut')this.hurt(hit.z,hit.z.health+666,{cause:'zap',points:50});else this.hurt(hit.z,0,{cause:'zap'});this.effect(hit.point,0x9fd8ff,8);return true;}
    if(p.knife){
      const killed=this.hurt(hit.z,d.damage*(d.loc?.[hit.location]??1),{location:hit.location,cause:'ballistic'});
      this.stickBlade(p,hit.point,killed?null:hit.z);return true;
    }
    if(this.enemies.list.includes(hit.z)){const alive=!this.hurt(hit.z,d.damage*(d.loc?.[hit.location]??1),{location:hit.location,cause:'explosion'});if(alive)this.splashBonus(hit.z,'projectile');}
    return false;
  }
  splashBonus(z,mod){
    // _zombiemode_spawner.gsc zombie_damage: grenades add round + 100..199, projectiles round × 0..99, mines round × 100..199.
    const r=this.session.round,random=this.session.random();
    const bonus=mod==='grenade'?r+100+Math.floor(random*100):mod==='mine'?r*(100+Math.floor(random*100)):r*Math.floor(random*100);
    if(bonus>0&&this.enemies.list.includes(z))this.hurt(z,bonus,{cause:mod==='projectile'?'explosion':mod,location:'none',noDamagePoints:true});
  }
  explode(position,d,{cause='explosion',mod='projectile',playerDamage=true,cone=null,exclude=null}={}){
    const radius=d.explosionRadius||0;
    this.audio.play('explosion');this.effect(position,cause==='grenade'?0xffb347:d.id==='ray_gun_zm'?0x93ed62:0xffb347,25);this.features?.blast(position,cause==='grenade'?'grenade':'explosion');
    if(!radius)return;
    for(const z of [...this.enemies.list]){
      if(z===exclude)continue;
      const point=z.root.position.clone().add(new THREE.Vector3(0,30,0)),distance=point.distanceTo(position);
      if(distance>=radius||cone&&point.clone().sub(position).setY(0).normalize().dot(cone)<Math.cos(Math.PI/3)||!this.world.lineClear(position,point))continue;
      const alive=!this.hurt(z,lerp(d.explosionInnerDamage,d.explosionOuterDamage,distance/radius),{cause,location:'none'});if(alive)this.splashBonus(z,mod);
    }
    if(!playerDamage)return;
    const eye=this.camera.position,distance=eye.distanceTo(position);
    if(distance<radius&&this.world.lineClear(position,eye))this.damage(lerp(d.explosionInnerDamage,d.explosionOuterDamage,distance/radius),{explosive:true});
  }
  stickBlade(p,point,target){
    const mesh=p.mesh;this.projectiles.splice(this.projectiles.indexOf(p),1);mesh.position.copy(point);
    this.blades.push({mesh,id:p.def.id,upgraded:!!p.def.upgraded,target,offset:target?point.clone().sub(target.root.position):null,shared:p.shared});
  }
  // _ballistic_knife.gsc: blades stay where they land until picked up; Max Ammo removes them (zmb_lost_knife).
  pickupBlade(){
    const s=this.session,at=this.feet().clone().add(new THREE.Vector3(0,30,0));
    const blade=this.blades.find(b=>b.mesh.position.distanceTo(at)<72);if(!blade)return false;
    const w=s.inventory.find(w=>w.id==='knife_ballistic_zm');if(!w)return false;const d=s.weaponDef({...w,alt:false});
    if(w.reserve>=d.maxAmmo)return false;w.reserve++;this.removeEffect(this.blades,blade);this.audio.play('buy');return true;
  }
  // knife_zm / bowie_knife_zm / knife_ballistic_zm meleeChargeRange 128: a zombie within it is lunged at.
  get meleeRange(){return this.data.melee?.knife?.chargeRange||94;}
  meleeTarget(range=this.meleeRange){
    const forward=this.camera.getWorldDirection(new THREE.Vector3());let best=null;
    for(const z of this.enemies.list){const delta=z.root.position.clone().add(new THREE.Vector3(0,44,0)).sub(this.camera.position);if(delta.length()<range&&delta.clone().normalize().dot(forward)>.4&&this.world.lineClear(this.camera.position,z.root.position.clone().add(new THREE.Vector3(0,44,0))))if(!best||delta.length()<best.distance)best={z,distance:delta.length()};}
    return best?.z;
  }
  melee(){
    const s=this.session;if(!this.view.ready||!s.canAct||s.hackerOut)return false;
    const target=this.meleeTarget(),strike=this.view.melee(s.bowie?'bowie':'knife',!!target);if(!strike)return false;
    s.cancelReload();s.meleeLeft=strike.duration;this.burst=0;this.ads=false;this.pressed=false;
    // The melee charge carries the player to the target before the strike lands.
    if(target){const feet=this.feet(),to=target.root.position.clone().sub(feet).setY(0),gap=to.length()-40;this.lunge=gap>0&&strike.delay>0?{velocity:to.normalize().multiplyScalar(gap/strike.delay),until:s.time+strike.delay}:null;}
    this.pendingMelee={at:s.time+strike.delay,damage:strike.damage,ballistic:s.def.id?.startsWith('knife_ballistic')};this.audio.knife('swing',false);return true;
  }
  // Horizontal velocity the player controller holds during a melee charge.
  get lungeVelocity(){const l=this.lunge;if(!l)return null;if(this.session.time>=l.until||!this.enabled){this.lunge=null;return null;}return l.velocity;}
  // Frag grenades cook while G is held (fuseTime 3.5); Semtex cannot be cooked and sticks (fuse 2).
  startGrenade(){
    const s=this.session;if(!s.grenades||!s.canAct||s.hackerOut||this.cooking)return;
    const d=this.data.lethal?.[s.lethal];this.cooking={at:s.time,def:d};if(!d?.fuseTime||s.lethal!=='frag_grenade_zm')this.grenade();
  }
  grenade(){
    const s=this.session,d=this.cooking?.def??this.data.lethal?.[s.lethal]??{fuseTime:3.5,projectileSpeed:900};
    const held=this.cooking&&s.lethal==='frag_grenade_zm'?s.time-this.cooking.at:0;this.cooking=null;
    if(!s.grenades||!s.canAct||s.hackerOut)return;s.grenades--;
    const forward=this.camera.getWorldDirection(new THREE.Vector3()),right=new THREE.Vector3().crossVectors(forward,up).normalize(),viewUp=new THREE.Vector3().crossVectors(right,forward).normalize();
    const mesh=this.model(d.projectileModel,0x43563b,3.5);mesh.position.copy(this.camera.position);this.scene.add(mesh);
    this.grenades.push({mesh,velocity:forward.multiplyScalar(d.projectileSpeed||900).addScaledVector(viewUp,120),life:Math.max(0,(d.fuseTime||3.5)-held),lethal:d.id??'frag_grenade_zm',sticky:d.id==='sticky_grenade_zm',shared:!!mesh.userData.shared});
  }
  magicGrenade(id,position,fuse){
    const d=this.data.lethal[id],mesh=this.model(d.projectileModel,0x43563b,3.5);mesh.position.copy(position);this.scene.add(mesh);
    this.grenades.push({mesh,velocity:new THREE.Vector3(),life:fuse,lethal:id,sticky:false,shared:!!mesh.userData.shared});
  }
  throwEquipment(){
    const s=this.session;if(!s.canAct||s.hackerOut||!s.equipment||s.equipmentAmmo<=0)return false;
    const d=this.data.equipment[s.equipment];
    s.equipmentAmmo--;const mesh=clone(this.equipmentModels[s.equipment]);mesh.position.copy(this.camera.position);this.scene.add(mesh);
    this.grenades.push({mesh,velocity:this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(d.projectileSpeed||800).addScaledVector(up,d.projectileSpeedUp??100),life:s.equipment==='zombie_black_hole_bomb'?d.fuseTime||8:d.fuseTime||2,equipment:s.equipment,shared:true});return true;
  }
  // _zombiemode_claymore.gsc: trigger radius 96, cos(70°) detection cone beyond 20 units, 0.4 s delay; mines never hurt players.
  placeClaymore(){
    const s=this.session;if(!s.canAct||s.hackerOut||s.claymores<=0)return false;
    const forward=this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(),feet=this.feet(),guess=feet.clone().addScaledVector(forward,35).addScaledVector(up,32);
    if(!this.world.lineClear(feet.clone().addScaledVector(up,30),guess))return false;
    const floor=this.world.raycast(new THREE.Ray(guess,up.clone().negate()),0,70);if(!floor)return false;
    s.claymores--;const d=this.data.lethal.claymore_zm,mesh=this.model(d.projectileModel,0x4f5a3a,4);mesh.position.copy(floor.position).addScaledVector(up,1);mesh.rotation.y=Math.atan2(-forward.z,forward.x);this.scene.add(mesh);
    this.mines.push({mesh,forward,def:d,detonateAt:0,shared:!!mesh.userData.shared});this.audio.play('buy');return true;
  }
  effect(position,color=0x9e3023,count=7){
    for(let i=0;i<count;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5),new THREE.MeshBasicMaterial({color}));mesh.position.copy(position);this.scene.add(mesh);this.particles.push({mesh,life:.5,velocity:new THREE.Vector3((Math.random()-.5)*90,Math.random()*80,(Math.random()-.5)*90)});}
  }
  // MP _damagefeedback.gsc: alpha 1 then fadeOverTime(1); mpl_hit_alert at most once per 0.05s frame, never for grenade splash.
  hit(z,head,cause){
    const t=this.session.time;this.hitAt=t;
    if(cause!=='grenade'&&(t<this.hitSoundAt||t-this.hitSoundAt>=.05)){this.hitSoundAt=t;this.audio.play('moon/mpl/hit/alert/alert',.75);}
    this.effect(head===true||head==='head'||head==='helmet'?this.enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,40,0)));}
  onKill(z){
    this.features?.onKill(z);
    if(z)this.audio.zombieVox(z,'death',true);
    // zombie_can_drop_powerups: tactical (Gersh) and microwave deaths never drop; nuked zombies still can.
    if(!z||this.session.area==='earth'||z.kind==='astronaut'||['wave','zap','gersh'].includes(z.deathCause))return;
    const at=z.root.position.clone(),type=this.session.drops.tryDrop(this.session,{kind:z.kind,playable:this.features?.inPlayable(at)??true,destroyedWindows:this.features?.brokenWindows??0,boxMoves:this.features?.box?.moves??0});
    if(type&&this.data.powerups[type])this.pickups.spawn(type,at);
  }
  collect(type,position,item){
    const s=this.session;
    this.audio.play(type);this.notice(pickupNames[type]??type);
    if(type==='nuke'){this.enemies.nuke(z=>this.effect(z.root.position,0xe3e7b9),{origin:position?.clone()??null,done:()=>s.addPoints(400)});}
    if(type==='carpenter')this.features?.repairAll();
    if(type==='full_ammo'&&!s.lastStand)for(const b of [...this.blades])this.removeEffect(this.blades,b);
    // minigun_weapon_powerup: 30 s, refreshed only upwards.
    if(type==='minigun'){s.effects.death_machine=Math.max(s.effects.death_machine??0,s.time+30);this.spin=0;s.fireLeft=0;}
    if(type==='free_perk')this.features?.giveRandomPerk();
    if(type==='random_weapon'&&item?.weapon){const w=item.weapon;if(this.data.equipment[w.id])s.giveEquipment(w.id);else s.giveWeapon(w.id,w.upgraded);this.equip().catch(console.error);}
    // bonus_points_*_powerup: RandomIntRange(1, 25) * 100, not paid to a player in last stand.
    if((type==='bonus_points_player'||type==='bonus_points_team')&&!s.lastStand)s.addPoints((1+Math.floor(s.random()*24))*100);
    if(type!=='nuke')s.powerup(type);
  }
  // powerup_zombie_grab effects.
  zombieGrab(type){
    const s=this.session;this.audio.play('round');this.notice((pickupNames[type]??type)+' — taken by a zombie',4);
    if(type==='lose_points_team')s.points=Math.max(0,s.points-(1+Math.floor(s.random()*24))*100);
    if(type==='lose_perk')this.features?.loseRandomPerk();
    if(type==='empty_clip'&&s.weapon&&!s.lastStand){s.weapon.mag=0;if(s.weapon.leftMag)s.weapon.leftMag=0;}
  }
  // default_find_exit_point: during the solo revive, zombies head to a spawn point away from the player.
  lure(z){
    const s=this.session;
    if(s.lastStand){
      if(!z.fleeGoal){const player=this.feet(),away=z.root.position.clone().sub(player).setY(0).normalize(),end=z.root.position.clone().addScaledVector(away,600);
        const spots=this.shuffle(this.world.navigation?.metadata?.[s.area]?.candidates??[]).map(c=>new THREE.Vector3(...c.position));
        z.fleeGoal=spots.find(p=>p.distanceToSquared(end)<p.distanceToSquared(player))??this.world.closest(end,{x:200,y:120,z:200})??end;}
      return z.fleeGoal;
    }
    z.fleeGoal=null;return this.features?.lure?.(z)??null;
  }
  shuffle(list){const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(this.session.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  onAction(id){
    if(id==='knuckle')this.equip().catch(console.error);
    this.features?.onAction?.(id);
  }
  buyWeapon(id){
    if(!this.session.buyWeapon(id)){if(this.session.lastDenied)this.audio.noMoney?.();this.notice(this.session.inventory.some(w=>w.id===id)?'Not enough points or ammunition already full.':'Not enough points.');return false;}
    this.equip().catch(console.error);this.audio.play('buy');this.notice(this.data.weapons[id].name);return true;
  }
  // Deadshot snaps ADS onto a nearby head (engine aim assist; strength assumed).
  deadshotAssist(){
    const forward=this.camera.getWorldDirection(new THREE.Vector3());let best=null;
    for(const z of this.enemies.list){const head=this.enemies.headPosition(z),delta=head.clone().sub(this.camera.position),d=delta.length();
      if(d>3200||delta.normalize().dot(forward)<Math.cos(10*Math.PI/180)||!this.world.lineClear(this.camera.position,head))continue;if(!best||d<best.d)best={head,d};}
    if(best)this.camera.lookAt(best.head);
  }
  update(dt,{moving,sprint}){
    if(!this.enabled||this.session.phase==='gameover')return;
    const s=this.session;s.update(dt);this.frame=(this.frame??0)+1;
    if(!s.hackerLowering&&(this.view.currentId!==this.viewKey(this.viewDef())||this.handSuit!==!!this.features?.state.suit))this.equip().catch(console.error);
    this.updateSuit();this.perkDrink.update(dt,s);this.view.pivot.visible=!s.drinking&&(s.lastStand||s.hackerOut||s.weapon!==s.pack?.weapon);
    if(s.reloadLeft>0&&s.reloadSerial!==this.lastReload){this.lastReload=s.reloadSerial;this.view.reload(false,s.reloadDuration,s.reloadStage);}
    if(this.pendingMelee&&s.time>=this.pendingMelee.at){const strike=this.pendingMelee;this.pendingMelee=null;this.features?.shot(new THREE.Ray(this.camera.position.clone(),this.camera.getWorldDirection(new THREE.Vector3())),'melee',this.meleeRange);const z=this.meleeTarget();if(z){this.hurt(z,strike.damage,{cause:strike.ballistic?'ballistic':'melee',melee:true});this.audio.knife('hit',false);}}
    this.view.update(dt,{moving,sprint,ads:this.ads&&!s.hackerOut,reloading:s.reloadLeft>0,empty:s.weapon?.mag===0,time:s.time});
    if(moving&&!this.ads)s.spread=Math.min(1,s.spread+(s.def?.spread?.moveAdd??0)*dt);
    if(this.ads&&!this.wasAds&&s.perks.has('specialty_deadshot'))this.deadshotAssist();this.wasAds=this.ads;
    const minigun=s.effects.death_machine>s.time&&!s.lastStand;
    // minigun_zm spinUpTime 0.25 s before the barrel fires.
    this.spin=minigun&&(this.primary||this.pressed)?this.spin+dt:0;
    if(!sprint&&(this.pressed||this.primary&&s.def.automatic||this.burst>0)&&(!minigun||this.spin>=(s.def.spinUpTime||.25))){if(this.shot()){if(this.burst>0)this.burst--;else if(s.def.fireType==='3-Round Burst')this.burst=2;}}
    this.pressed=false;
    if(!sprint&&s.def.dualWield&&(this.secondaryPressed||this.secondary&&s.def.automatic))this.shot('left');
    this.secondaryPressed=false;
    if(this.cooking&&s.time-this.cooking.at>=(this.cooking.def?.fuseTime??3.5)){this.cooking=null;s.grenades--;this.explode(this.camera.position.clone(),this.data.lethal.frag_grenade_zm,{cause:'grenade',mod:'grenade'});}
    this.enemies.update(dt,this.feet());
    if(s.area==='moon'&&s.phase==='fighting'&&s.round!==this.lastRound){this.lastRound=s.round;this.notice('Round '+s.round,4);this.audio.play('round');}
    // powerup_grab: a downed player still takes power-ups, except the Death Machine and the random weapon.
    this.pickups.update(dt,this.feet(),type=>s.phase!=='gameover'&&!(s.lastStand&&['minigun','random_weapon'].includes(type)),(a,b)=>this.world.lineClear(a,b),this.enemies.list,type=>this.zombieGrab(type));
    this.updateProjectiles(dt);this.updateGrenades(dt);this.updateMines(dt);
    for(const b of this.blades)if(b.target){if(this.enemies.list.includes(b.target))b.mesh.position.copy(b.target.root.position).add(b.offset);else{b.target=null;b.mesh.position.y=Math.max(b.mesh.position.y-dt*120,(this.world.raycast(new THREE.Ray(b.mesh.position.clone(),up.clone().negate()),0,400)?.position.y??b.mesh.position.y)+1);}}
    for(const p of [...this.particles]){p.life-=dt;p.velocity.y-=200*dt;p.mesh.position.addScaledVector(p.velocity,dt);if(p.life<=0)this.removeEffect(this.particles,p);}
    this.muzzle.intensity=Math.max(0,this.muzzle.intensity-dt*2200);
    const horizontal=this.ads&&!s.hackerOut&&!s.reloadLeft&&!s.meleeLeft?s.def.adsFov||56:(this.baseFov??65);
    const vertical=2*THREE.MathUtils.radToDeg(Math.atan(.75*Math.tan(THREE.MathUtils.degToRad(horizontal)/2)));
    this.camera.fov=THREE.MathUtils.damp(this.camera.fov,vertical,12,dt);this.camera.updateProjectionMatrix();
  }
  gravity(position){return this.world.lowGravity(position)?136:800;}
  updateProjectiles(dt){
    for(const p of [...this.projectiles]){
      p.life-=dt;if(p.gravity)p.velocity.y-=this.gravity(p.mesh.position)*dt;
      const travel=p.velocity.clone().multiplyScalar(dt),distance=travel.length(),direction=travel.clone().normalize(),ray=new THREE.Ray(p.mesh.position.clone(),direction);
      const wall=this.world.raycast(ray,0,distance),hit=this.trace(ray,Math.min(distance,wall?.distance??distance));
      if(hit){p.mesh.position.copy(hit.point);if(this.impact(p,hit))continue;}
      else if(wall){p.mesh.position.copy(wall.position).addScaledVector(direction,-2);
        if(p.knife){this.stickBlade(p,p.mesh.position.clone(),null);continue;}
        if(p.zap){this.effect(p.mesh.position,0x9fd8ff,4);this.removeEffect(this.projectiles,p);continue;}}
      else{p.mesh.position.add(travel);p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction);if(p.life>0)continue;if(p.knife||p.zap){this.removeEffect(this.projectiles,p);continue;}}
      if(p.def.explosionRadius>0&&!p.zap)this.explode(p.mesh.position.clone(),p.def,{cause:'explosion',mod:'projectile',exclude:null});
      this.removeEffect(this.projectiles,p);
    }
  }
  updateGrenades(dt){
    for(const g of [...this.grenades]){
      g.life-=dt;
      if(g.stuckTo){if(this.enemies.list.includes(g.stuckTo))g.mesh.position.copy(g.stuckTo.root.position).add(g.offset);else g.stuckTo=null;}
      else if(!g.stuck){
        g.velocity.y-=this.gravity(g.mesh.position)*dt;
        const travel=g.velocity.clone().multiplyScalar(dt),length=travel.length(),direction=travel.clone().normalize(),ray=new THREE.Ray(g.mesh.position.clone(),direction);
        const hit=length>0?this.world.raycast(ray,0,length+4):null,actor=g.sticky&&length>0?this.trace(ray,Math.min(length,hit?.distance??length)):null;
        if(actor){g.stuckTo=actor.z;g.offset=actor.point.clone().sub(actor.z.root.position);g.velocity.set(0,0,0);}
        else if(hit){const normal=hit.triangle.getNormal(new THREE.Vector3());if(normal.dot(g.velocity)>0)normal.negate();g.mesh.position.copy(hit.position).addScaledVector(normal,g.sticky?1:4);
          if(g.sticky){g.stuck=true;g.velocity.set(0,0,0);}else{g.velocity.reflect(normal).multiplyScalar(.45);if(normal.y>.5&&g.velocity.length()<40){g.velocity.set(0,0,0);g.stuck=true;}}}
        else g.mesh.position.add(travel);
      }
      // black_hole_bomb: the Gersh activates once stationary (fuse reset to 8 s); the QED's 2 s fuse runs from the throw.
      if(g.equipment==='zombie_black_hole_bomb'&&(g.stuck||g.life<=0)){this.features?.equipment(g.equipment,g.mesh.position.clone());this.removeEffect(this.grenades,g);continue;}
      if(g.life>0)continue;
      if(g.equipment){this.features?.equipment(g.equipment,g.mesh.position.clone());this.removeEffect(this.grenades,g);continue;}
      this.explode(g.mesh.position.clone(),this.data.lethal[g.lethal]??this.data.lethal.frag_grenade_zm,{cause:'grenade',mod:'grenade'});this.removeEffect(this.grenades,g);
    }
  }
  updateMines(dt){
    const s=this.session;
    for(const mine of [...this.mines]){
      if(mine.detonateAt&&s.time>=mine.detonateAt){this.explode(mine.mesh.position.clone().addScaledVector(up,10),mine.def,{cause:'explosion',mod:'mine',playerDamage:false,cone:mine.forward});this.removeEffect(this.mines,mine);continue;}
      if(mine.detonateAt)continue;
      for(const z of this.enemies.list){const d=z.root.position.clone().add(new THREE.Vector3(0,32,0)).sub(mine.mesh.position),flat=Math.hypot(d.x,d.z);
        if(flat>96||d.y<-96||d.y>96||d.dot(mine.forward)<20||d.normalize().dot(mine.forward)<=Math.cos(70*Math.PI/180)||!this.world.lineClear(mine.mesh.position.clone().addScaledVector(up,12),z.root.position.clone().addScaledVector(up,32)))continue;
        mine.detonateAt=s.time+.4;this.audio.play('empty');break;}
    }
  }
  removeEffect(list,item){item.mesh.removeFromParent();if(item.shared||item.mesh.userData.shared)disposeSkeletons(item.mesh);else{item.mesh.geometry?.dispose();item.mesh.material?.dispose?.();}list.splice(list.indexOf(item),1);}
  snapshot(){return {...this.session.snapshot(),area:this.session.area,earthTime:this.session.earthTime,enemies:this.enemies.snapshot(),view:this.view.snapshot(),spawnFailures:this.enemies.spawnFailures,projectiles:this.projectiles.map(p=>({id:p.def.id,position:p.mesh.position.toArray()})),blades:this.blades.length,mines:this.mines.length};}
}
