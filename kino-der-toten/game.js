import * as THREE from 'three';
import { PlayerController } from './player-controller.js';
import { World, vector, zoneNames } from './world.js';
import { ViewWeapon } from './animation.js';
import { WeaponScope } from './weapon-optics.js';
import { Enemies } from './enemies.js';
import { KinoSession as Session } from './kino-session.js';
import { KinoFeatures } from './kino-features.js';
import { GameAudio } from './audio.js';
import { Powerups } from './powerups.js';
import { PerkDrink } from './perk-drink.js';
import { MysteryBox } from './mystery-box.js';
import { createZombieTouch } from './zombies-touch.js';
import { configureKinoAssets, assetDiagnostics } from './runtime-assets.js';
import { KinoCoop } from './kino-coop.js';
import { shareWorld } from './kino-coop-state.js';
import { KinoEvents } from './kino-events.js';
import { ZombiesMenu } from './zombies-menu.js';
import { ZombiesHud } from './zombies-hud.js';
import { MoonController } from './moon-controller.js';
const menuUI=new ZombiesMenu();

const $=id=>document.getElementById(id), keys=new Set(),audio=new GameAudio(),weaponScope=new WeaponScope();
const profile=configureKinoAssets();
audio.maxBufferBytes=profile.mobile?16*1024*1024:Infinity;audio.preload=!profile.mobile;
const renderer=new THREE.WebGLRenderer({antialias:!profile.mobile,powerPreference:profile.mobile?'default':'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,profile.mobile?1:1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
let previous=performance.now(),lastRendered=0,renderedFrames=0,contextLost=false,resizeTimer;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=2.05;renderer.autoClear=false;
document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x101319);scene.fog=new THREE.FogExp2(0x14181b,.00032);
const ambient=new THREE.AmbientLight(0xb3bcc7,1.2);scene.add(ambient,new THREE.HemisphereLight(0xd2d9e3,0x574236,2.0));
const keyLight=new THREE.DirectionalLight(0xffdfb1,1.5);keyLight.position.set(.4,1,.2);scene.add(keyLight);
const fill=new THREE.DirectionalLight(0x8cabc9,.7);fill.position.set(-1,.5,-.5);scene.add(fill);
let camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,1,14000);camera.rotation.order='YXZ';camera.position.set(-101,168,1256);camera.lookAt(160,170,850);
const viewScene=new THREE.Scene(),viewCamera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200);
viewScene.add(new THREE.AmbientLight(0xe1d9c7,2.8));const vl=new THREE.DirectionalLight(0xffefc8,2);vl.position.set(0,4,2);viewScene.add(vl);
const muzzle=new THREE.PointLight(0xffc276,0,240,1);scene.add(muzzle);
let data,world,session,player,enemies,view,powerups,perkDrink,mysteryBox,features,ready=false,active=false,started=false,primary=false,primaryPressed=false,ads=false;
let prompt=null,promptText='',toastUntil=0,announcementUntil=0,hitUntil=0,flashUntil=0,spawn;
let lastPhase='',lastRound=0,frameTime=0,frameCount=0,fps=0,debugVisible=false,teleportPending=0,linkUntil=0,returnAt=0,cooldownUntil=0,repairLeft=0,burstLeft=0;
const particles=[],grenades=[],traps=[],gasClouds=[],meteors=new Set();
const perkInfo={specialty_quickrevive:{name:'Quick Revive',price:500,color:'#509ebc',icon:'QR'},specialty_fastreload:{name:'Speed Cola',price:3000,color:'#478450',icon:'SC'},specialty_rof:{name:'Double Tap',price:2000,color:'#b37528',icon:'DT'},specialty_armorvest:{name:'Juggernog',price:2500,color:'#a53835',icon:'J'}};
const powerupNames={nuke:'Nuke',insta_kill:'Insta-Kill',double_points:'Double Points',full_ammo:'Max Ammo',carpenter:'Carpenter',fire_sale:'Fire Sale'};
const errors=[];
let lastShot=null;
let pendingMelee=null,lastReloadSerial=0,reloadShot=false;
let mousePrimary=false,mouseAim=false;
let coop,remoteActor=null;
let grenadeSerial=0;
const controller=new MoonController({menu:$('menu'),back:()=>{if(!menuUI.back()&&started)start();}});
const nativeHud=new ZombiesHud();
function switchWeapon(slot){if(coop?.isClient)coop.action('switch',slot);session.switchWeapon(slot);equipView();}
function equipment(kind){if(coop?.isClient)return coop.action(kind);return kind==='claymore'?features.placeClaymore():features.throwMonkey();}
function attachment(){if(coop?.isClient)coop.action('attachment');if(session.toggleAttachment())equipView();}
const touchControls=createZombieTouch({
  onLook:(x,y,sensitivity)=>{
    if(!active||session.phase==='reviving')return;
    const scale=.005*sensitivity*menuUI.settings.sensitivity*(ads?.5:1);
    camera.rotation.y-=x*scale;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-y*scale,-1.5,1.5);
  },
  onAction:action=>{
    if(!active||session.phase==='reviving')return;
    if(action==='reload')reload();if(action==='melee')melee();if(action==='grenade')throwGrenade();if(action==='use')interact();
    if(action==='weapon')switchWeapon();
    if(action==='claymore')equipment('claymore');if(action==='equipment')equipment('monkey');
    if(action==='attachment')attachment();
  },
  onPause:()=>{setActive(false);document.exitPointerLock?.();},
});
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
function progress(text,percent){$('load-label').textContent=text;$('load-progress').style.width=percent+'%';}
function toast(text,duration=2.5){if(remoteActor){coop.event({type:'toast',text},remoteActor.id);return;}$('toast').textContent=text;toastUntil=(session?.time??0)+duration;}
function announce(title,small='KINO DER TOTEN',duration=4){$('announcement-title').textContent=title;$('announcement-small').textContent=small;$('announcement').style.opacity=1;announcementUntil=session.time+duration;}
function setActive(value){
  active=!!value&&ready&&session.phase!=='gameover';$('menu').hidden=active;document.body.classList.toggle('menu-open',!active);keys.clear();primary=false;primaryPressed=false;ads=false;reloadShot=false;
  if(active)menuUI.playerCounter.recordPlay();
  mousePrimary=mouseAim=false;controller.reset();menuUI.close();touchControls.reset();touchControls.setEnabled(active&&session.phase!=='reviving',active);
  if(active&&audio.ctx)audio.start();else if(!active)audio.pause();
  if(active){if(!started){started=true;announce('Round 1','SURVIVE');audio.play('round');}else if(session.phase==='preparing')announce('Round '+session.round,'PREPARE YOURSELF');}
  else if(started&&session.phase!=='gameover'){$('start').innerHTML='RESUME GAME <span>→</span>';$('restart').hidden=false;$('menu-status').textContent='Paused · Round '+session.round;}
  if(coop?.running){$('restart').hidden=true;$('menu-status').textContent=active?'':'Co-op continues while this menu is open';}
}
function start(){if(!ready||contextLost||coop?.connected&&!coop.running)return;if(session.phase==='gameover'){if(coop?.running)return;reset();}audio.start();warmViewAudio();if(touchControls.mode||controller.usingPad){setActive(true);return;}renderer.domElement.requestPointerLock?.()?.catch(e=>toast('Click the game to capture the mouse'));}
$('start').addEventListener('click',start);$('restart').addEventListener('click',()=>{reset();start();});
renderer.domElement.addEventListener('click',()=>{if(!active)start();});
document.addEventListener('pointerlockchange',()=>{if((touchControls.mode||controller.usingPad)&&!document.pointerLockElement)return;setActive(document.pointerLockElement===renderer.domElement);});
function suspendRendering(){renderer.setAnimationLoop(null);if(ready){setActive(false);document.exitPointerLock?.();}audio.pause();}
function resumeRendering(){previous=performance.now();lastRendered=0;if(!document.hidden&&!contextLost)renderer.setAnimationLoop(renderFrame);}
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspendRendering();else resumeRendering();});
addEventListener('pagehide',suspendRendering);
addEventListener('pageshow',resumeRendering);
// Keep simulation alive when the host switches tabs. Fully suspended browsers
// are detected by the guest's snapshot timeout.
let backgroundAt=performance.now();
setInterval(()=>{const now=performance.now();if(document.hidden&&coop?.running){const elapsed=Math.min((now-backgroundAt)/1000,.25);for(let left=elapsed;left>0;left-=.05)update(Math.min(.05,left));}backgroundAt=now;},50);
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;suspendRendering();$('start').disabled=true;$('menu-status').textContent='Graphics paused. Waiting for Safari to restore the game…';});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;$('start').disabled=!ready;$('menu-status').textContent='Graphics restored · tap to resume';resumeRendering();});
addEventListener('blur',()=>{keys.clear();primary=false;ads=false;if(started&&active){setActive(false);document.exitPointerLock?.();}});
addEventListener('mousemove',e=>{if(!active||document.pointerLockElement!==renderer.domElement)return;const sensitivity=(ads?.0012:.002)*menuUI.settings.sensitivity;camera.rotation.y-=e.movementX*sensitivity;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-e.movementY*sensitivity,-1.5,1.5);});
addEventListener('mousedown',e=>{if(!active||e.sourceCapabilities?.firesTouchEvents||e.target.closest('#touch-controls'))return;if(e.button===0){mousePrimary=primary=true;primaryPressed=true;}if(e.button===2)mouseAim=ads=true;});
addEventListener('mouseup',e=>{if(e.sourceCapabilities?.firesTouchEvents)return;if(e.button===0)mousePrimary=primary=false;if(e.button===2)mouseAim=ads=false;});
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea'))return;
  if(['Space','Tab','F3'].includes(e.code))e.preventDefault();
  keys.add(e.code);if(e.repeat||!active)return;
  if(e.code==='KeyR')reload();if(e.code==='KeyV')melee();if(e.code==='KeyG')throwGrenade();if(e.code==='KeyF'||e.code==='KeyE')interact();
  if(e.code==='Digit4')equipment('claymore');if(e.code==='KeyX')equipment('monkey');
  if(e.code==='Digit5')attachment();
  if(e.code==='Digit1'||e.code==='Digit2')switchWeapon(e.code==='Digit1'?0:1);
  if(e.code==='KeyQ')switchWeapon();
  if(e.code==='KeyM'){audio.enabled=!audio.enabled;toast(audio.enabled?'Sound on':'Sound off');}
  if(e.code==='F3'){debugVisible=!debugVisible;$('debug').hidden=!debugVisible;}
  if(e.code==='Escape'){setActive(false);document.exitPointerLock?.();}
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('wheel',()=>{if(active)switchWeapon();});
addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const width=innerWidth,height=innerHeight,current=renderer.getSize(new THREE.Vector2());if(current.x===width&&current.y===height)return;camera.aspect=viewCamera.aspect=width/height;camera.updateProjectionMatrix();viewCamera.updateProjectionMatrix();renderer.setSize(width,height);},profile.mobile?150:0);});

