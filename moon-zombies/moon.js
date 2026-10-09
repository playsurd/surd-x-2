import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayerController } from './player-controller.js';
import { CollisionWorld, loadCollisionWorld } from './collision-world.js';
import { optimizeStaticScene } from './scene-optimizer.js';
import { MoonState, contains, touching, environmentAt } from './moon-rules.js';
import { MoonNavigation } from './moon-navigation.js';
import { createStairCollision } from './moon-stairs.js';
import { MoonCombat } from './moon-combat.js';
import { MoonFeatures } from './moon-features.js';
import { MoonHud } from './moon-hud.js';
import { MoonPresentation } from './moon-presentation.js';
import { MoonRender, t5Fov } from './moon-render.js';
import { loadMoonWater } from './moon-water.js';
import { createZombieTouch } from './zombies-touch.js';
import { MoonController } from './moon-controller.js';
import { ZombiesMenu } from './zombies-menu.js';
const menuUI=new ZombiesMenu({moon:true});

const $ = id => document.getElementById(id), keys = new Set(), errors = [];
const vector = a => new THREE.Vector3(...a);
const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1 : 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.45;
renderer.autoClear = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x010306);
const ambient = new THREE.AmbientLight(0xb4c6d7, 1.1), hemisphere = new THREE.HemisphereLight(0xc6d6ea, 0x434853, 1.7);
scene.add(ambient, hemisphere);
const sun = new THREE.DirectionalLight(0xe7efff, 2.4); sun.position.set(-.6, 1, -.3); scene.add(sun);
const fill = new THREE.DirectionalLight(0x8191b3, .6); fill.position.set(1, .3, .5); scene.add(fill);
const camera = new THREE.PerspectiveCamera(t5Fov(), innerWidth/innerHeight, 1, 70000); camera.rotation.order = 'YXZ';
let data, state, player, collision, ready = false, active = false, onMoon = false, checkpoint = 'area51', environment, target;
let navigation, combat, features, presentation, water, hud, atmosphere, mode = new URLSearchParams(location.search).get('mode') === 'explore' ? 'explore' : 'survival';
let notice = '', noticeLeft = 0, debugVisible = false, frames = 0, frameTime = 0, fps = 0;
const objects = new Map(), parts = new Map(), opened = new Set(), airlocks = [], hazards = {cliff: null, fall: null, pending: 0, zones: []};
let statics = new Map(), powerProps = null;
const labels = {nml_zone: 'No Man’s Land', bridge_zone: 'Receiving Bay', water_zone: 'Lunar Surface', cata_left_start_zone: 'Tunnel 6', cata_left_middle_zone: 'Tunnel 6', cata_right_start_zone: 'Tunnel 11', cata_right_middle_zone: 'Tunnel 11', cata_right_end_zone: 'Tunnel 11', generator_zone: 'Power / MPD', generator_exit_east_zone: 'Laboratories', enter_forest_east_zone: 'Upper Laboratories', forest_zone: 'Biodome', tower_zone_east: 'Laboratories', tower_zone_east2: 'Laboratories'};

