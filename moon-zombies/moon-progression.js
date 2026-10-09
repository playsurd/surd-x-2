import { MOON_PERKS } from './moon-session.js';

const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export const LAUNCH={start:0,rockets:10,line:40,explode:70,earth:72};
// zombie_moon_sq_ctvg.gsc charge_init: Richtofen's presses per block, each followed by its exchange
// (rictofen = vox_plr_3_*, computer = vox_mcomp_*, maxis = vox_xcomp_*).
export const CHARGE=[[1,['rictofen','plr_3_quest_step5_12']],[15,['computer','mcomp_quest_step5_13'],['rictofen','plr_3_quest_step5_14']],
  [15,['computer','mcomp_quest_step5_15'],['maxis','xcomp_quest_step5_16'],['rictofen','plr_3_quest_step5_17']],[10,['maxis','xcomp_quest_step5_18'],['rictofen','plr_3_quest_step5_19']],
  [15,['maxis','xcomp_quest_step5_20'],['rictofen','plr_3_quest_step5_21'],['maxis','xcomp_quest_step5_22'],['rictofen','plr_3_quest_step5_23']],
  [10,['maxis','xcomp_quest_step5_24'],['rictofen','plr_3_quest_step5_25'],['computer','mcomp_quest_step5_26']]];
// zombie_moon_digger.gsc: digger_think_move zones and digger_think_panel triggers.
// Names follow each digger's console model: tunnel_console _pi, hangar_console _eps, biodome_console _omi (map ents 2714-2716).
export const DIGGERS = {
  teleporter:{name:'Pi',label:'Tunnel 6',zones:['cata_left_middle_zone','cata_left_start_zone'],cut:['airlock_west2_zone','cata_left_middle_zone','catacombs_west4'],switch:'teleporter_digger_switch',blocker:'digger_teleporter_blocker',damage:'digger_teleporter_dmg',rubble:'tunnel_6_destroyed',path:'digger_path_teleporter',down:-52,vox:''},
  hangar:{name:'Epsilon',label:'Tunnel 11',zones:['cata_right_start_zone','cata_right_middle_zone','cata_right_end_zone'],cut:['cata_right_start_zone','cata_right_middle_zone','tunnel_11_door1'],switch:'hangar_digger_switch',blocker:'digger_hangar_blocker',damage:'digger_hangar_dmg',rubble:'tunnel_11_destroyed',path:'hangar_vehicle_path',down:-45,vox:'1_'},
  biodome:{name:'Omicron',label:'Biodome',zones:['forest_zone'],switch:'biodome_digger_switch',path:'digger_path_biodome',down:-20,vox:'2_'},
};
// level.diggers_global_time, level.arm_move_speed and the 8 s smash delay.
export const DIGGER_TRAVEL=240,DIGGER_ARM=11,DIGGER_SMASH=8,DIGGER_LIFT=2;

