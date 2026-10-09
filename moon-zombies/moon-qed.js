import * as THREE from 'three';
import { loadModel } from './animation.js';
import { DIGGERS } from './moon-progression.js';

const V=a=>new THREE.Vector3(...a),UP=new THREE.Vector3(0,1,0),RAD=Math.PI/180;
// T5 angles (pitch, yaw) to a forward vector in the browser's y-up axes (x, z, -y).
const forward=(pitch,yaw)=>new THREE.Vector3(Math.cos(pitch)*Math.cos(yaw),-Math.sin(pitch),-Math.cos(pitch)*Math.sin(yaw));

// _zombiemode_weap_quantum_bomb.gsc init_registration and the results registered through
// level.quantum_bomb_register_result_func (_zombiemode_blockers.gsc:37, _zombiemode_perks.gsc:106,
// _zombiemode_powerups.gsc:153-156, zombie_moon_digger.gsc:48). No chance means 100, no validation passes.
// The quest's ctvg and be2 entries only notify from their validation and are never eligible.
export const QED_RESULTS=[
  ['random_lethal_grenade',50],['random_weapon_starburst',75],['pack_or_unpack_current_weapon',10,'packOrUnpack'],
  ['auto_revive',60,'autoRevive'],['player_teleport',20],['zombie_speed_buff',2],['zombie_add_to_total',70,'addToTotal'],
  ['zombie_fling',100],['open_nearest_door',35,'nearestDoor'],['give_nearest_perk',10,'nearestPerk'],
  ['random_powerup',5,'playable'],['random_zombie_grab_powerup',5,'playable'],['random_weapon_powerup',60,'playable'],
  ['random_bonus_or_lose_points_powerup',25,'playable'],['remove_digger',75,'removeDigger'],
].map(([name,chance,validation])=>({name,chance,validation}));

// quantum_bomb_select_result: one RandomInt(100); every result whose chance exceeds it and whose validation passes
// is eligible, and one is picked uniformly. zombie_fling is always eligible.
export function selectQedResult(random,valid){
  const roll=Math.floor(random()*100),eligible=QED_RESULTS.filter(r=>r.chance>roll&&(!r.validation||valid(r.validation)));
  return eligible[Math.floor(random()*eligible.length)].name;
}

// zombie_moon.gsc blackhole_bomb_area_check: zones that trap players while both tunnel excavators block.
const TRAPPED=['water_zone','cata_right_start_zone','airlock_east_zone','airlock_bridge_zone','bridge_zone','airlock_west_zone','cata_left_start_zone','cata_left_middle_zone'];