function showNotice(text, duration = 4) { notice = text; noticeLeft = duration; }
// Survival puts the P.E.S. on or off through its timed equipment switch; exploration toggles it at once.
function useSuit(){if(!state.hasSuit){showNotice('Find a P.E.S. station in Receiving Bay.');return;}if(combat?.enabled)combat.toggleSuit();else state.toggleSuit();}
let mousePrimary=false,mouseSecondary=false,mouseAim=false,touchFirePending=false,padFirePending=false,padPlaying=false;
const controller=new MoonController({menu:$('menu'),back:()=>{if(!menuUI.back()&&ready&&combat.session.time>0&&combat.session.phase!=='gameover')start();}});
const touchControls=createZombieTouch({moon:true,
  onReset:()=>{touchFirePending=false;},
  onLook:(x,y,sensitivity)=>{
    if(!active)return;
    const scale=.005*sensitivity*menuUI.settings.sensitivity*(combat.ads?.5:1);
    camera.rotation.y-=x*scale;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-y*scale,-1.5,1.5);
  },
  onAction:action=>{
    // In last stand only the pistol's reload remains (the gun still fires and the player still looks and crawls).
    if(!active||combat.enabled&&combat.session.phase==='reviving'&&action!=='reload')return;
    const code={reload:'KeyR',melee:'KeyV',grenade:'KeyG',equipment:'KeyX',attachment:'KeyB'}[action];
    if(code){combat.key(code);if(action==='grenade')combat.keyUp(code);}
    if(action==='weapon')combat.switchWeapon();
    if(action==='use')interact();
    // SUIT and HACK work the shared P.E.S./Hacker slot like Q; USE then holds the hack.
    if((action==='hack'||action==='suit')&&combat.enabled&&combat.session.hacker)combat.toggleHacker();
    else if(action==='suit'){useSuit();}
    if(action==='journal')$('journal').hidden=!$('journal').hidden;
  },
  onPause:()=>{pause();document.exitPointerLock();},
});
function pause() { active = false; padPlaying=false;controller.reset();keys.clear(); mousePrimary=mouseSecondary=mouseAim=touchFirePending=padFirePending=false;touchControls.reset();touchControls.setEnabled(false);if (player) player.setEnabled(false); combat?.pause(); $('menu').hidden = false; $('hud').hidden = true; $('visor').hidden = true; $('lowhealth').style.opacity = 0; }
function resume() {
  if(!ready||combat.enabled&&combat.session.phase==='gameover')return;
  menuUI.close();touchControls.reset();touchControls.setEnabled(true);active=true;player.setEnabled(true);combat.resume();$('menu').hidden=true;$('hud').hidden=false;$('start').innerHTML='RESUME <span>→</span>';
  if(combat.enabled)menuUI.playerCounter.recordPlay();
}
function start() {
  if (!ready) return;
  if(controller.usingPad){padPlaying=true;resume();return;}
  if(touchControls.mode){resume();return;}
  renderer.domElement.requestPointerLock()?.catch(() => { $('status').textContent = 'Click the start button to capture the mouse.'; });
}
$('start').addEventListener('click', async () => {if(combat?.enabled&&combat.session.phase==='gameover')await resetRun();start();});
$('new-run').addEventListener('click', async () => {await resetRun();start();});
$('explore').addEventListener('click', () => {mode='explore';combat.enabled=false;combat.enemies.reset();combat.pickups.reset();combat.clearTransient();camera.fov=t5Fov();camera.updateProjectionMatrix();setModeUi();start();});
function setModeUi(){
  $('destinations').hidden=mode!=='explore';$('combat-hud').hidden=mode!=='survival';
  $('mode-label').textContent=mode==='survival'?'MOON / SOLO SURVIVAL':'MOON / EXPLORATION';
  $('start').innerHTML=(mode==='survival'?'START GAME':'EXPLORE MAP');
}
async function resetRun(){
  if(!ready)return;
  pause();ending=null;Object.assign($('intermission').style,{transition:'none',opacity:0});$('hud').classList.remove('ending');ready=false;mode='survival';combat.enabled=true;opened.clear();Object.assign(state,new MoonState(data.rules));
  for(const part of parts.values()){if(part.hazard){part.amount=1;continue;}part.amount=0;part.delta.set(0,0,0);if(part.object)part.object.position.copy(part.origin);}
  resetMapState();
  navigation.setDoors(parts);await combat.reset();features.reset();presentation.reset();hud?.reset();relocate('area51');setModeUi();ready=true;
  $('status').textContent='500 points. M1911. Reach the teleporter and survive.';
}
// end_game: the GAME OVER text over the frozen world, moon_intermission's camera from 3.1 s, then the menu.
let ending=null;
function endRun(){
  player.setEnabled(false);ending={t:0,area:combat.session.area,camera:null};hud.gameOver(combat.session,finishRun);
  // A dead player has no hints or crosshair; the intermission view has no helmet or damage overlay.
  $('hud').classList.add('ending');$('prompt').textContent='';$('notice').textContent='';noticeLeft=0;
}
function finishRun(){
  ending=null;Object.assign($('intermission').style,{transition:'none',opacity:0});$('hud').classList.remove('ending');
  document.exitPointerLock();pause();$('start').innerHTML='TRY AGAIN <span>→</span>';
  const s=combat.session;$('status').textContent=`Game over · ${s.kills} kills · ${s.moonStarted?'Round '+s.round:'No Man’s Land'} · ${Math.floor(s.time)} seconds`;
}
// moon_intermission: the "earth" struct after dying in No Man's Land (enter_nml), otherwise the "moon" one. The camera
// starts black, fades in over q_time and MoveTo/RotateTo the target at script_float speed with q_time ease in and out.
function intermissionShot(){
  const point=data.entities.find(e=>e.targetname==='intermission'&&e.script_noteworthy===(ending.area==='earth'?'earth':'moon'));
  const target=point&&data.entities.find(e=>e.targetname===point.target);if(!target)return null;
  const angles=e=>(e.angles??'0 0 0').split(' ').map(n=>THREE.MathUtils.degToRad(Number(n)));
  const from=vector(point.position),to=vector(target.position),time=from.distanceTo(to)/(Number(point.speed)||20),q=Math.min(1,time*.25);
  return {from,to,a:angles(point),b:angles(target),time,q,start:ending.t};
}
// MoveTo with acceleration and deceleration times: constant acceleration over q, cruise, constant deceleration over q.
function eased(t,time,q){
  if(t>=time)return 1;const v=1/(time-q);
  if(t<q)return v*t*t/(2*q);if(t>time-q){const r=time-t;return 1-v*r*r/(2*q);}return v*(q/2)+v*(t-q);
}
function updateEnding(dt){
  const e=ending;e.t+=dt;if(e.t<3.1)return;
  const shot=e.camera??=intermissionShot();if(!shot)return;
  const age=e.t-shot.start,el=$('intermission');
  const fade=(opacity,seconds)=>{el.style.transition=seconds?`opacity ${seconds}s linear`:'none';el.style.opacity=opacity;};
  if(!shot.shown){shot.shown=true;fade(1,0);void el.offsetWidth;fade(0,shot.q);$('visor').hidden=true;$('lowhealth').style.opacity=0;}
  const k=eased(Math.min(age,shot.time),shot.time,shot.q);
  camera.position.lerpVectors(shot.from,shot.to,k);
  const lerp=(i)=>shot.a[i]+(shot.b[i]-shot.a[i])*k;
  camera.rotation.set(-lerp(0),lerp(1)-Math.PI/2,0,'YXZ');
  // wait(time - q_time), fade back to black over q_time, then the next (only) point again.
  if(age>=shot.time-shot.q&&!shot.closing){shot.closing=true;fade(1,shot.q);}
  if(age>=shot.time)e.camera=intermissionShot();
  combat.enemies.gameOver(dt);
}
document.querySelectorAll('[data-destination]').forEach(button => button.addEventListener('click', () => {
  if (!ready) return;
  relocate(button.dataset.destination);
  start();
}));
document.addEventListener('pointerlockchange', () => {
  if(padPlaying&&!document.pointerLockElement)return;
  if(touchControls.mode&&!document.pointerLockElement)return;
  if (document.pointerLockElement !== renderer.domElement) { pause(); return; }
  padPlaying=false;resume();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { document.exitPointerLock(); pause(); } });
addEventListener('blur', () => { document.exitPointerLock(); pause(); });
addEventListener('mousemove', e => { if (active&&document.pointerLockElement===renderer.domElement) { const sensitivity=(combat?.enabled&&combat.ads?.0012:.002)*menuUI.settings.sensitivity;camera.rotation.y -= e.movementX*sensitivity; camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x-e.movementY*sensitivity, -1.5, 1.5); } });
renderer.domElement.addEventListener('mousedown',()=>{
  if(active&&padPlaying&&!document.pointerLockElement)renderer.domElement.requestPointerLock()?.catch(()=>{});
});
// A browser may require a click/key gesture before sound can start during controller-only play.
for(const event of ['pointerdown','keydown'])addEventListener(event,()=>{if(active&&combat?.enabled&&combat.audio.ctx?.state==='suspended')combat.audio.start();});
addEventListener('mousedown',e=>{if(!active||!combat.enabled||e.sourceCapabilities?.firesTouchEvents||e.target.closest('#touch-controls'))return;if(e.button===0){mousePrimary=combat.primary=true;combat.pressed=true;}if(e.button===2){if(combat.session.def.dualWield){mouseSecondary=combat.secondary=true;combat.secondaryPressed=true;}else mouseAim=combat.ads=true;}});
addEventListener('mouseup',e=>{if(!combat||e.sourceCapabilities?.firesTouchEvents)return;if(e.button===0)mousePrimary=combat.primary=false;if(e.button===2){mouseAim=combat.ads=false;mouseSecondary=combat.secondary=false;}});
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',()=>{if(active)combat.switchWeapon();});
addEventListener('keydown', e => {
  if (['Space', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
  if (!active) return;
  keys.add(e.code); if (e.repeat) return;
  combat.key(e.code);
  if (['KeyF', 'KeyE'].includes(e.code)) interact();
  // The Hacker shares the P.E.S. slot (actionslot 1): Q or H raises or lowers it; holding F then hacks.
  if(['KeyH','KeyQ'].includes(e.code)&&combat.enabled&&combat.session.hacker)combat.toggleHacker();
  else if (e.code === 'KeyQ') { useSuit(); }
  if (e.code === 'F3') { debugVisible = !debugVisible; $('debug').hidden = !debugVisible; }
  if (e.code === 'Tab') $('journal').hidden = !$('journal').hidden;
  if (e.code === 'Escape') { document.exitPointerLock(); pause(); }
});
addEventListener('keyup', e => {keys.delete(e.code);combat?.keyUp(e.code);});
addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();if(combat){combat.viewCamera.aspect=camera.aspect;combat.viewCamera.updateProjectionMatrix();} renderer.setSize(innerWidth, innerHeight);atmosphere?.resize(); });
addEventListener('error', e => errors.push(e.message));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