function damage(n,targetId){
  if(coop?.isClient)return;
  if(targetId&&targetId!=='host'){const actor=coop?.actors.get(targetId);if(actor)return withActor(actor,()=>damage(n));}
  if(!session.damage(n))return;audio.play('hit');
  if(remoteActor){coop.event({type:'hurt'},remoteActor.id);return;}
  if(!session.drinking)perkDrink?.stop();
  if(session.phase==='gameover'){
    primary=false;ads=false;setActive(false);document.exitPointerLock?.();$('start').innerHTML='TRY AGAIN <span>→</span>';$('restart').hidden=true;
    $('menu-status').textContent='You survived '+session.round+' rounds';$('results').hidden=false;$('results').textContent=session.kills+' kills · '+session.headshots+' headshots · '+Math.floor(session.time/60)+'m '+Math.floor(session.time%60)+'s';
    try{const best=Math.max(session.round,+(localStorage.getItem('kino.best')||0));localStorage.setItem('kino.best',String(best));}catch{}
  }else if(session.phase==='reviving')announce('A second chance','QUICK REVIVE',4);
}
function areaDamage(position,radius,maxDamage){
  if(coop?.isHost){for(const actor of coop.actors.values()){const point=actor.player.getFeetPosition().add(new THREE.Vector3(0,30,0)),distance=point.distanceTo(position);if(distance<radius&&world.lineClear(position,point)&&actor.session.damage(maxDamage*(1-distance/radius))){if(actor.id==='host')audio.play('hit');else coop.event({type:'hurt'},actor.id);}}}
  else {const point=player.getFeetPosition().add(new THREE.Vector3(0,30,0)),distance=point.distanceTo(position);if(distance<radius&&world.lineClear(position,point))damage(maxDamage*(1-distance/radius));}
}
function effect(position,color=0x9e3023,count=7){
  for(let i=0;i<count;i++){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5),new THREE.MeshBasicMaterial({color}));mesh.position.copy(position);scene.add(mesh);
    particles.push({mesh,velocity:new THREE.Vector3((Math.random()-.5)*100,Math.random()*90,(Math.random()-.5)*100),life:.45+Math.random()*.3});
  }
}
function hit(z,head){if(remoteActor)coop.event({type:'hit',head},remoteActor.id);else{hitUntil=session.time+.12;$('hitmarker').style.color=head?'#db5140':'#eee';}effect(head?enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?42:25,0)));}
function kill(z,force,position){
  if(z?.gasDeath){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(75,12,8),new THREE.MeshBasicMaterial({color:0x8ca345,transparent:true,opacity:.14,depthWrite:false}));
    mesh.scale.set(1.65,.6,1.65);mesh.position.copy(z.root.position).add(new THREE.Vector3(0,28,0));scene.add(mesh);gasClouds.push({mesh,position:z.root.position.clone(),life:7});
    effect(mesh.position,0x9eb652,15);audio.play('explosion');
    for(const other of [...enemies.list])if(other.root.position.distanceTo(z.root.position)<96)enemies.hurt(other,other.maxHealth,false,false,'explosion');
    if(coop?.isHost)areaDamage(z.root.position.clone().add(new THREE.Vector3(0,30,0)),96,45);else if(player.getFeetPosition().distanceTo(z.root.position)<96)damage(45);
  }
  if(force){dropPowerup(force,position??player.getFeetPosition());return;}
  if(z){const type=session.drops.tryDrop(session,{kind:z.kind,playable:z.state!=='barricade'&&!!world.zoneAt(z.root.position.clone().add(new THREE.Vector3(0,40,0))),destroyedWindows:world.barriers.filter(b=>b.count===0).length,boxMoves:mysteryBox.moves});if(type)dropPowerup(type,z.root.position);}
}
function dropPowerup(type,position){
  return powerups.spawn(type,position);
}
function collect(type){
  if(!powerupNames[type])return;
  if(coop?.isHost){for(const a of coop.actors.values())if(a.session!==session)a.session.powerup(type);coop.event({type:'toast',text:powerupNames[type]});}
  session.powerup(type);toast(powerupNames[type],3);audio.event('powerup/grab/grab_00',.75);
  audio.play(type);
  if(type==='full_ammo')audio.event('powerup/max_ammo/max_ammo_00',.7);
  if(type==='nuke'){flashUntil=session.time+.8;audio.event('nuke/nuke_flash',.8);enemies.nuke(z=>effect(z.root.position,0xc7dba4));}
  if(type==='carpenter'){for(const b of world.barriers)world.setBoards(b,b.boards.length||6);audio.event('powerup/carpenter/end/end_00',.7);}
}
function shoot(){
  if(!active||features.events.room||!view.ready||view.mode==='raise'||session.busy||session.weaponUnavailable)return false;
  if(session.reloadLeft>0&&session.def.segmentedReload&&session.weapon.mag>0){session.interruptReload();reloadShot=true;return false;}
  if(!session.fire()){if(session.weapon.mag===0&&primaryPressed){audio.weapon('empty',session.def);reload();}return false;}
  if(coop?.isClient)coop.action('shoot');
  view.shoot({ads:ads&&!session.def.dualWield,empty:session.weapon.mag===0,hand:session.def.dualWield&&session.shots%2?'left':'right'});audio.weapon('shot',session.def);muzzle.position.copy(camera.position);muzzle.intensity=160;camera.rotation.x=Math.min(1.48,camera.rotation.x+(ads?.008:.015));
  if(coop?.isClient)return true;
  if(coop?.isHost)coop.event({type:'shot',id:remoteActor?.id??'host',weapon:session.weapon.id});
  const forward=camera.getWorldDirection(new THREE.Vector3());
  if(session.weapon.id==='thundergun_zm'){
    for(const z of [...enemies.list]){const d=z.root.position.clone().add(new THREE.Vector3(0,40,0)).sub(camera.position);if(d.length()<600&&d.normalize().dot(forward)>.65&&world.lineClear(camera.position,z.root.position.clone().add(new THREE.Vector3(0,40,0))))enemies.hurt(z,100000,false,false,'thunder');}
    effect(camera.position.clone().addScaledVector(forward,100),0xb9d8e5,22);return true;
  }
  if(session.def.projectileSpeed>0){features.shoot(session.def,forward);return true;}
  const pellets=Math.max(1,session.def.pellets);
  for(let i=0;i<pellets;i++){
    const direction=forward.clone();if(pellets>1||!ads){const spread=pellets>1?.055:.012;direction.x+=(Math.random()-.5)*spread;direction.y+=(Math.random()-.5)*spread;direction.z+=(Math.random()-.5)*spread;direction.normalize();}
    const ray=new THREE.Ray(camera.position.clone(),direction),wall=world.raycast(ray,1,6000),target=enemies.rayHit(ray,wall?.distance??6000);
    lastShot={origin:ray.origin.toArray(),direction:direction.toArray(),wallDistance:wall?.distance??null,target:target?{id:target.z.id,head:target.head,distance:target.distance}:null};
    if(target){const d=target.distance>session.def.range?session.def.minDamage:session.def.damage;enemies.hurt(target.z,d*(target.head?Math.max(1,session.def.headMultiplier):1),target.head,false,session.def.explosionRadius?'explosion':'bullet');}
    else if(wall)effect(wall.position,0xb8a388,3);
    if(session.def.explosionRadius&&(target||wall)){
      const p=target?.point??wall.position,radius=session.def.explosionRadius;
      effect(p,session.weapon.id==='ray_gun_zm'?0x93ed62:0xffb44e,18);audio.play('explosion',.3);
      for(const z of [...enemies.list]){const d=z.root.position.distanceTo(p);if(d<radius&&world.lineClear(p.clone().addScaledVector(direction,-3),z.root.position.clone().add(new THREE.Vector3(0,25,0))))enemies.hurt(z,THREE.MathUtils.lerp(session.def.explosionInnerDamage,session.def.explosionOuterDamage,d/radius),false,false,'explosion');}
      const distance=player.getFeetPosition().distanceTo(p);if(distance<radius)damage(100*(1-distance/radius));
    }
  }
  return true;
}
function warmViewAudio(){if(view?.ready)audio.warmWeapon(session.def,Object.values(view.rig.data).flatMap(d=>(d.notifies??[]).map(n=>n.name)));}
async function equipView(){reloadShot=false;await view.equip(session.def);warmViewAudio();}
function reload(){if(!view.ready)return;const empty=session.weapon.mag===0;if(session.reload()){if(coop?.isClient)coop.action('reload');burstLeft=0;ads=false;lastReloadSerial=session.reloadSerial;view.reload(empty,session.reloadDuration,session.reloadStage);}}
function melee(){
  if(!active||session.busy||session.weaponUnavailable||features.events.room||!view.ready)return false;
  const charge=!!meleeTarget(),type=session.bowie?'bowie':'knife',strike=view.melee(type,charge);
  if(!strike)return false;
  if(coop?.isClient)coop.action('melee');
  session.cancelReload();session.meleeLeft=strike.duration;burstLeft=0;reloadShot=false;ads=false;primaryPressed=false;
  pendingMelee={at:session.time+strike.delay,damage:session.weapon.id==='knife_ballistic_zm'&&session.bowie?(session.weapon.upgraded?1500:1000):strike.damage,bowie:session.bowie};
  audio.knife('swing',session.bowie);return true;
}
function meleeTarget(){
  const direction=camera.getWorldDirection(new THREE.Vector3());let nearest=null;
  for(const z of enemies.list){const target=z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?45:22,0)),delta=target.clone().sub(camera.position);if(delta.length()<94&&delta.normalize().dot(direction)>.45&&world.lineClear(camera.position,target)){if(!nearest||z.root.position.distanceTo(camera.position)<nearest.root.position.distanceTo(camera.position))nearest=z;}}
  return nearest;
}
function resolveMelee(){
  if(!pendingMelee||session.time<pendingMelee.at)return;
  const strike=pendingMelee;pendingMelee=null;
  if(coop?.isClient||session.downed||session.dead)return;
  if(session.phase==='reviving'||session.phase==='gameover')return;
  const nearest=meleeTarget();
  if(nearest){enemies.hurt(nearest,strike.damage,false,true);audio.knife('hit',strike.bowie);}
  else {const ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),wall=world.raycast(ray,0,94);if(wall){audio.knife('wall');effect(wall.position,0xb8a388,3);}}
}
function throwGrenade(){
  if(coop?.isClient)return coop.action('grenade');
  if(!active||session.grenades<=0||session.busy||features.events.room)return false;session.grenades--;
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(3.5,8,6),new THREE.MeshStandardMaterial({color:0x4a5039,roughness:.8}));mesh.position.copy(camera.position);scene.add(mesh);grenades.push({netId:++grenadeSerial,owner:remoteActor?.id??'host',mesh,velocity:camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(480).add(new THREE.Vector3(0,140,0)),life:3});
}
function findPrompt(){
  prompt=null;promptText='';let distance=115;
  for(const e of world.interactions){
    if(e.targetname?.startsWith('trigger_movie_reel_')&&!features.events.available(e.id))continue;
    if(e.targetname==='meteor_egg_trigger'&&meteors.has(e.id))continue;
    if(e.targetname==='treasure_chest_use'&&!mysteryBox.available(e))continue;
    if(e.targetname==='zombie_door'){const d=world.doors.get(e.target);if(session.openDoors.has(e.target)||(d.electric&&session.power))continue;}
    if(e.targetname==='use_elec_switch'&&session.power)continue;
    if(e.targetname==='weapon_upgrade'&&!data.weapons[e.zombie_weapon_upgrade])continue;
    const dist=camera.position.distanceTo(vector(e.position));if(dist<distance){distance=dist;prompt=e;}
  }
  for(const b of world.barriers){const d=camera.position.distanceTo(b.position.clone().add(new THREE.Vector3(0,25,0)));if(d<100&&d<distance){prompt={barrier:b};distance=d;}}
  if(!prompt)return;
  if(prompt.barrier){promptText=prompt.barrier.count<(prompt.barrier.boards.length||6)?'Hold F to rebuild barricade':'Barricade secured';return;}
  const e=prompt;
  if(e.targetname==='zombie_door'){const d=world.doors.get(e.target);promptText=d.electric?'The power must be activated':'Open door · '+d.cost;}
  if(e.targetname==='weapon_upgrade'){const d=data.weapons[e.zombie_weapon_upgrade],owned=session.inventory.find(w=>w.id===d.id&&!w.lost);promptText=owned?d.name+' ammo · '+(owned.upgraded?4500:d.ammoPrice??Math.ceil(d.price/2)):d.name+' · '+d.price;}
  if(e.targetname==='zombie_vending'){const p=perkInfo[e.script_noteworthy];if(!p)return;promptText=session.perks.has(e.script_noteworthy)?p.name+' equipped':!session.power&&(session.coop||e.script_noteworthy!=='specialty_quickrevive')?'The power must be activated':p.name+' · '+(session.coop&&e.script_noteworthy==='specialty_quickrevive'?1500:p.price);}
  if(e.targetname==='use_elec_switch')promptText='Turn on the power';
  if(e.targetname==='meteor_egg_trigger')promptText='Listen to the meteor fragment';
  if(e.targetname==='bowie_upgrade')promptText=session.bowie?'Bowie Knife equipped':'Bowie Knife · 3000';
  if(e.targetname==='treasure_chest_use'){const roll=mysteryBox.at(e);promptText=roll?(roll.ready?(roll.teddy?'The Mystery Box is moving…':'Take '+(data.weapons[roll.weapon]??data.equipment[roll.weapon]).name):'Choosing your weapon…'):'Mystery Box · '+(session.effects.fire_sale>session.time?10:950);}
  if(e.targetname==='trigger_teleport_pad_0')promptText=!session.power?'The power must be activated':session.teleporter==='linked'?'Teleport to the projection room':session.teleporter==='cooldown'?'Teleporter cooling down':session.teleporter==='linking'?'Link the pad in the lobby':'Initiate teleporter link';
  if(e.targetname==='pf16_auto1')promptText=session.teleporter==='linking'?'Link with the mainframe':'Link the teleporter on the stage first';
  if(e.targetname==='zombie_vending_upgrade')promptText=session.pack?(session.time>=session.pack.readyAt?'Take '+data.weapons[session.pack.weapon.id].upgrade.name+' · '+Math.ceil(session.pack.expires-session.time)+'s':'Upgrading weapon…'):session.weapon.upgraded?'Weapon already upgraded':'Pack-a-Punch · 5000';
  if(e.targetname?.endsWith('_room_trap'))promptText=!session.power?'The power must be activated':'Activate electric trap · 1000';
  promptText=features.prompt(e)??promptText;
}
function interact(){
  if(coop?.isClient)return coop.action('interact');
  if(!active||session.busy)return false;findPrompt();if(!prompt)return false;
  if(prompt.barrier)return repair(prompt.barrier);
  const e=prompt,t=e.targetname;
  if(t==='claymore_purchase'||e.script_noteworthy==='auto_turret_trigger'||t?.startsWith('trigger_movie_reel_')||t==='trigger_change_projector_reels')return features.interact(e);
  if(t==='meteor_egg_trigger'){meteors.add(e.id);audio.play('buy');toast('Meteor fragment '+meteors.size+' / 3');if(meteors.size===3){audio.playMusic('115');announce('115','MUSICAL EASTER EGG');}return true;}
  const pay=n=>{if(!session.spend(n)){toast('Not enough points');return false;}audio.play('buy');return true;};
  if(t==='bowie_upgrade'){if(session.bowie||!pay(3000))return false;session.bowie=true;toast('Bowie Knife');return true;}
  if(t==='zombie_door'){
    const d=world.doors.get(e.target);if(d.electric){toast('Turn on the power');return false;}if(session.openDoors.has(e.target)||!pay(d.cost))return false;
    session.openDoors.add(e.target);if(d.flag)session.flags.add(d.flag);world.setDoors(session);toast('Door opened');return true;
  }
  if(t==='weapon_upgrade'){
    const d=data.weapons[e.zombie_weapon_upgrade];if(!d||session.pack?.weapon===session.weapon)return false;
    session.leaveAttachment();const owned=session.inventory.find(w=>w.id===d.id&&!w.lost);
    const cost=owned?(owned.upgraded?4500:d.ammoPrice??Math.ceil(d.price/2)):d.price;
    if(!pay(cost))return false;
    if(owned)owned.reserve=owned.upgraded?d.upgrade?.maxAmmo??d.maxAmmo:d.maxAmmo;
    else {session.giveWeapon(d.id);equipView();}toast(owned?'Ammo replenished':d.name);return true;
  }
  if(t==='zombie_vending'){
    const id=e.script_noteworthy,p=perkInfo[id];if(!p||session.perks.has(id)||(!session.power&&(session.coop||id!=='specialty_quickrevive')))return false;
    if(id==='specialty_quickrevive'&&!session.coop&&session.revives>=3){toast('Quick Revive is depleted');return false;}if(!pay(id==='specialty_quickrevive'&&session.coop?1500:p.price))return false;
    if(!session.drink(id))return false;primary=false;primaryPressed=false;ads=false;burstLeft=0;reloadShot=false;perkDrink.start(id,view);toast(p.name);audio.play(id);return true;
  }
  if(t==='use_elec_switch'&&!session.power){
    session.power=true;session.flags.add('power_on');world.setDoors(session);ambient.intensity=1.7;announce('Power restored','THE SHOW GOES ON');audio.play('round');return true;
  }
  if(t==='treasure_chest_use'){
    if(mysteryBox.at(e)){if(session.pack?.weapon===session.weapon)return false;const weapon=mysteryBox.take(e);if(!weapon)return false;if(weapon==='zombie_cymbal_monkey'){session.giveMonkeys();toast('Monkey Bombs · X to throw');}else{session.giveWeapon(weapon);equipView();toast(data.weapons[weapon].name);}return true;}
    const cost=session.effects.fire_sale>session.time?10:950;
    if(session.points<cost){toast('Not enough points');return false;}
    if(!mysteryBox.start(e))return false;session.spend(cost);return true;
  }
  if(t==='zombie_vending_upgrade'){
    if(session.pack){if(!session.takePack())return false;equipView();toast(session.def.name);return true;}
    if(coop?.isHost&&[...coop.actors.values()].some(a=>a.session!==session&&a.session.pack)){toast('Pack-a-Punch is in use');return false;}
    if(!session.beginPack())return false;ads=false;primary=false;burstLeft=0;reloadShot=false;audio.play('packapunch');toast('Upgrading… retrieve your weapon when it is ready.');return true;
  }
  if(t==='trigger_teleport_pad_0'&&session.power){
    if(session.teleporter==='unlinked'){session.teleporter='linking';linkUntil=session.time+30;toast('Link the mainframe pad in the lobby',5);return true;}
    if(session.teleporter==='linked'&&!teleportPending){teleportPending=session.time+2;toast('Teleporting…');return true;}return false;
  }
  if(t==='pf16_auto1'&&session.teleporter==='linking'){session.teleporter='linked';toast('Teleporter linked',4);audio.play('buy');return true;}
  if(t?.endsWith('_room_trap')&&session.power){
    if(traps.some(tr=>tr.name===t&&tr.cooldown>session.time)){toast('Trap cooling down');return false;}if(!pay(1000))return false;
    const p=vector(e.position),mesh=new THREE.Mesh(new THREE.CylinderGeometry(60,60,100,12,1,true),new THREE.MeshBasicMaterial({color:0x8cbbff,transparent:true,opacity:.24,wireframe:true}));mesh.position.copy(p);scene.add(mesh);traps.push({name:t,position:p,mesh,end:session.time+30,cooldown:session.time+90});return true;
  }
  return false;
}
function repair(b){if(b.count>=(b.boards.length||6)||repairLeft>0)return false;repairLeft=.75;world.setBoards(b,b.count+1);if(b.rewardRound!==session.round){b.rewardRound=session.round;b.reward=0;}if(b.reward<50*session.round){session.addPoints(10);b.reward+=10;}audio.play('board');return true;}
function reset(){
  pendingMelee=null;lastReloadSerial=0;reloadShot=false;
  touchControls.reset();mousePrimary=mouseAim=false;toastUntil=0;announcementUntil=0;hitUntil=0;flashUntil=0;primary=false;primaryPressed=false;ads=false;keys.clear();
  session.reset();enemies.reset();world.reset(session);player.setSpawn(vector(spawn.position));player.respawn();camera.rotation.set(0,spawn.yaw-Math.PI/2,0);
  powerups.reset();perkDrink.stop();mysteryBox.reset();
  features?.reset();
  for(const group of [particles,grenades,traps,gasClouds]){for(const item of group){item.mesh.removeFromParent();item.mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}group.length=0;}
  meteors.clear();renderer.domElement.style.filter='';if(audio.ctx)audio.playMusic('ambience');
  started=false;teleportPending=0;returnAt=0;linkUntil=0;cooldownUntil=0;repairLeft=0;burstLeft=0;lastPhase='';lastRound=0;ambient.intensity=1.2;view.currentId=null;equipView();$('results').hidden=true;$('menu-status').textContent=touchControls.mode?'Tap to start':'Click to capture the mouse';
}
function returnToLobby(){
  const dest=data.entities.find(e=>e.targetname==='theater_teleport_player0');teleportTeam(dest);cooldownUntil=session.time+90;flashUntil=session.time+.8;
}
function teleportTeam(dest){
  if(coop?.isHost){let i=0;for(const a of coop.actors.values()){a.player.setPosition(vector(dest.position).add(new THREE.Vector3((i++%2)*32,0,0)));a.camera.rotation.set(0,dest.yaw-Math.PI/2,0);a.teleport=(a.teleport||0)+1;}}
  else {player.setPosition(vector(dest.position));camera.rotation.set(0,dest.yaw-Math.PI/2,0);}
}
function update(dt){
  if(!ready)return;
  touchControls.setEnabled(active&&session.phase!=='reviving'&&session.phase!=='gameover',active&&session.phase!=='gameover');
  const touch=touchControls.input.read();
  const pad=controller.frame;
  primary=active&&(mousePrimary||touch.fire||pad.fire||(session.def.dualWield&&pad.aim));primaryPressed ||= active&&(touch.firePressed||pad.firePressed||(session.def.dualWield&&controller.pad.state.pressed.aim));ads=active&&(mouseAim||touch.aim||pad.aim)&&!session.def.dualWield;
  if(active||coop?.running){
    session.update(dt);
    if(coop?.isHost&&coop.running)coop.beforeHost(dt);
    if(session.phase!=='gameover'){
      resolveMelee();
      if(session.reloadLeft>0&&session.reloadSerial!==lastReloadSerial){lastReloadSerial=session.reloadSerial;view.reload(false,session.reloadDuration,session.reloadStage);}
      const forward=active?Number(keys.has('KeyW'))-Number(keys.has('KeyS'))+touch.forward+pad.move.y:0,strafe=active?Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+touch.strafe+pad.move.x:0;
      const moving=Math.hypot(forward,strafe)>.01,sprint=((keys.has('ShiftLeft')||keys.has('ShiftRight'))&&keys.has('KeyW')||touch.sprint||pad.sprint)&&!ads&&!session.reloadLeft&&!session.meleeLeft&&!session.drinking;
      const input={forward:THREE.MathUtils.clamp(forward,-1,1),strafe:THREE.MathUtils.clamp(strafe,-1,1),sprint,crouch:active&&(keys.has('ControlLeft')||keys.has('ControlRight')||keys.has('KeyC')||touch.crouch||pad.crouch),jump:active&&(keys.has('Space')||touch.jump||pad.jump),use:active&&(keys.has('KeyF')||keys.has('KeyE')||touch.use||pad.use),yaw:camera.rotation.y,pitch:camera.rotation.x,ads};
      coop?.setInput(input);
      player.update(dt,session.phase==='reviving'||session.downed||session.dead?{}:input);
      view.update(dt,{moving,sprint,ads:ads&&!session.def.dualWield,reloading:session.reloadLeft>0,empty:session.weapon.mag===0,time:session.time});
      view.pivot.visible=!session.weaponUnavailable&&!features.events.room;
      perkDrink.update(dt,session);
      if(!sprint&&session.phase!=='reviving'&&(primaryPressed||(primary&&session.def.automatic)||burstLeft>0||reloadShot)){
        if(shoot()){reloadShot=false;if(burstLeft>0)burstLeft--;else if(session.def.fireType==='3-Round Burst')burstLeft=2;}
      }
      primaryPressed=false;
      if(!coop?.isClient){
      enemies.update(dt,player.getFeetPosition());
      features.update(dt);
      repairLeft=Math.max(0,repairLeft-dt);findPrompt();if((keys.has('KeyF')||keys.has('KeyE')||touch.use||pad.use)&&prompt?.barrier)repair(prompt.barrier);
      if(session.round!==lastRound||session.phase!==lastPhase){if(session.phase==='fighting'){announce(session.dogRound?'Fetch their souls':'Round '+session.round,session.dogRound?'HELLHOUNDS':'SURVIVE');audio.play(session.dogRound?'dog_round':'round');if(session.dogRound)audio.play('dog_announce');}else if(session.phase==='preparing'&&session.round>1){announce('Round survived','RELOAD. REBUILD. PREPARE.');audio.play('round_end');}lastRound=session.round;lastPhase=session.phase;}
      mysteryBox.update(dt);
      if(session.teleporter==='linking'&&session.time>linkUntil){session.teleporter='unlinked';toast('Teleporter link timed out');}
      if(teleportPending&&session.time>=teleportPending){teleportPending=0;const dest=data.entities.find(e=>e.targetname==='projroom_teleport_player0');teleportTeam(dest);returnAt=session.time+30;session.teleporter='cooldown';flashUntil=session.time+.8;toast('Projection room · 30 seconds',4);}
      if(returnAt&&session.time>=returnAt){
        returnAt=0;const room=features.events.chooseRoom();
        if(room){features.events.room=room;features.events.roomUntil=session.time+5.8;teleportTeam(room);toast('A room outside time… find a film reel.',5);}
        else returnToLobby();flashUntil=session.time+.8;
      }
      if(features.events.room&&session.time>=features.events.roomUntil){features.events.room=null;returnToLobby();}
      if(cooldownUntil&&session.time>cooldownUntil){cooldownUntil=0;session.teleporter='unlinked';}
      for(const tr of traps)if(session.time<tr.end){tr.mesh.rotation.y+=dt*3;for(const z of [...enemies.list])if(z.root.position.distanceTo(tr.position)<100)enemies.hurt(z,99999,false,false,'electric');if(coop?.isHost){for(const a of coop.actors.values())if(a.player.getFeetPosition().distanceTo(tr.position)<75)withActor(a,()=>damage(dt*100));}else if(player.getFeetPosition().distanceTo(tr.position)<75)damage(dt*100);}else tr.mesh.visible=false;
      let gassed=false;
      for(const g of [...gasClouds]){g.life-=dt;g.mesh.material.opacity=.14*Math.min(1,g.life/2);g.mesh.rotation.y+=dt*.2;if(player.getFeetPosition().distanceTo(g.position)<125)gassed=true;if(g.life<=0){g.mesh.removeFromParent();g.mesh.geometry.dispose();g.mesh.material.dispose();gasClouds.splice(gasClouds.indexOf(g),1);}}
      renderer.domElement.style.filter=gassed?'blur(3px)':'';
      powerups.update(dt,player.getFeetPosition(),!session.coop&&session.phase!=='reviving',(a,b)=>world.lineClear(a,b));
      for(const g of [...grenades]){
        g.life-=dt;g.velocity.y-=650*dt;const travel=g.velocity.clone().multiplyScalar(dt),ray=new THREE.Ray(g.mesh.position.clone(),travel.clone().normalize()),hit=world.raycast(ray,0,travel.length()+4);
        if(hit){g.velocity.y=Math.abs(g.velocity.y)*.4;g.velocity.x*=-.4;g.velocity.z*=-.4;}else g.mesh.position.add(travel);
        if(g.life<=0){withActor(coop?.actors.get(g.owner),()=>{effect(g.mesh.position,0xffb347,30);audio.play('explosion');for(const z of [...enemies.list]){const d=z.root.position.distanceTo(g.mesh.position);if(d<300&&world.lineClear(g.mesh.position,z.root.position.clone().add(new THREE.Vector3(0,30,0))))enemies.hurt(z,Math.max(75,1500*(1-d/300)),false,false,'explosion');}if(coop?.isHost)areaDamage(g.mesh.position,160,180);else{const d=camera.position.distanceTo(g.mesh.position);if(d<160)damage(180*(1-d/160));}});g.mesh.removeFromParent();g.mesh.geometry.dispose();g.mesh.material.dispose();grenades.splice(grenades.indexOf(g),1);}
      }
      for(const p of [...particles]){p.life-=dt;p.velocity.y-=200*dt;p.mesh.position.addScaledVector(p.velocity,dt);if(p.life<=0){p.mesh.removeFromParent();p.mesh.geometry.dispose();p.mesh.material.dispose();particles.splice(particles.indexOf(p),1);}}
      }else findPrompt();
    }
    if(coop?.running){if(coop.isHost)coop.afterHost(dt);else coop.updateClient(dt);}
  }
  muzzle.intensity=Math.max(0,muzzle.intensity-dt*2200);camera.fov=THREE.MathUtils.damp(camera.fov,ads&&!session.def.dualWield&&!session.drinking&&!session.meleeLeft&&!session.reloadLeft?(session.def.adsFov||56):menuUI.settings.fov,12,dt);camera.updateProjectionMatrix();
  weaponScope.update(view,active&&ads&&!session.busy&&!session.weaponUnavailable&&!features.events.room);
  hud();
  nativeHud.update(session,{controller,touch:touchControls,active:started&&active});controller.feedback(session);
}
function hud(){
  const s=session,w=s.weapon;
  $('round').textContent=s.round<=5?'I'.repeat(s.round):String(s.round);$('remaining').textContent=s.phase==='preparing'?'STARTS IN '+Math.max(0,Math.ceil(s.countdown)):(s.total-s.killed)+' REMAINING';
  $('points').textContent=s.points.toLocaleString();$('mag').textContent=s.weaponUnavailable?'—':w.mag;$('reserve').textContent=s.weaponUnavailable?'—':w.reserve;$('weapon-name').textContent=s.weaponUnavailable?(s.pack?'Weapon in Pack-a-Punch':'No weapon'):s.def.name;$('reload-label').textContent=s.weaponUnavailable?'':s.reloadLeft>0?'RELOADING':w.mag===0?'R TO RELOAD':s.weapon.upgraded&&data.weapons[w.id].upgrade?.attachment?'5 · SWITCH ATTACHMENT':'';
  if(touchControls.mode){$('reload-label').textContent=$('reload-label').textContent.replace('R TO RELOAD','TAP RELOAD').replace('5 · SWITCH ATTACHMENT','TAP ALT FIRE');}
  $('health-fill').style.width=(100*s.health/s.maxHealth)+'%';$('health-label').textContent=Math.ceil(s.health)+' / '+s.maxHealth;
  $('hurt').style.opacity=s.health<s.maxHealth?(1-s.health/s.maxHealth)*.8:0;$('hitmarker').style.opacity=hitUntil>s.time?1:0;$('flash').style.opacity=Math.max(0,flashUntil-s.time);
  $('prompt').innerHTML=active&&promptText?(promptText==='Barricade secured'?promptText:touchControls.mode?'<kbd>USE</kbd> '+promptText.replace('Hold F','Hold USE'):'<kbd>F</kbd> '+promptText):'';
  if(coop?.running&&!s.downed&&!s.dead){const others=coop.isHost?[...coop.actors.values()].map(a=>({session:a.session,feet:a.player.getFeetPosition().toArray(),id:a.id})):coop.snapshot?.players??[];if(others.some(a=>a.id!==coop.id&&a.session.downed&&vector(a.feet).distanceTo(player.getFeetPosition())<90))$('prompt').textContent=touchControls.mode?'Hold USE to revive teammate':'Hold F to revive teammate';}
  if(toastUntil<s.time)$('toast').textContent='';if(announcementUntil<s.time)$('announcement').style.opacity=0;
  const effectHtml=Object.entries(s.effects).filter(([k,t])=>t>s.time&&powerupNames[k]).map(([k,t])=>`<span class="powerup-timer ${t-s.time<5&&Math.floor(s.time*4)%2?'expiring':''}"><img src="${data.powerups[k].icon}" alt="${powerupNames[k]}"><span>${Math.ceil(t-s.time)}s</span></span>`).join('')+(returnAt?'<span>RETURN IN '+Math.ceil(returnAt-s.time)+'</span>':'');if($('effects').innerHTML!==effectHtml)$('effects').innerHTML=effectHtml;
  $('location').textContent=features.events.room?'Hidden room · '+Math.max(0,Math.ceil(features.events.roomUntil-s.time))+'s':returnAt?'Projection room':zoneNames[world.zoneAt(player.getFeetPosition().add(new THREE.Vector3(0,35,0)))]??'Kino der Toten';
  $('objective').textContent=features.events.carried?'Film reel carried · return to the projector':features.events.installed.size?'Film reels projected · '+features.events.installed.size+' / 3':!s.power?'Open the theater and restore power':s.teleporter==='unlinked'?'Link the stage teleporter and lobby pad':s.teleporter==='linking'?'Activate the lobby pad':s.teleporter==='linked'?'Teleporter ready · return to the stage':'';
  if(debugVisible)$('debug').textContent=`${fps} FPS · ${renderer.info.render.calls} calls\n${camera.position.toArray().map(v=>v.toFixed(1)).join(', ')}\n${enemies.list.length} enemies · ${world.navDisabled.size} blocked polygons`;
}

