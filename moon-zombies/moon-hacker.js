import * as THREE from 'three';
import { MOON_PERKS } from './moon-session.js';

const V=a=>new THREE.Vector3(...a),RAD=THREE.MathUtils.degToRad,MCOMP='moon/vox/scripted/zombie_moon/mcomp/vox_mcomp_';
// _zombiemode_hackables_wallbuys skips grenades, melee weapons, mines and bombs.
const WALL_EXCLUDED=new Set(['sticky_grenade_zm','claymore_zm','bowie_knife_zm','frag_grenade_zm']);
// _zombiemode_hackables_powerups: not registered for these types, nor for the Biodome temptation.
const POWERUP_EXCLUDED=new Set(['random_weapon','bonus_points_player','bonus_points_team','lose_points_team']);
// AnglesToRight for a yaw (degrees), in port axes.
const right=yaw=>new THREE.Vector3(Math.sin(RAD(yaw)),0,Math.cos(RAD(yaw)));

// _zombiemode_equip_hacker.gsc with the Moon hackables. With the Hacker out, holding use on a registered spot that
// passes can_hack (2D radius, the 72-high trigger, facing, sight and bullet traces, qualifier) runs hacker_do_hack:
// script_float seconds (x0.66 with Speed Cola, at least 1.5), the zmb_progress_bar loop, and hack_success or hack_fail.
// script_int is charged on success, or paid raw when negative.
export class MoonHacker {
  constructor(features){
    const f=this.f=features;this.hack=null;
    this.walls=f.data.entities.filter(e=>e.targetname==='weapon_upgrade'&&f.combat.data.weapons[e.zombie_weapon_upgrade]&&!WALL_EXCLUDED.has(e.zombie_weapon_upgrade))
      .map(e=>({e,model:f.objects.get(f.one(e.target)?.id)}));
    this.reset();
  }
  get s(){return this.f.s;}
  get a(){return this.f.combat.audio;}
  reset(){this.stop();this.boardRound=null;this.boardHacks=new Map();this.turning=[];this.denied=false;this.packLock=null;this.packReward=true;}
  stop(){if(this.hack)this.a.unloop?.('hacker-progress');this.hack=null;}
  // The spots registered right now; each is {e, kind, origin, radius, duration, cost, ...checks, action}.
  spots(){
    const f=this.f,s=this.s,q=f.quest,list=[];
    const at=(e,offset=[0,0,0])=>V(e.position).add(new THREE.Vector3(...offset));
    // Wall buys: 48, 2 s, 3000, once each; the ammo price is reversed and the model rolls 180 over 0.5 s.
    for(const w of this.walls)if(!s.hackedWeapons.has(w.e.zombie_weapon_upgrade))list.push({e:w.e,kind:'wall',origin:at(w.e),radius:48,duration:2,cost:3000,
      action:()=>{s.hackedWeapons.add(w.e.zombie_weapon_upgrade);if(w.model)this.turning.push({object:w.model,from:w.model.quaternion.clone(),t:0});}});
    // Perks: 18 to the machine's right and 48 up, 48, 5 s, refunding the price; the third solo Quick Revive is final.
    for(const t of f.targets.filter(t=>t.kind==='perk')){
      const perk=t.perk,model=t.e.id==='mule'?{position:t.e.position,yaw:180}:f.one(t.e.target),price=MOON_PERKS[perk]?.price;
      if(!s.perks.has(perk)||s.permanentPerks||!price||!model)continue;
      if(perk==='specialty_quickrevive'&&s.soloLivesGiven>=3)continue;
      if(t.e.position[0]>10000&&(perk!==f.nmlPerk.perk||f.nmlPerk.drop))continue;
      const yaw=model.yaw!==undefined&&t.e.id==='mule'?model.yaw:Number((model.angles??'0 0 0').split(' ')[1]);
      list.push({e:t.e,kind:'perk',origin:V(model.position).addScaledVector(right(yaw),18).add(new THREE.Vector3(0,48,0)),radius:48,duration:5,cost:-price,
        action:()=>{s.losePerk(perk);this.a.sound?.('moon/evt/zombie_moon/evt_perk_throwup',{bus:'sfx'});f.combat.equip().catch(console.error);}});
    }
    // Pack-a-Punch: 26 to the right and 48 up, 48, 5 s. The +1000 is paid only by the registration made while
    // script_int was still -1000 (the first one); the hack closes the zombieland gates for 30 s and is off meanwhile.
    const pack=f.one('zombie_vending_upgrade'),packModel=pack&&f.one(pack.target);
    if(packModel&&!(this.packLock>s.time)){const yaw=Number((packModel.angles??'0 0 0').split(' ')[1]);
      list.push({e:pack,kind:'pack',origin:V(packModel.position).addScaledVector(right(yaw),26).add(new THREE.Vector3(0,48,0)),radius:48,duration:5,cost:this.packReward?-1000:0,
        action:()=>{this.packReward=false;this.packLock=s.time+30;f.closePack();}});}
    // Barricades: 52 above the window, spot radius or 96, 2 s, no touch/sight/bullet checks, facing 0.7. The first two
    // hacks of a window each round pay 100; later ones cost up to 300. The boards return one per frame.
    if(this.boardRound!==s.round){this.boardRound=s.round;this.boardHacks.clear();}
    for(const t of f.targets.filter(t=>t.kind==='barrier')){const b=t.barrier;if(b.count>=b.boards.length||b.hackRepair)continue;
      list.push({e:t.e,kind:'barrier',origin:V(t.e.position),radius:Number(b.radius??96),duration:2,cost:0,noTouch:true,noSight:true,noBullet:true,dot:.7,
        action:()=>{const n=(this.boardHacks.get(b)??0)+1;this.boardHacks.set(b,n);if(n<=2)s.addRaw(100);else s.points-=Math.min(300,s.points);
          b.hackRepair={next:0};}});}
    // Doors and airlocks: the trigger, 48, 32.7 s, 200, sight trace only; the hack opens every side of the door.
    for(const d of f.data.doors){if(s.openDoors.has(d.name))continue;
      for(const id of d.triggers){const e=f.data.entities[id];if(!['zombie_door','zombie_airlock_buy'].includes(e?.targetname))continue;
        list.push({e,kind:'door',origin:V(e.position),radius:48,duration:32.7,cost:200,noBullet:true,action:()=>f.openDoor?.(d)});}}
    // Power-ups: the drop point, 65, 5 s, 5000, once; Max Ammo becomes a Fire Sale and anything else a Max Ammo in
    // place, keeping its timeout; the red power-ups are replaced by a fresh Max Ammo.
    for(const p of f.combat.pickups.items){if(p.hacked||p.temptation||POWERUP_EXCLUDED.has(p.type))continue;
      p.hackOrigin??=p.root.position.clone();
      list.push({e:{id:'powerup-'+p.netId,position:p.hackOrigin.toArray()},kind:'powerup',origin:p.hackOrigin,radius:65,duration:5,cost:5000,
        action:()=>{if(!f.combat.pickups.items.includes(p))return;
          if(p.def?.zombieGrabbable){const position=p.root.position.clone().setY(p.root.position.y-40);f.combat.pickups.remove(p);const n=f.combat.pickups.spawn('full_ammo',position);if(n)n.hacked=true;}
          else{f.combat.pickups.retype(p,p.type==='full_ammo'?'fire_sale':'full_ammo');p.hacked=true;this.a.event?.('powerup/spawn/spawn_00',.65,p.root.position);}}});}
    // Mystery Box: respin (600) and re-respin (+950) on a shown offer for its user, summon (1200) on a hidden chest.
    for(const b of f.box.boxes.values()){const r=b.roll,origin=V(b.entity.position).add(new THREE.Vector3(0,24,0));
      if(r?.ready&&!r.teddy&&!r.rerespun)list.push({e:b.entity,kind:'box',origin,radius:48,duration:1.5,cost:r.respun?-950:600,
        action:()=>{if(b.roll!==r)return;if(r.respun)f.box.rerespin(b);else f.box.respin(b.entity);}});
      if(!r&&!b.summoned&&!f.box.available(b.entity)&&(f.box.hacked.get(b.id)??0)<=s.round&&f.box.moving?.id!==b.id&&b.id!==f.box.world.activeBox?.id)
        list.push({e:b.entity,kind:'summon',origin,radius:48,duration:5,cost:1200,noBullet:true,action:()=>f.box.summon(b.entity)});}
    // Excavator consoles: 12 below the switch, 64, 5 s, +1000, no sight or bullet checks.
    for(const t of f.targets.filter(t=>t.kind==='digger'))if(q.hackable(t.id))
      list.push({e:t.e,kind:'digger',origin:V(t.e.position).add(new THREE.Vector3(0,-12,0)),radius:64,duration:5,cost:-1000,noSight:true,noBullet:true,action:()=>q.hackDigger(t.id)});
    // Security: the covered buttons (48, 4 s, 500, no sight or bullet checks) start it; then the four lit terminals (5 s, free).
    if(q.stage==='security_start')for(const e of f.all('struct_osc_button'))list.push({e,kind:'security',origin:V(e.position),radius:48,duration:4,cost:500,noSight:true,noBullet:true,action:()=>q.startSecurity()});
    if(q.stage==='security')for(const id of q.securityTargets.filter(id=>!q.security.has(id))){const e=f.data.entities[id];
      list.push({e,kind:'terminal',origin:V(e.position),radius:48,duration:5,cost:0,action:()=>q.hackSecurity(id)});}
    return list;
  }
  // can_hack without the use button.
  canHack(spot){
    const f=this.f,s=this.s;if(!s.hacker||!s.hackerOut||s.hackerSwap||s.lastStand||!['fighting','preparing'].includes(s.phase))return false;
    const feet=f.player.getFeetPosition(),o=spot.origin,dx=o.x-feet.x,dz=o.z-feet.z,d=Math.hypot(dx,dz);
    if(d>spot.radius)return false;
    if(!spot.noTouch&&(feet.y<o.y-72||feet.y>o.y+72))return false;
    const forward=f.camera.getWorldDirection(new THREE.Vector3()),flat=Math.hypot(forward.x,forward.z);
    if(d>1e-3&&(forward.x*dx+forward.z*dz)/(flat*d)<=(spot.dot??.8))return false;
    if(!spot.noSight||!spot.noBullet){const eye=feet.clone().add(new THREE.Vector3(0,50,0)),to=o.clone().sub(eye),len=to.length();
      const hit=len>1&&f.raycast(new THREE.Ray(eye,to.normalize()),1,len);if(hit&&hit.distance<len-8)return false;}
    return true;
  }
  find(){let best=null,near=Infinity;for(const spot of this.spots()){if(!this.canHack(spot))continue;const d=spot.origin.distanceTo(this.f.player.getFeetPosition());if(d<near){near=d;best=spot;}}return best;}
  same(a,b){return a&&b&&a.kind===b.kind&&a.e.id===b.e.id;}
  update(dt,held){
    const s=this.s;
    for(const t of [...this.turning]){t.t=Math.min(.5,t.t+dt);t.object.quaternion.copy(t.from).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI*t.t/.5));if(t.t>=.5)this.turning.splice(this.turning.indexOf(t),1);}
    // _zombiemode_hackables_boards: replace_chunk one board per network frame.
    for(const t of this.f.targets.filter(t=>t.kind==='barrier')){const b=t.barrier,r=b.hackRepair;if(!r)continue;
      if((r.next-=dt)<=0){r.next=.05;if(b.count<b.boards.length){this.f.setBoards(b,b.count+1);this.a.play?.('board');}else b.hackRepair=null;}}
    if(this.hack){
      const h=this.hack,spot=this.spots().find(x=>this.same(x,h.spot));
      if(!held||!spot||!this.canHack(spot)){this.a.unloop?.('hacker-progress');this.a.sound?.(MCOMP+'hack_fail',{bus:'vox'});this.hack=null;this.f.combat.hackerLowReady?.(false);return;}
      h.left-=dt;if(h.left>0)return;
      this.a.unloop?.('hacker-progress');this.a.sound?.(MCOMP+'hack_success',{bus:'vox'});this.hack=null;this.f.combat.hackerLowReady?.(false);
      if(spot.cost>0)s.points=Math.max(0,s.points-spot.cost);else if(spot.cost<0)s.addRaw(-spot.cost);
      spot.action();return;
    }
    if(!held){this.denied=false;return;}
    const spot=this.find();if(!spot)return;
    // Not enough points: no_purchase and the no_money line, once per press.
    if(spot.cost>0&&s.points<spot.cost){if(!this.denied){this.denied=true;this.a.noMoney?.();}return;}
    const duration=s.hackTime(spot.duration);
    this.hack={spot,target:{e:spot.e,kind:spot.kind},duration,left:duration};
    this.a.loop?.('hacker-progress','moon/evt/zombie_moon/hack/hack_l',{bus:'sfx',volume:.8});this.f.combat.hackerLowReady?.(true);
  }
  // The hint the hacker sees for the spot in front of them (ZOMBIE_HACK, ZOMBIE_HACK_NO_COST, ZOMBIE_MOON_DISABLE_DIGGER).
  hint(spot){return spot.kind==='digger'?{loc:'DIGGER'}:spot.cost>0?{loc:'HACK',cost:spot.cost}:{loc:'HACK_NO_COST'};}
}