let controllerHintKey='';
const keyboardHints=[...document.querySelectorAll('#menu .preview, #journal p:last-child')].map(el=>[el,el.textContent]);
function pollController(dt){
  const f=controller.poll(dt,{menuOpen:!$('menu').hidden,playing:ready&&active&&!ending,prompt:!!target,focused:!document.hidden&&document.hasFocus()});
  const hintKey=controller.usingPad?controller.pad.state.type:'keyboard';
  if(hintKey!==controllerHintKey){
    controllerHintKey=hintKey;document.body.classList.toggle('pad-mode',controller.usingPad);
    $('pad-controls').hidden=!controller.usingPad;
    if(controller.usingPad){
      const g=a=>controller.glyph(a);
      $('pad-controls').textContent=`Left stick · Move | Right stick · Look | ${g('sprint')} · Sprint\n${g('fire')} · Fire | ${g('aim')} · Aim / Left gun | ${g('jump')} · Jump | ${g('crouch')} · Crouch\n${g('use')} · Tap reload / Hold interact | ${g('switchWeapon')} · Weapon | ${g('melee')} · Knife\n${g('lethal')} · Hold grenade, release to throw | ${g('tactical')} · Gersh / QED\n↑ · P.E.S. / Hacker | → · Wave Gun mode | ↓ · Claymore\n${g('scoreboard')} · Objective | ${g('pause')} · Play / Pause\nMenus: D-pad / Left stick · Navigate | ${g('jump')} · Select | ${g('crouch')} · Resume`;
    }
    for(const [el,text] of keyboardHints)el.textContent=controller.usingPad?text.replace(/Tab|OBJECTIVE/g,controller.glyph('scoreboard')):text;
  }
  if(f.actions.has('pause')){pause();document.exitPointerLock();return;}
  if(f.actions.has('resume')&&ready){$('start').click();return;}
  if(!ready||!active||ending){padFirePending=false;return;}
  const downed=combat.enabled&&combat.session.phase==='reviving';
  camera.rotation.y-=f.look.x*menuUI.settings.sensitivity*(combat.ads?.5:1);
  camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x+f.look.y*menuUI.settings.sensitivity*(combat.ads?.5:1),-1.5,1.5);
  padFirePending ||= f.firePressed;
  for(const action of f.actions){
    if(downed&&action!=='reload')continue;
    const code={reload:'KeyR',melee:'KeyV',grenade:'KeyG',equipment:'KeyX',attachment:'KeyB',claymore:'Digit4'}[action];
    if(code)combat.key(code);
    if(action==='grenadeRelease')combat.keyUp('KeyG');
    if(action==='weapon')combat.switchWeapon();
    if(action==='use')interact();
    if(action==='suit'){
      if(combat.enabled&&combat.session.hacker)combat.toggleHacker();
      else{useSuit();}
    }
    if(action==='journal')$('journal').hidden=!$('journal').hidden;
  }
}

function relocate(destination, entityId = null) {
  const landmark = data.landmarks[destination], entity = data.entities[entityId ?? landmark.entity];
  checkpoint = destination; onMoon = destination !== 'area51';
  if(combat?.session)combat.enterArea(onMoon);
  scene.background?.set(onMoon ? 0x010306 : 0x4c545e);
  player.setPosition(vector(entity.position).add(new THREE.Vector3(0, 3, 0)));
  atmosphere?.relocate(player.getFeetPosition(),onMoon);
  // Original angles describe a +X forward vector; Three cameras face -Z.
  camera.rotation.set(0, entity.yaw - Math.PI/2, 0);
  state.exposure = 0; state.teleport = null; state.cooldown = 4; hazards.fall = null;
  showNotice(onMoon && !state.hasSuit ? 'Find the P.E.S. station. F to equip life support.' : landmark.label);
  if (destination === 'area51') showNotice('Reach the teleporter at the far end of the yard.', 7);
  environment = environmentAt(data, player.getFeetPosition().add(new THREE.Vector3(0, 35, 0)).toArray(), state.power, onMoon);
}