function getState(){return {ready,active,started,input:{touch:touchControls.getState(),controller:{connected:controller.pad.connected,usingPad:controller.usingPad},primary,ads},...(session?session.snapshot():{}),player:player?{...player.state,rotation:camera.rotation.toArray().slice(0,3),position:camera.position.toArray(),feet:player.getFeetPosition().toArray()}:null,enemies:enemies?.snapshot()??[],prompt:promptText,barriers:world?.barriers.map(b=>({id:b.id,count:b.count,position:b.position.toArray(),inside:b.inside.toArray(),group:b.group}))??[],doors:world?[...world.doors.values()].map(d=>({name:d.name,cost:d.cost,flag:d.flag,open:session.openDoors.has(d.name),triggers:d.triggers.map(e=>e.position),parts:d.parts.length})):[],performance:{fps,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},viewmodelReady:view?.ready??false,errors:[...errors]};}
globalThis.kino={debug:{getState,setActive,pause:()=>setActive(false),resume:()=>setActive(true),reset,teleportPlayer:p=>player.setPosition(vector(p)),lookAt:p=>camera.lookAt(vector(p)),damagePlayer:damage,grantPoints:n=>session.points+=n,interact,shoot,reload,melee,giveWeapon:id=>{session.giveWeapon(id);equipView();},spawnEnemy:(p,kind)=>enemies.spawn(vector(p),null,kind).id,clearEnemies:()=>{for(const z of [...enemies.list])enemies.hurt(z,999999);},collectPowerup:collect,step:(seconds)=>{for(let t=0;t<seconds;t+=1/60)update(Math.min(1/60,seconds-t));},navigationPath:(a,b)=>world.path(vector(a),vector(b)).map(v=>v.toArray()),getEntities:()=>data.entities.filter(e=>e.classname==='trigger_use'||e.targetname==='initial_spawn_points'),showCollision:value=>{world.collision.setDebugVisible(value);scene.add(world.collision.mesh);}}};
// The verification runner uses the existing Kino debug clock in agent sessions.
if(new URLSearchParams(location.search).has('agent'))globalThis.vibe={get ready(){return ready;},step:seconds=>kino.debug.step(seconds),observe:getState};
Object.assign(kino.debug,{
  memoryState:()=>{
    const textures=new Set(),sources=new Set(),geometries=new Set();let textureBytes=0,geometryBytes=0;
    for(const root of [scene,viewScene])root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of [object.material].flat().filter(Boolean))for(const value of Object.values(material))if(value?.isTexture)textures.add(value);});
    for(const texture of textures){if(sources.has(texture.source))continue;sources.add(texture.source);const image=texture.image;if(image)textureBytes+=(image.width??0)*(image.height??0)*4*(texture.generateMipmaps?4/3:1);}
    for(const geometry of geometries){for(const attribute of Object.values(geometry.attributes))geometryBytes+=(attribute.array??attribute.data?.array)?.byteLength??0;geometryBytes+=geometry.index?.array.byteLength??0;}
    return {...assetDiagnostics(),textureBytes:Math.round(textureBytes),geometryBytes,collisionBytes:world?.collision.metadata.byteLength,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,renderedFrames,contextLost,antialias:renderer.getContext().getContextAttributes()?.antialias};
  },
  simulateContextLoss:()=>renderer.forceContextLoss(),
  simulateContextRestore:()=>renderer.forceContextRestore(),
  completionState:()=>features.snapshot(),
  setAutoSpawn:value=>{enemies.autoSpawn=value;enemies.autoRounds=value;},
  useEquipment:kind=>kind==='claymores'?features.placeClaymore():features.throwMonkey(),
  giveMonkeys:()=>session.giveMonkeys(),
  toggleAttachment:()=>{if(session.toggleAttachment()){equipView();return true;}return false;},
  pickSurface:(x,y)=>{const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),camera);const meshes=[];scene.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});return ray.intersectObjects(meshes,false).slice(0,4).map(h=>({object:h.object.name,material:(Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material).name,point:h.point.toArray()}));},
  audioState:()=>audio.snapshot(),
  weaponVisual:()=>view.snapshot(),
  lastShot:()=>lastShot,
  setInvulnerable:value=>{session.effects.invulnerable=value?Infinity:0;},
  aimAtEnemy:(id,head=true)=>{const z=enemies.list.find(z=>z.id===id);if(z)camera.lookAt(head?enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?40:25,0)));},
  specialState:()=>({meteors:meteors.size,gasClouds:gasClouds.length,boxLocation:world.activeBox.id,box:mysteryBox.snapshot().find(b=>b.id===world.activeBox.id)?.roll??null,boxes:mysteryBox.snapshot(),boxMoves:mysteryBox.moves,fireSale:!!world.fireSale,pickups:powerups.snapshot(),drink:perkDrink.snapshot()}),
  dropPowerup:(type,p)=>{dropPowerup(type,vector(p));return powerups.snapshot();},
  damageEnemy:(id,n=999999)=>{const z=enemies.list.find(z=>z.id===id);if(z)enemies.hurt(z,n);},
  grantScore:n=>session.addPoints(n),
  setBoards:(id,count)=>world.setBoards(world.barriers.find(b=>b.id===id),count),
  spawnCandidates:()=>world.spawnBarriers(session).map(b=>({id:b.id,inside:b.inside.toArray(),outside:b.outside.toArray(),path:world.path(b.inside,player.getFeetPosition()).map(v=>v.toArray())})),
  setRound:n=>{enemies.reset();while(session.round<n)session.nextRound();session.countdown=0;session.spawned=0;session.killed=0;},
});

