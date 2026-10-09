import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './animation.js';
import { MoonMysteryBox } from './moon-box.js';
import { MoonProgression, DIGGERS, CHARGE } from './moon-progression.js';
import { MoonExcavators } from './moon-excavators.js';
import { MoonQed } from './moon-qed.js';
import { MoonStories } from './moon-stories.js';
import { MoonMachineAudio } from './moon-machine-audio.js';
import { MoonQuestProps, moveFraction } from './moon-quest-props.js';
import { MoonHacker } from './moon-hacker.js';
import { MOON_PERKS } from './moon-session.js';
import { contains, touching, MoonGates } from './moon-rules.js';
import { zombieHealth } from './rules.js';

const V=a=>new THREE.Vector3(...a), colors=[0xe74a49,0x4ecc78,0x4b8cff,0xffdb55],colorNames=['RED','GREEN','BLUE','YELLOW'];
// toGame/toPort swap browser (x, up, -y) and T5 (x, y, up) axes for script maths.
// _zombiemode_sidequests.gsc fake_use: no hint string; fires on use within 64 units of the player's origin
// while facing it (2D dot > 0.9). Radios, 8-bit songs, the meteor, wire, Vril generator, charge and reels.
const FAKE_USE=new Set(['music','meteor','sq_wire_pos','sq_wire_final','sq_charge_terminal','sq_charge_vg_pos','sq_vg_final','sq_datalog','sq_reel_to_reel','egg_radios']);
const toGame=v=>[v.x,-v.z,v.y],toPort=([x,y,z])=>new THREE.Vector3(x,z,-y),BG=800;
// zombie_moon_teleporter.gsc gate offsets [closed, open]: the Moon gate opens by sinking the bottom brush 140 and raising
// the top one 140 from the map pose; the bunker gate's map pose is open and it closes 195 (bunker_gate_2 96) lower.
const GATE_MOVES={teleporter_gate:[[0,0,0],[0,-140,0]],teleporter_gate_top:[[0,0,0],[0,140,0]],bunker_gate:[[0,-195,0],[0,0,0]],bunker_gate_2:[[0,-96,0],[0,0,0]]};
export class MoonFeatures {
  constructor({data,state,combat,scene,camera,player,objects,opened,parts,navigation,notice,raycast}){
    Object.assign(this,{data,state,combat,scene,camera,player,objects,opened,parts,navigation,notice,raycast});
    this.s=combat.session;this.quest=new MoonProgression(data,this.s,notice);combat.features=this;
    this.targets=[];this.fx=[];this.portals=[];this.models={};this.flight=null;this.lastArea='earth';
    this.gates=new MoonGates();this.excavators=new MoonExcavators(data,objects,scene,this.quest.paths);this.qed=new MoonQed(this);
    this.grab=null;this.shockUntil=0;this.repairs=[];this.rebuildReward=0;this.rebuildCap=50;
  }
  all(n){return this.data.entities.filter(e=>e.targetname===n);}
  one(n){return this.all(n)[0];}
  async load(){
    await Promise.all(Object.entries(this.combat.data.props).map(async([n,url])=>this.models[n]=await loadModel(url)));
    const locations=this.all('treasure_chest_use'),entities=this.data.entities.slice();
    for(const e of locations){
      const index=e.target.split('_').at(-1),base=this.one('magic_box_base_'+index);
      entities.push({...base,targetname:e.script_noteworthy+'_org'});
      entities.push({...this.one(e.target),targetname:e.script_noteworthy+'_lid'});
    }
    const world={entities:this.objects,boxLocations:locations,activeBox:locations.find(e=>e.script_noteworthy==='start_chest')??locations[0],fireSale:false};
    world.updateBox=()=>{
      for(const e of locations){const index=e.target.split('_').at(-1),visible=e.id===world.activeBox.id||world.fireSale||world.openBoxes?.has(e.id);
        for(const name of ['magic_box_base_','magic_box_lid_']){const o=this.objects.get(this.one(name+index)?.id);if(o)o.visible=visible;}}
    };
    const boxWeapons=Object.fromEntries(Object.entries(this.combat.data.weapons).filter(([id])=>this.combat.data.boxPool.includes(id)));
    Object.assign(boxWeapons,this.combat.data.equipment);
    this.box=new MoonMysteryBox(this.scene,world,{...this.combat.data,weapons:boxWeapons,entities},this.s,this.combat.audio,this.notice);
    await this.box.load();world.updateBox();
    for(const e of this.all('zombie_vending'))this.targets.push({e,kind:'perk',perk:e.script_noteworthy});
    // Mule Kick is spawned by the DLC perk scripts, rather than a BSP trigger.
    const mule={id:'mule',targetname:'zombie_vending',script_noteworthy:'specialty_additionalprimaryweapon',position:[1480.8,-65,-3450],yaw:Math.PI};
    this.mule=this.spawnModel('zombie_vending_three_gun',mule.position,mule.yaw);this.muleVending=mule;this.targets.push({e:mule,kind:'perk',perk:mule.script_noteworthy});
    for(const e of locations)this.targets.push({e,kind:'box'});
    this.barriers=this.all('exterior_goal').map(e=>{
      const members=this.all(e.target),spot=members.find(n=>n.classname==='script_struct'),center=spot?.position??e.position,outside=V(e.position),inside=V(center);
      inside.addScaledVector(inside.clone().sub(outside).setY(0).normalize(),48);
      const boards=members.filter(n=>n.script_parameters?.startsWith('barricade_')).sort((a,b)=>Number(a.script_noteworthy)-Number(b.script_noteworthy));
      // trigger_location (the window's target struct) carries the radius the Hacker uses (36 on Moon).
      const b={id:e.id,position:V(center),outside,inside,boards,count:boards.length,repairReady:0,radius:spot?.radius};
      this.targets.push({e:{...e,position:center},kind:'barrier',barrier:b});return b;
    });
    this.combat.world.setBoards=(b,n)=>this.setBoards(b,n);this.combat.enemies.barriers=this.barriers;
    this.targets.push({e:this.one('zombie_vending_upgrade'),kind:'pack'});
    for(const e of this.all('zombie_equipment_upgrade').filter(e=>e.zombie_equipment_upgrade==='equip_hacker_zm'))this.targets.push({e,kind:'hacker'});
    for(const [id,d] of Object.entries(DIGGERS))this.targets.push({e:this.one(d.switch),kind:'digger',id});
    for(const name of ['sq_ss_button','struct_osc_st','struct_osc_button','sq_knife_switch','sq_charge_terminal','sq_charge_vg_pos','sq_vg_final','sq_wire_pos','sq_wire_final','sq_datalog','sq_reel_to_reel','egg_radios'])for(const e of this.all(name))this.targets.push({e,kind:name});
    for(const e of this.all('8bitsongs'))this.targets.push({e,kind:'music'});
    for(const e of this.all('mus_easteregg'))this.targets.push({e,kind:'meteor'});
    for(const e of this.data.entities){if(e.zombie_weapon_upgrade==='sticky_grenade_zm')this.targets.push({e,kind:'lethal'});if(e.zombie_weapon_upgrade==='claymore_zm')this.targets.push({e,kind:'claymore'});}
    const bowie=this.data.entities.find(e=>e.targetname==='bowie_upgrade');if(bowie)this.targets.push({e:bowie,kind:'bowie'});
    this.sphere=this.spawnModel('p_zom_moon_black_egg',this.one('vs_stage_1a').position);this.sphere.visible=false;
    this.wire=this.spawnModel('zombie_magic_box_wire',this.data.entities[this.quest.wireId].position);
    this.plates=this.all('sq_cassimir_plates').map(e=>this.spawnModel('p_zom_moon_cassimir_plate',e.position,e.yaw));
    this.generator=this.spawnModel('p_zom_moon_vril_complete',this.one('sq_charge_vg_pos').position);this.generator.visible=false;
    // The charge terminal swaps p_zom_moon_magic_box_com_red/green while the Vril Device charges.
    const term=this.one('sq_ctvg_terminal');this.chargeLight=new THREE.PointLight(0xe74a49,0,120,1);if(term)this.chargeLight.position.copy(V(term.position)).y+=20;this.scene.add(this.chargeLight);
    const sam=this.one('sq_sam');this.samantha=this.spawnModel(sam.model,sam.position,sam.yaw);this.samantha.visible=false;
    this.simonLights=this.all('sq_ss_button').map(e=>{
      const light=new THREE.PointLight(colors[Number(e.script_int)],0,150,1);light.position.copy(V(e.position));this.scene.add(light);
      const screen=new THREE.Mesh(new THREE.PlaneGeometry(25,22),new THREE.MeshBasicMaterial({color:colors[Number(e.script_int)],transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));
      screen.position.copy(V(e.position));screen.rotation.y=e.yaw;this.scene.add(screen);return {light,screen,int:Number(e.script_int)};
    });
    this.securityLights=this.all('struct_osc_st').map(e=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(3,8,6),new THREE.MeshBasicMaterial({color:0x61ff9c}));mesh.position.copy(V(e.position));this.scene.add(mesh);return {e,mesh};
    });
    const enemies=this.combat.enemies;enemies.camera=this.camera;enemies.suspendTracking=()=>!!this.flight;
    enemies.onAstronaut=(event,z)=>this.astronaut(event,z);enemies.onNmlRamp=()=>this.nmlWarning();
    enemies.onRoundStart=round=>{this.rebuildReward=0;this.rebuildCap=Math.min(500,50*round);};
    enemies.onTeleport=(from,to)=>{this.combat.effect(from,0x92ccff,12);this.combat.effect(to,0x92ccff,12);};
    // Map-state models that the scripts swap in (build_moon_props.py).
    const props=await fetch('moon/props.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
    await Promise.all(Object.entries(props).map(async([n,url])=>this.models[n]=await loadModel(url)));
    this.pads=this.all('trig_jump_pad').map(t=>{const start=this.one(t.target);return {t,start,dests:this.all(start.target),wait:Number(t.script_wait??1),airborne:t.script_start==='1',biodome:t.script_noteworthy==='biodome_pads',malfunction:/^pad_(labs|magic_box|teleporter)_low$/.test(t.script_label??''),next:0};});
    this.glass=this.all('moon_breach_glass').map(e=>({e,object:this.objects.get(e.id),fx:this.all(e.target).map(x=>V(x.position)),broken:null}));
    this.stories=new MoonStories(this);this.props=new MoonQuestProps(this);this.hacker=new MoonHacker(this);this.machineAudio=new MoonMachineAudio(this);this.machineAudio.build();
    this.combat.audio.intercoms=this.all('intercom').map(e=>V(e.position));
    this.perkModels=['vending_sleight','vending_jugg'].map(n=>this.all(n).find(e=>e.position[0]>10000)).map(e=>({e,object:this.objects.get(e?.id),origin:this.objects.get(e?.id)?.position.clone()}));
    this.gateParts=[...this.parts.values()].filter(p=>p.gate);this.packGates=[...this.parts.values()].filter(p=>p.packGate);
    this.gateLights=[1,2,3,4].map(i=>this.one('zapper_teleport_opening_'+i)).filter(Boolean).map(e=>{const o=this.objects.get(e.id);if(o)o.visible=false;return {e,red:this.spawnModel('zombie_trap_switch_light_on_red',e.position,e.yaw),green:this.spawnModel('zombie_trap_switch_light_on_green',e.position,e.yaw)};});
    this.rubble=Object.fromEntries(Object.entries(DIGGERS).filter(([,d])=>d.rubble).map(([id,d])=>[id,this.objects.get(this.one(d.rubble)?.id)]));
    this.biodomePanel=this.objects.get(this.one('biodome_breached')?.id);
    this.excavators.build();
    this.reset();
  }
  spawnModel(name,position,yaw=0){const o=clone(this.models[name]);o.position.copy(V(position));o.rotation.y=yaw;this.scene.add(o);return o;}
  // equipment_spawn_think: the pickup at its new spot stays hidden until the player's Hacker is released.
  showHacker(){const held=!!this.s.hacker;for(const t of this.targets.filter(t=>t.kind==='hacker')){const e=this.one(t.e.target),o=this.objects.get(e?.id);if(o)o.visible=!held&&t.e.id===this.quest.hackerId;}}
  resetPresentation(){
    this.showHacker();
    this.wire.position.copy(V(this.data.entities[this.quest.wireId].position));this.wire.visible=true;
    this.syncPerkMachine();
  }
  reset(){
    this.quest.reset();this.box.reset();this.meteors=new Set();this.stories.reset();this.machineAudio.reset();
    this.hacker?.reset();this.pack=null;for(const p of this.packGates??[]){p.amount=0;p.delta.set(0,0,0);p.solid=undefined;p.navBlock=false;if(p.object)p.object.position.copy(p.origin);}this.finishFlight();this.padCooldown=0;this.lastArea='earth';this.sphere.visible=false;
    this.grab=null;this.shockUntil=0;this.repairs=[];this.rebuildReward=0;this.rebuildCap=50;this.setBlur(0);this.quakes=[];this.pushWait=0;this.smashSeen=new Set();
    for(const p of this.portals){p.mesh.removeFromParent();p.mesh.geometry.dispose();p.mesh.material.dispose();}this.portals=[];this.qed.reset();
    for(const f of this.fx){f.mesh.removeFromParent();f.mesh.geometry.dispose();f.mesh.material.dispose();}this.fx=[];
    this.generator.visible=false;this.samantha.visible=false;this.samantha.position.fromArray(this.one('sq_sam').position);this.props?.reset();
    for(const b of this.barriers){this.setBoards(b,b.boards.length);b.repairReady=0;}
    for(const w of this.all('sq_pyramid_walls')){const o=this.objects.get(w.id);if(o)o.position.copy(V(w.position));}
    this.gates.reset();for(const p of this.gateParts)p.amount=this.gates[p.gate].open?1:0;this.padState=null;this.padLaunch=null;this.padDirection=null;this.landed=0;this.tempt={wait:0,item:null};
    for(const p of this.pads)Object.assign(p,{next:null,down:false});
    for(const g of this.glass){g.broken?.removeFromParent();g.broken=null;if(g.object)g.object.visible=true;}
    if(this.biodomePanel)this.biodomePanel.visible=true;this.biodomeBroken?.removeFromParent();this.biodomeBroken=null;
    this.nmlPerk={index:null,last:null,drop:null,perk:null};this.teleporterUsed=true;this.firstExit=true;this.lastPhase=null;this.hurtTime=0;this.navigation.cut.clear();
    this.resetPresentation();this.syncBlockers();this.arriveEarth();this.updateGates(0);
  }
  // perk_machine_arrival_update: on every No Man's Land arrival the Juggernog/Speed Cola pair is
  // lifted 1200 units, shown after 0.3 s and dropped over 4 s while alternating every 0.2 s. The
  // first result is random, later results never repeat; machines cannot be used during the drop.
  arriveEarth(){
    const n=this.nmlPerk,start=Math.floor(this.s.random()*2);let index=start;
    if(index===n.last)index=1-index;
    n.last=index;n.index=index;n.drop={time:0,start};n.perk=null;this.syncPerkMachine();
  }
  syncPerkMachine(){
    const n=this.nmlPerk,d=n.drop,ease=t=>t<1.5?t*t/7.5:t<2.5?.3+.4*(t-1.5):1-.4*(4-t)*(4-t)/3;
    let shown=[n.index===0,n.index===1],lift=0;
    if(d){lift=d.time<1.3?1200:1200*(1-ease(Math.min(4,d.time-1.3)));
      if(d.time<.3)shown=[n.last2===0,n.last2===1];else if(d.time<1.3)shown=[true,true];else{const k=(d.start+Math.floor((d.time-1.3)/.2))%2;shown=[k===0,k===1];}}
    this.perkModels.forEach(({object,origin},i)=>{if(!object)return;object.visible=shown[i];object.position.copy(origin).y+=lift;});
  }
  updatePerkDrop(dt){
    const n=this.nmlPerk;if(!n.drop)return;n.drop.time+=dt;
    if(n.drop.time>=5.3){n.drop=null;n.last2=n.index;n.perk=n.index?'specialty_armorvest':'specialty_fastreload';}
    this.syncPerkMachine();
  }
  describe(t){
    const q=this.quest,s=this.s,story=this.stories.describe(t);if(story!==undefined)return story;
    if(t.kind==='perk'){
      if(t.e.position[0]>10000&&t.perk!==this.nmlPerk.perk)return '';
      const p=MOON_PERKS[t.perk];if(!p)return '';
      if(s.perks.has(t.perk))return p.name+' equipped'+(s.hacker&&!s.permanentPerks?' · Hold F to refund':'');
      if(t.perk==='specialty_quickrevive'&&s.soloLivesGiven>=3)return 'Quick Revive exhausted';
      if(!s.power&&s.area!=='earth'&&t.perk!=='specialty_quickrevive')return p.name+' · Requires power';
      return p.name+' · '+p.price+(s.perks.size>=4?' · Four-perk limit':'');
    }
    if(t.kind==='box'){
      if(!this.box.available(t.e))return '';
      const roll=this.box.at(t.e);return roll?roll.ready&&!roll.teddy?'Take '+this.box.data.weapons[roll.weapon].name:roll.teddy?'The box is moving…':'Mystery Box rolling…':'Mystery Box · '+(s.effects.fire_sale>s.time?10:950);
    }
    if(t.kind==='pack')return s.pack?s.time>=s.pack.readyAt?'Retrieve '+s.def.name+' · Pack-a-Punch':'Upgrading weapon…':s.weapon.upgraded?'Weapon already upgraded':'Pack-a-Punch · 5000';
    if(t.kind==='hacker')return t.e.id===q.hackerId&&!s.hacker?'Take Hacker · replaces P.E.S.':'';
    if(t.kind==='bowie')return s.bowie?'Bowie Knife equipped':'Bowie Knife · 3000';
    if(t.kind==='barrier')return t.barrier.count<t.barrier.boards.length?'Hold F · Repair barricade':'';
    if(t.kind==='music')return s.power?'Play hidden recording':'';
    if(t.kind==='meteor')return this.meteors.has(t.e.id)?'':'Activate meteor';
    if(t.kind==='lethal')return 'Semtex · '+(s.lethal==='sticky_grenade_zm'?125:250);
    if(t.kind==='claymore')return s.claymoresOwned?'':'Claymores · 1000';
    if(t.kind==='sq_ss_button'&&['simon','final_simon'].includes(q.stage))return (q.simonAccepting()?'Press '+colorNames[Number(t.e.script_int)]:'Watch the sequence')+` · ${q.sequenceInput}/${q.sequenceLength}`;
    if(t.kind==='struct_osc_button')return q.stage==='buttons'?'Press laboratory button':'';
    if(t.kind==='sq_knife_switch'&&q.ctt1Full&&!q.switchThrown)return 'Release Samantha';
    if(t.kind==='sq_wire_pos'&&!q.wire&&t.e.id===q.wireId)return 'Collect wire';
    if(t.kind==='sq_wire_final'&&q.wire&&!q.wirePlaced)return q.plates==='bench'?'Connect wire':'The plates must be assembled first';
    if(t.kind==='sq_charge_terminal'&&q.chargeOpen&&!q.charge.ready)return q.chargeTalking?'Listen':`Press F · Charge Vril Device · ${q.charge.presses}/${CHARGE[q.charge.block][0]}`;
    if(t.kind==='sq_charge_vg_pos'&&q.chargeOpen&&q.charge.ready)return 'Take the charged Vril Device';
    if(t.kind==='sq_charge_vg_pos'&&q.wirePlaced&&!q.vgPlaced)return s.power?'Place Vril generator':'Power required';
    if(t.kind==='sq_vg_final'&&q.ctt2Full&&q.swappedAt===null)return 'Insert charged Vril Device';
    return '';
  }
  findTarget(maxDistance=110){
    if(this.s.hacker&&this.s.hackerOut){const spot=this.hacker.hack?.spot??this.hacker.find();this.target=spot?{e:spot.e,kind:'hack',spot,label:'hack'}:null;return this.target;}
    let best=null;const forward=this.camera.getWorldDirection(new THREE.Vector3());
    const feet=this.player.getFeetPosition(),flat=new THREE.Vector2(forward.x,forward.z).normalize();let near=64;
    for(const t of this.targets){if(!FAKE_USE.has(t.kind))continue;const label=this.describe(t);if(!label)continue;
      const point=t.kind==='sq_wire_pos'?this.wire.position:V(t.e.position),d=point.distanceTo(feet),to=new THREE.Vector2(point.x-feet.x,point.z-feet.z);
      if(d>=near||!to.lengthSq()||to.normalize().dot(flat)<=.9)continue;
      best={...t,label,distance:d,silent:true};near=d;
    }
    if(best){this.target=best;return best;}
    for(const t of this.targets){if(FAKE_USE.has(t.kind))continue;const label=this.describe(t);if(!label)continue;
      const point=t.kind==='sq_wire_pos'?this.wire.position:V(t.e.position),delta=point.clone().sub(this.camera.position);
      const d=t.e.bounds?new THREE.Box3(V(t.e.bounds[0]),V(t.e.bounds[1])).distanceToPoint(this.camera.position):delta.length();
      if(d>=maxDistance||delta.length()>25&&delta.clone().normalize().dot(forward)<.25)continue;
      const wall=this.raycast(new THREE.Ray(this.camera.position.clone(),delta.clone().normalize()),1,delta.length());
      if(wall&&wall.distance<delta.length()-32)continue;
      best={...t,label,distance:d};maxDistance=d;
    }
    this.target=best;return best;
  }
  interact(t=this.target){
    if(!t||this.s.hackerOut||!this.s.canAct&&!(t.kind==='pack'&&this.s.pack))return false;
    const s=this.s,q=this.quest,a=this.combat.audio;let ok=false;
    if(t.kind==='perk'){
      const owned=s.perks.has(t.perk),full=s.perks.size>=4,poor=s.points<MOON_PERKS[t.perk].price,powered=s.power||s.area==='earth'||t.perk==='specialty_quickrevive';
      ok=s.buyPerk(t.perk);if(ok){this.combat.clearInput();this.combat.perkDrink.start(t.perk,this.combat.view);this.notice(MOON_PERKS[t.perk].name);this.machineAudio.purchased(t.perk);a.perkBought?.(t.perk);return true;}
      // vending_trigger_think: an owned perk only gets the perk_deny line; points or the four-perk limit add evt_perk_deny.
      if(powered&&s.canAct&&(owned||poor||full)){this.machineAudio.denied(t.perk,owned?'owned':poor?'points':'limit');if(owned||poor)a.vox('general','perk_deny');}
      this.notice(full?'You can buy four perks. Complete the quest to earn all eight.':'Cannot purchase: check points, power, and owned perks.');
    }
    // equipment_spawn_think: taking the Hacker moves its spawn to a random one of hacker_tool_positions.
    if(t.kind==='hacker'&&t.e.id===q.hackerId){const spots=this.targets.filter(x=>x.kind==='hacker');q.hackerId=spots[Math.floor(s.random()*spots.length)].e.id;this.showHacker();s.takeHacker();this.state.hasSuit=false;this.state.suit=false;this.notice('Hacker equipped. You have no P.E.S. Return to a suit station before entering vacuum.');ok=true;}
    if(t.kind==='box'){
      const roll=this.box.at(t.e);
      if(roll?.ready&&!roll.teddy){const id=this.box.take(t.e);ok=!!id;if(id){if(this.combat.data.equipment[id])s.giveEquipment(id);else{s.giveWeapon(id);this.combat.equip().catch(console.error);}this.notice(this.box.data.weapons[id].name+(this.combat.data.equipment[id]?' · X to throw':''));}}
      else if(!roll&&this.box.available(t.e)){const cost=s.effects.fire_sale>s.time?10:950;if(s.points>=cost&&this.box.start(t.e)){s.spend(cost);return true;}if(s.points<cost){a.vox('general','no_money');this.notice('Not enough points.');}}
      return ok;
    }
    if(t.kind==='pack'){
      const taking=!!s.pack,poor=s.points<5000;ok=taking?s.takePack():s.beginPack();
      if(ok){if(taking)this.machineAudio.packTaken();else{this.machineAudio.packStarted();a.vox('weapon_pickup','upgrade_wait');}
        this.combat.equip().catch(console.error);this.notice(s.pack?'Weapon inserted. Retrieve it after five seconds.':'Weapon upgraded.');return true;}
      if(!taking&&poor)a.vox('general','perk_deny');
      this.notice(s.pack?'The machine is still working.':'Pack-a-Punch requires 5000 points and an unupgraded weapon.');return false;
    }
    if(t.kind==='struct_osc_button')ok=q.pressButton(t.e.id);
    if(t.kind==='sq_ss_button')ok=q.pressSimon(Number(t.e.script_int));
    if(t.kind==='sq_knife_switch')ok=q.useSwitch();
    if(t.kind==='sq_wire_pos')ok=q.takeWire(t.e.id);
    if(t.kind==='sq_charge_terminal')ok=q.pressCharge();
    if(t.kind==='sq_charge_vg_pos')ok=q.collectCharge()||q.placeVg();
    if(t.kind==='sq_wire_final')ok=q.placeWire();
    if(t.kind==='sq_vg_final')ok=q.swap();
    if(['sq_datalog','sq_reel_to_reel','egg_radios'].includes(t.kind))return this.stories.interact(t);
    // give_bowie: the bowie line, no cha-ching; a refusal plays zmb_no_cha_ching and no_money.
    if(t.kind==='bowie'&&!s.bowie){if(s.spend(3000)){s.bowie=true;a.vox('weapon_pickup','bowie');this.notice('Bowie Knife equipped.');return true;}a.noMoney();return false;}
    if(t.kind==='music'){
      if(s.power)ok=a.eightBit(t.e);
    }
    if(t.kind==='meteor'&&!this.meteors.has(t.e.id)){this.meteors.add(t.e.id);a.vox('eggs','meteors',{variant:this.meteors.size-1});if(this.meteors.size===3)a.musicEgg();ok=true;}
    // Wall-bought Semtex and claymores cha-ching (claymores add the "grenade" pickup line); quest and easter-egg uses are silent.
    if(t.kind==='lethal'){ok=s.buyLethal(t.e.zombie_weapon_upgrade);if(ok)a.play('buy');else if(s.canAct)a.noMoney();}
    if(t.kind==='claymore'){ok=s.buyClaymores();if(ok){a.play('buy');a.vox('weapon_pickup','grenade');}else if(s.canAct&&!s.claymoresOwned)a.noMoney();}
    return ok;
  }
  updateHold(dt,held){
    this.hacker.update(dt,held);
    // Manual repair is refused while the Hacker is out (blocker_trigger_think).
    if(held&&this.target?.kind==='barrier'&&this.s.canAct&&!this.s.hackerOut){const b=this.target.barrier,s=this.s;
      // blocker_trigger_think: a board at once, then wait(1); the 10 points follow the wait and count toward a
      // per-player, per-round cap across every barricade. Speed Cola only speeds the board animation.
      if(s.time>=b.repairReady&&b.count<b.boards.length){b.repairReady=s.time+1;this.setBoards(b,b.count+1);this.combat.audio.play('board');this.repairs.push(s.time+1);}
    }
  }
  get hack(){return this.hacker?.hack??null;}
  // packapunch_hack_think: the nine zombieland gates close over 1 s for 30 s (NotSolid while moving, solid once no
  // player touches them) and reopen; pack_gate_poi_activate turns on the three zombieland points of interest only if
  // every player is inside pack_enclosure, and watch_for_exit turns them off when one leaves.
  inEnclosure(position){const b=this.one('pack_enclosure')?.bounds;return !!b&&contains(b,position.toArray());}
  closePack(){
    const s=this.s;this.pack={start:s.time,until:s.time+30,poi:this.inEnclosure(this.player.getFeetPosition()),sounded:false};
    for(const p of this.packGates){p.solid=false;this.combat.audio.at?.('moon/evt/mp_radiation/doors/hydraulic/hydraulic_start',V(p.entity.position),{distance:1500});}
  }
  updatePack(){
    const pk=this.pack,s=this.s;if(!pk)return;
    const closed=s.time<pk.until,age=closed?s.time-pk.start:s.time-pk.until,amount=closed?Math.min(1,age):Math.max(0,1-age),feet=this.player.getFeetPosition();
    if(!closed&&!pk.sounded){pk.sounded=true;for(const p of this.packGates){p.solid=false;this.combat.audio.at?.('moon/evt/mp_radiation/doors/hydraulic/hydraulic_start',V(p.entity.position),{distance:1500});}}
    let changed=false;
    for(const p of this.packGates){
      p.amount=amount;p.delta.copy(V(p.entity.move??[0,0,0])).multiplyScalar(amount);if(p.object)p.object.position.copy(p.origin).add(p.delta);
      const box=new THREE.Box3(V(p.entity.bounds[0]),V(p.entity.bounds[1])).translate(p.delta).expandByScalar(16),touched=box.containsPoint(feet)||box.containsPoint(feet.clone().setY(feet.y+60));
      if(age>=1&&!touched)p.solid=closed?true:undefined;
      const block=closed&&amount>=1;if(block!==p.navBlock){p.navBlock=block;changed=true;}
    }
    if(pk.poi&&!this.inEnclosure(feet))pk.poi=false;
    if(!closed&&age>=1&&this.packGates.every(p=>p.solid===undefined)){this.pack=null;for(const z of this.combat.enemies.list)z.zland=null;}
    if(changed)this.navigation.setDoors(this.parts);
  }
  // switch_between_zland_poi: a zombie outside the cage takes the points in a shuffled order, 2-4 s or until it arrives each.
  zlandTarget(z){
    const pk=this.pack,s=this.s;if(!pk?.poi||s.time>=pk.until||this.inEnclosure(z.root.position))return null;
    const st=z.zland??={order:[],i:0,until:0};
    if(!st.goal||s.time>=st.until||z.root.position.distanceTo(st.goal)<40){
      if(st.i>=st.order.length){st.order=this.all('zombieland_poi').map(e=>V(e.position));for(let i=st.order.length-1;i>0;i--){const j=Math.floor(s.random()*(i+1));[st.order[i],st.order[j]]=[st.order[j],st.order[i]];}st.i=0;}
      st.goal=st.order[st.i++];st.until=s.time+2+Math.floor(s.random()*3);
    }
    return st.goal.clone();
  }
  // door_opened / moon_door_opened after a door hack: flags, the door moves and the purchase sound.
  openDoor(d){const s=this.s;if(s.openDoors.has(d.name))return;s.openDoors.add(d.name);if(d.flag)s.flags.add(d.flag);this.opened.add(d.name);this.combat.audio.play('buy');}
  inPlayable(position){return this.combat.enemies.pointInEnabledZone(position);}
  giveRandomPerk(){
    const choices=Object.keys(MOON_PERKS).filter(id=>!this.s.perks.has(id));
    if(!choices.length)return false;
    this.s.givePerk(choices[Math.floor(this.s.random()*choices.length)]);return true;
  }
  loseRandomPerk(){
    const choices=[...this.s.perks];if(!choices.length||this.s.permanentPerks)return false;
    this.s.losePerk(choices[Math.floor(this.s.random()*choices.length)]);this.combat.equip().catch(console.error);return true;
  }
  environment(base){if(this.quest.breaches.has(base.zone))return {...base,lowGravity:true,breathable:false,gravity:136};return base;}
  syncBlockers(){
    let changed=false;
    for(const [id,d] of Object.entries(DIGGERS)){
      const state=this.quest.diggers[id],part=this.parts.get(this.one(d.blocker)?.id);
      if(part){const amount=state.blocked?0:1;if(part.amount!==amount){part.amount=amount;part.navBlock=state.blocked;changed=true;}if(part.object)part.object.visible=false;}
      if(d.cut){const edge=d.cut.slice(0,2).join('|');if(state.blocked)this.navigation.cut.add(edge);else this.navigation.cut.delete(edge);}
      if(this.rubble?.[id])this.rubble[id].visible=state.breached;
    }
    if(changed)this.navigation.setDoors(this.parts);
  }
  padOpen(name){return this.gates.open(name);}
  updateGates(dt){
    this.gates.update(dt);let changed=false;
    for(const p of this.gateParts){
      const open=this.gates[p.gate].open,target=open?1:0,old=p.amount,[closed,opened]=GATE_MOVES[p.entity.targetname];
      // MoveTo over teleporter_gate_move_time (3 s) with time/6 of acceleration and deceleration.
      p.amount=THREE.MathUtils.clamp(p.amount+Math.sign(target-p.amount)*dt/3,0,1);
      p.delta.copy(V(closed)).lerp(V(opened),moveFraction(p.amount*3,3,.5,.5));
      if(p.object)p.object.position.copy(p.origin).add(p.delta);
      // connectpaths as a gate starts opening; the Moon gate disconnects at once, the bunker gate once it is down.
      const block=!open&&(p.gate==='moon'||p.amount===0);if(block!==p.navBlock){p.navBlock=block;changed=true;}
      if(old!==p.amount||dt===0)this.setStatic?.(p.entity.id,!open);
    }
    this.gateLights.forEach((p,i)=>{p.red.visible=i>=this.gates.moon.lights;p.green.visible=!p.red.visible;});
    if(changed)this.navigation.setDoors(this.parts);
  }
  prePlayer(dt,input){
    if(!this.flight)return;
    const f=this.flight;f.time+=dt;
    // Keep the scripted launch velocity while the controller resolves collision.
    this.player.airAcceleration=0;this.player.gravity=f.gravity;
    const right=new THREE.Vector3(Math.cos(this.camera.rotation.y),0,-Math.sin(this.camera.rotation.y));
    f.velocity.addScaledVector(right,input.strafe*30*dt);
    this.player.velocity.x=f.velocity.x;this.player.velocity.z=f.velocity.z;
  }
  // The Gersh is a 2056-unit point of interest: zombies switch to pulled walks beyond 1024 and runs inside it,
  // and get their movement back when the hole collapses (black_hole_bomb_escaped_zombie_reset).
  lure(z){
    if(z.kind==='astronaut')return null;
    let best=null,range=2056;for(const p of this.portals){const d=z.root.position.distanceTo(p.center);if(d<range){best=p;range=d;}}
    const band=best?(range>1024?'walk':'run'):null,e=this.combat.enemies;
    if(z.kind!=='dog'&&band!==(z.gershBand??null)){if(!z.gershBand)z.gershPrev=z.moveSpeed;z.gershBand=band;z.moveSpeed=band??z.gershPrev;e.setCycle(z,e.cycleName(z));}
    // A Gersh overrides the zombieland points (moon_nml_bhb_present).
    return best?best.center.clone():this.powerupPoi(z)??this.zlandTarget(z);
  }
  // powerup_zombie_grab: each red power-up is a point of interest for the two nearest zombies within 300 units.
  powerupPoi(z){
    const items=this.combat.pickups.items,list=this.combat.enemies.list;let best=null,range=300;
    for(const p of items){if(!p.def?.zombieGrabbable)continue;p.attractors??=new Set();for(const a of p.attractors)if(!list.includes(a))p.attractors.delete(a);
      const d=z.root.position.distanceTo(p.root.position);if(d<range&&(p.attractors.has(z)||p.attractors.size<2)){best=p;range=d;}}
    for(const p of items)if(p!==best)p.attractors?.delete(z);
    if(!best)return null;best.attractors.add(z);return best.root.position.clone();
  }
  safeTeleport(){
    const zones=this.navigation.activeZones(this.s),feet=this.player.getFeetPosition();
    const spots=this.all('struct_black_hole_teleport').filter(e=>zones.has(e.script_string)&&V(e.position).distanceTo(feet)>250);
    const ordered=spots.sort(()=>this.s.random()-.5);
    for(const e of ordered){const p=this.navigation.closest(V(e.position));if(p&&p.distanceTo(V(e.position))<100){this.player.setPosition(p.add(new THREE.Vector3(0,3,0)));this.state.exposure=0;return true;}}
    return false;
  }
  // _zombiemode_ai_astro.gsc headbutt: grab (0.2 s view lock, then 10% speed), release past 59, or perk theft, 1 health and teleport.
  astronaut(event,z){
    const s=this.s;
    if(event==='grab'){this.grab={z,t:0};this.combat.clearInput();return;}
    if(event==='release'||event==='restore'){if(this.grab?.z===z)this.grab=null;return;}
    if(event!=='hit'||['reviving','gameover'].includes(s.phase))return;
    const perks=[...s.perks],perk=!s.permanentPerks&&perks.length?perks[Math.floor(s.random()*perks.length)]:null;
    if(perk){s.losePerk(perk);this.combat.equip().catch(console.error);}
    this.combat.damage(s.health-1);this.astronautTeleport();this.combat.effect(z.root.position,0xa6d9ff,25);this.combat.audio.play('teleport');
    this.notice('The astronaut teleported you'+(perk?' and stole '+MOON_PERKS[perk].name:'')+'.',7);
  }
  // astro_zombie_teleport_enemy: a black hole struct in an enabled zone other than the player's, preferring low gravity.
  astronautTeleport(){
    const e=this.combat.enemies,s=this.s,current=e.zones?.current;if(!current||!e.map)return false;
    const structs=this.all('struct_black_hole_teleport').map(t=>[s.random(),t]).sort((a,b)=>a[0]-b[0]).map(([,t])=>t);let chosen=null;
    for(const t of structs){const active=e.pointInEnabledZone(V(t.position));
      if(active&&current!==t.script_string){chosen=t;if(!s.power||e.map.zones.get(t.script_string)?.low)break;}else if(active)chosen=t;}
    if(!chosen)return false;
    const p=this.navigation.closest(V(chosen.position))??V(chosen.position);this.player.setPosition(p.add(new THREE.Vector3(0,3,0)));this.camera.rotation.set(0,chosen.yaw-Math.PI/2,0);return true;
  }
  nmlWarning(){
    // evt_nomans_warning accompanies each ramp; the port's round cue stands in where the native cue was not recovered.
    const cue=Object.keys(this.combat.audio.manifest).find(k=>k.endsWith('evt_nomans_warning'));
    this.combat.audio.play(cue??'round');this.notice('No Man’s Land: the horde is getting stronger.',4);
  }
  playerSlow(){return this.grab?this.grab.t<.2?0:.1:1;}
  setBlur(px){this.canvas??=globalThis.document?.querySelector('body > canvas');const filter=px?`blur(${px}px)`:'';if(this.canvas&&this.canvas.style.filter!==filter)this.canvas.style.filter=filter;}
  onKill(z){
    if(!z)return;
    const tank=this.quest.kill(z.root.position.toArray(),z.kind,z.deathCause);if(tank)this.props.soul(z.root.position.toArray());
    const e=this.combat.enemies,s=this.s,o=z.root.position.clone(),feet=this.player.getFeetPosition(),clear=(a,b)=>this.combat.world.lineClear(a,b);
    if(z.kind==='astronaut'){
      // astro_player_pulse: within 400 eye to eye with a clear eye, mid or foot trace, fling the player and kill zombies within 300.
      this.combat.effect(o,0xc7efff,30);this.combat.audio.play('explosion');if(this.grab?.z===z)this.grab=null;
      const eye=o.clone().setY(o.y+64),foot=o.clone().setY(o.y+8),mid=o.clone().setY((eye.y+foot.y)/2),peye=this.camera.position.clone(),pfoot=feet.clone().setY(feet.y+8),pmid=feet.clone().setY((peye.y+pfoot.y)/2),d=eye.distanceTo(peye);
      if(d<=400&&!['reviving','gameover'].includes(s.phase)&&!this.flight&&(clear(eye,peye)||clear(mid,pmid)||clear(foot,pfoot))){
        const pulse=100+200*Math.max(0,1-d/400),dir=new THREE.Vector3(feet.x-o.x,0,feet.z-o.z).normalize();
        this.player.setPosition(feet.clone().setY(feet.y+1));this.player.velocity.set(dir.x*pulse,pulse,dir.z*pulse);
        for(const other of [...e.list])if(other.root.position.clone().setY(other.root.position.y+40).distanceTo(mid)<=300)e.hurt(other,other.health+666,false,false,'explosion');
      }
    }
    // quad_killed_override: gas only on pistol/rifle bullet deaths, and never in low gravity (override_quad_explosion).
    if(z.gasDeath&&!z.lowGravity){
      // quad_death_explo: 96-unit blast, 2.5 s shellshock unless the P.E.S. is worn; RadiusDamage of level.zombie_health hits non-quads.
      if(feet.distanceTo(o)<=96){if(!this.state.suit)this.shockUntil=s.time+2.5;if(clear(o.clone().setY(o.y+30),feet.clone().setY(feet.y+30)))this.combat.damage(z.meleeDamage??45);}
      const health=zombieHealth(e.healthRound(),this.combat.data.rules);
      for(const other of [...e.list])if(other.kind!=='nova'&&other.root.position.distanceTo(o)<=96&&clear(o.clone().setY(o.y+30),other.root.position.clone().setY(other.root.position.y+30)))e.hurt(other,health,false,false,'explosion',false);
      // quad_gas_area_of_effect: a 125-unit cloud for gas_time 0..7 that only blurs vision.
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(125,12,8),new THREE.MeshBasicMaterial({color:0x91bd52,transparent:true,opacity:.16,depthWrite:false}));mesh.position.copy(o).y+=30;this.scene.add(mesh);this.fx.push({mesh,life:8,gas:true,center:o});
    }
  }
  shot(ray,cause,range=6000){
    const q=this.quest;
    if(q.be1==='active'&&q.spherePosition){const p=ray.intersectSphere(new THREE.Sphere(V(q.spherePosition),18),new THREE.Vector3());
      if(p&&p.distanceTo(ray.origin)<range){const wall=this.raycast(ray,1,p.distanceTo(ray.origin));if(!wall||wall.distance>=p.distanceTo(ray.origin)-24)q.motivateSphere(cause);}}
  }
  // digger_damage_player: while a blocker is down, touching its dig trigger pushes the player out and up at 20-44 units/s
  // (and deals 100 per touch only with Juggernog). kill_anyone_touching_blocker: every 0.1 s the dropped blocker kills a
  // player under it (insta_kill_player) and ragdolls any zombie touching it without points.
  updateDiggerHazards(dt,feet){
    const q=this.quest,s=this.s,out=['reviving','gameover'].includes(s.phase);this.pushWait=Math.max(0,(this.pushWait??0)-dt);
    for(const [id,D] of Object.entries(DIGGERS)){
      const d=q.diggers[id],trig=D.damage&&this.one(D.damage);if(!d.blocked)continue;
      if(trig&&!out&&!this.pushWait&&touching(trig.bounds,feet.toArray())){
        this.pushWait=.05;if(s.perks.has('specialty_armorvest'))this.combat.damage(100);
        const centre=V(trig.bounds[0]).add(V(trig.bounds[1])).multiplyScalar(.5),dir=feet.clone().sub(centre).setY(0).normalize(),pulse=20+Math.floor(s.random()*25);
        this.player.setPosition(feet.clone().setY(feet.y+.1));this.player.velocity.set(dir.x*pulse,pulse,dir.z*pulse);
      }
      const part=this.parts.get(this.one(D.blocker)?.id);if(!part||(d.blockerCheck=(d.blockerCheck??0)-dt)>0)continue;d.blockerCheck=.1;
      const b=part.entity.bounds.map(v=>V(v).add(part.delta).toArray());
      if(!out&&touching(b,feet.toArray()))this.instaKillPlayer?.();
      for(const z of [...this.combat.enemies.list])if(touching(b,z.root.position.toArray()))this.combat.enemies.hurt(z,z.health+666,false,false,'digger',false);
    }
  }
  // Earthquake(scale, duration, source, radius): the shake fades over its duration and to nothing at the radius.
  quake(scale,duration,origin,radius){this.quakes.push({scale,duration,left:duration,origin:origin.clone(),radius});}
  updateQuakes(dt){
    const q=this.quest,s=this.s,cam=this.camera.position;for(const k of this.quakes)k.left-=dt;this.quakes=this.quakes.filter(k=>k.left>0);
    // digger_arm_smash: Earthquake(0.5, 3) within 1500 of the destroyed tunnel; the Biodome breach shakes a client within
    // 2500 at full strength with ten damage_heavy rumbles.
    for(const [id,d] of Object.entries(q.diggers)){
      if(!d.smashed){this.smashSeen?.delete(id);continue;}if((this.smashSeen??=new Set()).has(id))continue;this.smashSeen.add(id);
      const D=DIGGERS[id],at=V((D.rubble?this.one(D.rubble):this.one('biodome_breached'))?.position??cam.toArray());
      if(D.rubble)this.quake(.5,3,at,1500);else if(at.distanceTo(cam)<2500){this.quake(.5,3,cam,1500);for(let i=0,t=0;i<10;i++,t+=.1+Math.random()*.1)this.combat.audio.later?.(t,()=>this.rumble?.(1,1,150));}
    }
    if(s.area!=='moon')return;this.quakeWait=(this.quakeWait??0)-dt;if(this.quakeWait>0)return;this.quakeWait=.1;
    // zombie_moon_digger.csc: moving tracks shake 0.15-0.25 within 2500 (slide_rumble); a digging blade 0.12-0.17 within 1500
    // and 750 vertically (grenade_rumble); both repeat every 0.05-0.25 s.
    for(const [id,d] of Object.entries(q.diggers)){const r=this.excavators.rigs[id];if(!r)continue;
      if(['moving','returning'].includes(d.phase)){const o=r.rig.position;this.quake(.15+Math.random()*.1,3,o,2500);if(o.distanceTo(cam)<2500)this.rumble?.(.3,.6,120);}
      else if(d.smashed&&['arm','digging','raising'].includes(d.phase)){const o=r.spin.getWorldPosition(new THREE.Vector3());this.quake(.12+Math.random()*.05,3,o,1500);if(o.distanceTo(cam)<1500&&Math.abs(o.y-cam.y)<750)this.rumble?.(.6,.4,120);}}
  }
  // The view offset this frame (radians); applied to the rendered view only.
  shake(){
    // Overlapping quakes (a moving excavator re-triggers one every 0.05-0.15 s) shake at the strongest, not their sum.
    const cam=this.camera.position;let amount=0;for(const k of this.quakes)amount=Math.max(amount,k.scale*Math.max(0,1-k.origin.distanceTo(cam)/k.radius)*(k.left/k.duration));
    if(amount<=0)return null;const a=Math.min(amount,1)*THREE.MathUtils.degToRad(3);return {x:(Math.random()*2-1)*a,y:(Math.random()*2-1)*a};
  }
  // zombie_moon_utility.gsc: bullets leave these panes intact; explosive/projectile
  // impacts within sqrt(64²+200²) of a native FX point replace the model and vent its zone.
  breakGlass(g){
    if(g.broken)return;
    const model=g.e.model+'_broken';if(!this.models[model])return;
    g.broken=this.spawnModel(model,g.e.position,g.e.yaw);if(g.object)g.object.visible=false;
    this.quest.breaches.add(g.e.script_noteworthy);
    for(const point of g.fx)this.combat.effect(point,0xb2d9e8,5);
  }
  blast(position,cause){
    this.quest.blast(position.toArray(),cause);
    if(['grenade','explosion'].includes(cause))for(const g of this.glass)if(!g.broken&&g.fx.some(point=>point.distanceToSquared(position)<64*64+200*200))this.breakGlass(g);
  }
  equipment(id,position){
    const type=id==='zombie_black_hole_bomb'?'gersh':'qed',quest=this.quest.blast(position.toArray(),type);
    if(type==='gersh'){
      // player_handle_black_hole_bomb: the 8 s fuse restarts once the device stops; outside an active zone
      // check_point_in_active_zone fails and black_hole_bomb_stolen_by_sam takes it.
      // bhb_teleport_loc_check: a quest Gersh is consumed and opens no black hole.
      if(quest||!this.combat.enemies.pointInEnabledZone?.(position)){this.combat.effect(position,0xb98cff,20);return;}
      this.combat.audio.play('moon/wpn/grenade/gersh_device/exp/wpn_gersh_exp');
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(45,24,16),new THREE.MeshBasicMaterial({color:0x6034b5,transparent:true,opacity:.85}));mesh.position.copy(position).y+=25;this.scene.add(mesh);
      this.portals.push({mesh,center:position.clone(),life:this.combat.data.equipment.zombie_black_hole_bomb?.fuseTime??8});
    }else{
      this.combat.audio.play('moon/wpn/quantum/quantum_detonate');
      // The quest's ctvg/be2 validations only notify, so a quest QED still rolls a normal result.
      this.combat.effect(position,0x83c7ff,45);this.lastQed=this.qed.detonate(position);
    }
  }
  finishFlight(){
    if(this.flight)this.player.airAcceleration=this.flight.airAcceleration;
    this.flight=null;
  }
  // moon_pad_malfunction_think: after power-on the three low Biodome pads run 30-59 s, then shut down for 10-29 s and
  // start again. The client flickers the pad glow with 4-6 electrical surges; zmb_turret_down/startup have no sound file.
  updatePadMalfunctions(){
    const s=this.s,a=this.combat.audio;if(!s.power)return;
    for(const p of this.pads){
      if(!p.malfunction)continue;if(p.next===null){p.next=s.time+30+Math.floor(s.random()*30);continue;}if(s.time<p.next)continue;
      p.down=!p.down;p.next=s.time+(p.down?10+Math.floor(s.random()*20):30+Math.floor(s.random()*30));
      if(p.down){let t=0;const n=4+Math.floor(Math.random()*3),at=V(p.start.position);for(let i=0;i<n;i++){t+=.1+Math.random()*.2;a.later?.(t,()=>a.at?.('moon/evt/zombie_global/switch/surge/',at,{distance:1000}));}}
    }
  }
  // moon_biodome_random_pad_temptation: every 60-179 s, while the Biodome is open and none is out, a power-up appears on
  // a random pad arc and hops along it (15, 7.5 and 2.5 s, then every 1.5 s), cycling a shuffled fire sale, insta-kill,
  // nuke, double points and carpenter; fire sale is skipped while one runs or before the box has moved.
  updateTemptation(dt){
    const tp=this.tempt,s=this.s,pickups=this.combat.pickups;
    if(tp.item&&!pickups.items.includes(tp.item))tp.item=null;
    if(tp.item&&s.time>=tp.hop)this.temptStep();
    if((tp.wait-=dt)>0)return;tp.wait=60+Math.floor(s.random()*120);
    const structs=this.data.entities.filter(e=>e.script_noteworthy==='struct_biodome_temptation');if(!structs.length||tp.item||!this.combat.enemies.zones?.enabled.has('forest_zone'))return;
    const spots=this.all(structs[Math.floor(s.random()*structs.length)].targetname),list=['fire_sale','insta_kill','nuke','double_points','carpenter'];
    for(const arr of [spots,list])for(let i=arr.length-1;i>0;i--){const j=Math.floor(s.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
    Object.assign(tp,{spots,list,index:0,spot:0,rotation:0});this.temptStep();
  }
  temptStep(){
    const tp=this.tempt,s=this.s;let type=tp.list[tp.index];
    if(type==='fire_sale'&&(s.effects.fire_sale>s.time||!this.box.moves)){tp.index=(tp.index+1)%tp.list.length;type=tp.list[tp.index];}
    const at=V(tp.spots[tp.spot].position);
    if(!tp.item){tp.item=this.combat.pickups.spawn(type,at.clone().setY(at.y-40));if(tp.item)tp.item.temptation=true;}else this.combat.pickups.retype(tp.item,type,at);
    tp.hop=s.time+([15,7.5,2.5][tp.rotation]??1.5);tp.rotation++;tp.index=(tp.index+1)%tp.list.length;tp.spot=(tp.spot+1)%tp.spots.length;
  }
  // jump_pad_start via trigger_thread: entering a pad plays evt_jump_pad_charge(_short) and waits script_wait; leaving
  // the trigger cancels. script_start pads then launch even an airborne player, the others only a grounded one, and
  // never one still in a pad flight (_padded); a refused launch charges again after 0.5 s while the player stays on it.
  updateJump(dt){
    const feet=this.player.getFeetPosition(),s=this.s,out=['reviving','gameover'].includes(s.phase);
    if(this.flight&&(this.flight.time>.25&&this.player.isGrounded||this.flight.time>8||out))this.finishFlight();
    if(this.padLaunch&&(this.padLaunch.left-=dt)<=0){const pad=this.padLaunch.pad;this.padLaunch=null;if(!out)this.launchPad(pad);}
    const pad=out?null:this.pads.find(p=>!p.down&&(p.t.script_flag_wait!=='power_on'||s.power)&&touching(p.t.bounds,feet.toArray()));
    if(this.padState?.pad!==pad){this.padState=null;if(pad?.dests.length)this.chargePad(this.padState={pad});}
    const c=this.padState;if(!c||c.stage==='launched'||(c.left-=dt)>0)return;
    if(c.stage==='retry'){this.chargePad(c);return;}
    if(this.flight||this.padLaunch||!pad.airborne&&!this.player.isGrounded){Object.assign(c,{stage:'retry',left:.5});return;}
    // jump_pad_move: evt_jump_pad_launch, SetStance("stand"), then 0.1 s before the velocity is applied.
    c.stage='launched';this.padLaunch={pad,left:.1};this.combat.audio.play('jump_pad');
  }
  chargePad(c){
    const b=c.pad.t.bounds,at=b?V(b[0]).add(V(b[1])).multiplyScalar(.5):V(c.pad.start.position);
    Object.assign(c,{stage:'charge',left:c.pad.wait});this.combat.audio.at?.('moon/evt/zombie_moon/jump_pad/evt_jump_pad_charge'+(c.pad.wait<1?'_short':''),at,{distance:1000});
  }
  launchPad(pad){
    const feet=this.player.getFeetPosition(),s=this.s;
    // moon_jump_pad_progression_end keeps the forward/backward route through the Biodome chain.
    this.padDirection=pad.start.script_string??this.padDirection;
    const candidates=pad.dests.filter(e=>!this.padDirection||e.script_string===this.padDirection);
    const end=candidates[Math.floor(s.random()*candidates.length)]??pad.dests[0];
    const to=V(end.position),delta=to.clone().sub(feet),gravity=this.player.gravity;
    const duration=Math.max(.7,Math.sqrt(2*delta.length()/gravity)+Math.sqrt(Math.abs(delta.y)/gravity));
    const velocity=delta.clone().divideScalar(duration);velocity.y+=gravity*duration/2;
    this.flight={time:0,duration,gravity,velocity,airAcceleration:this.player.airAcceleration,start:pad.start.id,end:end.id};
    this.player.velocity.copy(velocity);this.player.onFloor=this.player.grounded=false;
    // 20 >= randomintrange(0, 101): the jumppad line plays about one launch in five.
    if(s.random()*101<21)this.combat.audio.vox?.('general','jumppad');
  }

  update(dt,held){
    const q=this.quest,s=this.s;q.update(dt);q.playerAt(this.player.getFeetPosition().toArray());this.stories.update(dt);this.machineAudio.update();this.box.update(dt);this.qed.update(dt);this.updateHold(dt,held);this.updatePadMalfunctions();this.updateTemptation(dt);this.updatePack();this.updateJump(dt);this.syncBlockers();
    if(s.area!==this.lastArea){
      this.lastArea=s.area;this.hacker.stop();this.finishFlight();this.padLaunch=null;this.grab=null;
      if(s.area==='moon')this.gates.arriveMoon();else{this.gates.arriveEarth();this.arriveEarth();}
      this.teleporterUsed=true;this.lastPhase=s.phase;
    }
    if(s.area==='moon'&&this.lastPhase==='preparing'&&s.phase==='fighting'){
      if(!this.teleporterUsed){this.gates.roundOver();q.roundOver();}this.teleporterUsed=false;
    }
    if(this.hackerShown!==!!s.hacker){this.hackerShown=!!s.hacker;this.showHacker();}
    this.lastPhase=s.phase;this.updateGates(dt);this.updatePerkDrop(dt);this.excavators.update(dt,q.diggers,s.area==='moon');
    if(q.diggers.biodome.breached&&!this.biodomeBroken&&this.biodomePanel){const e=this.one('biodome_breached');this.biodomePanel.visible=false;this.biodomeBroken=this.spawnModel('p_zom_moon_biodome_hole_broken',e.position,e.yaw);}
    if(this.grab){const g=this.grab,o=g.z.root.position,at=this.camera.position,r=this.camera.rotation;g.t+=dt;
      // astro_turn_player lerps the view to face the astronaut over 0.2 s.
      if(g.t<=.2){const yaw=Math.atan2(at.x-o.x,at.z-o.z),diff=Math.atan2(Math.sin(yaw-r.y),Math.cos(yaw-r.y));r.y+=diff*Math.min(1,dt/(.2-g.t+dt));}}
    for(const at of this.repairs.filter(at=>s.time>=at)){this.repairs.splice(this.repairs.indexOf(at),1);if(!['reviving','gameover'].includes(s.phase)){this.rebuildReward+=10;if(this.rebuildReward<this.rebuildCap)s.addPoints(10);}}
    if(s.pack&&s.time>s.pack.expires){
      const slot=s.inventory.indexOf(s.pack.weapon);if(slot>=0)s.inventory.splice(slot,1);s.pack=null;
      if(!s.inventory.length)s.giveWeapon('m1911_zm');s.slot=Math.min(s.slot,s.inventory.length-1);this.combat.equip().catch(console.error);this.notice('The Pack-a-Punch weapon was not collected in time.');
    }
    const feet=this.player.getFeetPosition();
    this.updateDiggerHazards(dt,feet);this.updateQuakes(dt);
    for(const p of [...this.portals]){
      p.life-=dt;p.mesh.rotation.y+=dt*2;p.mesh.scale.setScalar(1+Math.sin(p.life*7)*.12);
      // black_hole_bomb_initial_attract_func: inside pulled_in_range (128) a zombie starts its event-horizon death at once.
      for(const z of [...this.combat.enemies.list]){
        const distance=z.root.position.distanceTo(p.center);if(z.kind==='astronaut')continue;
        if(distance<128)this.combat.hurt(z,z.health+666,{location:'none',cause:'gersh'});
      }
      // black_hole_bomb_trigger_monitor: a 64 x 70 trigger teleports airborne players with a clear line to the hole.
      const up=feet.y-p.center.y,eye=this.camera.position,mouth=p.center.clone().add(new THREE.Vector3(0,65,0));
      if(!this.player.onFloor&&!s.lastStand&&up>=0&&up<=70&&Math.hypot(feet.x-p.center.x,feet.z-p.center.z)<64&&this.combat.world.lineClear(eye,mouth)){
        const e=this.qed.destination();if(e){this.combat.audio.play('moon/evt/zombie_cosmodrome/gersh/gersh_teleport_out');this.qed.teleport(e);}
      }
      if(p.life<=0){p.mesh.removeFromParent();p.mesh.geometry.dispose();p.mesh.material.dispose();this.portals.splice(this.portals.indexOf(p),1);}
    }
    let gassed=false;
    for(const f of [...this.fx]){f.life-=dt;if(f.gas&&Math.hypot(feet.x-f.center.x,feet.z-f.center.z)<=125&&Math.abs(feet.y-f.center.y)<100)gassed=true;if(f.life<=0){f.mesh.removeFromParent();f.mesh.geometry.dispose();f.mesh.material.dispose();this.fx.splice(this.fx.indexOf(f),1);}}
    this.gassed=gassed&&!this.state.suit;this.setBlur(this.gassed?4:s.time<this.shockUntil?3:0);
    this.sphere.visible=!!q.spherePosition;if(q.spherePosition)this.sphere.position.copy(V(q.spherePosition));
    // wp_init: once placed, the wire model stands at sq_wire_final.
    this.wire.visible=!q.wire||q.wirePlaced;if(q.wirePlaced)this.wire.position.copy(V(this.one('sq_wire_final').position));
    const platePositions=q.plates==='earth'||q.plates==='loose'?this.all('sq_cassimir_plates'):q.plates==='receiving'?this.all('sq_ctvg_tp2'):this.all('sq_cp_final');
    this.plates.forEach((o,i)=>{o.position.copy(V(platePositions[i].position));if(q.plates==='loose')o.position.y-=75;});
    // The generator stands at sq_charge_vg_pos from placement until collected, and at sq_vg_final after the soul swap.
    this.generator.visible=q.vgPlaced&&!q.vgCharged||q.swappedAt!==null;
    if(this.generator.visible)this.generator.position.copy(V(this.one(q.swappedAt!==null?'sq_vg_final':'sq_charge_vg_pos').position));
    // Collectors, souls, pyramid walls, Samantha and the generator bob (moon-quest-props.js).
    this.props.update(dt);
    // Each terminal shows the colour its p_zom_moon_magic_box_com_* model would (display_seq lights all four together).
    this.chargeLight.intensity=q.vgPlaced&&!q.vgCharged?60:0;this.chargeLight.color.setHex(q.charge.terminal==='green'?0x4ecc78:0xe74a49);
    const screens=q.simonScreens();
    this.simonLights.forEach(({light,screen,int})=>{const c=screens[int];if(c>=0){light.color.setHex(colors[c]);screen.material.color.setHex(colors[c]);}light.intensity=c>=0?90:0;screen.material.opacity=c>=0?.9:.06;});
    for(const {e,mesh}of this.securityLights)mesh.visible=q.stage==='security'&&q.securityTargets.includes(e.id)&&!q.security.has(e.id);
    this.updateHud();
  }
  updateHud(){
    const s=this.s,q=this.quest,$=id=>document.getElementById(id);
    if($('objective'))$('objective').textContent=q.objective();
    if($('perks')){const html=[...s.perks].map(id=>`<span title="${MOON_PERKS[id].name}" style="background:${MOON_PERKS[id].color}">${MOON_PERKS[id].icon}</span>`).join('');if($('perks').innerHTML!==html)$('perks').innerHTML=html;}
    if($('equipment'))$('equipment').textContent=(s.hacker?'HACKER · ':'')+(s.equipment?this.combat.data.equipment[s.equipment].name+' × '+s.equipmentAmmo+' · X':'')+(s.weapon.id==='microwavegun_zm'?' · B: combine / split':'');
    if($('hazard'))$('hazard').textContent=Object.entries(q.diggers).filter(([,d])=>d.phase!=='idle').map(([id,d])=>`${DIGGERS[id].name} · ${DIGGERS[id].label} · ${d.phase==='digging'?'BREACHED':Math.ceil(d.left)+'s'}`).join(' / ');
    if($('hack-progress')){$('hack-progress').hidden=!this.hack;$('hack-progress').value=this.hack?1-this.hack.left/this.hack.duration:0;}
  }
  setBoards(b,n){b.count=Math.max(0,Math.min(b.boards.length,n));b.boards.forEach((e,i)=>{const o=this.objects.get(e.id);if(o)o.visible=i<b.count;const p=this.parts.get(e.id);if(p)p.amount=i<b.count?0:1;});}
  get brokenWindows(){return this.barriers.filter(b=>b.count===0).length;}
  repairAll(){for(const b of this.barriers)this.setBoards(b,b.boards.length);}
  snapshot(){return {quest:this.quest.snapshot(),box:this.box.snapshot(),boxLocation:this.box.world.activeBox.id,boxMoves:this.box.moves,hacker:this.s.hacker,equipment:this.s.equipment,equipmentAmmo:this.s.equipmentAmmo,hack:this.hack?{left:this.hack.left,target:this.hack.target.e.id}:null,flight:!!this.flight};}
}