function makePart(entity, object) {
  const box = entity.bounds ? new THREE.Box3(vector(entity.bounds[0]), vector(entity.bounds[1])) : object ? new THREE.Box3().setFromObject(object) : null;
  if (!box || box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  if (Math.min(size.x, size.y, size.z) < .01) return null;
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(...box.getCenter(new THREE.Vector3()).toArray());
  geometry.computeBoundingBox();
  return {entity, object, origin: object?.position.clone(), delta: new THREE.Vector3(), amount: 0, collider: new CollisionWorld(geometry)};
}
const solid = part => part.solid ?? !(part.removable && part.amount >= 1);
let stairs;
function capsuleIntersect(capsule) {
  const stairHit=stairs?.capsuleIntersect(capsule);if(stairHit)return stairHit;
  const hit = collision.capsuleIntersect(capsule); if (hit) return hit;
  for (const part of parts.values()) {
    if(!solid(part))continue;
    const local = capsule.clone(); local.translate(part.delta.clone().negate());
    const contact = part.collider.capsuleIntersect(local); if (contact) return contact;
  }
  if(combat?.enabled)for(const z of combat.enemies.list){
    const p=z.root.position,feet=capsule.start.y-capsule.radius,top=capsule.end.y+capsule.radius;
    if(feet>p.y+65||top<p.y+4)continue;
    const normal=new THREE.Vector3(capsule.start.x-p.x,0,capsule.start.z-p.z),distance=normal.length(),depth=capsule.radius+15-distance;
    if(depth>0)return {normal:distance>.001?normal.divideScalar(distance):new THREE.Vector3(1,0,0),depth};
  }
  return false;
}
function rayIntersect(ray, near = 0, far = Infinity) {
  let hit = collision.rayIntersect(ray, near, far);
  for (const part of parts.values()) {
    if(part.window||!solid(part))continue;
    const local = ray.clone(); local.origin.sub(part.delta);
    const contact = part.collider.rayIntersect(local, near, hit ? Math.min(hit.distance, far) : far);
    if (contact) { contact.position.add(part.delta); hit = contact; }
  }
  return hit;
}
function slide(part, amount, move = part.entity.move || [0, 120, 0]) {
  part.amount = amount; part.delta.copy(vector(move)).multiplyScalar(amount);
  if (part.object) part.object.position.copy(part.origin).add(part.delta);
}
function updateDoors(dt) {
  let changed=false;
  for (const door of data.doors) if (opened.has(door.name)&&!door.airlock) for (const id of door.parts) {
    const part = parts.get(id); if (!part || part.amount >= 1) continue;
    slide(part, Math.min(1, part.amount + dt/Math.max(.25, +(part.entity.script_transition_time || .6))));
    if(part.amount===1)changed=true;
  }
  // zombie_moon_utility.gsc airlock_think: once bought, each airlock trigger opens its leaves in
  // 0.25 s while a player or zombie touches it and closes them 0.25 s after it empties. Leaves are
  // non-solid while moving; paths stay connected after purchase (airlock_connect_paths).
  const feet=player.getFeetPosition().toArray(),enemies=combat?.enabled?combat.enemies.list:[];
  for(const a of airlocks){
    if(!opened.has(a.door.name))continue;
    if(!a.unlocked){a.unlocked=true;changed=true;for(const p of a.parts){p.navBlock=false;unlockLeaf(p);}}
    const occupied=touching(a.trigger.bounds,feet)||enemies.some(z=>contains(a.trigger.bounds,[z.root.position.x,z.root.position.y+30,z.root.position.z]));
    if(!a.moving&&occupied!==a.open){a.open=occupied;a.moving=.25;if(combat?.enabled)combat.audio.play('moon/evt/zombie_moon/airlock/airlock_'+(a.open?'open':'close'),.5);}
    if(a.moving){a.moving=Math.max(0,a.moving-dt);for(const p of a.parts){slide(p,a.open?1-a.moving/.25:a.moving/.25);p.solid=!a.moving;}}
  }
  if(changed)navigation?.setDoors(parts);
}
// zombie_moon_sq_be.gsc: level._sliding_doors are the airlock triggers and zombie_door triggers; the Vril Sphere
// waits at a sliding_door node until the closest one (2D) is open.
function slidingDoorOpen(position){
  let best=null,distance=Infinity;
  for(const e of data.entities){
    if(e.script_noteworthy!=='zombie_door_airlock'&&e.targetname!=='zombie_door')continue;
    const p=e.bounds?e.bounds[0].map((v,i)=>(v+e.bounds[1][i])/2):e.position,d=Math.hypot(p[0]-position[0],p[2]-position[2]);
    if(d<distance){best=e;distance=d;}
  }
  if(!best)return undefined;
  if(best.script_noteworthy==='zombie_door_airlock'){const a=airlocks.find(a=>a.trigger===best||a.trigger?.id===best.id);return !!a&&opened.has(a.door.name)&&a.open;}
  const door=data.doors.find(d=>d.triggers.includes(best.id));return door?opened.has(door.name):undefined;
}
// change_door_models: purchased airlock leaves swap *_locked for the unlocked model.
let unlockedMap=null;
function unlockLeaf(part){
  if(!part.object||!/_locked$/.test(part.entity.model??''))return;
  part.object.traverse(o=>{if(!o.isMesh)return;o.userData.lockedMaterial??=o.material;
    const next=[o.userData.lockedMaterial].flat().map(m=>{if(!/airlock.*_locked/.test(m.name))return m;const c=m.clone();if(unlockedMap)c.map=unlockedMap;c.userData.unlocked=true;return c;});
    o.material=next.length===1?next[0]:next;});
}
// Static collision of script-moved entities is toggled in place (Solid/NotSolid) by pointing
// their baked triangles at a single remote vertex, so no rebake is needed.
function staticTriangles(ids){
  const pos=collision.geometry.attributes.position.array,index=collision.geometry.index.array;
  let remote=0;for(let i=1;i<pos.length/3;i++)if(pos[i*3+1]<pos[remote*3+1])remote=i;
  const cell=p=>[Math.round(p.x*2),Math.round(p.y*2),Math.round(p.z*2)];
  for(const id of ids){
    const o=objects.get(id);if(!o)continue;const keys=new Set(),v=new THREE.Vector3();o.updateMatrixWorld(true);
    o.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){const [x,y,z]=cell(v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld));for(let dx=-1;dx<2;dx++)for(let dy=-1;dy<2;dy++)for(let dz=-1;dz<2;dz++)keys.add((x+dx)+','+(y+dy)+','+(z+dz));}});
    const box=new THREE.Box3().setFromObject(o).expandByScalar(2),tris=[];
    collision.bvh.shapecast({intersectsBounds:b=>b.intersectsBox(box),intersectsTriangle:(t,i)=>{if([t.a,t.b,t.c].every(p=>keys.has(cell(p).join(','))))tris.push(i);return false;}});
    statics.set(id,{tris,original:tris.map(i=>[index[i*3],index[i*3+1],index[i*3+2]]),remote,enabled:true});
  }
}
function setStatic(id,enabled){
  const g=statics.get(id);if(!g||g.enabled===enabled)return;g.enabled=enabled;const index=collision.geometry.index.array;
  g.tris.forEach((t,j)=>index.set(enabled?g.original[j]:[g.remote,g.remote,g.remote],t*3));
}
// zombie_moon_utility.gsc zombie_moon_hatch and zombie_moon.csc receiving_bay_doors /
// computer_screens_power / wait_for_power: power opens the Receiving Bay hatch (1 s, then
// non-solid), drops its clips 256 units, moves the bay doors over 3 s and lights the screens.
function updatePower(dt){
  const p=powerProps;if(!p||!state.power||p.time>=3)return;
  if(!p.time){for(const id of p.hatches)setStatic(id,false);for(const o of p.screens)o.visible=true;}
  p.time=Math.min(3,p.time+dt);const t=Math.min(1,p.time);
  for(const id of p.hatches){const o=objects.get(id);if(o)o.position.copy(p.origin.get(id)).add(vector(data.entities[id].move).multiplyScalar(t));}
  for(const part of p.clips){slide(part,t);if(t===1&&!part.navBlock){part.navBlock=true;navigation.setDoors(parts);}}
  for(const id of p.bay){const o=objects.get(id);if(o)o.position.copy(p.origin.get(id)).add(vector(data.entities[id].move).multiplyScalar(p.time/3));}
  if(p.handle){p.handle.quaternion.copy(p.handleRest).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2*Math.min(1,p.time/.3)));}
}
function resetMapState(){
  for(const a of airlocks){a.open=false;a.moving=0;a.unlocked=false;for(const p of a.parts){p.solid=undefined;p.navBlock=undefined;p.object?.traverse(o=>{if(o.userData.lockedMaterial)o.material=o.userData.lockedMaterial;});}}
  if(powerProps){const p=powerProps;p.time=0;for(const id of p.hatches)setStatic(id,true);for(const id of [...p.hatches,...p.bay]){const o=objects.get(id);if(o)o.position.copy(p.origin.get(id));}for(const o of p.screens)o.visible=false;for(const part of p.clips){slide(part,0);part.navBlock=false;}if(p.handle)p.handle.quaternion.copy(p.handleRest);}
  hazards.fall=null;hazards.pending=0;
}
function findTarget() {
  target = null; let distance = 110;
  if(combat?.enabled&&combat.session.hackerOut){const spot=features.findTarget();target=spot?{kind:'feature',feature:spot}:null;return spot?'Hold F · Hack':'';}
  for (const e of data.entities) {
    const suit = e.zombie_equipment_upgrade === 'equip_gasmask_zm';
    const power = e.targetname === 'use_elec_switch';
    const door = data.doors.find(d => !opened.has(d.name) && d.triggers.includes(e.id));
    const weapon=combat?.enabled&&e.targetname==='weapon_upgrade'&&combat.data.weapons[e.zombie_weapon_upgrade];
    if ((!suit || state.hasSuit) && (!power || state.power) && !door && !weapon) continue;
    const d = e.bounds ? new THREE.Box3(vector(e.bounds[0]), vector(e.bounds[1])).distanceToPoint(camera.position) : camera.position.distanceTo(vector(e.position));
    if (d >= distance) continue;
    // Doors and airlocks are trigger_use_touch: the player has to stand inside the trigger, not just look at it.
    if (door && e.classname === 'trigger_use_touch' && !touching(e.bounds, player.getFeetPosition().toArray())) continue;
    // A short sight check prevents collecting equipment through walls.
    const center = vector(e.position), direction = center.clone().sub(camera.position);
    if(direction.length()>25&&direction.clone().normalize().dot(camera.getWorldDirection(new THREE.Vector3()))<.25)continue;
    const wall = rayIntersect(new THREE.Ray(camera.position.clone(), direction.clone().normalize()), 1, direction.length());
    if (!door && wall && wall.distance < direction.length()-28) continue;
    distance = d; target = {entity: e, door, weapon, kind: door ? 'door' : suit ? 'suit' : weapon ? 'weapon' : 'power'};
  }
  if(target?.kind==='weapon'){
    const owned=combat.session.inventory.find(w=>w.id===target.weapon.id),price=owned?(owned.upgraded?4500:target.weapon.ammoPrice??Math.ceil(target.weapon.price/2)):target.weapon.price;
    const displayed=owned&&combat.session.hackedWeapons.has(target.weapon.id)?owned.upgraded?(target.weapon.ammoPrice??Math.ceil(target.weapon.price/2)):4500:price;
    target.label=`F · ${target.weapon.name}${owned?' ammo':''} · ${displayed}`;
  }
  const extra=combat.enabled?features?.findTarget(distance):null;
  if(extra){target={kind:'feature',feature:extra};return extra.silent?'':(extra.label.startsWith('Hold F')?'':'F · ')+extra.label;}
  return target?.label??(target?.kind === 'door' ? 'F · Open ' + (target.entity.targetname === 'zombie_airlock_buy' ? 'airlock' : 'door')+(combat.enabled?' · '+target.door.cost:'') : target?.kind === 'suit' ? 'F · Equip P.E.S. life support' : target?.kind === 'power' ? 'F · Restore power' : '');
}
function interact() {
  findTarget(); if (!target) return false;
  if(target.kind==='feature')return features.interact(target.feature);
  if(combat.enabled&&!combat.session.canAct)return false;
  if (target.kind === 'suit') { state.equipSuit();combat.session.hacker=false;showNotice('P.E.S. equipped · Q to remove or replace the helmet.'); }
  if (target.kind === 'power') { state.power = true; combat.session.power=true;showNotice('Power restored. Pressurized rooms now have normal gravity.'); }
  if (target.kind === 'door') { if(combat.enabled&&!combat.session.buyDoor(target.door)){combat.audio.noMoney?.();showNotice('Not enough points.');return false;}opened.add(target.door.name); showNotice('Passage opened', 2); }
  if (target.kind === 'weapon') return combat.buyWeapon(target.weapon.id);
  return true;
}
// zombie_moon_ffotd.gsc main_end trigger_radius volumes (origin is the cylinder base):
// kill brushes, then force-move and force-not-prone triggers with their exit offsets.
const FFOTD={kill:[[-866,-219,-634,100,60],[-686,-219,-634,100,128],[846,-219,-634,100,60],[676,-219,-634,100,128],[-866,-380,19,128,64],[-232,1536,-7120,2048,1024]],
  move:[[530,135,-7433,32,128,-40,40],[-8,166,-6735,32,128,-40,40],[1.2,171,-5548.6,32,128,-40,40],[44,-464,-3725,96,128,0,80],[-794,132,-7672,128,128,0,80]]};