// The host runs the existing combat and interaction rules for each survivor.
// Only the synchronous call swaps context; world state has one shared owner.
function withActor(actor,fn){
  if(!actor||actor===coop?.local)return fn();
  const saved={session,player,camera,features,view,perkDrink,active,ads,primaryPressed,pendingMelee,repairLeft,burstLeft,reloadShot,lastReloadSerial,prompt,promptText,remoteActor,scoreSession:enemies.scoreSession,boxSession:mysteryBox.session};
  session=actor.session;player=actor.player;camera=actor.camera;features=actor.features;view=actor.view;perkDrink=actor.perkDrink;
  active=true;ads=!!actor.input?.ads;primaryPressed=true;pendingMelee=actor.pendingMelee;repairLeft=actor.repairLeft||0;burstLeft=0;reloadShot=false;
  remoteActor=actor;enemies.scoreSession=session;mysteryBox.session=session;
  try{return fn();}finally{
    actor.pendingMelee=pendingMelee;actor.repairLeft=repairLeft;
    ({session,player,camera,features,view,perkDrink,active,ads,primaryPressed,pendingMelee,repairLeft,burstLeft,reloadShot,lastReloadSerial,prompt,promptText,remoteActor}=saved);
    enemies.scoreSession=saved.scoreSession;mysteryBox.session=saved.boxSession;
  }
}
function createCoopActor(id,index){
  const s=new Session(data);shareWorld(s,session);s.playerId=id;
  const c=new THREE.PerspectiveCamera();c.rotation.order='YXZ';c.rotation.copy(camera.rotation);
  const spawns=data.entities.filter(e=>e.targetname==='initial_spawn_points'),point=vector((spawns[index]??spawn).position);
  const p=new PlayerController(c,world.physics,{spawn:point,spawnIsEye:false,radius:14,height:70,eyeHeight:60,moveSpeed:190,sprintSpeed:285,crouchSpeed:95,gravity:800,jumpHeight:39,fallResetY:-800,maxSubSteps:12,groundSnapSpeed:10});p.update(.05,{});
  const f=Object.assign(Object.create(Object.getPrototypeOf(features)),features,{session:s,player:p,camera:c,projectiles:[],mines:[],turrets:[],packMesh:null,packId:null,events:new KinoEvents(data)});
  for(const key of ['reels','installed','film','room','roomUntil'])Object.defineProperty(f.events,key,{get:()=>coop.local.features.events[key],set:value=>{coop.local.features.events[key]=value;}});
  const v={ready:true,mode:'idle',rig:{data:{}},equip:async()=>{},shoot:()=>{},reload:()=>{},melee:(type,charge)=>{const d=s.def.melee;if(d)return {duration:charge?d.meleeChargeTime:d.meleeTime,delay:charge?d.meleeChargeDelay:d.meleeDelay,damage:d.meleeDamage};const knife=data.melee[type];return {duration:charge?knife.chargeTime:knife.time,delay:charge?knife.chargeDelay:knife.delay,damage:knife.damage};}};
  return {id,session:s,player:p,camera:c,features:f,view:v,perkDrink:{start:()=>{},stop:()=>{}},input:{},pendingMelee:null,repairLeft:0};
}
function coopAction(actor,name,value){
  return withActor(actor,()=>{
    if(name==='shoot')return shoot();if(name==='reload')return reload();if(name==='melee')return melee();if(name==='grenade')return throwGrenade();
    if(name==='interact')return interact();if(name==='claymore')return features.placeClaymore();if(name==='monkey')return features.throwMonkey();
    if(name==='switch'){if(value!==undefined&&value!==null&&(!Number.isInteger(value)||value<0||value>=session.inventory.length))return false;session.switchWeapon(value??undefined);return true;}
    if(name==='attachment')return session.toggleAttachment();
  });
}
function applyCoopEvents(state){
  if(!state)return;features.events.reels=state.reels.map(r=>({entity:data.entities.find(e=>e.id===r.id),film:r.film,collected:r.collected}));features.events.carried=state.carried;features.events.installed=new Set(state.installed);features.events.film=state.film;features.events.room=data.entities.find(e=>e.targetname===state.room)??null;features.events.roomUntil=state.roomUntil;
}
coop=new KinoCoop({
  get:()=>({ready,data,scene,session,player,camera,features,enemies,world,mysteryBox,powerups}),reset,equip:equipView,collect,
  createActor:createCoopActor,action:coopAction,
  updateActor:(actor,dt)=>withActor(actor,()=>{session.update(dt,true);player.update(dt,session.downed||session.dead?{}:actor.input);resolveMelee();features.update(dt);repairLeft=Math.max(0,repairLeft-dt);if(actor.input?.use&&!session.busy){findPrompt();if(prompt?.barrier)repair(prompt.barrier);}}),
  removeActor:actor=>{for(const list of [actor.features.projectiles,actor.features.mines])for(const p of [...list])actor.features.remove(p,list);actor.features.packMesh?.removeFromParent();},
  respawnActor:actor=>{const s=actor.session;s.dead=s.downed=false;s.health=100;s.inventory=[{id:'m1911_zm',mag:8,reserve:32,upgraded:false}];s.slot=0;s.pack=null;s.attachmentMode=false;s.coopInvulnerableUntil=s.time+3;const teammate=[...coop.actors.values()].find(a=>a!==actor&&!a.session.dead&&!a.session.downed);actor.player.setPosition(teammate?.player.getFeetPosition()??vector(spawn.position));actor.teleport=(actor.teleport||0)+1;if(actor===coop.local)equipView();},
  begin:()=>{session.playerId=coop.id;started=true;setActive(false);$('start').textContent='ENTER CO-OP';$('menu-status').textContent='Room '+coop.code+' · click to enter';$('play-mode').textContent='CO-OP';mysteryBox.playerSession=id=>coop.actors.get(id)?.session;for(const a of coop.actors.values())a.features.damagePlayers=areaDamage;enemies.playerTargets=()=>coop.isHost?coop.targets():[];enemies.lureTarget=z=>{for(const a of coop.actors.values()){const target=a.features.lureTarget(z);if(target)return target;}return null;};},
  end:()=>{setActive(false);document.exitPointerLock?.();$('start').disabled=false;$('start').textContent='START GAME';$('play-mode').textContent='SOLO';delete enemies.playerTargets;delete features.damagePlayers;delete features.remotePack;delete mysteryBox.playerSession;delete session.playerId;enemies.lureTarget=z=>features.lureTarget(z);},
  gameover:()=>{if(active){setActive(false);document.exitPointerLock?.();}$('start').hidden=true;$('restart').hidden=true;$('menu-status').textContent='Co-op ended · survived '+session.round+' rounds';},
  drink:()=>perkDrink.start(session.drinking,view),
  event:e=>{if(e.type==='toast')toast(e.text);if(e.type==='hit'){hitUntil=session.time+.12;$('hitmarker').style.color=e.head?'#db5140':'#eee';}if(e.type==='hurt')audio.play('hit');if(e.type==='shot'&&e.id!==coop.id&&data.weapons[e.weapon])audio.weapon('shot',data.weapons[e.weapon]);},
  captureExtras:()=>({meteors:[...meteors],returnAt,linkUntil,cooldownUntil,traps:traps.map(t=>({name:t.name,position:t.position.toArray(),end:t.end,cooldown:t.cooldown})),gas:gasClouds.map(g=>({position:g.position.toArray(),life:g.life})),turrets:[...coop.actors.values()].flatMap(a=>a.features.turrets.map(t=>({id:t.id,until:t.until,yaw:t.mesh?.rotation.y}))),grenades:grenades.map(g=>({id:g.netId,position:g.mesh.position.toArray()}))}),
  applyExtras:(extra,eventState)=>{meteors.clear();for(const id of extra.meteors)meteors.add(id);returnAt=extra.returnAt;linkUntil=extra.linkUntil;cooldownUntil=extra.cooldownUntil;ambient.intensity=session.power?1.7:1.2;applyCoopEvents(eventState);},
});
menuUI.attachCoop(coop);
Object.assign(kino.debug,{coopState:()=>coop.debug(),coopDamage:(id,n)=>{if(!coop.isHost)return false;const actor=coop.actors.get(id);return actor&&withActor(actor,()=>damage(n));},coopTeleport:(id,p)=>{const a=coop.actors.get(id);if(a){a.player.setPosition(vector(p));a.teleport=(a.teleport||0)+1;}},coopGrant:(id,n)=>{const a=coop.actors.get(id);if(a)a.session.points+=n;}});
try{
  progress('Loading game data',5);data=await fetch('game-data.json').then(r=>r.json());session=new Session(data);world=new World(scene,data);await world.load(progress);
  spawn=data.entities.find(e=>e.targetname==='initial_spawn_points'&&e.script_int==='1');
  player=new PlayerController(camera,world.physics,{spawn:vector(spawn.position),spawnIsEye:false,radius:14,height:70,eyeHeight:60,moveSpeed:190,sprintSpeed:285,crouchSpeed:95,gravity:800,jumpHeight:39,fallResetY:-800,maxSubSteps:12,groundSnapSpeed:10});
  camera.rotation.set(0,spawn.yaw-Math.PI/2,0);world.setDoors(session);
  progress('Loading weapons and the undead',85);view=new ViewWeapon(viewScene,data,(name,def)=>audio.notify(name,def));enemies=new Enemies(scene,world,data,session,{damage,kill,hit,sound:(kind,p)=>audio.play(kind,Math.max(0,1-p.distanceTo(camera.position)/1000))});
  world.actors=()=>enemies.list;
  powerups=new Powerups(scene,data,audio,collect);perkDrink=new PerkDrink(viewScene,data,audio);mysteryBox=new MysteryBox(scene,world,data,session,audio,toast);
  features=new KinoFeatures({scene,world,data,session,enemies,player,camera,audio,effect,damage,toast});
  await Promise.all([enemies.load(),equipView(),audio.load(),powerups.load(),perkDrink.load(),mysteryBox.load(),features.load()]);player.update(.05,{});ready=true;
  progress('Ready',100);$('loading').hidden=true;$('start').disabled=contextLost;$('menu-status').textContent=contextLost?'Graphics paused. Waiting for Safari to restore the game…':touchControls.mode?'Tap to enter the theater':'Click to capture the mouse · Esc to pause';
  coop.ready();
}catch(error){console.error(error);errors.push(String(error));$('load-label').textContent='Unable to start: '+error.message;$('menu-status').textContent='See browser console for details';}
renderer.info.autoReset=false;
function pollKinoController(dt){
  const f=controller.poll(dt,{menuOpen:!$('menu').hidden,playing:ready&&active&&!session.busy,prompt:!!prompt,focused:!document.hidden&&document.hasFocus()});
  if(f.actions.has('pause')){setActive(false);document.exitPointerLock?.();return;}
  if(f.actions.has('resume')){$('start').click();return;}
  if(!ready||!active)return;
  camera.rotation.y-=f.look.x*menuUI.settings.sensitivity*(ads?.5:1);camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x+f.look.y*menuUI.settings.sensitivity*(ads?.5:1),-1.5,1.5);
  for(const action of f.actions){
    if(action==='reload')reload();if(action==='melee')melee();if(action==='use')interact();if(action==='weapon')switchWeapon();
    if(action==='grenade')throwGrenade();if(action==='equipment')equipment('monkey');if(action==='claymore')equipment('claymore');if(action==='attachment')attachment();
    if(action==='journal'){setActive(false);document.exitPointerLock?.();}
  }
}
function renderFrame(now){
  if(document.hidden||contextLost)return;
  const interval=profile.mobile?(active?1000/30:200):0;
  if(lastRendered&&now-lastRendered<interval-1)return;
  lastRendered=now;const dt=Math.min((now-previous)/1000,.06);previous=now;frameTime+=dt;frameCount++;renderedFrames++;
  if(frameTime>.75){fps=Math.round(frameCount/frameTime);frameTime=0;frameCount=0;}
  pollKinoController(dt);
  if(controller.usingPad){const g=a=>controller.glyph(a);$('pad-controls').textContent=`Left stick · Move | Right stick · Look | ${g('sprint')} · Sprint
${g('fire')} · Fire | ${g('aim')} · Aim / Dual weapon | ${g('jump')} · Jump | ${g('crouch')} · Crouch
${g('use')} · Tap reload / Hold interact | ${g('switchWeapon')} · Weapon | ${g('melee')} · Knife
${g('lethal')} · Grenade | ${g('tactical')} · Monkey Bomb
↓ · Claymore | → · Attachment | ${g('scoreboard')} · Scoreboard
${g('pause')} · Play / Pause`;}
  menuUI.update({started,session,controller,objective:$('objective').textContent,audio});
  update(dt);renderer.info.reset();renderer.clear();renderer.render(scene,camera);if(ready&&started&&!weaponScope.active){renderer.clearDepth();renderer.render(viewScene,viewCamera);}
}
resumeRendering();