// The state machine is independent of rendering. All quest locations and sphere
// path nodes come from the retained map entities, and timers stop when paused.
export class MoonProgression {
  constructor(data,session,notice=()=>{}){
    this.data=data;this.s=session;this.notice=notice;
    // Vehicle node chains; a hacked excavator reverses at half the 5 mph node speed (engine mph -> in/s).
    this.paths=Object.fromEntries(Object.entries(DIGGERS).map(([id,d])=>{const nodes=[];let n=data.entities.find(e=>e.targetname===d.path&&/vehicle_node/.test(e.classname));
      while(n&&!nodes.includes(n)){nodes.push(n);n=n.target&&data.entities.find(e=>e.targetname===n.target&&/vehicle_node/.test(e.classname));}
      let length=0;for(let i=1;i<nodes.length;i++)length+=distance(nodes[i].position,nodes[i-1].position);return [id,{nodes,length,returnSpeed:Number(nodes[0]?.speed??5)*17.6*.5}];}));
    this.reset();
  }
  all(name){return this.data.entities.filter(e=>e.targetname===name);}
  one(name){return this.all(name)[0];}
  reset(){
    this.stage='power';this.elapsed=0;this.stageTime=0;this.events=[];
    this.diggers=Object.fromEntries(Object.keys(DIGGERS).map(id=>[id,{phase:'idle',time:0,progress:0,arm:0,armFrom:0,left:0,hacked:false,breached:false,blocked:false}]));
    this.schedule={stage:'off',timer:20,rnd:0,last:1};
    this.breaches=new Set();this.history=[];this.security=new Set();this.buttons=new Set();
    this.simon=null;this.finalGame=0;this.rockets=0;this.launchSteps=new Set();
    this.sphereNode=null;this.spherePosition=null;this.sphereMoving=false;this.sphereWait=0;this.sphereBlocked=false;this.pull=null;this.lastArea=null;this.revealAt=null;this.musicAt=null;this.tanksArmed=false;
    this.plates='earth';this.wire=false;this.generator=false;this.charge={block:0,presses:0,line:-1,ready:false,terminal:'red'};this.tanks=[0,0,0,0];
    this.hackerId=this.all('zombie_equipment_upgrade').filter(e=>e.zombie_equipment_upgrade==='equip_hacker_zm')[Math.floor(this.s.random()*6)]?.id;
    const wires=this.all('sq_wire_pos');this.wireId=wires[Math.floor(this.s.random()*wires.length)]?.id;
    this.musicEggs=new Set();this.completed=false;
    this.simon1Done=false;this.osc='start';this.oscDone=false;this.be1='idle';this.seatedAt=null;this.ctt1Full=false;this.switchThrown=false;this.switchAt=null;this.armedAt=null;this.sphereHits=0;this.voiced=new Set();this.oscDoneAt=null;this.swapDone=false;this.earthAt=null;
    this.wirePlaced=false;this.vgPlaced=false;this.builtAt=null;this.vgCharged=false;this.ctt2Full=false;this.swappedAt=null;this.story=0;
    this.finalSimonDone=false;this.egg2='waiting';this.be2Done=false;
  }
  // The original runs sidequest_logic (sq), cassimir (ctvg), be and tanks as parallel threads. stage is the first
  // unfinished step in quest order; it only drives the objective, the journal and stage-local timers.
  deriveStage(){
    if(this.completed)return 'complete';
    if(!this.simon1Done)return this.s.power?'simon':'power';
    if(!this.oscDone)return {start:'security_start',security:'security',buttons:'buttons'}[this.osc];
    if(this.be1!=='seated')return this.be1==='active'?'sphere':'excavator';
    if(!this.ctt1Full)return 'tank';
    if(!this.switchThrown)return 'switch';
    if(this.plates!=='bench')return 'plates';
    if(!this.wirePlaced||!this.vgPlaced)return 'wire';
    if(!this.vgCharged)return 'charge';
    if(!this.ctt2Full)return 'tanks';
    if(this.swappedAt===null)return 'swap';
    if(!this.finalSimonDone)return 'final_simon';
    if(!this.be2Done)return this.egg2==='moved'?'final_gersh':'final_qed';
    return 'launch';
  }
  sync(){const stage=this.deriveStage();if(stage!==this.stage){this.history.push({stage:this.stage,time:this.elapsed});this.stage=stage;this.stageTime=0;}}
  // build_stage_logic -> charge: five seconds after the plates, wire and Vril generator are in place.
  get chargeOpen(){return this.builtAt!==null&&this.elapsed>=this.builtAt+5&&!this.vgCharged;}
  // tanks(): ctt1 starts 4 s after the sphere seats; ctt2 once the reveal is over, the Vril charged and Richtofen at the MPD.
  ctt1Active(){return this.be1==='seated'&&this.elapsed>=this.seatedAt+4&&!this.ctt1Full;}
  ctt2Active(){return this.switchThrown&&this.revealAt===null&&this.vgCharged&&this.tanksArmed&&!this.ctt2Full;}
  // create_and_play_dialog("eggs", "questN", undefined, variant, override) and direct PlaySound lines (moon-presentation.js).
  voice(cat,variant,{override=false,delay=0}={}){this.events.push({type:'voice',cat,variant,override,delay});}
  line(key,{position=null,delay=0}={}){this.events.push({type:'line',key,position,delay});}
  once(key,fn){if(!this.voiced.has(key)){this.voiced.add(key);fn();}}
  say(message){this.notice(message,7);this.sync();}
  // zombie_moon_sq_ss.gsc generate_sequence: random colours (0 red, 1 green, 2 blue, 3 yellow), never three in a row.
  simonSequence(n){
    const seq=Array.from({length:n},()=>Math.floor(this.s.random()*4));let last=-1,reps=0;
    // Re-rolling until the colour differs is a uniform pick among the other three.
    for(let i=0;i<n;i++){if(seq[i]!==last){last=seq[i];reps=0;}else if(++reps>=2){seq[i]=(last+1+Math.floor(this.s.random()*3))%4;reps=0;last=seq[i];}}
    return seq;
  }
  // ss_logic(6,1) opens the station; ss_logic(6,3), (7,4) and (8,5) are the launch codes.
  startSimon(final=false){
    const [len,start]=final?[[6,3],[7,4],[8,5]][this.finalGame]:[6,1];
    this.simon={len,start,final,seq:this.simonSequence(len),fails:0,step:start,input:[],phase:'wait',t:0,flash:null,tone:-1};
  }
  get sequence(){return this.simon?.seq??[];}
  get sequenceLength(){return this.simon?.step??0;}
  get sequenceInput(){return this.simon?.input.length??0;}
  // flag("displays_active") covers the attract sweep, the sequence and the fail/success flashes.
  simonActive(){return ['wait','attract','show','fail','win','done'].includes(this.simon?.phase);}
  simonAccepting(){return !!this.simon&&!this.simonActive();}
  // display_seq: earlier colours 0.5 s on and 0.2 s off, the newest 1.0 s on and 0.4 s off, on all four screens.
  simonShown(m){let t=m.t;for(let i=0;i<m.step;i++){const on=i<m.step-1?.5:1,off=i<m.step-1?.2:.4;if(t<on)return i;t-=on;if(t<off)return -1;t-=off;}return -1;}
  // The colour each terminal (script_int 0-3) shows, or -1 for the plain screen.
  simonScreens(){
    const m=this.simon,out=[-1,-1,-1,-1];if(!m)return out;
    if(m.phase==='attract'){const k=Math.floor(m.t/.6);if(k<8)out[k<4?k:7-k]=k<4?k:7-k;return out;}
    if(m.phase==='show'){const i=this.simonShown(m);return i<0?out:out.fill(m.seq[i]);}
    if(m.phase==='fail'||m.phase==='win')return m.t%.25<.2&&m.t<1.25?out.fill(m.phase==='fail'?0:1):out;
    if(m.flash)out[m.flash.color]=m.flash.color;return out;
  }
  // sq_ss_button_thread: presses count only while the displays are idle and flash that terminal for 0.3 s.
  pressSimon(color){
    const m=this.simon;if(!this.simonAccepting())return false;
    m.input.push(color);m.flash={color,t:.3};this.events.push({type:'simonTone',color});return true;
  }
  updateSimon(dt){
    const m=this.simon;if(!m)return;
    m.t+=dt;if(m.flash&&(m.flash.t-=dt)<=0)m.flash=null;
    const go=phase=>{m.phase=phase;m.t=0;m.tone=-1;};
    if(m.phase==='wait'&&m.t>=.5)go('attract');
    if(m.phase==='attract'){
      // do_attract: each terminal in turn for 0.6 s, the start line, back down, then 0.5 s.
      const k=Math.floor(m.t/.6);if(k<8&&k!==m.tone){m.tone=k;this.events.push({type:'simonTone',color:k<4?k:7-k});if(k===4)this.events.push({type:'simonVox',kind:'start'});}
      if(m.t>=5.3){m.step=m.start;m.input=[];go('show');}
    }
    if(m.phase==='show'){
      const i=this.simonShown(m);if(i>=0&&i!==m.tone){m.tone=i;this.events.push({type:'simonTone',color:m.seq[i]});}
      let total=0;for(let j=0;j<m.step;j++)total+=j<m.step-1?.7:1.4;if(m.t>=total)go('gap');
    }
    if(m.phase==='gap'&&m.t>=1)go('input');
    if(m.phase==='input'){
      // validate_input: a wrong colour or len*4 s without the full sequence fails the attempt.
      if(m.input.some((c,i)=>c!==m.seq[i])||m.t>=m.step*4){m.input=[];go('fail');this.events.push({type:'simonFail'});}
      else if(m.input.length>=m.step){m.input=[];go('gap2');}
    }
    if(m.phase==='gap2'&&m.t>=1){if(++m.step>m.len){go('win');this.events.push({type:'simonWin',seq:m.seq.slice()});}else{m.input=[];go('show');}}
    // ss_logic: four failures generate a new sequence; every retry starts again from the start length.
    if(m.phase==='fail'&&m.t>=1.25){if(++m.fails===4){m.seq=this.simonSequence(m.len);m.fails=0;}go('wait');}
    if(m.phase==='win'&&m.t>=1.25){
      if(!m.final){this.simon=null;this.simon1Done=true;this.say('Access granted. Find the Hacker in the laboratories.');}
      else go('done');
    }
    // do_ss2_logic: wait(2) and notify "rl" (rocket_raise) after each launch code.
    if(m.phase==='done'&&m.t>=2){
      this.events.push({type:'rocket',index:this.rockets++});
      if(++this.finalGame<3)this.startSimon(true);else{this.simon=null;this.finalSimonDone=true;this.say(this.be2Done?'Launch codes accepted.':'Launch codes accepted. Throw a QED at the sphere beside the MPD.');}
    }
  }
  startSecurity(){
    if(this.stage!=='security_start'||!this.s.hacker)return false;this.osc='security';
    const choices=this.all('struct_osc_st').slice();
    for(let i=choices.length-1;i>0;i--){const j=Math.floor(this.s.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}
    this.securityTargets=choices.slice(0,4).map(e=>e.id);this.security.clear();this.securityVox=new Set();this.events.push({type:'coverLine',mcomp:'quest_step3_1',cat:'quest3',variant:9});
    this.say('Hack the four green laboratory terminals within 70 seconds.');return true;
  }
  hackSecurity(id){
    if(this.stage!=='security'||!this.s.hacker||!this.securityTargets.includes(id)||this.security.has(id))return false;
    this.security.add(id);
    if(this.security.size<4)this.voice('quest3',this.s.random()<.5?10:11);
    else this.events.push({type:'coverLine',mcomp:'quest_step5_26',cat:'quest3',variant:12});
    if(this.security.size===4){this.buttons.clear();this.osc='buttons';this.say('Press all four laboratory buttons within 3.5 seconds.');}
    return true;
  }
  pressButton(id){
    if(this.stage!=='buttons'||this.buttons.has(id))return false;
    if(!this.buttons.size)this.stageTime=0;
    this.buttons.add(id);
    if(this.buttons.size===4){this.oscDone=true;this.oscDoneAt=this.elapsed;this.say(this.be1==='idle'?'Security released. Allow excavator Pi to breach Tunnel 6, then hack its console in Receiving Bay.':'Security released.');}
    return true;
  }
  activateDigger(id){
    const d=this.diggers[id];if(!d||d.phase!=='idle')return false;
    Object.assign(d,{phase:'moving',time:0,progress:0,arm:0,hacked:false,left:DIGGER_TRAVEL+DIGGER_SMASH});this.events.push({type:'start',id});
    this.notice(`Warning: excavator ${DIGGERS[id].name} is approaching ${DIGGERS[id].label}. Hack its Receiving Bay console to stop it.`,10);return true;
  }
  // digger_round_logic: random choice among excavators whose start flag is clear.
  activateRandom(){const choices=Object.keys(DIGGERS).filter(id=>this.diggers[id].phase==='idle');return choices.length?this.activateDigger(choices[Math.floor(this.s.random()*choices.length)]):false;}
  get diggerMoving(){return Object.values(this.diggers).some(d=>d.phase==='moving');}
  hackable(id){const d=this.diggers[id];return !!d&&!d.hacked&&['moving','arm','digging'].includes(d.phase);}
  hackDigger(id){
    if(!this.s.hacker||!this.removeDigger(id))return false;
    this.events.push({type:'diggerHacked',id});this.notice(`Excavator ${DIGGERS[id].name} retracting.`,6);return true;
  }
  // flag_set("<name>_digger_hacked"); the QED's remove_digger result sets it without the hacker reward.
  removeDigger(id){
    const d=this.diggers[id];if(!this.hackable(id))return false;
    d.hacked=true;d.hackedBeforeBreach=!d.breached;this.events.push({type:'hacked',id});
    if(d.phase==='moving'){d.phase='returning';d.time=0;}else{d.phase='raising';d.time=0;d.armFrom=d.arm;}
    return true;
  }
  // between_round_over on the Moon; skip mirrors flag("teleporter_used").
  roundOver(skip=false){
    const sc=this.schedule,roll=()=>Math.floor(this.s.random()*100);if(skip||!['first','main'].includes(sc.stage))return;
    if(sc.stage==='first'){if(roll()>=90||sc.rnd>2){this.activateRandom();sc.last=this.s.round;sc.stage='main';}sc.rnd++;return;}
    if(this.diggerMoving)return;
    const diff=Math.abs(this.s.round-sc.last),min=this.s.round<10?3:2;
    if(diff>=min&&diff<8){if(roll()>=80){this.activateRandom();sc.last=this.s.round;}}
    else if(diff>=8){this.activateRandom();sc.last=this.s.round;}
  }
  updateDiggers(dt){
    const sc=this.schedule;
    if(sc.stage==='off'&&this.s.power)sc.stage='wait';
    if(sc.stage==='wait'&&(sc.timer-=dt)<=0){sc.last=this.s.round;if(Math.floor(this.s.random()*100)>=90){this.activateRandom();sc.stage='main';}else sc.stage='first';}
    const ease=t=>t<.25?8*t*t/3:t>.75?1-8*(1-t)*(1-t)/3:(4*t-.5)/3;
    for(const [id,d] of Object.entries(this.diggers)){
      if(d.phase==='idle')continue;d.time+=dt;
      if(d.phase==='moving'){d.progress=Math.min(1,d.time/DIGGER_TRAVEL);d.left=DIGGER_TRAVEL+DIGGER_SMASH-d.time;if(d.progress===1){d.phase='arm';d.time=0;this.events.push({type:'arm',id});}}
      if(d.phase==='arm'){d.arm=ease(Math.min(1,d.time/DIGGER_ARM));d.left=Math.max(0,DIGGER_SMASH-d.time);if(!d.smashed&&d.time>=DIGGER_SMASH)this.smash(id);if(d.time>=DIGGER_ARM){d.phase='digging';d.time=0;}}
      if(d.phase==='raising'){d.arm=d.armFrom*(1-ease(Math.min(1,d.time/DIGGER_ARM)));if(d.blocked&&d.time>=DIGGER_LIFT)this.lift(id);if(d.time>=DIGGER_ARM){d.phase='returning';d.time=0;d.smashed=false;}}
      if(d.phase==='returning'){d.progress=Math.max(0,d.progress-dt*this.paths[id].returnSpeed/Math.max(1,this.paths[id].length));if(!d.progress){d.phase='idle';d.hacked=false;d.time=0;}}
    }
  }
  smash(id){
    const d=this.diggers[id],D=DIGGERS[id];d.smashed=true;d.breached=true;if(D.blocker)d.blocked=true;
    for(const zone of D.zones)this.breaches.add(zone);this.events.push({type:'smash',id});
    this.notice(`${D.label} breached by excavator ${D.name}. Oxygen lost. Hack its Receiving Bay console to retract it.`,10);
  }
  lift(id){this.diggers[id].blocked=false;this.events.push({type:'lift',id});this.checkSphere();}
  checkSphere(){
    // zombie_moon_sq_be.gsc moon_be_start_capture: teleporter_breached and not teleporter_blocked.
    if(this.be1==='idle'&&this.diggers.teleporter.breached&&!this.diggers.teleporter.blocked){
      this.sphereNode=this.one('vs_stage_1a');this.spherePosition=this.sphereNode.position.slice();this.be1='active';
      this.say('The Vril Sphere is in Tunnel 6. Strike it with your knife and follow it.');
    }
  }
  motivateSphere(cause){
    if(this.be1!=='active'||this.sphereMoving||this.sphereWait>0)return false;
    // moon_be_move checks the node's list and then the damage type against struct_motivation's full list, so any
    // melee, bullet, grenade or explosive hit moves the sphere at any stop; the "zap" stop wants the Wave Gun.
    if(this.sphereNode.script_string==='zap'?cause!=='wave':!['melee','bullet','grenade','explosion'].includes(cause))return false;
    this.events.push({type:'sphere',sound:'activate'});this.sphereMoving=true;this.sphereWait=.05;
    const hits=++this.sphereHits;this.voice('quest2',hits>4?hits-4:hits);return true;
  }
  updateSphere(dt){
    if(this.be1!=='active'||!this.sphereMoving)return;
    this.sphereWait=Math.max(0,this.sphereWait-dt);if(this.sphereWait)return;
    // script_hidden flag_wait_for_osc: the last node holds the sphere until security is complete.
    if(this.sphereNode.script_hidden==='flag_wait_for_osc'&&!(this.oscDone&&(this.oscDoneAt===null||this.elapsed>=this.oscDoneAt+1)))return;
    // A sliding_door node holds the sphere until the closest door or airlock (2D) is open.
    if(this.sphereNode.script_waittill==='sliding_door'&&this.slidingDoorOpen?.(this.sphereNode.position)===false){if(!this.sphereBlocked){this.sphereBlocked=true;this.events.push({type:'sphere',sound:'wait'});this.voice('quest2',5);}return;}
    if(this.sphereBlocked){this.sphereBlocked=false;this.events.push({type:'sphere',sound:'accel'});}
    const next=this.one(this.sphereNode.target??this.sphereNode.script_parameters);
    if(!next){this.sphereMoving=false;return;}
    // level._my_speed is 12 mph (17.6 units per second each).
    const d=distance(this.spherePosition,next.position),step=dt*12*17.6;
    if(d>step){this.spherePosition=this.spherePosition.map((v,i)=>v+(next.position[i]-v)*step/d);return;}
    this.spherePosition=next.position.slice();this.sphereNode=next;if(next.script_sound)this.events.push({type:'sphere',sound:'bounce'});
    if(next.script_flag==='complete_be_1'){
      this.sphereMoving=false;this.tanks=[0,0,0,0];this.be1='seated';this.seatedAt=this.elapsed;this.voice('quest2',6);this.say('The sphere is seated. Kill 25 zombies near the first MPD soul collector.');
    }else if(next.script_string){this.sphereMoving=false;this.events.push({type:'sphere',sound:'stop'});this.notice(next.script_string==='zap'?'The sphere is above Receiving Bay. Shoot it with the Wave Gun.':'The sphere has stopped. Knife, shoot or blast it to continue.');}
  }
  // ctt2 stage_logic: the four collectors open only once Richtofen (the solo player) is within 240 of sq_vg_final.
  playerAt(position){
    if(this.switchThrown&&this.revealAt===null&&this.vgCharged&&!this.tanksArmed&&distance(position,this.one('sq_vg_final').position)<240){
      this.tanksArmed=true;this.armedAt=this.elapsed;this.events.push({type:'tanksArmed'});this.line('plr3/vox_plr_3_quest_step6_0');}
    if(this.be1!=='idle'&&this.spherePosition&&distance(position,this.spherePosition)<=250)this.once('sphere-near',()=>this.voice('quest2',0));
    if(this.egg2==='seated'&&this.swappedAt!==null&&this.elapsed>=this.swappedAt+32&&this.spherePosition&&distance(position,this.spherePosition)<=250)this.once('egg2-near',()=>this.voice('quest8',0));
  }
  kill(position,kind,cause){
    const first=this.ctt1Active(),count=first?1:this.ctt2Active()?4:0;if(!count||kind==='astronaut'||kind==='dog')return null;
    const tanks=[this.one('sq_first_tank'),...this.all('sq_second_tank')];
    for(let i=0;i<count;i++)if(this.tanks[i]<25&&Math.abs(position[1]-tanks[i].position[1])<110&&Math.hypot(position[0]-tanks[i].position[0],position[2]-tanks[i].position[2])<=225){
      this.tanks[i]++;
      // do_tank_fill fills 0.5 s after the death; the vox threads react to the fill.
      if(first&&this.tanks[0]===1)this.voice('quest4',0,{override:true,delay:.5});
      if(first&&this.tanks[0]===13)this.voice('quest4',1,{override:true,delay:.5});
      if(!first){const souls=this.tanks.reduce((a,b)=>a+b,0),at=[10,20,30,40,50,60,70,90].indexOf(souls);
        if(at>=0)this.line('plr4/vox_plr_4_quest_step6_'+['1','1a','2','2a','3','3a','4','5'][at],{position:this.one(this.one('sq_sam').target).position,delay:.5});}
      if(this.tanks.slice(0,count).every(n=>n>=25)){if(first){this.ctt1Full=true;this.voice('quest4',2,{override:true,delay:.5});}else{this.ctt2Full=true;this.events.push({type:'samSequence',delay:.5});}this.say(first?'Collector charged. Use the switch beside the pyramid.':'All four collectors charged. Insert the charged Vril Device into the MPD.');}
      return tanks[i].position;
    }
    return null;
  }
  useSwitch(){
    if(!this.ctt1Full||this.switchThrown)return false;this.switchThrown=true;this.switchAt=this.elapsed;this.tanks=[0,0,0,0];
    // The flush (2 s) and lowered tubes (2 s) set first_tanks_drained; the pyramid walls open (3.7 s) to walls_down,
    // and 1 s later room_sweeper gives each valid player a 90 s Death Machine.
    this.revealAt=this.elapsed+8.7;this.musicAt=this.elapsed+5.5;
    this.say(this.plates==='bench'?'Cryogenic Slumber Party.':'Cryogenic Slumber Party. Recover the plates from the shelf in Area 51 with a grenade, then a Gersh Device.');return true;
  }
  blast(position,cause){
    if(this.be1==='active'&&this.spherePosition&&distance(position,this.spherePosition)<250)this.motivateSphere(cause);
    const plates=this.one('sq_cassimir_plates').position,be2=this.one('be2_pos').position;
    // bhb_teleport_loc_check: a Gersh that lands in the 125 x 100 trigger 70 below its target is consumed by the quest.
    const gershTrigger=t=>Math.hypot(position[0]-t[0],position[2]-t[2])<=125&&position[1]-t[1]>=-70&&position[1]-t[1]<=30;
    // ctvg plates(): the trigger_damage under the plates takes player projectile, explosive and grenade damage, splash included.
    if(this.plates==='earth'&&['grenade','explosion'].includes(cause)&&distance(position,plates)<300){this.plates='loose';this.voice('quest5',this.s.random()<.5?0:1,{override:true});this.notice('Plates dislodged. Throw a Gersh Device beside them.');return true;}
    if(this.plates==='loose'&&cause==='gersh'&&!this.pull&&gershTrigger(plates)){this.plates='pulled';this.pull={t:0,target:'plates'};return true;}
    // ctvg_validation: a QED within 128 of the plates at sq_ctvg_tp2.
    if(this.plates==='receiving'&&cause==='qed'&&distance(position,this.one('sq_ctvg_tp2').position)<128){this.plates='bench';this.voice('quest5',this.s.random()<.5?4:5,{override:true});this.say(this.wire?'Plates assembled. Connect the wire beside the Receiving Bay terminal.':'Plates assembled. Find the wire in the laboratories.');return true;}
    // be2_validation: a QED within 164 of the seated sphere moves it to be2_pos.
    if(this.egg2==='seated'&&cause==='qed'&&this.spherePosition&&distance(position,this.spherePosition)<164){this.spherePosition=be2.slice();this.egg2='moved';this.say('The sphere returned to the computers. Throw a Gersh Device beside it.');return true;}
    if(this.egg2==='moved'&&cause==='gersh'&&!this.pull&&gershTrigger(be2)){this.pull={t:0,target:'sphere',from:this.spherePosition?.slice()??be2.slice(),to:[position[0],position[1]+50,position[2]]};return true;}
    return false;
  }
  // teleport_target: a 1 s pause, a 3 s pull into the hole, the target vanishes, and 3 s later the step completes.
  updatePull(dt){
    const p=this.pull;if(!p)return;p.t+=dt;
    if(p.target==='sphere'&&p.t>=1&&p.t<4)this.spherePosition=p.from.map((v,i)=>v+(p.to[i]-v)*(p.t-1)/3);
    if(p.t>=4&&!p.gone){p.gone=true;if(p.target==='sphere')this.spherePosition=null;this.events.push({type:'pulled',target:p.target});}
    if(p.t<7)return;this.pull=null;
    if(p.target==='plates'){this.plates='away';this.notice('The plates were pulled away. Leave No Man’s Land to bring them to Receiving Bay.');}
    else{this.be2Done=true;this.egg2='done';this.voice('quest8',2);this.say(this.finalSimonDone?'Missiles armed. Stand by for launch.':'The sphere is gone. Finish the launch codes at the color computers.');}
  }
  takeWire(id){if(id!==this.wireId||this.wire)return false;this.wire=true;this.events.push({type:'wireTaken'});this.voice('quest5',7,{override:true});this.say(this.plates==='bench'?'Wire recovered. Connect it beside the Receiving Bay terminal.':'Wire recovered.');return true;}
  // wire(): once the plates are built (c_built), the wire is placed at sq_wire_final.
  placeWire(){if(!this.wire||this.wirePlaced||this.plates!=='bench')return false;this.wirePlaced=true;this.events.push({type:'wirePlaced'});this.voice('quest5',8,{override:true});this.say('Wire connected. Place the Vril generator at the terminal.');return true;}
  // vg(): with the wire placed and the power on, the generator is placed at sq_charge_vg_pos.
  placeVg(){if(!this.wirePlaced||this.vgPlaced||!this.s.power)return false;this.vgPlaced=true;this.builtAt=this.elapsed;this.events.push({type:'vgPlaced'});this.voice('quest5',9,{override:true});this.say('Vril generator connected. The terminal will be ready to charge it shortly.');return true;}
  // charge_stage_logic: do_bucket_fill counts separate presses, then speak_charge_lines plays each line to its end.
  get chargeTalking(){return this.chargeOpen&&this.charge.line>=0;}
  pressCharge(){
    const c=this.charge;if(!this.chargeOpen||c.line>=0||c.ready)return false;
    this.events.push({type:'chargeTyping'});
    if(++c.presses>=CHARGE[c.block][0]){c.line=0;this.chargeLine();}
    return true;
  }
  chargeLine(){
    const c=this.charge,[who,what]=CHARGE[c.block][c.line+1];
    // The terminal turns green on vox_mcomp_quest_step5_15 and _26, and red on vox_xcomp_quest_step5_16.
    if(what==='mcomp_quest_step5_15'||what==='mcomp_quest_step5_26')c.terminal='green';else if(what==='xcomp_quest_step5_16')c.terminal='red';
    this.events.push({type:'chargeLine',who,what});
  }
  chargeLineDone(){
    const c=this.charge;if(!this.chargeTalking)return false;
    if(++c.line<CHARGE[c.block].length-1){this.chargeLine();return true;}
    c.line=-1;c.presses=0;
    if(++c.block===CHARGE.length){c.ready=true;this.events.push({type:'chargeReady'});this.notice('Vril Device charged. Take it from the terminal.');}
    return true;
  }
  // The charged generator waits at sq_charge_vg_pos until Richtofen collects it.
  collectCharge(){
    if(!this.chargeOpen||!this.charge.ready)return false;
    this.generator=true;this.vgCharged=true;this.events.push({type:'chargeCollected'});this.voice('quest5',27,{override:true});
    this.say('Vril Device collected. Bring it to the MPD and fill all four collectors with 25 souls each.');return true;
  }
  swap(){
    if(!this.ctt2Full||this.swappedAt!==null)return false;
    this.swappedAt=this.elapsed;this.say('Vril Device placed. The collectors drain into the MPD.');return true;
  }
  soulSwap(){
    this.swapDone=true;this.s.permanentPerks=true;this.s.perks=new Set(Object.keys(MOON_PERKS));this.s.health=this.s.maxHealth;
    this.say('Soul exchange complete. All eight perks are permanent.');
  }
  update(dt){
    this.elapsed+=dt;this.stageTime+=dt;
    if(this.s.power&&!this.simon1Done&&!this.simon){this.startSimon();this.say('Power restored. Repeat the flashing sequence at the four computers outside Receiving Bay.');}
    if(this.stage==='security'){
      for(const [left,n] of [[50,2],[40,3],[30,4],[20,5],[10,6],[5,7]])if(this.stageTime>=70-left&&!this.securityVox.has(n)){this.securityVox.add(n);
        const lit=this.securityTargets.filter(id=>!this.security.has(id)).map(id=>this.one(this.data.entities[id].target)?.position).filter(Boolean);
        if(lit.length)this.events.push({type:'mcompAt',alias:'quest_step3_'+n,positions:lit});}
    }
    if(this.stage==='security'&&this.stageTime>70){this.security.clear();this.osc='start';this.say('Security timed out. Hack a laboratory button to try again.');}
    if(this.swappedAt!==null){
      const t=this.elapsed-this.swappedAt;
      if(t>=4&&!this.swapDone)this.soulSwap();
      if(t>=5)this.once('sam-response',()=>this.line('plr4/vox_plr_4_quest_step6_12'));
      if(t>=7&&this.egg2==='waiting'&&this.be1==='seated')this.egg2='seated';
      const story=[[10,'plr_3_quest_step6_9'],[15.25,'plr_3_quest_step6_11'],[36.9,'xcomp_quest_step6_14']];
      while(this.story<3&&t>=story[this.story][0])this.events.push({type:'story',line:story[this.story++][1]});
      if(this.story===3&&t>=50.9&&!this.simon&&!this.finalSimonDone&&this.finalGame===0){this.startSimon(true);this.say('Return to the color computers for three final sequences.');}
    }
    if(this.switchAt!==null&&this.elapsed>=this.switchAt+12)this.once('reveal-vox',()=>this.voice('quest4',3,{override:true}));
    if(this.stage==='buttons'&&this.buttons.size&&this.stageTime>3.5){this.buttons.clear();this.notice('Button window missed. Press all four again.');}
    this.updateSimon(dt);this.updateDiggers(dt);this.checkSphere();this.updatePull(dt);
    // reveal_music starts 1.5 s after the walls begin to move, 4 s after the switch.
    if(this.musicAt!==null&&this.elapsed>=this.musicAt){this.musicAt=null;this.events.push({type:'samMusic'});}
    if(this.revealAt!==null&&this.elapsed>=this.revealAt&&!this.s.lastStand){this.revealAt=null;this.s.effects.death_machine=this.s.time+90;this.events.push({type:'reveal'});}
    // ctvg: once pulled away, the plates wait for restart_round, which leaving No Man's Land sends.
    if(this.s.area!==this.lastArea){if(this.lastArea==='earth'&&this.s.area==='moon'&&this.plates==='away'){this.plates='receiving';this.notice('Plates transferred to Receiving Bay. Throw a QED beside them.');}this.lastArea=this.s.area;}
    this.updateSphere(dt);
    // zombie_moon_sq.gsc do_launch: Maxis step8_4, 10 s to "rl" (the rockets launch), 30 s to step8_5, 30 s to
    // evt_earth_explode and the "dte" flash, then 2 s to the destroyed Earth ("SDE") and the laugh.
    if(this.earthAt!==null){const t=this.elapsed-this.earthAt;if(t>=12)this.once('end-9',()=>this.voice('quest8',9,{override:true}));if(t>=17)this.once('end-10',()=>this.voice('quest8',10,{override:true}));}
    this.sync();
    if(this.stage==='launch'){
      for(const [step,at] of Object.entries(LAUNCH))if(this.stageTime>=at&&!this.launchSteps.has(step)){this.launchSteps.add(step);this.events.push({type:'launch',step});if(step==='earth'){this.earthAt=this.elapsed;this.voice('quest8',7,{override:true});}}
      if(this.stageTime>=LAUNCH.earth){this.completed=true;this.say('Big Bang Theory complete. Earth is destroyed. Continue surviving with permanent perks.');}
    }
  }
  objective(){
    const goals={power:'Restore power in the MPD room.',simon:'Repeat the six-color sequence outside Receiving Bay.',security_start:'Find the Hacker; hack a laboratory button (500 points).',security:`Hack the four green terminals: ${this.security.size}/4 · ${Math.max(0,Math.ceil(70-this.stageTime))}s`,buttons:`Press the four laboratory buttons: ${this.buttons.size}/4`,excavator:'Let Pi breach Tunnel 6, then hack its Receiving Bay console.',sphere:this.sphereNode?.script_string==='zap'?'Shoot the sphere above Receiving Bay with the Wave Gun.':'Follow the Vril Sphere through the tunnels to the MPD.',tank:`Fill the first MPD collector: ${this.tanks[0]}/25 souls.`,switch:'Use the switch beside the MPD.',plates:this.plates==='earth'?'Grenade the Area 51 plates on the shelf.':this.plates==='loose'?'Throw a Gersh Device beside the Area 51 plates.':'Throw a QED beside the plates in Receiving Bay.',wire:!this.wire?'Find the wire in the laboratories.':!this.wirePlaced?'Connect the wire beside the Receiving Bay terminal.':this.s.power?'Place the Vril generator at the Receiving Bay terminal.':'Restore power, then place the Vril generator.',charge:!this.chargeOpen?'The Receiving Bay terminal is preparing the charge.':this.charge.ready?'Take the charged Vril Device from the Receiving Bay terminal.':`Press the Receiving Bay terminal to charge the Vril Device: ${this.charge.block}/6`,tanks:`Fill the four MPD collectors: ${this.tanks.map(n=>n+'/25').join(' · ')}`,swap:'Insert the charged Vril Device into the MPD.',final_simon:this.simon?`Repeat the final color sequences: ${this.finalGame+1}/3`:'Listen to Maxis, then return to the color computers.',final_qed:'Throw a QED beside the sphere at the MPD.',final_gersh:'Throw a Gersh Device beside the sphere at the color computers.',launch:'Missiles launching. Watch Earth.',complete:'Big Bang Theory complete. Survive as long as you can.'};
    return goals[this.stage];
  }
  snapshot(){return {stage:this.stage,objective:this.objective(),completed:this.completed,elapsed:this.elapsed,diggers:structuredClone(this.diggers),breaches:[...this.breaches],tanks:this.tanks.slice(),plates:this.plates,wire:this.wire,charge:this.charge,sequence:this.sequence.slice(),sequenceLength:this.sequenceLength,sequenceInput:this.sequenceInput,spherePosition:this.spherePosition?.slice(),sphereNode:this.sphereNode?.id,security:[...this.security],securityTargets:this.securityTargets,branches:{simon1Done:this.simon1Done,oscDone:this.oscDone,be1:this.be1,ctt1Full:this.ctt1Full,switchThrown:this.switchThrown,wirePlaced:this.wirePlaced,vgPlaced:this.vgPlaced,vgCharged:this.vgCharged,ctt2Full:this.ctt2Full,swapped:this.swappedAt!==null,finalSimonDone:this.finalSimonDone,egg2:this.egg2,be2Done:this.be2Done}};}
}
