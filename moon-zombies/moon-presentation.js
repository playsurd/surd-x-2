import * as THREE from 'three';
import { DIGGERS, LAUNCH } from './moon-progression.js';

// The sky image contains the native star field in the left half and the Earth
// horizon in the right half. Keep the Earth as its separate native vista layer.
export class MoonPresentation {
  constructor(scene,camera,features){Object.assign(this,{scene,camera,features});this.stage=null;this.flashColor=-1;this.diggers={};this.diggerTimer={};this.pending=[];this.time=0;this.typingUntil=0;this.loops={};}
  async load(){
    this.lights=Array.from({length:4},()=>{const l=new THREE.PointLight(0xc5def2,0,300,1);this.scene.add(l);return l;});
    this.lamps=this.features.data.entities.filter(e=>e.classname==='light'&&e.position&&e.radius&&Number(e.radius)<1800);
    this.rockets=this.features.all('vista_rocket').map(e=>({e,object:this.features.objects.get(e.id),top:new THREE.Vector3(...(this.features.one(e.target)??e).position),raise:0}));
  }
  reset(){this.stage=null;this.flashColor=-1;this.diggers={};this.diggerTimer={};this.pending=[];this.typingUntil=0;for(const k of Object.keys(this.loops??{}))this.stopLoop(k);for(const r of this.rockets){r.raise=0;r.flight=null;if(r.object){r.object.position.fromArray(r.e.position);r.object.quaternion.identity();r.object.visible=true;}r.booster?.removeFromParent();r.booster=null;}}
  // zombie_moon_sq_ss.gsc plays the Samantha Says tones in space at (-1006.3, 294.2, -93.7).
  samantha(a,name){const d=this.camera.position.distanceTo(new THREE.Vector3(-1006.3,-93.7,-294.2));a.cue('_sidequest/samanthasays/evt_ss_'+name,Math.max(0,1-d/1500));}
  // is_player_close_enough: within 75 of the second button's terminal.
  nearTerminal(){const b=this.features.all('sq_ss_button')[1],t=b&&this.features.one(b.target);return !!t&&this.features.player.getFeetPosition().distanceTo(new THREE.Vector3(...t.position))<=75;}
  // launch: each rocket waits 0.1-1 s, plays evt_rocket_launch and rides its info_vehicle_node path (speeds in mph).
  launchRockets(){
    const f=this.features;
    for(const r of this.rockets){
      if(!r.object)continue;const nodes=[];let e=f.one(f.one(r.e.target)?.target);
      while(e&&nodes.length<64){nodes.push({p:new THREE.Vector3(...e.position),v:Math.max(1,Number(e.speed??10))*17.6});e=e.target?f.one(e.target):null;}
      if(nodes.length>1)r.flight={nodes,delay:.1+Math.random()*.9,seg:0,u:0,started:false};
    }
  }
  fly(r,dt,a){
    const f=r.flight;
    if(!f.started){if((f.delay-=dt)>0)return;f.started=true;a.cue('_sidequest/rocket/evt_rocket_launch',Math.max(.2,1-this.camera.position.distanceTo(r.object.position)/8000));
      r.booster=new THREE.PointLight(0xffa24a,400,3000,1);r.booster.position.y=-150;r.object.add(r.booster);}
    let left=dt;
    while(left>0&&f.seg<f.nodes.length-1){
      const A=f.nodes[f.seg],B=f.nodes[f.seg+1],len=Math.max(1,A.p.distanceTo(B.p)),v=A.v+(B.v-A.v)*f.u,du=v*left/len;
      if(f.u+du<1){f.u+=du;left=0;}else{left-=(1-f.u)*len/v;f.u=0;f.seg++;}
    }
    if(f.seg>=f.nodes.length-1){r.object.visible=false;return;}
    const A=f.nodes[f.seg].p,B=f.nodes[f.seg+1].p;r.object.position.lerpVectors(A,B,f.u);r.object.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),B.clone().sub(A).normalize());
  }
  loop(name,key,volume){if(this.loops[name])return;this.loops[name]='starting';this.features.combat.audio.native(key,volume,true).then(s=>{if(this.loops[name]==='starting')this.loops[name]=s;else s.stop();}).catch(()=>{delete this.loops[name];});}
  stopLoop(name){const s=this.loops[name];delete this.loops[name];if(s&&s!=='starting')try{s.stop();}catch{}}
  // speak_charge_lines: each line plays to its end before the next; Richtofen's own lines use the helmet (_f) take.
  chargeLine(e,q,a){
    const P='moon/vox/scripted/zombie_moon/',base=P+{rictofen:'plr3/vox_',computer:'mcomp/vox_',maxis:'xcomp/vox_'}[e.who]+e.what;
    const key=e.who==='rictofen'&&a.helmet&&a.manifest[base+'_f']?base+'_f':base,mark=q.charge.block+':'+q.charge.line,done=()=>{if(q.charge.block+':'+q.charge.line===mark)q.chargeLineDone();};
    if(!a.manifest[key]||!a.ready?.()){this.pending.push({left:2.5,fn:done});return;}
    a.native(key,.9,false,{bus:'vox'}).then(s=>s.addEventListener('ended',done)).catch(()=>this.pending.push({left:2.5,fn:done}));
  }
  event(e,q,a){
    const S='moon/evt/zombie_moon/_sidequest/';
    if(e.type==='chargeTyping'){this.typingUntil=this.time+.25;this.loop('typing',S+'vril/evt_typing_loop_l',.6);}
    if(e.type==='chargeLine')this.chargeLine(e,q,a);
    if(e.type==='chargeReady'){a.play(S+'assemble/evt_extra_charge',.8);this.loop('vril',S+'vril/evt_vril_loop_lvl2_l',.5);}
    if(e.type==='chargeCollected'){this.stopLoop('vril');a.play(S+'vril/evt_vril_remove',.8);}
    const tone=['e','d','c','lo_g'],first=!q.simon1Done;
    if(e.type==='simonTone')this.samantha(a,tone[e.color]);
    // do_ss_*_vox: on the first puzzle Richtofen answers each computer line when he is within 75 units.
    if(e.type==='simonVox'&&(first?this.nearTerminal():q.finalGame===0))a.mcomp(first?'quest_step1_0':'quest_step7_0',first?()=>a.vox('eggs','quest1',{variant:0}):null);
    if(e.type==='simonFail'){this.samantha(a,'wrong');if(first&&this.nearTerminal())a.mcomp('quest_step1_1',()=>a.vox('eggs','quest1',{variant:1}));}
    if(e.type==='simonWin'){
      e.seq.forEach((c,i)=>this.pending.push({left:i*.2,fn:()=>this.samantha(a,tone[c])}));
      // After the third code, Maxis answers unless the sphere is already gone (flag be2).
      if(!first)a.mcomp(['quest_step7_2','hack_success','quest_step7_4'][q.finalGame],q.finalGame===2?()=>{if(!q.be2Done)a.line('xcomp/vox_xcomp_quest_step7_5');}:null);
      else if(this.nearTerminal())a.mcomp('quest_step1_2',()=>a.vox('eggs','quest1',{variant:2}));
    }
    if(e.type==='launch'){
      if(e.step==='start')a.xcomp('quest_step8_4');if(e.step==='line')a.xcomp('quest_step8_5');if(e.step==='earth')a.xcomp('laugh');
      if(e.step==='explode')a.cue('_sidequest/rocket/evt_earth_explode');if(e.step==='rockets')this.launchRockets();
    }
    if(e.type==='sphere'&&q.spherePosition){
      const key={activate:'moon/evt/zombie_temple/sq/lgs/knife_crystal',stop:'moon/evt/zombie_temple/sq/oafc/glyph_wrong',wait:'moon/evt/zombie_moon/_sidequest/blackegg/black_egg_door_wait',
        accel:'moon/evt/zombie_moon/_sidequest/blackegg/black_egg_accelerate',bounce:'moon/evt/zombie_moon/_sidequest/blackegg/black_egg_bounce_b'}[e.sound];
      if(key)a.play(key,Math.max(0,1-this.camera.position.distanceTo(new THREE.Vector3(...q.spherePosition))/1500));
    }
    // maxis_story_vox: Richtofen's lines play at sq_vg_final, then Maxis.
    if(e.type==='story')a.line((e.line.startsWith('xcomp')?'xcomp/vox_':'plr3/vox_')+e.line,this.features.one('sq_vg_final').position);
    // ctvg wire(): evt_grab_wire on pickup; placing it plays evt_casimir_charge and evt_sq_rbs_light_on on Richtofen and
    // the client's wire model starts the old computer. vg(): evt_vril_connect and the level-1 loop at sq_charge_vg_pos.
    if(e.type==='wireTaken')a.play(S+'assemble/evt_grab_wire',.9);
    if(e.type==='wirePlaced'){a.play(S+'assemble/evt_casimir_charge',.9);a.play(S+'samanthasays/evt_ss_c',.8);a.at(S+'vril/evt_start_old_computer',new THREE.Vector3(...this.features.one('sq_wire_final').position),{distance:1500});}
    if(e.type==='vgPlaced'){const p=new THREE.Vector3(...this.features.one('sq_charge_vg_pos').position);a.at(S+'vril/evt_vril_start',p,{distance:1500});a.loop('vril-lvl1',S+'vril/evt_vril_loop_lvl1_l',{position:p,distance:1000,volume:.6});}
    if(e.type==='chargeReady')a.unloop('vril-lvl1');
    // digger_hack_func: the hacker's line, then delayed_computer_hacked_vox 4 s later.
    if(e.type==='diggerHacked'){a.vox('digger','hacked');this.pending.push({left:4,fn:()=>a.mcomp(`digger_${DIGGERS[e.id].vox}hacked`)});}
    if(e.type==='voice')this.pending.push({left:e.delay??0,fn:()=>a.vox('eggs',e.cat,{variant:e.variant,override:e.override})});
    if(e.type==='line')this.pending.push({left:e.delay??0,fn:()=>a.line(e.key,e.position)});
    // The covers play the computer line, then the hacker answers when it ends.
    const lids=()=>this.features.props.covers.map(c=>c.position);
    if(e.type==='coverLine')a.mcompAt(e.mcomp,lids(),()=>a.vox('eggs',e.cat,{variant:e.variant}));
    if(e.type==='mcompAt')a.mcompAt(e.alias,e.positions.map(p=>new THREE.Vector3(...p)));
    // richtofen_sam_vo (endon ss_done, 4 s after the Vril Device is placed): Richtofen, Samantha at her target, Richtofen.
    if(e.type==='samSequence')this.pending.push({left:e.delay??0,fn:async()=>{
      const live=()=>q.swappedAt===null||q.elapsed<q.swappedAt+4,sam=this.features.one(this.features.one('sq_sam').target).position;
      for(const [key,position] of [['plr3/vox_plr_3_quest_step6_7',null],['plr4/vox_plr_4_quest_step6_10',sam],['plr3/vox_plr_3_quest_step6_8',null]]){if(!live())return;await a.line(key,position);}
    }});
    if(e.type==='samMusic')a.musicReveal?.();
    if(e.type==='pulled')a.play('moon/evt/zombie_cosmodrome/gersh/gersh_teleport_out',.8);
    if(e.type==='rocket'){const r=this.rockets[e.index];if(r?.object){const d=this.camera.position.distanceTo(r.top);a.cue('_sidequest/rocket/evt_rocket_move_up',Math.max(0,1-d/6000));}}
  }
  update(dt,environment){
    const f=this.features,q=f.quest,a=f.combat.audio,lunar=environment.lunar;
    const flash=document.getElementById('earth-flash');if(flash)flash.style.opacity=q.stage==='launch'&&q.stageTime>=LAUNCH.explode?String(Math.max(0,.85-(q.stageTime-LAUNCH.explode)*.4)):'0';
    this.time+=dt;for(const e of q.events.splice(0))this.event(e,q,a);
    // typing_sound_thread: the typing loop stops 250 ms after the last press.
    if(this.loops.typing&&this.time>this.typingUntil)this.stopLoop('typing');
    for(const p of [...this.pending])if((p.left-=dt)<=0){this.pending.splice(this.pending.indexOf(p),1);p.fn();}
    // rocket_raise: each launch code moves the next rocket from its silo to its struct over 4 s.
    this.rockets.forEach((r,i)=>{if(!r.object)return;if(!r.flight){r.raise=i<q.rockets?Math.min(1,r.raise+dt/4):0;r.object.position.lerpVectors(new THREE.Vector3(...r.e.position),r.top,r.raise);}
      if(r.flight)this.fly(r,dt,a);});
    const lamps=environment.breathable&&f.s.power?this.lamps.filter(e=>Math.abs(e.position[0]-this.camera.position.x)<900&&Math.abs(e.position[2]-this.camera.position.z)<900).sort((a,b)=>new THREE.Vector3(...a.position).distanceToSquared(this.camera.position)-new THREE.Vector3(...b.position).distanceToSquared(this.camera.position)):[];
    this.lights.forEach((l,i)=>{const e=lamps[i];l.intensity=e?12:0;if(e){l.position.fromArray(e.position);l.distance=Math.min(700,Number(e.radius));const c=(e._color??'.65 .8 1').split(' ').map(Number);l.color.setRGB(...c);}});
    if(this.stage!==q.stage){
      this.stage=q.stage;
      const cue={security:'hack/evt_moon_hacker_open',buttons:'_sidequest/hacks/evt_correct_hack_00'}[q.stage];if(cue)a.cue(cue);
    }
    for(const [id,d]of Object.entries(q.diggers))if(this.diggers[id]!==d.phase){
      this.diggers[id]=d.phase;const event={moving:'start',digging:'breach'}[d.phase];
      if(q.elapsed>1&&event)a.mcomp(`digger_${DIGGERS[id].vox}${event}`);
      // play_digger_start_vox: a player answers 7 s later while on the Moon.
      if(d.phase==='moving'&&q.elapsed>1)this.pending.push({left:7,fn:()=>{if(this.features.s.area==='moon')a.vox('digger','incoming');}});
      if(d.phase==='moving')this.diggerTimer[id]=new Set();
    }
    // play_timer_vox: the start line again at 180 and 120 s left of the 240 s approach, then time_60 and time_30.
    for(const [id,d]of Object.entries(q.diggers)){const said=this.diggerTimer[id];if(d.phase!=='moving'||d.hacked||!said)continue;
      for(const [left,line] of [[180,'start'],[120,'start'],[60,'time_60'],[30,'time_30']])if(240-d.time<=left&&!said.has(left)){said.add(left);a.mcomp(`digger_${DIGGERS[id].vox}${line}`);}
    }
  }
}