const inCylinder=([x,y,z,r,h],f)=>Math.hypot(f.x-x,f.z-z)<r+15&&f.y+70>=y&&f.y<=y+h;
function respawnPoint(){
  const flags=combat.session.flags,d=features.quest.diggers,pick=zone=>{const root=data.entities.find(e=>e.targetname==='player_respawn_point'&&e.script_noteworthy===zone);const list=root?data.entities.filter(e=>e.targetname===root.target):[];return list.find(e=>e.script_int==='1')??list[0];};
  // moon_digger_respawn: with both tunnels breached, solo respawns move to the Hacker-side airlocks.
  if(d.teleporter.breached&&d.hangar.breached){if(flags.has('catacombs_west4'))return pick('airlock_west2_zone');if(flags.has('catacombs_east4'))return pick('airlock_east2_zone');}
  return pick('bridge_zone');
}
// zombie_moon.gsc insta_kill_player: a solo life goes at once and the player is moved to a respawn point after 1.5 s;
// without one the game ends.
function instaKillPlayer(){
  const s=combat.session;if(hazards.fall||!['fighting','preparing'].includes(s.phase))return false;
  combat.damage(10000);hazards.fall={left:1.5};return true;
}
// zombie_moon.gsc cliff_fall_death / insta_kill_player and the FFOTD volumes.
function mapHazards(dt){
  const feet=player.getFeetPosition(),s=combat.session,protectedNow=s.effects.invulnerable>s.time,padded=!!(features.flight||features.padLaunch);
  for(const m of hazards.zones){m.wait=Math.max(0,m.wait-dt);if(!m.wait&&inCylinder(m.zone,feet)){m.wait=2;player.setPosition(new THREE.Vector3(m.zone[0]+m.zone[5],m.zone[1],m.zone[2]+m.zone[6]));}}
  // player_out_of_playable_area_monitor polls every 3 s; zombie_moon_player_out_of_playable_area_monitor_callback skips a padded player.
  if((hazards.poll=(hazards.poll??3)-dt)<=0){hazards.poll=3;if(!hazards.pending&&!padded&&FFOTD.kill.some(k=>inCylinder(k,feet)))hazards.pending=.5;}
  if(hazards.pending&&!(hazards.pending=Math.max(0,hazards.pending-dt))){
    if(!combat.enabled){relocate(checkpoint);showNotice('Returned to the arrival point.',5);return true;}
    // After the 0.5 s laugh a downed solo player ends the game; otherwise every life is taken first (self.lives = 0).
    if(s.lastStand&&s.phase!=='gameover'){s.lastStand=null;s.phase='gameover';s.lastEvent='Game over';combat.clearInput();combat.end();return true;}
    if(!protectedNow&&s.phase!=='gameover'){s.lives=0;combat.damage(10000);return true;}
  }
  if(!hazards.fall&&touching(hazards.cliff?.bounds,feet.toArray())){
    if(!combat.enabled){relocate(checkpoint);showNotice('Returned to the arrival point.',5);return true;}
    if(instaKillPlayer()&&s.phase==='gameover')return true;
  }
  if(hazards.fall&&(hazards.fall.left-=dt)<=0){
    hazards.fall=null;if(s.phase!=='reviving')return false;
    const p=respawnPoint();if(p){player.setPosition(vector(p.position).add(new THREE.Vector3(0,20,0)));camera.rotation.set(0,p.yaw-Math.PI/2,0);}if(s.lastStand)s.lastStand.left=0;
  }
  return false;
}
// zombie_moon_gravity.gsc zombie_moon_player_float: sprinting on the ground in low gravity
// rolls a 40% chance (rising 10 points per miss) to add a 100 u/s hop after 0.75-1.25 s.
const hop={wait:0,chance:40,pending:null};let baseAcceleration=null;
function floatHop(dt,sprinting){
  hop.wait=Math.max(0,hop.wait-dt);
  const eligible=sprinting&&environment.lowGravity&&player.isGrounded;
  if(hop.pending!==null){if((hop.pending-=dt)>0)return;hop.pending=null;if(eligible){player.velocity.y+=100;hop.chance=40;hop.wait=2;}else hop.chance+=10;return;}
  if(!eligible||hop.wait)return;
  if(Math.random()*100<hop.chance)hop.pending=.75+Math.random()*.5;else hop.wait=2;
}
function update(dt) {
  touchControls.setEnabled(active&&(!combat.enabled||combat.session.phase!=='gameover'),active);
  const touch=touchControls.input.read();
  const padInput=controller.frame;
  // Keep a tap through the native sprint-out animation so a moving player
  // can fire a semi-automatic weapon as soon as it has been lowered.
  if(!touchControls.enabled)touchFirePending=false;
  touchFirePending ||= touch.firePressed;
  const touchWantsFire=touch.fire||touchFirePending;
  const padWantsFire=padInput.fire||padFirePending;
  combat.primary=mousePrimary||touchWantsFire||padWantsFire;
  if(touchFirePending&&combat.view.ready&&!['drop','raise','melee','sprintIn','sprint','sprintOut'].includes(combat.view.mode)){
    combat.pressed=true;touchFirePending=false;
  }
  if(padFirePending&&combat.view.ready&&!['drop','raise','melee','sprintIn','sprint','sprintOut'].includes(combat.view.mode)){
    combat.pressed=true;padFirePending=false;
  }
  const secondary=mouseSecondary||(combat.session.def.dualWield&&(touch.aim||padInput.aim));
  combat.secondaryPressed ||= secondary&&!combat.secondary;combat.secondary=secondary;
  combat.ads=mouseAim||((touch.aim||padInput.aim)&&!combat.session.def.dualWield);
  const feet = player.getFeetPosition();
  environment = environmentAt(data, feet.clone().add(new THREE.Vector3(0, 35, 0)).toArray(), state.power, onMoon, environment);
  if(combat.enabled)environment=features.environment(environment);
  combat.audio.environment(environment);
  player.gravity = environment.gravity;
  player.jumpSpeed = environment.lowGravity ? 190 : Math.sqrt(2*data.rules.normalGravity*39);
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'))+touch.forward+padInput.move.y,strafe=Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+touch.strafe+padInput.move.x;
  const moving=Math.hypot(forward,strafe)>.01,wantSprint=((keys.has('ShiftLeft')||keys.has('ShiftRight'))&&keys.has('KeyW')||touch.sprint||padInput.sprint)&&!touchWantsFire&&!padWantsFire&&(!combat.enabled||!combat.ads&&!combat.session.reloadLeft&&!combat.session.meleeLeft);
  const sprint=combat.enabled?combat.session.sprint(dt,wantSprint):wantSprint;
  // Astronaut capture slows movement while jump-pad flight drives the controller velocity.
  const slow=combat.enabled?features?.playerSlow()??1:1,free=slow===1;
  // The held weapon's moveSpeedScale (0.8 launchers to 1.1 SMGs) scales walking and sprinting.
  const weaponScale=combat.enabled&&!combat.session.hackerOut?combat.session.def?.moveSpeedScale??1:1;
  player.moveSpeed=(combat.session.perks.has('specialty_longersprint')?209:190)*slow*weaponScale;player.sprintSpeed=(combat.session.perks.has('specialty_longersprint')?330:285)*slow*weaponScale;
  const valid=!combat.enabled||!['reviving','gameover'].includes(combat.session.phase);
  if(combat.enabled)features.prePlayer(dt,{forward,strafe});
  // The melee charge holds its horizontal velocity: input acceleration is suspended for the lunge.
  const lunge=combat.enabled?combat.lungeVelocity:null;baseAcceleration??=player.groundAcceleration;
  player.groundAcceleration=lunge?0:baseAcceleration;if(lunge){player.velocity.x=lunge.x;player.velocity.z=lunge.z;}
  // _laststand.gsc only disallows jumping; the engine keeps a prone crawl (approximated as a crouch at CoD's 0.15 prone speed scale).
  const downed=combat.enabled&&combat.session.phase==='reviving';player.crouchSpeed=downed?190*.15:90;
  player.update(dt,{forward,strafe,sprint:sprint&&!downed,jump:!downed&&free&&(keys.has('Space')||padInput.jump),jumpPressed:!downed&&free&&touch.jump,crouch:downed||free&&(keys.has('ControlLeft')||keys.has('ControlRight')||keys.has('KeyC')||touch.crouch||padInput.crouch)});
  floatHop(dt,sprint&&valid);
  updateDoors(dt);updatePower(dt);
  const position = player.getFeetPosition().add(new THREE.Vector3(0, 35, 0)).toArray();
  const pad = data.entities.find(e => ['nml_teleporter', 'generator_teleporter'].includes(e.targetname) && contains(e.bounds, position) && (!combat.enabled || features.padOpen(e.targetname)));
  const event = state.update(dt, environment, pad?.targetname, {jug: combat.enabled && combat.session.perks.has('specialty_armorvest'), valid});
  if (event.teleport) {
    if (event.teleport === 'nml_teleporter') relocate('receiving');
    else relocate('area51', data.returnSpawn);
  }
  if(mapHazards(dt))return;
  if (event.suffocated || player.getFeetPosition().y < -2000) {
    if(combat.enabled){combat.damage(10000);return;}
    relocate(checkpoint); showNotice(event.suffocated ? 'No oxygen. Returned to the arrival point — find a P.E.S. station.' : 'Returned to the arrival point.', 7);
  }
  combat.update(dt,{moving,sprint});
  if(combat.enabled)features.update(dt,keys.has('KeyF')||keys.has('KeyE')||touch.use||padInput.use);
  presentation.update(dt,environment);
  atmosphere.update(dt,player.getFeetPosition());atmosphere.setEarthDestroyed(features.quest.completed);
  noticeLeft = Math.max(0, noticeLeft-dt);
  $('notice').textContent = noticeLeft ? (controller.usingPad?notice.replace('F to equip',`Hold ${controller.glyph('use')} to equip`).replace('Q to','↑ to').replace('X to throw',`${controller.glyph('tactical')} to throw`):touchControls.mode?notice.replace('F to equip','Tap USE to equip'):notice) : '';
  $('prompt').textContent = state.teleport ? `Teleporting in ${(data.rules.teleportSeconds-state.teleport.elapsed).toFixed(1)}…` : findTarget();
  if(touchControls.mode)$('prompt').textContent=$('prompt').textContent.replace(/\bF\s*·/g,'USE ·').replace('Hold F','Hold USE').replace('H to hack','Hold HACK');
  if(controller.usingPad)$('prompt').textContent=$('prompt').textContent.replace(/\bF\s*·/g,`Hold ${controller.glyph('use')} ·`).replace('Hold F',`Hold ${controller.glyph('use')}`).replace('H to hack','↑ to raise Hacker');
  if(combat.enabled){
    hud.update(dt,{active,environment,exposure:state.exposure});
    if(!state.teleport)$('prompt').innerHTML=hud.hint(target);
    const hitAge=combat.session.time-combat.hitAt;$('hitmarker').style.opacity=hitAge>=0&&hitAge<1?1-hitAge:0;
    combat.audio.update(dt,{camera,environment,features});
    controller.feedback(combat.session);
  }else $('visor').hidden=!state.suit||!active;

}
async function load() {
  const response = await fetch('moon/map-data.json');
  if (!response.ok) throw new Error('Moon data is missing. Run .tools/rebuild-moon.ps1.');
  data = await response.json(); state = new MoonState(data.rules);
  $('status').textContent = 'Loading lunar geometry, textures and collision…';
  const [gltf, world] = await Promise.all([new GLTFLoader().loadAsync('moon/moon.gltf'), loadCollisionWorld({metadataUrl: 'moon/collision.json'})]);
  collision = world; scene.add(gltf.scene); scene.updateMatrixWorld(true);
  const stairResponse=await fetch('moon/stair-ramps.json');if(!stairResponse.ok)throw new Error('Moon stair collision is missing');
  stairs=createStairCollision((await stairResponse.json()).ramps,collision);
  water = await loadMoonWater(gltf.scene);
  const hazardIds=data.entities.filter(e=>['digger_hangar_blocker','digger_teleporter_blocker'].includes(e.targetname)).map(e=>e.id);
  const windowGroups=new Set(data.entities.filter(e=>e.targetname==='exterior_goal').map(e=>e.target));
  const windowIds=data.entities.filter(e=>windowGroups.has(e.targetname)&&e.script_noteworthy==='clip').map(e=>e.id);
  const boardIds=data.entities.filter(e=>windowGroups.has(e.targetname)&&e.script_parameters?.startsWith('barricade_')).map(e=>e.id);
  // zombie_moon_teleporter.gsc gate brushes and the Receiving Bay hatch clips (hatch_clip).
  const gateIds=data.entities.filter(e=>['teleporter_gate','teleporter_gate_top','bunker_gate','bunker_gate_2'].includes(e.targetname)).map(e=>e.id);
const packGateIds=data.entities.filter(e=>e.targetname==='zombieland_gate').map(e=>e.id);
  const clipIds=data.entities.filter(e=>e.targetname==='recieving_hatch'&&e.script_noteworthy==='hatch_clip').map(e=>e.id);
  const moving = new Set([...data.doors.flatMap(d => d.parts),...hazardIds,...windowIds,...boardIds,...gateIds,...packGateIds,...clipIds]), detach = [];
  gltf.scene.traverse(o => {
    if (o.userData.collisionOnly) o.visible = false;
    // Native sky materials use cubemap shaders; their flat DDS preview makes
    // opaque blue boxes in glTF. Use a clear sky until that shader is ported.
    if (o.isMesh && /(?:sky_day|mtl_skybox)/i.test(o.material?.name || '')) o.visible = false;
    if(o.isMesh&&/moon_vista_earth/i.test(o.material?.name||''))o.visible=false;
    if (o.userData.entityId !== undefined) {
      objects.set(o.userData.entityId, o);
      detach.push(o);
    }
  });
  for (const o of detach) { scene.attach(o); o.matrixAutoUpdate = true; }
  for (const id of moving) { const part = makePart(data.entities[id], objects.get(id)); if (part) {part.hazard=hazardIds.includes(id);part.window=windowIds.includes(id);part.removable=part.hazard||boardIds.includes(id);if(part.hazard)part.amount=1;parts.set(id, part);} }
  // digger_think_blocker: the blocker drops 512 units on breach (the teleporter one is shifted 20 units).
  for(const id of hazardIds){const p=parts.get(id);if(p){p.delta.set(0,-512,data.entities[id].targetname==='digger_teleporter_blocker'?20:0);p.navBlock=false;}}
  for(const id of gateIds){const p=parts.get(id);if(p)p.gate=/^bunker/.test(data.entities[id].targetname)?'nml':'moon';}
  // The zombieland gates around Pack-a-Punch start retracted and only move when the machine is hacked.
  for(const id of packGateIds){const p=parts.get(id);if(p){p.packGate=true;p.navBlock=false;}}
  // These invisible hatch clips drive disconnect_paths_when_done. Their aggregate
  // bounds are navigation blockers, not a solid player box across the launch shaft.
  for(const id of clipIds){const p=parts.get(id);if(p){p.clip=true;p.solid=false;p.navBlock=false;}}
  for(const door of data.doors)door.airlock=door.triggers.some(id=>data.entities[id].targetname==='zombie_airlock_buy');
  for(const t of data.entities.filter(e=>e.script_noteworthy==='zombie_door_airlock')){
    const door=data.doors.find(d=>d.airlock&&d.triggers.some(id=>data.entities[id].target===t.targetname));
    if(door)airlocks.push({trigger:t,door,parts:data.entities.filter(e=>e.targetname===t.target).map(e=>parts.get(e.id)).filter(Boolean),open:false,moving:0,unlocked:false});
  }
  hazards.cliff=data.entities.find(e=>e.targetname==='cliff_fall_death');hazards.zones=FFOTD.move.map(zone=>({zone,wait:0}));
  const hatches=data.entities.filter(e=>e.targetname==='recieving_hatch'&&e.script_noteworthy!=='hatch_clip').map(e=>e.id),bay=data.entities.filter(e=>e.targetname==='receiving_bay_doors').map(e=>e.id);
  const handle=objects.get(data.entities.find(e=>e.targetname==='elec_switch')?.id);
  powerProps={time:0,hatches,bay,clips:clipIds.map(id=>parts.get(id)).filter(Boolean),screens:data.entities.filter(e=>e.targetname==='moon_comp_screens').map(e=>objects.get(e.id)).filter(Boolean),handle,handleRest:handle?.quaternion.clone(),origin:new Map([...hatches,...bay].filter(id=>objects.get(id)).map(id=>[id,objects.get(id).position.clone()]))};
  for(const o of powerProps.screens)o.visible=false;
  staticTriangles([...hatches,data.entities.find(e=>e.targetname==='teleporter_gate')?.id]);
  unlockedMap=await new THREE.TextureLoader().loadAsync('moon/textures/actors/airlock_unlocked_c.webp').catch(()=>null);
  if(unlockedMap){unlockedMap.flipY=false;unlockedMap.colorSpace=THREE.SRGBColorSpace;unlockedMap.wrapS=unlockedMap.wrapT=THREE.RepeatWrapping;}
  const optimization = optimizeStaticScene(gltf.scene, {cellSize: 1024});
  navigation=new MoonNavigation(data);await navigation.load();navigation.setDoors(parts);
  const playerRay=ray=>{const hit=rayIntersect(ray),ramp=stairs.rayIntersect(ray,0,hit?.distance??Infinity);return ramp||hit;};
  player = new PlayerController(camera, {capsuleIntersect, rayIntersect:playerRay}, {radius: 15, height: 70, eyeHeight: 60, moveSpeed: 190, sprintSpeed: 285, crouchSpeed: 90, gravity: 800, jumpHeight: 39, stepHeight:18, groundProbeDistance: 4, groundSnapSpeed:240, verticalFloorResolution:true});
  $('status').textContent='Loading Moon zombies and weapons…';
  const worldApi={navigation,pathCornerTolerance:.25,path:(a,b)=>navigation.path(a,b),closest:(p,e)=>navigation.closest(p,e),move:(a,b)=>navigation.move(a,b),raycast:rayIntersect,
    lineClear:(a,b)=>{const d=b.clone().sub(a);return !rayIntersect(new THREE.Ray(a,d.clone().normalize()),1,Math.max(1,d.length()-4));},
    zoneAt:p=>environmentAt(data,p.clone().add(new THREE.Vector3(0,35,0)).toArray(),state.power,navigation.area==='moon').zone,
    lowGravity:p=>{const env=environmentAt(data,p.clone().add(new THREE.Vector3(0,35,0)).toArray(),state.power,navigation.area==='moon');return (features?.environment(env)??env).lowGravity;}};
  combat=new MoonCombat(scene,camera,worldApi,{notice:showNotice,end:endRun,feet:()=>player.getFeetPosition()});await combat.load();combat.enabled=mode==='survival';
  $('status').textContent='Preparing station systems and quest…';
  features=new MoonFeatures({data,state,combat,scene,camera,player,objects,opened,parts,navigation,notice:showNotice,raycast:rayIntersect});await features.load();features.setStatic=setStatic;features.quest.slidingDoorOpen=slidingDoorOpen;features.instaKillPlayer=instaKillPlayer;
  features.rumble=(strong,weak,ms)=>{if(controller.usingPad)controller.pad.rumble(strong,weak,ms);};
  hud=new MoonHud({combat,features,state,touch:touchControls,controller});combat.crouched=()=>player.crouched;
  presentation=new MoonPresentation(scene,camera,features);await presentation.load();
  atmosphere=new MoonRender(renderer,scene,camera,{sun,ambient,hemisphere,fill,viewScene:combat.viewScene,shadowParts:[...parts.values()],mobile:matchMedia('(pointer: coarse)').matches});await atmosphere.load(data);
  relocate('area51'); water.captureReflection(renderer, scene); player.enabled = false; ready = true;setModeUi();
  $('status').textContent = mode==='survival'?'500 points. M1911. Reach the teleporter and survive.':'Exploration: free doors and destination shortcuts.';
  $('new-run').disabled=false;$('explore').disabled=false;
  $('start').disabled = false; document.querySelectorAll('[data-destination]').forEach(b => b.disabled = false);
  window.moon = {ready: true, data, state, player, camera, scene, renderer, collision, parts, opened, errors, optimization,combat,navigation,features,presentation,hud,atmosphere,
    debug: {relocate, interact, update, resetRun, pause, resume, environment: () => environment, target: () => target,
      snapshot: () => ({input:{touch:touchControls.getState(),controller:{connected:controller.pad.connected,usingPad:controller.usingPad,...controller.frame,actions:[...controller.frame.actions]},primary:combat.primary,ads:combat.ads},player:{...player.state,rotation:camera.rotation.toArray().slice(0,3)},position: player.getFeetPosition().toArray(), grounded: player.isGrounded, active, mode, checkpoint, environment, power: state.power, hasSuit: state.hasSuit, suit: state.suit, exposure: state.exposure, doors: [...opened], combat:combat.snapshot(), fps, drawCalls: renderer.info.render.calls, errors: [...errors]})}};
}
load().catch(error => { errors.push(String(error)); $('status').textContent = 'Moon could not load.'; $('error').hidden = false; $('error').textContent = error.message; console.error(error); });
let previous = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.max(0, (now-previous)/1000); previous = now;
  pollController(Math.min(.25,dt));
  menuUI.update({started:!!combat?.session?.time,session:combat?.session,controller,objective:$('objective').textContent,audio:combat?.audio});
  if(combat)combat.baseFov=menuUI.settings.fov;
  if (active) water?.update(Math.min(.25, dt));
  // Preserve real-time timers on slower GPUs while keeping collision steps small.
  for(let remaining=Math.min(.25,dt);active&&remaining>0;){const step=Math.min(.05,remaining);if(ending)updateEnding(step);else update(step);remaining-=step;}
  // Earthquakes shake only the rendered view, so the aim is unchanged.
  const shake=ready&&active&&combat.enabled&&!ending?features.shake():null;if(shake){camera.rotation.x+=shake.x;camera.rotation.y+=shake.y;}
  if(ready)atmosphere.render(active&&combat.enabled&&!ending?combat.viewScene:null,combat.viewCamera);
  else {renderer.clear();renderer.render(scene,camera);}
  if(shake){camera.rotation.x-=shake.x;camera.rotation.y-=shake.y;}
  frames++; frameTime += dt;
  if (frameTime >= .5) { fps = Math.round(frames/frameTime); frames = 0; frameTime = 0; }
  if (debugVisible && ready) $('debug').textContent = `${fps} FPS · ${renderer.info.render.calls} calls\n${player.getFeetPosition().toArray().map(n => n.toFixed(1)).join(', ')}\n${environment?.zone || 'outside volume'} · gravity ${player.gravity}\n${opened.size}/${data.doors.length} door groups open`;
});
