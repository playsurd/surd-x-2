import * as THREE from 'three';
import { Enemies } from './enemies.js';
import { loadModel, loadAnimation } from './animation.js';
import { zombieHealth } from './rules.js';
import { moonMaxZombies } from './moon-session.js';

const V=a=>new THREE.Vector3(...a),Z='ai_zombie_',DEG=Math.PI/180;
const turn=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))),yawOf=d=>Math.atan2(-d.z,d.x);
// _zombiemode.csc createZombieEyes: eye_glow (misc/fx_zombie_eye_single) on J_Eyeball_LE; once the charged Vril
// Device sits in the MPD, zombie_moon_sq.csc vg_init switches newly spawned zombies to blue_eyes.
let eyeTexture=null;const eyeMaterials={};
const eyeMaterial=blue=>eyeMaterials[blue]??=new THREE.SpriteMaterial({map:eyeTexture??=new THREE.TextureLoader().load('textures/fxt_light_flare2.png'),color:blue?0x6cb6ff:0xffa82e,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false,fog:false});
// GSC randomintrange(a,b) returns a..b-1.
const randInt=(s,a,b)=>b<=a?a:a+Math.floor(s.random()*(b-a)),pick=(s,list)=>list[Math.floor(s.random()*list.length)];
const shuffle=(s,list)=>{const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(s.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const inside=(b,p)=>p.x>=b[0][0]&&p.x<=b[1][0]&&p.y>=b[0][1]&&p.y<=b[1][1]&&p.z>=b[0][2]&&p.z<=b[1][2];
const range=(prefix,a,b)=>Array.from({length:b-a+1},(_,i)=>prefix+(a+i));
// _zombiemode.gsc walk1-7/run1-5/sprint1-4 (zombie_moon.gsc walk3, zombie_moon_wasteland.gsc sprint5), _zombiemode_ai_quad.gsc
// quad cycles and the zombie_moon_gravity.gsc low-gravity sets. Speeds come from each clip's root motion.
const CYCLES={
  zombie:{walk:['walk_v1','walk_v2','walk_v2','walk_v4','walk_v6','walk_v7','walk_v9'],run:['walk_fast_v1','walk_fast_v2','walk_fast_v3','run_v2','run_v4'],
    sprint:['sprint_v1','sprint_v2','sprint_v1','sprint_v2','fast_sprint_01'],walk_moon:['walk_moon_v1'],run_moon:range('run_moon_v',1,4),sprint_moon:range('sprint_moon_v',1,4)},
  nova:{walk:['quad_crawl','quad_crawl','quad_crawl','quad_crawl_2','quad_crawl_2','quad_crawl_3','quad_crawl_3'],run:['quad_crawl_run',...range('quad_crawl_run_',2,5)],
    sprint:['quad_crawl_sprint','quad_crawl_sprint_2','quad_crawl_sprint_3'],walk_moon:['quad_crawl_moon','quad_crawl_moon_01'],
    run_moon:['quad_crawl_run_moon',...range('quad_crawl_run_moon_',2,5)],sprint_moon:['quad_crawl_sprint_moon','quad_crawl_sprint_moon_2','quad_crawl_sprint_moon_3']}};
const RISE={walk:Z+'traverse_ground_v1_walk',run:Z+'traverse_ground_v1_run',sprint:Z+'traverse_ground_climbout_fast'},RISE_V2=Z+'traverse_ground_v2_walk_alta';
const FALL={emerge:Z+'ceiling_emerge_01',drop:Z+'ceiling_dropdown_01',loop:Z+'ceiling_fall_loop',land:Z+'ceiling_fall_land'};
const NML_SPAWN='nml_zone_spawners',NML_WAVES=['nml_area1_spawners','nml_area2_spawners'],ASTRO_WALK=Z+'astro_walk_moon_v1',HEADBUTT=Z+'astro_headbutt';
// Root motion is stored in anim space: x forward, y left, z up.
function rootAt(clip,t){
  const d=clip?.delta,out=new THREE.Vector3();if(!d)return out;
  const f=Math.max(0,t*clip.fps),n=d.frames.length,v=d.values;let i=0;while(i<n-1&&d.frames[i+1]<=f)i++;
  const j=Math.min(i+1,n-1),k=j>i?Math.min(1,(f-d.frames[i])/(d.frames[j]-d.frames[i])):0;
  return out.set(v[i*3]+(v[j*3]-v[i*3])*k,v[i*3+1]+(v[j*3+1]-v[i*3+1])*k,v[i*3+2]+(v[j*3+2]-v[i*3+2])*k);
}
const toWorld=(d,yaw)=>new THREE.Vector3(Math.cos(yaw)*d.x-Math.sin(yaw)*d.y,d.z,-Math.sin(yaw)*d.x-Math.cos(yaw)*d.y);

export class MoonEnemies extends Enemies {
  constructor(...args){
    super(...args);this.autoSpawn=false;this.autoRounds=false;this.spawnFailures=0;this.riseCache=new Map();
    // player_damage_override ignores a repeat hit from the same attacker for 0.4 s (remove_ignore_attacker).
    const damage=this.onDamage;this.rawDamage=damage;this.onDamage=(n,target,z)=>{z??=typeof target==='object'?target:null;const t=this.session.time;if(z&&this.lastAttacker===z&&t-this.lastAttack<.4)return;this.lastAttacker=z;this.lastAttack=t;damage?.(n);};
    this.resetDirector();
  }
  async load(){
    const actors=this.data.actors;
    this.lunarBodies=await Promise.all(actors.technicians.map(n=>loadModel(actors.models[n])));
    this.earthBodies=[await loadModel(actors.models[actors.military])];
    this.heads=await Promise.all(actors.heads.map(n=>loadModel(actors.models[n])));
    [this.astroBody,this.astroHead,this.quad,this.quadHead,this.dog]=await Promise.all([
      'c_zom_moon_pressure_suit_body_zombie','c_zom_moon_pressure_suit_helm','c_zom_quad_body_bloat','c_zom_quad_head_bloat'
    ].map(n=>loadModel(actors.models[n])).concat([loadModel(this.data.characters.zombie_wolf)]));
    await Promise.all(Object.entries(this.data.animations).filter(([name])=>name.startsWith('ai_zombie_')||name.startsWith('zombie_dog_')).map(async([name,url])=>this.anims[name]=await loadAnimation(url)));
  }
  resetDirector(){
    const s=this.session;
    // _zombiemode.gsc init_levelvars and _zombiemode_ai_astro.gsc init.
    this.spawnDelay=3;this.roundDelay=this.data.rules?.zombie_spawn_delay??2;this.moveSpeed=1;this.oldSpawner=null;this.oldDog=null;
    this.nextAstroRound=1+randInt(s,0,3);this.astroManager=false;this.astroThreshold=0;this.parked=null;this.lastAttacker=null;
    this.roundKey=null;this.speedUp=null;this.tracking=10;this.zoneTimer=0;this.zones=null;this.fallTaken=new Set();this.nmlInitial=true;this.nml=this.newNml(1);
  }
  newNml(lastRound){return {clock:0,start:null,mode:'normal',next:25,area:1,wait:0,wave:null,waveWait:0,timer:lastRound,ramp:null,dogsAt:30,dogGate:-Infinity,dogCheck:0,dogTargets:0,dogHealth:100,superSprint:false,prepared:new Set()};}
  get map(){
    if(this._map!==undefined)return this._map;const data=this.world.navigation?.data;if(!data)return null;
    const e=data.entities,by=n=>e.filter(x=>x.targetname===n),zones=new Map();
    for(const v of e.filter(x=>x.script_noteworthy==='player_volume')){if(!zones.has(v.targetname))zones.set(v.targetname,{name:v.targetname,target:v.target,low:v.script_string==='lowgravity',volumes:[]});zones.get(v.targetname).volumes.push(v.bounds);}
    for(const z of zones.values())Object.assign(z,{spawners:e.filter(x=>x.targetname===z.target&&x.classname.startsWith('actor_')&&x.classname!=='actor_zombie_dog'),rise:by(z.target+'_rise'),fall:by(z.target+'_fall'),dog:by(z.target+'_dog'),astro:by(z.target+'_astro')});
    return this._map={zones,links:data.zoneLinks,goals:by('exterior_goal'),astroSpawner:by('astronaut_zombie')[0],dogVolume:by('nml_dogs_volume')[0]?.bounds,named:by};
  }
  flag(name){const f=this.session.flags;return f.has(name)||name==='digsite_group'&&(f.has('exit_dig_east')||f.has('forest_enter_digsite'));}
  zoneOf(p){for(const z of this.map.zones.values())if(z.volumes.some(b=>inside(b,p)))return z.name;}
  // _zombiemode_zone_manager.gsc manage_zones: occupied zones plus their connected, enabled neighbours.
  updateZones(player){
    const cut=this.world.navigation?.cut;
    const m=this.map,p=player.clone().setY(player.y+35),links=m.links.filter(([a,b,f])=>this.flag(f)&&!cut?.has(a+'|'+b)&&!cut?.has(b+'|'+a)),enabled=new Set(['bridge_zone','nml_zone']);
    for(const [a,b] of links){enabled.add(a);enabled.add(b);}
    const occupied=new Set([...m.zones.values()].filter(z=>enabled.has(z.name)&&z.volumes.some(b=>inside(b,p))).map(z=>z.name)),active=new Set(occupied);
    for(const [a,b] of links){if(occupied.has(a)&&enabled.has(b))active.add(b);if(occupied.has(b)&&enabled.has(a))active.add(a);}
    if(!active.size){active.add('bridge_zone');occupied.add('bridge_zone');}
    this.zones={enabled,occupied,active,current:this.zoneOf(p)};
  }
  // check_point_in_active_zone tests enabled zone volumes.
  pointInEnabledZone(p){const q=p.clone().setY(p.y+40);return [...this.map.zones.values()].some(z=>this.zones?.enabled.has(z.name)&&z.volumes.some(b=>inside(b,q)));}
  navPoint(position,extent=60){const p=V(position),c=this.world.closest?.(p,{x:extent,y:Math.max(90,extent),z:extent});return c&&c.distanceTo(p)<=extent*1.5?c:null;}
  cachedNav(e,extent){if(!this.riseCache.has(e.id))this.riseCache.set(e.id,this.navPoint(e.position,extent));return this.riseCache.get(e.id)?.clone();}
  speedOf(name){const c=this.anims[name],d=c?.delta;if(!d||!c.duration)return 0;const v=d.values,n=v.length-3;return Math.hypot(v[n]-v[0],v[n+1]-v[1])/c.duration;}
  // set_run_speed: randomintrange(zombie_move_speed, +35) <=35 walk, <=70 run, else sprint.
  rollSpeed(){const r=randInt(this.session,this.moveSpeed,this.moveSpeed+35);return r<=35?'walk':r<=70?'run':'sprint';}
  cycleName(z){
    const s=this.session,set=CYCLES[z.kind==='nova'?'nova':'zombie'];
    if(z.lowGravity)return Z+pick(s,set[z.moveSpeed+'_moon']);
    const list=set[z.moveSpeed],n=z.moveSpeed==='walk'?7:z.moveSpeed==='run'?5:z.superSprint?5:3;return Z+list[randInt(s,0,Math.min(n,list.length))];
  }
  setCycle(z,name){
    const clip=this.anims[name];if(!clip)return;if(!z.rig.actions[name])z.rig.add(name,clip,true);
    const old=z.rig.actions.walk,playing=z.rig.current==='walk';z.rig.actions.walk=z.rig.actions[name];z.rig.data.walk=clip;z.cycle=name;z.speed=this.speedOf(name)||z.speed;
    if(playing&&old!==z.rig.actions.walk){old?.stop();z.rig.current=null;z.rig.play('walk');}
  }
  clipPlay(z,key,loop=false){const clip=this.anims[key];if(!clip)return null;if(!z.rig.actions[key])z.rig.add(key,clip,true);z.rig.play(key,loop,1,.1);return clip;}
  healthRound(){return this.session.area==='earth'?this.nml.timer:this.session.round;}
  spawn(position,barrier=null,kind='zombie',{military=this.session.area==='earth',sprint=false}={}){
    const s=this.session,heads=this.heads;this.templates=military?this.earthBodies:this.lunarBodies;
    if(kind==='astronaut'){this.templates=[this.astroBody];this.heads=[this.astroHead];}
    const z=super.spawn(position,barrier,kind==='astronaut'?'zombie':kind);this.heads=heads;z.kind=kind;z.born=s.time;
    // Actors can move through the yard's cached world shadows without baking
    // their own moving silhouettes into that static shadow map.
    z.root.traverse(object=>{if(object.isMesh)object.receiveShadow=true;});
    const health=zombieHealth(this.healthRound(),this.data.rules);
    // _zombiemode_ai_astro.gsc health x4 (solo); quad prespawn x0.75; meleeDamage 60/45/50 and dogs 40.
    z.health=z.maxHealth=kind==='astronaut'?health*4:kind==='nova'?Math.trunc(health*.75):kind==='dog'?this.nml.dogHealth:health;
    z.meleeDamage={zombie:60,nova:45,dog:40,astronaut:50}[kind];
    if(kind==='astronaut'){s.spawned--;z.nextHeadbutt=s.time+2;z.ignoreGravity=true;this.setCycle(z,ASTRO_WALK);}
    else if(kind==='dog')this.setCycle(z,'zombie_dog_run');
    else{z.moveSpeed=sprint?'sprint':this.rollSpeed();z.superSprint=sprint&&this.nml.superSprint;z.lowGravity=s.area==='moon'&&!!this.world.lowGravity?.(z.root.position);this.setCycle(z,this.cycleName(z));}
    z.rig.current=null;z.rig.play('walk',true,1,0);z.rig.update(.01);
    const eyeball=kind==='zombie'&&z.root.getObjectByName('j_eyeball_le');
    if(eyeball&&typeof document!=='undefined'){z.eyeBone=eyeball;z.eye=new THREE.Sprite(eyeMaterial(!!s.permanentPerks));z.eye.scale.setScalar(9);this.scene.add(z.eye);}
    return z;
  }
  spawnFrom(sp,{sprint=false}={}){
    const s=this.session,military=sp.classname.includes('militarypolice'),quad=sp.classname==='actor_zombie_moon_quad',mode=sp.script_string;
    if(quad||mode==='zombie_chaser'){
      const p=quad&&this.playerPos&&this.world.navigation?.closestReachable
        ?this.world.navigation.closestReachable(V(sp.position),this.playerPos,250):this.cachedNav(sp,quad?250:750);
      if(!p)return null;const z=this.spawn(p,null,quad?'nova':'zombie',{military,sprint});z.root.rotation.y=sp.yaw??0;return z;
    }
    if(mode==='riser'){
      // Risers use any active zone's *_rise struct (level.zombie_rise_spawners); off-navmesh structs are skipped.
      const spots=[...this.zones.active].flatMap(n=>this.map.zones.get(n)?.rise??[]).map(e=>({e,p:this.cachedNav(e,40)})).filter(x=>x.p);if(!spots.length)return null;
      const spot=pick(s,spots),z=this.spawn(spot.p,null,'zombie',{military,sprint});this.rise(z,spot);return z;
    }
    if(mode==='faller'){
      const zone=[...this.map.zones.values()].find(z=>z.target===sp.targetname),spots=(zone?.fall??[]).filter(f=>!this.fallTaken.has(f.id));
      if(!spots.length)return null;const spot=pick(s,spots),z=this.spawn(V(spot.position),null,'zombie',{military,sprint});this.fall(z,spot);return z;
    }
    const b=this.pickGoal(sp);if(!b)return null;const z=this.spawn(V(sp.position),null,'zombie',{military,sprint});this.approach(z,b);return z;
  }
  // zombie_think: three closest exterior goals to the spawner target, dropping any more than 500 further away.
  pickGoal(sp){
    if(!this.barriers?.length)return null;const origin=V(sp.position),desired=sp.target?V(this.map.named(sp.target)[0]?.position??sp.position):origin;
    const nodes=this.barriers.slice().sort((a,b)=>a.outside.distanceTo(desired)-b.outside.distanceTo(desired)).slice(0,3),chosen=[nodes[0]];
    for(let i=1,prev=origin.distanceTo(nodes[0].outside);i<nodes.length;i++){const d=origin.distanceTo(nodes[i].outside);if(d-prev>500)break;prev=d;chosen.push(nodes[i]);}
    return pick(this.session,chosen);
  }
  pickSpawner(){
    const list=[...this.zones.active].flatMap(n=>this.map.zones.get(n)?.spawners??[]);if(!list.length)return null;
    let sp=pick(this.session,list);if(sp===this.oldSpawner)sp=pick(this.session,list);this.oldSpawner=sp;return sp;
  }
  trySpawn(player,kind='zombie'){
    if(!this.map)return false;if(!this.zones)this.updateZones(player);
    const sp=this.session.area==='earth'?pick(this.session,this.map.named(NML_SPAWN)):this.pickSpawner(),z=sp&&this.spawnFrom(sp,{sprint:this.session.area==='earth'&&!this.nmlInitial});
    if(z)this.spawnFailures=0;else this.spawnFailures++;return !!z;
  }
  approach(z,b){
    const from=z.root.position.clone(),to=b.outside.clone();z.state='approach';z.barrier=b;z.root.visible=false;
    z.approach={from,to,t:0,time:from.distanceTo(to)/Math.max(10,z.speed)};z.root.rotation.y=yawOf(to.clone().sub(from));
  }
  rise(z,spot){
    const v2=z.moveSpeed==='walk'&&this.session.random()<.5,key=v2?RISE_V2:RISE[z.moveSpeed];
    z.state='rising';z.root.visible=false;z.rise={key,t:0,yaw:spot.e.yaw??0,base:spot.p.clone().setY(spot.p.y-(v2?14:45))};
    z.root.rotation.y=z.rise.yaw;z.root.position.copy(z.rise.base);this.clipPlay(z,key);
  }
  fall(z,spot){
    this.fallTaken.add(spot.id);z.fallSpot=spot;z.state='falling';z.root.visible=false;z.fallen={stage:'emerge',t:0,total:0,yaw:spot.yaw??0,origin:V(spot.position)};
    z.root.rotation.y=z.fallen.yaw;z.root.position.copy(z.fallen.origin);this.clipPlay(z,FALL.emerge);
  }
  spotPosition(b,i){
    // blocker_attack_spots: centre 36 short of the closest board, then 28 to either side.
    if(!b.spots){
      const boards=b.boards.map(e=>V(e.position)),flat=p=>new THREE.Vector2(p.x,p.z),o=b.outside,closest=boards.sort((a,c)=>flat(a).distanceTo(flat(o))-flat(c).distanceTo(flat(o)))[0]??b.position;
      const forward=closest.clone().sub(o).setY(0),dist=forward.length()-36;forward.normalize();const right=new THREE.Vector3(-forward.z,0,forward.x),centre=o.clone().addScaledVector(forward,dist);
      b.spots=[centre,centre.clone().addScaledVector(right,28),centre.clone().addScaledVector(right,-28)].map(p=>{const g=this.world.raycast?.(new THREE.Ray(p.clone().setY(p.y+60),new THREE.Vector3(0,-1,0)),0,200);if(g)p.y=g.position.y;return p;});
      b.facing=yawOf(forward);
    }
    return b.spots[i].clone();
  }
  enterArea(lunar){
    const s=this.session,from=s.area,to=lunar?'moon':'earth',astro=this.list.find(z=>z.kind==='astronaut');
    if(from!==to){
      // Init_Moon_NML_Round and resume_moon_rounds both end the current round; nml_last_round is the lunar round.
      if(lunar)this.roundEnded(s.savedWave?.round??1);
      else{if(s.phase==='fighting')this.roundEnded(s.round);this.nml=this.newNml(s.moonStarted?s.round:1);}
      // The astronaut has ignore_nml_delete and waits on the Moon.
      if(!lunar&&astro){this.list.splice(this.list.indexOf(astro),1);astro.root.visible=false;this.parked=astro;}
    }
    const parked=lunar?this.parked:null;if(lunar)this.parked=null;
    // nml_round_manager is the next round_spawn_func: the lunar round loop first ends (round_wait poll, then
    // chalk_round_over at zombie_between_round_time 2 = 4 s, or the rest of a between-round chalk), then chalk_one_up 2.5 s.
    const clock=this.waitClock??0,entry=from==='moon'?(s.phase==='preparing'?Math.max(0,s.countdown):Math.ceil(clock)-clock+4)+2.5:3;
    this.finishNuke();this.releaseAll();this.clearEyes();super.reset();this.roundKey=null;this.zones=null;this.spawnDelay=lunar?0:entry;
    if(parked){parked.root.visible=true;this.scene.add(parked.root);this.list.push(parked);parked.state='chase';parked.path=[];}
  }
  releaseAll(){for(const b of this.barriers??[])b.taken=null;this.fallTaken.clear();}
  release(z){
    if(z.barrier?.taken)for(let i=0;i<3;i++)if(z.barrier.taken[i]===z)z.barrier.taken[i]=null;
    if(z.fallSpot){this.fallTaken.delete(z.fallSpot.id);z.fallSpot=null;}
  }
  remove(z){this.release(z);z.eye?.removeFromParent();super.remove(z);}
  // zombie_game_over_death: every zombie holds its position, then one dies every 0.5-2.5 s (the original adds a head gib).
  gameOver(dt){
    this.overWait=(this.overWait??0)-dt;
    if(this.overWait<=0&&this.list.length){
      this.overWait=.5+Math.random()*2;const z=this.list.shift();this.release(z);z.eye?.removeFromParent();z.eye=null;
      z.state='dead';z.deathCause='game_over';z.life=3;z.rig.play('death',false);this.dead.push(z);
    }
    this.updateDead(dt);
  }
  clearEyes(){for(const z of [...this.list,...this.dead]){z.eye?.removeFromParent();z.eye=null;}}
  reset(){
    this.finishNuke();
    if(this.parked){const p=this.parked;this.parked=null;this.list.push(p);}
    this.releaseAll();this.clearEyes();super.reset();this.spawnFailures=0;this.resetDirector();
  }
  update(dt,player){
    const s=this.session,earth=s.area==='earth';this.playerPos=player.clone();
    // deleteZombieEyes: the glow goes out when the zombie dies. The eyeoffset technique draws it toward the viewer.
    for(const d of this.dead)if(d.eye){d.eye.removeFromParent();d.eye=null;}
    const viewer=player.clone().setY(player.y+60);
    // The renderer refreshes bone matrices each frame; reading them avoids a full skeleton update per zombie.
    for(const z of this.list)if(z.eye){const p=z.eye.position.setFromMatrixPosition(z.eyeBone.matrixWorld);z.eye.visible=p.distanceToSquared(z.root.position)<100*100;p.addScaledVector(viewer.clone().sub(p).normalize(),2.5);}
    if(this.map&&((this.zoneTimer-=dt)<=0||!this.zones)){this.zoneTimer=1;this.updateZones(player);}
    if(this.map){if(earth)this.updateNml(dt,player);else this.updateRound(dt,player);}
    for(const z of this.list)if((z.kind==='zombie'||z.kind==='nova')&&!z.ignoreGravity&&['chase','attack'].includes(z.state)&&(z.gravityCheck=(z.gravityCheck??0)-dt)<=0){
      z.gravityCheck=.25;const low=!earth&&!!this.world.lowGravity?.(z.root.position);if(low!==z.lowGravity){z.lowGravity=low;this.setCycle(z,this.cycleName(z));}
    }
    this.updateNuke(dt);
    for(const z of [...this.list]){this.roundSpawnFailsafe(z,dt);this.touchFailsafe(z,player);}
    super.update(dt,player);
    // round_wait checks once a second from round start, so the round ends at the first check after the last kill.
    const clear=!earth&&s.phase==='fighting'&&s.spawned>=s.total&&!this.list.some(z=>z.kind!=='astronaut');
    if(!clear)this.roundOverAt=null;else this.roundOverAt??=Math.max(1,Math.ceil(this.waitClock??0));
    if(clear&&(this.waitClock??Infinity)>=this.roundOverAt){const round=s.round;s.nextRound();this.roundEnded(round);this.roundKey=null;this.roundOverAt=null;if(this.spawnDelay<1e3)this.spawnDelay=0;}
  }
  // round_spawn_failsafe replaces the port's re-path check: every 30 s a zombie (not the astronaut) that moved under
  // 24 units dies without a kill credit, unless it tore a board in the last 8 s; Moon does not requeue it.
  unstick(){}
  roundSpawnFailsafe(z,dt){
    if(z.kind==='astronaut'||!this.list.includes(z))return;
    const f=z.failsafe??={wait:30,from:z.root.position.clone()};if((f.wait-=dt)>0)return;f.wait=30;
    if(this.session.time-(z.lastChunk??-Infinity)<8)return;
    if(z.root.position.distanceTo(f.from)<24){this.timeout(z);return;}
    f.from.copy(z.root.position);
  }
  timeout(z){
    this.release(z);z.eye?.removeFromParent();z.eye=null;this.list.splice(this.list.indexOf(z),1);this.session.killed++;
    z.state='dead';z.deathCause='timeout';z.root.visible=true;z.life=3;z.rig.play('death',false);this.dead.push(z);
  }
  // zombie_damage_failsafe: checked every 0.5 s, a zombie touching its player for 5 s without moving 60 units kills them
  // (never with Juggernog or in last stand); while it keeps touching, the next checks need no new 5 s wait.
  touchFailsafe(z,player){
    if(z.kind==='dog'||!this.list.includes(z))return;
    const s=this.session,f=z.touchCheck??={next:s.time+.5,until:null,from:null,again:false};if(s.time<f.next)return;f.next=s.time+.5;
    const o=z.root.position,touching=Math.hypot(player.x-o.x,player.z-o.z)<32&&Math.abs(player.y-o.y)<70;
    if(f.until===null){if(!touching){f.again=false;return;}f.from=o.clone();if(!f.again){f.until=s.time+5;return;}}
    else if(s.time<f.until)return;
    f.until=null;if(s.perks.has('specialty_armorvest'))return;
    if(touching&&this.playerValid()&&o.distanceTo(f.from)<60){this.rawDamage?.(s.health+1000);f.again=true;}
  }
  roundEnded(round){
    // moon_round_think_func: speed = round * multiplier; spawn delay x0.95 with a 0.08 floor.
    this.moveSpeed=round*(this.data.rules?.zombie_move_speed_multiplier??8);const t=this.roundDelay;this.roundDelay=t>.08?t*.95:.08;
  }
  roundStart(){
    // chalk_one_up (2.5 s for a non-intro round) runs before round_spawn_func, which spawns immediately.
    const s=this.session,total=moonMaxZombies(s.round,this.data.rules);this.speedUp=null;this.waitClock=0;if(this.spawnDelay<1e3)this.spawnDelay=2.5;
    // astro_zombie_total_update: spawn once the unspawned count drops to a random 25-75% of the round.
    this.astroThreshold=randInt(s,Math.trunc(total*.25),Math.trunc(total*.75));
    this.astroManager=s.round>=this.nextAstroRound&&!this.parked&&!this.list.some(z=>z.kind==='astronaut');this.onRoundStart?.(s.round);
  }
  updateRound(dt,player){
    const s=this.session;
    if((this.tracking-=dt)<=0){this.tracking=10;if(!this.suspendTracking?.())this.track(player);}
    if(s.phase!=='fighting'){this.roundKey=null;return;}
    if(this.roundKey!==s.round){this.roundKey=s.round;this.roundStart();}
    this.waitClock+=dt;
    const regular=this.list.filter(z=>z.kind!=='astronaut').length;
    if(s.spawned<s.total&&regular<24&&(this.spawnDelay-=dt)<=0){
      const sp=this.pickSpawner(),z=sp&&this.spawnFrom(sp);this.spawnDelay=z?this.roundDelay+.05:.5;if(z)this.spawnFailures=0;else this.spawnFailures++;
    }
    if(this.astroManager&&s.total-s.spawned<=this.astroThreshold&&!this.list.some(z=>z.kind==='astronaut')&&this.spawnAstronaut())this.astroManager=false;
    // zombie_speed_up: rounds 4-9, the last enemy sprints once few remain.
    if(s.round>3&&s.round<10&&this.speedUp!=='done'){
      if(!this.speedUp&&s.total-s.spawned<=4&&regular<=3)this.speedUp='armed';
      if(this.speedUp==='armed'&&this.list.length===1){const z=this.list[0];this.speedUp='done';if(z.kind==='zombie'||z.kind==='nova'){z.moveSpeed='sprint';this.setCycle(z,this.cycleName(z));}}
    }
  }
  inView(p){
    // player_can_see_me: cg_fov 65 with the 0.2 banzai buffer.
    const c=this.camera;if(!c)return false;const d=p.clone().sub(c.position).normalize();return Math.acos(Math.min(1,d.dot(c.getWorldDirection(new THREE.Vector3()))))<=65*.5*.8*DEG;
  }
  // zombie_moon_distance_tracking.gsc: unseen, undamaged zombies beyond 1500 are deleted and requeued.
  track(player){for(const z of [...this.list])if(z.kind==='zombie'&&z.state!=='rising'&&z.health===z.maxHealth&&!this.inView(z.root.position)&&z.root.position.distanceTo(player)>=1500){this.remove(z);this.session.spawned--;}}
  spawnAstronaut(){
    // zombie_moon_ai_astro.gsc: an *_astro struct in an occupied zone, else in an active zone.
    const m=this.map,s=this.session,zones=[...m.zones.values()].filter(z=>z.name!=='nml_zone'&&z.astro.length);
    const zone=zones.find(z=>this.zones.occupied.has(z.name))??zones.find(z=>this.zones.active.has(z.name)),struct=zone?pick(s,zone.astro):m.astroSpawner;
    const p=struct&&this.navPoint(struct.position,200);if(!p)return false;
    const z=this.spawn(p,null,'astronaut');z.root.rotation.y=struct.yaw??0;this.onSound?.('teleport',p);this.onTeleport?.(p.clone(),p);return true;
  }
  // zombie_moon_wasteland.gsc nml_round_manager.
  updateNml(dt,player){
    const s=this.session,n=this.nml;n.clock+=dt;
    if(this.spawnDelay>0){this.spawnDelay-=dt;if(this.spawnDelay>0)return;}
    if(n.start===null)n.start=n.clock;const t=n.clock-n.start;
    if(n.ramp!==null&&n.clock>=n.ramp){n.ramp+=20;this.nmlRamp();}
    if((n.dogCheck-=dt)<=0){n.dogCheck=1.3;n.dogTargets=this.map.dogVolume&&inside(this.map.dogVolume,player.clone().setY(player.y+35))?1:0;}
    if(n.wave&&(n.waveWait-=dt)<=0){n.waveWait=.3+s.random()*.7;this.nmlSpawn(20,n.wave,true);}
    if((n.wait-=dt)>0)return;
    if(this.list.length+(this.parked?1:0)>=20){n.wait=.5;return;}
    let wait=0;
    if(n.mode==='normal'){
      if(this.nmlInitial)this.nmlSpawn(10,NML_SPAWN,false);else this.nmlSpawn(20,NML_SPAWN,true);
      if(t>n.next){n.next=t+2.1;n.mode='prepare';n.prepared.clear();}
    }else if(n.mode==='prepare'){
      for(const z of this.list)if(z.kind==='zombie'&&!n.prepared.has(z)){
        n.prepared.add(z);this.nmlInitial=false;if(n.ramp===null)n.ramp=n.clock;z.moveSpeed='sprint';z.superSprint=n.superSprint;this.setCycle(z,this.cycleName(z));
      }
      if(t>n.next){n.mode='wave';n.area=n.area===1?2:1;n.wave=NML_WAVES[n.area-1];n.waveWait=0;n.next=t+35;}
      wait=.1;
    }else if(n.mode==='wave'){
      if(t<n.next){if(s.random()<.05)this.nmlSpawn(20,NML_SPAWN,true);}else{n.wave=null;n.mode='cooldown';n.next=t+16;}
    }else{if(t>n.next){n.next=t+26;n.mode='normal';}wait=.01;}
    if(t>2){
      // Solo dogs try every 3-9.5 s while the player is inside nml_dogs_volume, two per player.
      let skip=n.mode==='prepare';if(n.clock<n.dogGate)skip=true;else n.dogGate=n.clock+3+s.random()*6.5;
      if(!skip&&n.clock>=n.dogsAt&&n.dogTargets&&this.list.filter(z=>z.kind==='dog').length<2*n.dogTargets&&this.spawnDog(player))for(const d of this.list)if(d.kind==='dog')d.health=d.maxHealth=n.dogHealth;
    }
    n.wait=wait||.1+s.random()*.7;
  }
  nmlRamp(){
    const n=this.nml,rules=this.data.rules,old=zombieHealth(n.timer,rules);n.timer++;this.onNmlRamp?.(n.timer);
    // The source removes damaged zombies in place while iterating, so the entry after each removal keeps its ramp.
    const full=this.list.filter(z=>z.kind==='zombie');for(let i=0;i<full.length;i++)if(full[i].health!==old)full.splice(i,1);
    const health=zombieHealth(n.timer,rules);for(const z of full)z.health=z.maxHealth=health;
    n.dogHealth=n.timer<4?100:n.timer<6?400:n.timer<15?800:n.timer<30?1200:1600;for(const d of this.list)if(d.kind==='dog')d.health=d.maxHealth=n.dogHealth;
    if(n.timer===6)n.superSprint=true;
  }
  nmlSpawn(max,name,sprint){
    if(this.list.length+(this.parked?1:0)>=max)return null;const list=this.map.named(name);if(!list.length)return null;
    const z=this.spawnFrom(pick(this.session,list),{sprint});if(z&&name!==NML_SPAWN)z.ignoreGravity=true;return z;
  }
  spawnDog(player){
    // dog_spawn_factory_logic: a random *_dog struct 400-1000 from the player, then dog_spawn_fx's 1.6 s arrival.
    const s=this.session,locs=shuffle(s,[...this.zones.active].flatMap(n=>this.map.zones.get(n)?.dog??[]));if(!locs.length)return false;
    const loc=locs.find(l=>{const d=V(l.position).distanceTo(player);return l!==this.oldDog&&d>400&&d<1000;})??locs[0];this.oldDog=loc;
    const p=this.navPoint(loc.position,60);if(!p)return false;const z=this.spawn(p,null,'dog');z.state='spawnfx';z.fxLeft=1.6;z.root.visible=false;this.onSound?.('dog',p);return true;
  }
  customState(z,dt,player){
    switch(z.state){
      case 'approach':{const a=z.approach;a.t+=dt;const k=Math.min(1,a.t/a.time);z.root.position.lerpVectors(a.from,a.to,k);if(k===1){z.root.visible=true;z.state='barricade';z.spot=null;z.wait=0;z.act=null;}return true;}
      case 'barricade':return this.window(z,dt);
      case 'entering':{z.enterTime+=dt;const t=Math.min(1,z.enterTime/1.2);z.root.position.lerpVectors(z.enterFrom,z.barrier.inside,t);z.root.position.y+=Math.sin(t*Math.PI)*12;if(t===1){z.state='chase';z.repath=0;}return true;}
      case 'rising':return this.rising(z,dt);
      case 'falling':return this.falling(z,dt);
      case 'spawnfx':z.fxLeft-=dt;if(z.fxLeft<=0){z.root.visible=true;z.state='chase';}return true;
      case 'phase':return this.phasing(z,dt);
      case 'headbutt':return this.headbutt(z,dt,player);
      case 'chase':return z.kind==='astronaut'?this.tryHeadbutt(z,player):z.kind==='nova'?this.tryPhase(z,player):false;
    }
    return false;
  }
  act(z,key,events,duration,done){if(key!=='attack')this.clipPlay(z,key);else z.rig.play('attack',false);z.act={t:0,events,duration,done};}
  stepAct(z,dt){const a=z.act;a.t+=dt;for(const e of a.events)if(!e.fired&&a.t>=e.time){e.fired=true;e.fn();}if(a.t>=a.duration){z.act=null;a.done?.();}}
  // tear_into_building: up to three attack spots per window, board tear anims and 50% reach-through swipes.
  window(z,dt){
    const b=z.barrier,s=this.session;
    if(z.act){this.stepAct(z,dt);return true;}
    if(b.count===0){this.enter(z);return true;}
    if(z.spot==null){
      if((z.wait-=dt)>0)return true;b.taken??=[null,null,null];const free=[0,1,2].filter(i=>!b.taken[i]);if(!free.length){z.wait=.5;return true;}
      const i=pick(s,free);b.taken[i]=z;z.spot=i;z.root.position.copy(this.spotPosition(b,i));z.root.rotation.y=b.facing;
    }
    const key=Z+'boardtear_'+'mrl'[z.spot]+'_'+b.boards[b.count-1]?.script_noteworthy,clip=this.anims[key];
    this.act(z,clip?key:'attack',[{time:clip?.notifies.find(x=>x.name==='board')?.time??1.4,fn:()=>{if(b.count>0){this.world.setBoards?.(b,b.count-1);z.lastChunk=this.session.time;this.onSound?.('board',z.root.position);}}}],clip?.duration??2.8,()=>this.reach(z));
    return true;
  }
  reach(z){
    const s=this.session,p=this.playerPos,o=z.root.position;
    if(!p||['reviving','gameover'].includes(s.phase)||Math.hypot(p.x-o.x,p.z-o.z)>90||randInt(s,0,100)>50)return;
    const key=Z+'window_attack_arm_'+(z.spot===1?'l':z.spot===2?'r':randInt(s,0,100)>50?'l':'r')+'_out',clip=this.anims[key];if(!clip)return;
    this.act(z,key,clip.notifies.filter(x=>x.name==='fire').map(x=>({time:x.time,fn:()=>this.reachHit(z)})),clip.duration);
  }
  reachHit(z){
    // window_notetracks: within 90 of the zombie and 51 of the barricade trigger location.
    const p=this.playerPos,o=z.root.position,c=z.barrier.position;
    if(Math.hypot(p.x-o.x,p.z-o.z)<90&&Math.abs(p.y-o.y)<90&&Math.hypot(p.x-c.x,p.z-c.z)<51&&Math.abs(p.y-c.y)<51)this.onDamage(z.meleeDamage,z);
  }
  enter(z){
    const b=z.barrier;b.taken=null;z.spot=null;z.act=null;z.state='entering';z.enterFrom=z.root.position.clone();z.enterTime=0;
    z.root.rotation.y=yawOf(b.inside.clone().sub(z.enterFrom));z.rig.play('walk');
  }
  rising(z,dt){
    const r=z.rise,clip=this.anims[r.key];r.t+=dt;if(r.t>=.5)z.root.visible=true;
    z.root.position.copy(r.base).add(toWorld(rootAt(clip,r.t),r.yaw));
    if(r.t>=(clip?.duration??2)){z.state='chase';z.repath=0;const g=this.world.closest?.(z.root.position);if(g)z.root.position.copy(g);z.rig.play('walk');}
    return true;
  }
  falling(z,dt){
    const f=z.fallen;f.t+=dt;f.total+=dt;if(f.total>=.5)z.root.visible=true;
    const next=stage=>{f.stage=stage;f.t=0;f.origin=z.root.position.clone();this.clipPlay(z,FALL[stage],stage==='loop');};
    if(f.stage==='loop'){f.vy-=(this.world.lowGravity?.(z.root.position)?136:800)*dt;z.root.position.y=Math.max(f.ground,z.root.position.y+f.vy*dt);if(z.root.position.y-f.ground<20)next('land');return true;}
    const clip=this.anims[FALL[f.stage]];z.root.position.copy(f.origin).add(toWorld(rootAt(clip,f.t),f.yaw));
    if(f.stage==='land')z.root.position.y=Math.max(f.ground,z.root.position.y);
    if(f.t<(clip?.duration??1))return true;
    // drop_now structs drop as soon as the emerge finishes and free the location (zombie_faller_enable_location).
    if(f.stage==='emerge'){this.fallTaken.delete(z.fallSpot?.id);z.fallSpot=null;next('drop');}
    else if(f.stage==='drop'){f.ground=this.world.closest?.(z.root.position,{x:30,y:600,z:30})?.y??z.root.position.y;f.vy=0;next(z.root.position.y-f.ground+15>20?'loop':'land');}
    else{z.state='chase';z.repath=0;const g=this.world.closest?.(z.root.position);if(g)z.root.position.copy(g);z.rig.play('walk');}
    return true;
  }
  playerValid(){return !['reviving','gameover'].includes(this.session.phase);}
  // zombie_move.gsc trySideStep with zombie_moon_ai_quad.gsc phase anims: sidestep while watched, else phase forward.
  tryPhase(z,player){
    const s=this.session,o=z.root.position;if(s.time-(z.lastStep??-9)<2||!z.path?.length)return false;
    const goal=z.path.at(-1),target=z.path[z.pathIndex];if(!target||goal.distanceTo(o)<64)return false;
    const facing=z.root.rotation.y,move=target.clone().sub(o).setY(0),d=o.distanceTo(player);
    if(move.lengthSq()<1||turn(yawOf(move),facing)>15*DEG||turn(yawOf(player.clone().sub(o)),facing)>45*DEG)return false;
    let type=null;
    if(d>=64&&d<=1000&&this.inView(o))type=z.moveSpeed!=='sprint'||s.random()<.7?'step':'roll';
    if(!type&&d>=120&&d<=2400)type='phase';if(!type)return false;
    const dir=type==='step'?(z.stepped<0?'right':z.stepped>0?'left':s.random()<.5?'right':'left'):'forward';
    const key=Z+'quad_phase'+dir+'_'+pick(s,type==='phase'?['long_a','long_b']:['long_a','long_b','short_a','short_b']),clip=this.anims[key];if(!clip)return false;
    // checkRoomForAnim
    const end=o.clone().add(toWorld(rootAt(clip,clip.duration),facing)),landing=this.world.closest?.(end,{x:24,y:60,z:24});
    if(!landing||landing.distanceTo(end)>40||!this.world.lineClear?.(o.clone().setY(o.y+20),landing.clone().setY(landing.y+20)))return false;
    if(this.world.navigation?.reachable&&!this.world.navigation.reachable(o,landing))return false;
    const at=name=>clip.notifies.find(n=>n.name===name)?.time;
    z.state='phase';z.phase={key,clip,t:0,from:o.clone(),yaw:facing,dir,landing,start:at('phase_start')??.2,end:at('phase_end')??.6};this.clipPlay(z,key);return true;
  }
  phasing(z,dt){
    const p=z.phase;p.t+=dt;const k=Math.min(1,p.t/p.clip.duration);z.root.position.copy(p.from).add(toWorld(rootAt(p.clip,p.t),p.yaw)).setY(p.from.y+(p.landing.y-p.from.y)*k);
    const hidden=p.t>=p.start&&p.t<p.end;if(hidden!==!z.root.visible){z.root.visible=!hidden;this.onTeleport?.(z.root.position.clone(),z.root.position.clone());}
    if(p.t>=p.clip.duration){z.root.position.copy(p.landing);z.root.visible=true;z.state='chase';z.repath=0;z.lastStep=this.session.time;z.stepped=(z.stepped??0)+(p.dir==='left'?-1:1);z.rig.play('walk');}
    return true;
  }
  // _zombiemode_ai_astro.gsc astro_zombie_headbutt_think: eyes within 64, facing within 45 degrees, clear trace, 2 s apart.
  tryHeadbutt(z,player){
    const s=this.session,o=z.root.position;if(s.time<z.nextHeadbutt||!this.playerValid())return false;
    const eye=o.clone().setY(o.y+60),target=player.clone().setY(player.y+60);
    if(eye.distanceTo(target)>64||turn(yawOf(player.clone().sub(o)),z.root.rotation.y)>45*DEG||this.world.lineClear&&!this.world.lineClear(eye,target))return false;
    const clip=this.clipPlay(z,HEADBUTT),at=name=>clip?.notifies.find(n=>n.name===name)?.time;
    z.state='headbutt';z.headbutt={t:0,duration:clip?.duration??2.367,start:at('headbutt_start')??1.567,fire:at('fire')??2};this.onAstronaut?.('grab',z);return true;
  }
  headbutt(z,dt,player){
    const h=z.headbutt,s=this.session;h.t+=dt;
    if(!h.checked&&h.t>=h.start){h.checked=true;if(player.distanceTo(z.root.position)>=59){h.released=true;this.onAstronaut?.('release',z);this.clipPlay(z,Z+'astro_headbutt_release');}}
    if(!h.released&&!h.fired&&h.t>=h.fire){h.fired=true;if(this.playerValid())this.onAstronaut?.('hit',z);}
    if(h.t>=h.duration){this.onAstronaut?.('restore',z);z.state='chase';z.repath=0;z.nextHeadbutt=s.time+2;z.rig.play('walk');}
    return true;
  }
  rayHit(ray,far){
    const all=this.list;this.list=all.filter(z=>!['approach','spawnfx'].includes(z.state));
    // The astronaut sets ignorelocationaldamage.
    try{const hit=super.rayHit(ray,far);if(hit?.z.kind==='astronaut')hit.head=false;return hit;}finally{this.list=all;}
  }
  hurt(z,damage,head=false,melee=false,cause='bullet',score=true){
    if(!this.list.includes(z))return;const s=this.session;
    if(z.kind==='astronaut'){
      // astro_actor_damage zeroes the Zap Guns; Wave Gun sizzle, Nuke and Gersh do nothing; the damage callback awards no hit points.
      if(['wave','zap','gersh','nuke'].includes(cause))return;
      z.health-=damage;s.hits++;this.onHit?.(z,false);if(z.health>0)return;
      this.list.splice(this.list.indexOf(z),1);z.state='dead';z.deathCause=cause;z.life=.2;z.root.visible=false;this.dead.push(z);
      s.kills++;if(score)s.addPoints(melee?130:50);this.nextAstroRound=s.round+randInt(s,1,3);this.astroManager=false;this.onKill?.(z);return;
    }
    // check_for_instakill: a hit that leaves the zombie alive scores as damage, then DoDamage with the "MOD_" prefix
    // stripped kills it as MOD_UNKNOWN, for which player_add_points doubles the hit-location bonus (and gives no melee bonus).
    if(score&&z.kind!=='dog'&&s.effects.insta_kill>s.time&&damage<z.health){
      const info=s.hitInfo??{},location=typeof head==='string'?head:head?'head':info.location;s.scoreHit(false);
      s.hitInfo={...info,points:info.points??50+2*({head:50,helmet:50,neck:20,torso_upper:10,torso_lower:10}[location]??0)};
    }
    z.deathCause=cause;super.hurt(z,damage,head,melee,cause,score);if(z.state==='dead')this.release(z);
  }
  // nuke_powerup: 0.5 s after the pickup every zombie, closest to the drop first, is marked; one dies every 0.1-0.7 s
  // (no kill points) and the 400 points follow the last. Astronauts use their own nuke_damage_func and survive.
  nuke(onDeath,{origin=null,done=null}={}){
    if(this.nuking)this.finishNuke();this.nuking={wait:.5,queue:null,onDeath,origin,done};
  }
  updateNuke(dt){
    const n=this.nuking;if(!n||(n.wait-=dt)>0)return;
    if(!n.queue){n.queue=this.list.filter(z=>z.kind!=='astronaut'&&!z.nuked);if(n.origin)n.queue.sort((a,b)=>a.root.position.distanceToSquared(n.origin)-b.root.position.distanceToSquared(n.origin));for(const z of n.queue)z.nuked=true;n.wait+=.1+this.session.random()*.6;if(n.wait>0)return;}
    while(n.wait<=0&&n.queue.length){const z=n.queue.shift();if(this.list.includes(z))this.nukeOne(z,n.onDeath);if(n.queue.length)n.wait+=.1+this.session.random()*.6;}
    if(!n.queue.length)this.finishNuke();
  }
  nukeOne(z,onDeath){
    z.deathCause='nuke';this.release(z);this.list.splice(this.list.indexOf(z),1);this.session.kills++;this.session.killed++;
    if(z.kind==='dog')this.lastDogDeath=z.root.position.clone();z.state='dead';z.gasDeath=false;z.life=3;z.rig.play('death',false);this.dead.push(z);onDeath?.(z);this.onKill?.(z);
  }
  finishNuke(){const n=this.nuking;if(!n)return;this.nuking=null;n.done?.();}
  snapshot(){return this.list.map(z=>({id:z.id,kind:z.kind,health:z.health,state:z.state,position:z.root.position.toArray(),pathLength:z.path.length,animation:z.rig.current,cycle:z.cycle,moveSpeed:z.moveSpeed,speed:Math.round(z.speed),visible:z.root.visible}));}
}