export class MoonQed {
  constructor(features){this.f=features;this.timers=[];this.props=[];}
  get s(){return this.f.s;}
  get combat(){return this.f.combat;}
  get enemies(){return this.f.combat.enemies;}
  random(n){return Math.floor(this.s.random()*n);}
  after(delay,fn){this.timers.push({left:delay,fn});}
  update(dt){for(const t of [...this.timers]){t.left-=dt;if(t.left<=0){this.timers.splice(this.timers.indexOf(t),1);t.fn();}}}
  reset(){this.timers=[];for(const p of this.props)p.removeFromParent();this.props=[];}
  vox(type){this.combat.audio.vox?.('kill',type);}
  feet(){return this.f.player.getFeetPosition();}
  zoneAt(p){const q=p.clone().setY(p.y+40);for(const z of this.enemies.map?.zones?.values()??[])if(z.volumes.some(b=>q.x>=b[0][0]&&q.x<=b[1][0]&&q.y>=b[0][1]&&q.y<=b[1][1]&&q.z>=b[0][2]&&q.z<=b[1][2]))return z.name;return null;}
  // check_point_in_playable_area: the point lies in an enabled zone.
  playable(position){return this.cachedPlayable??=!!this.enemies.pointInEnabledZone?.(position);}
  doors(){return ['zombie_door','zombie_airlock_buy','zombie_debris'].flatMap(name=>this.f.all(name)).map(e=>({e,door:this.f.data.doors.find(d=>d.triggers.includes(e.id))})).filter(t=>t.door&&!this.s.openDoors.has(t.door.name));}
  // zombie_vending triggers; the Area 51 pair only counts the machine that has arrived.
  machines(){return [...this.f.all('zombie_vending').filter(e=>e.position[0]<10000||e.script_noteworthy===this.f.nmlPerk?.perk),this.f.muleVending].filter(Boolean);}
  diggerNear(position){return ['hangar','teleporter'].filter(id=>{const e=this.f.one(DIGGERS[id].blocker);if(!e)return false;const p=V(e.position);if(this.f.quest.diggers[id].blocked)p.y-=512;return p.distanceToSquared(position)<600*600;});}
  validate(name,position){
    const near=(list,range)=>list.some(e=>V(e.position).distanceToSquared(position)<range*range);
    switch(name){
      case 'playable':return this.playable(position);
      case 'packOrUnpack':if(!this.playable(position))return false;return near(this.f.all('zombie_vending_upgrade'),180)||!this.random(5);
      case 'autoRevive':return false; // flag("solo_game")
      case 'addToTotal':return this.s.total-this.s.spawned<=0&&this.enemies.list.length<24;
      case 'nearestDoor':return near(this.doors().map(t=>t.e),180);
      case 'nearestPerk':return near(this.machines(),180);
      case 'removeDigger':{const d=this.f.quest.diggers;return d.teleporter.breached&&d.hangar.breached&&this.diggerNear(position).length>0;}
    }
    return true;
  }
  detonate(position){
    this.cachedPlayable=undefined;
    // force mirrors the scr_force_quantum_bomb_result developer dvar.
    const result=this.force??selectQedResult(()=>this.s.random(),name=>this.validate(name,position));
    this[result](position);this.cachedPlayable=undefined;return result;
  }
  random_lethal_grenade(position){
    this.vox('quant_good');
    const type=['frag_grenade_zm','sticky_grenade_zm'][this.random(2)],d=this.combat.data.lethal?.[type];
    // MagicGrenadeType with a 0.35 s fuse; its MOD_GRENADE_SPLASH takes the grenade bonus (round + 100..199).
    if(d)this.after(.35,()=>this.combat.explode(position.clone(),d,{cause:'grenade',mod:'grenade'}));
  }
  random_weapon_starburst(position){
    this.vox('quant_good');
    const r=this.random(20),order=[[3,'ray_gun_zm'],[5,'spas_zm'],[7,'china_lake_zm'],[9,'m72_law_zm'],[10,'python_zm']];
    // The switch falls through to the next upgraded weapon the level includes; 10-19 is the base Ray Gun.
    let id='ray_gun_zm',upgraded=false;
    for(let i=order.findIndex(([end])=>r<end);i>=0&&i<order.length;i++)if(this.combat.data.weapons[order[i][1]]?.upgrade){id=order[i][1];upgraded=true;break;}
    const base=this.combat.data.weapons[id],d=upgraded?{...base,...base.upgrade,id,upgraded:true}:base;
    this.combat.effect(position,0x83c7ff,20);
    const feet=this.feet(),yaw=Math.atan2(-(position.z-feet.z),position.x-feet.x),start=position.clone(),top=position.clone().add(new THREE.Vector3(0,40,0));
    const url=d.worldModel??base.worldModel,holder=new THREE.Group();holder.position.copy(start);holder.rotation.y=yaw;this.f.scene.add(holder);this.props.push(holder);
    if(url)loadModel(url).then(model=>{if(holder.parent)holder.add(model);}).catch(console.error);
    // MoveTo(base_pos, 1, 0.25, 0.25), then 36 MagicBullets ten degrees apart, one per network frame.
    const ease=t=>t<.25?8*t*t/3:t>.75?1-8*(1-t)*(1-t)/3:(4*t-.5)/3;
    for(let k=1;k<=20;k++)this.after(k*.05,()=>holder.position.lerpVectors(start,top,ease(k/20)));
    for(let i=0;i<36;i++)this.after(1+i*.05,()=>{
      const pitch=(this.random(6)-3)*RAD,turn=yaw+i*10*RAD,dir=forward(pitch,turn);holder.rotation.y=turn;
      const flash=top.clone().addScaledVector(dir,24);
      if(d.weaponType==='projectile')this.combat.launch(d,flash,dir,{owner:'player'});
      else for(let p=0;p<Math.max(1,d.weaponClass==='spread'?d.pellets:1);p++)this.combat.bullet(flash,dir,d,'player');
    });
    this.after(1+36*.05,()=>{holder.removeFromParent();this.props.splice(this.props.indexOf(holder),1);});
  }
  pack_or_unpack_current_weapon(position){
    this.combat.effect(position,0xb98cff,30);
    const s=this.s,w=s.weapon,d=w&&this.combat.data.weapons[w.id];
    if(!d||s.lastStand||s.effects.death_machine>s.time||!s.inventory.includes(w))return;
    if(w.upgraded){if(this.random(5))return;w.upgraded=false;this.vox('quant_bad');}
    else{if(!d.upgrade||!this.random(4))return;w.upgraded=true;this.vox('quant_good');}
    w.alt=false;w.altAmmo=w.mainAmmo=undefined;s.fillWeapon(w);s.cancelReload();this.combat.equip().catch(console.error);
  }
  auto_revive(){}
  // quantum_bomb_teleport_player through zombie_moon.gsc blackhole_bomb_area_check and get_blackholebomb_destination_point.
  destination(){
    const s=this.s,d=this.f.quest.diggers,feet=this.feet(),nml=s.area==='earth';
    let structs=this.f.all(nml?'struct_black_hole_teleport_nml':'struct_black_hole_teleport');
    if(!nml&&d.teleporter.blocked&&d.hangar.blocked&&!s.hacker&&TRAPPED.includes(this.zoneAt(feet)))structs=structs.filter(e=>!TRAPPED.includes(this.zoneAt(V(e.position).setY(e.position[1]-40))));
    const here=this.zoneAt(feet);
    for(const e of [...structs].sort(()=>this.s.random()-.5)){
      const p=V(e.position);if(!this.enemies.pointInEnabledZone?.(p))continue;
      if(nml||this.zoneAt(p)!==here)return e;
    }
    return null;
  }
  teleport(e){
    const p=V(e.position);if(this.f.player.crouched)p.y+=20;
    this.combat.effect(this.feet(),0x83c7ff,20);this.f.player.setPosition(p);if(e.yaw!==undefined)this.f.camera.rotation.y=e.yaw-Math.PI/2;
    this.f.state.exposure=0;this.combat.audio.play('moon/evt/zombie_cosmodrome/gersh/gersh_teleport');this.combat.effect(p,0x83c7ff,20);
  }
  player_teleport(position){
    this.combat.effect(position,0xb98cff,30);
    // quantum_bomb_prevent_player_getting_teleported_override: not while a jump pad has the player.
    if(this.s.lastStand||this.f.flight)return;
    const e=this.destination();if(e)this.teleport(e);
  }
  zombie_speed_buff(position){
    this.combat.effect(position,0xb98cff,30);this.vox('quant_bad');
    for(const z of this.enemies.list){
      if(z.kind==='dog'||z.kind==='astronaut')continue;
      z.moveSpeed='sprint';z.superSprint=true;this.enemies.setCycle(z,z.kind==='zombie'&&!z.lowGravity?'ai_zombie_fast_sprint_01':this.enemies.cycleName(z));
    }
  }
  zombie_add_to_total(position){
    this.combat.effect(position,0xb98cff,30);this.vox('quant_bad');
    if(this.s.area==='moon'&&this.s.phase==='fighting')this.s.total+=24; // zombie_ai_limit
  }
  zombie_fling(position){
    this.combat.effect(position,0xc7efff,30);this.vox('quant_good');
    const at=z=>z.root.position.clone().add(new THREE.Vector3(0,40,0)).distanceToSquared(position);
    for(const z of [...this.enemies.list].sort((a,b)=>at(a)-at(b))){
      if(at(z)>300*300)break;
      // DoDamage( health + 666 ) from the player: a plain kill worth 50 points.
      this.combat.hurt(z,z.health+666,{location:'none',cause:'qed'});
    }
  }
  open_nearest_door(position){
    const t=this.doors().find(t=>V(t.e.position).distanceToSquared(position)<180*180);if(!t)return;
    this.vox('quant_good');this.combat.effect(position,0xb98cff,30);
    this.s.openDoors.add(t.door.name);if(t.door.flag)this.s.flags.add(t.door.flag);this.f.opened.add(t.door.name);
  }
  give_nearest_perk(position){
    this.combat.effect(position,0xb98cff,30);
    const list=this.machines();let best=null;for(const e of list)if(!best||V(e.position).distanceToSquared(position)<V(best.position).distanceToSquared(position))best=e;
    const perk=best?.script_noteworthy,s=this.s;
    if(!perk||s.lastStand||s.perks.has(perk)||s.drinking===perk||!this.random(5))return;
    this.vox('quant_good');s.givePerk(perk);
  }
  spawnPowerup(type,position,options){this.combat.effect(position,0xb98cff,20);this.combat.pickups.spawn(type,position.clone(),options);}
  random_powerup(position){
    let keys=['nuke','insta_kill','double_points','full_ammo','carpenter','fire_sale','minigun','free_perk'];
    while(keys.length){
      const key=keys[this.random(keys.length)];
      const skip=['full_ammo','insta_kill','fire_sale','minigun'].includes(key)?this.random(4)!==0:key==='free_perk'?this.random(20)!==0:false;
      if(skip){keys=keys.filter(k=>k!==key);continue;}
      this.vox('quant_good');this.spawnPowerup(key,position);return;
    }
  }
  random_zombie_grab_powerup(position){this.vox('quant_bad');this.spawnPowerup(['lose_points_team','lose_perk','empty_clip'][this.random(3)],position);}
  random_weapon_powerup(position){
    const pool=this.f.box?.pool?.({player:false})??[];if(!pool.length)return;
    const id=pool[this.random(pool.length)],upgraded=!!this.combat.data.weapons[id]?.upgrade&&!this.random(4);
    this.vox('quant_good');this.spawnPowerup('random_weapon',position,{weapon:{id,upgraded}});
  }
  random_bonus_or_lose_points_powerup(position){
    const r=this.random(10),type=r<2?'lose_points_team':r<5?'bonus_points_player':'bonus_points_team';
    if(type==='lose_points_team')this.vox('quant_bad');this.spawnPowerup(type,position);
  }
  remove_digger(position){
    for(const id of this.diggerNear(position)){this.f.quest.removeDigger?.(id);this.combat.effect(position,0xb98cff,30);}
  }
}
