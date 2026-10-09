import * as THREE from 'three';

const V=a=>new THREE.Vector3(...a),SQ='moon/evt/zombie_moon/_sidequest/sq/',RAD=THREE.MathUtils.degToRad;
// MoveTo/RotateTo with acceleration and deceleration times: the fraction of the move done at t.
export function moveFraction(t,time,acc=0,dec=0){
  if(t<=0)return 0;if(t>=time)return 1;
  const v=1/(time-acc/2-dec/2);
  if(t<acc)return .5*v*t*t/acc;
  if(t>time-dec){const r=time-t;return 1-.5*v*r*r/dec;}
  return .5*v*acc+v*(t-acc);
}
// Game angles (pitch yaw roll) in port axes: Euler(roll, yaw, -pitch, 'YZX').
const euler=(e,[p,y,r])=>e.set(RAD(r),RAD(y),-RAD(p),'YZX');
// zombie_moon_sq_ctt.gsc add_tank / do_tank_fill / drain_tanks, zombie_moon_sq_sc.gsc wall_move and the client
// script's sam_rise_and_bob, bob_vg and zombie_release_soul, timed from the port's quest state.
export class MoonQuestProps {
  constructor(features){
    const f=this.f=features;this.trails=[];
    const one=n=>f.all(n)[0],flare=new THREE.TextureLoader().load('textures/fxt_light_flare2.png');
    this.trailMaterial=new THREE.SpriteMaterial({map:flare,color:0x67ffd8,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
    this.tanks=[one('sq_first_tank'),...f.all('sq_second_tank')].map(e=>{
      const cap=one(e.target),tube=one(cap.target),max=one(tube.target),object=f.objects.get(tube.id);
      // The fill spawns 56 above the lowered tube and climbs (max - base) / script_int per soul.
      const base=V(tube.position).y+56,capacity=Number(tube.script_int)||25;
      const capacitor=f.models.p_zom_moon_py_capacitor?f.spawnModel('p_zom_moon_py_capacitor',cap.position,cap.yaw??0):null;
      const fill=f.models.p_zom_moon_py_collector_fill?f.spawnModel('p_zom_moon_py_collector_fill',[tube.position[0],base,tube.position[2]]):null;
      return {e,cap,tube,object,origin:object?.position.clone()??V(tube.position),base,step:(V(max.position).y-base)/capacity,capacity,capacitor,fill,shown:0};
    });
    this.walls=f.all('sq_pyramid_walls').map(e=>{const object=f.objects.get(e.id);
      const retract=V(one('pyramid_walls_retract').position).add(new THREE.Vector3(0,48,0)),origin=object?.position.clone()??V(e.position);
      // wall_move: the direction is taken after the 4-unit drop.
      const dropped=origin.clone().add(new THREE.Vector3(0,-4,0));
      return {e,object,origin,dropped,away:retract.sub(dropped).normalize().multiplyScalar(200),angles:(e.script_angles??'0 0 0').split(' ').map(Number)};});
    const sam=one('sq_sam');this.sam={start:V(sam.position),end:V(one(sam.target).position)};
    // moon_keyhole: the glyph dial cap at struct_cover turns 180 in roll over 1 s when the release completes.
    const cap=one('struct_cover');this.cap=cap&&f.models.p_zom_moon_py_glyph_dial_cap?{angles:(cap.angles??'0 0 0').split(' ').map(Number),model:f.spawnModel('p_zom_moon_py_glyph_dial_cap',cap.position)}:null;
    // zombie_moon_sq_osc.gsc init: a lid over each covered button, closed at its struct angles and open at roll - 90.
    const osc=one('struct_sq_osc');this.osc={min:Number(osc?.script_wait_min??180),max:Number(osc?.script_wait_max??512),check:V(one('struct_rb_dist_check').position)};
    this.covers=f.all('struct_osc_button').map(e=>{const t=one(e.target),angles=(t.angles??'0 0 0').split(' ').map(Number);
      const lid=f.models.p_zom_moon_button_console_lid?f.spawnModel('p_zom_moon_button_console_lid',t.position):null;return {e,t,angles,lid,position:V(t.position)};});
    this.reset();
  }
  get q(){return this.f.quest;}
  get a(){return this.f.combat.audio;}
  reset(){
    for(const t of this.trails)t.sprite.removeFromParent();this.trails=[];this.fired=new Set();this.lidArmed=true;this.lidAt=null;this.lidVoxAt=null;this.lastOsc='start';
    for(const c of this.covers??[])if(c.lid)euler(c.lid.rotation,c.angles);
    for(const t of this.tanks){t.shown=0;t.seen=0;t.pending=[];t.cycle=null;if(t.object)t.object.position.copy(t.origin);if(t.capacitor)t.capacitor.visible=false;if(t.fill)t.fill.visible=false;}
    for(const w of this.walls)if(w.object){w.object.position.copy(w.origin);w.object.rotation.set(0,0,0);}
    for(const id of ['sam-loop',...this.tanks.map((t,i)=>'souls-full-'+i)])this.a.unloop?.(id);
  }
  once(key,fn){if(!this.fired.has(key)){this.fired.add(key);fn();}}
  cue(key,position){this.a.at?.(SQ+key,position,{distance:1500});}
  // The tanks used by a fill cycle: the first alone, then all four after the reveal.
  cycles(i){
    const q=this.q,list=[];
    if(i===0&&q.seatedAt!==null)list.push({raise:q.seatedAt+4,drain:q.switchAt,full:q.ctt1Full||q.switchAt!==null,count:0});
    if(q.armedAt!=null)list.push({raise:q.armedAt,drain:q.swappedAt,full:q.ctt2Full||q.swappedAt!==null,count:1});
    return list;
  }
  // zombie_release_soul: a trail from 24 above the corpse to 12 below the closest capacitor in 0.5 s.
  soul(from){
    const active=this.tanks.filter(t=>t.capacitor?.visible);if(!active.length)return;
    const start=V(from).add(new THREE.Vector3(0,24,0)),target=active.reduce((a,b)=>V(a.cap.position).distanceToSquared(start)<=V(b.cap.position).distanceToSquared(start)?a:b);
    const end=V(target.cap.position).add(new THREE.Vector3(0,-12,0)),sprite=new THREE.Sprite(this.trailMaterial);sprite.scale.setScalar(14);sprite.position.copy(start);this.f.scene.add(sprite);
    this.a.at?.(SQ+'rise/',start,{distance:1200});this.trails.push({sprite,start,end,age:0});
  }
  // moon_rb_dist_think: after the first tones puzzle and until security passes the lids close as the closest player
  // nears struct_rb_dist_check (2D, 512 open to 180 closed). Fully closed, rb_cover_sound plays evt_sq_rbs_close and the
  // computer line on every lid, then the closest player answers 0.5 s later; it re-arms 30 s after the line. Hacking the
  // covered button (moon_jolie_access) disarms it until a security timeout. Passing security opens the lids, and the
  // release buttons close them again.
  updateCovers(){
    const q=this.q,o=this.osc,a=this.a,now=q.elapsed;if(!this.covers.length)return;
    if(this.lastOsc!==q.osc){if(q.osc==='security')this.lidArmed=false;else if(this.lastOsc==='security'&&q.osc==='start')this.lidArmed=true;this.lastOsc=q.osc;}
    let scale=0;
    if(q.oscDone)scale=0;else if(q.osc==='buttons')scale=1;
    else if(q.simon1Done){const feet=this.f.player.getFeetPosition(),d=Math.min(o.max,Math.max(o.min,Math.hypot(feet.x-o.check.x,feet.z-o.check.z)));scale=(d-o.min)/(o.max-o.min);
      if(scale===0&&this.lidArmed&&this.lidAt===null){this.lidArmed=false;this.lidAt=now;
        for(const c of this.covers)a.at?.('moon/evt/wmd/base/lab_door_unlock',c.position,{distance:1000});
        a.mcompAt?.('quest_step3_0',this.covers.map(c=>c.position),()=>{this.lidVoxAt=q.elapsed+.5;this.lidAt=null;this.lidRearm=q.elapsed+30;});}}
    if(this.lidVoxAt!==null&&now>=this.lidVoxAt){this.lidVoxAt=null;a.vox?.('eggs','quest3',{variant:0});}
    if(this.lidRearm!=null&&now>=this.lidRearm&&q.osc!=='security'){this.lidRearm=null;this.lidArmed=true;}
    for(const c of this.covers)if(c.lid)euler(c.lid.rotation,[c.angles[0],c.angles[1],c.angles[2]-90*scale]);
  }
  // level.skit_vox_override: ordinary player lines are held back near the charge terminal and the MPD collectors and
  // during the scripted conversations; quest lines with override still play.
  updateSkit(){
    const q=this.q,now=q.elapsed,zone=this.f.qed?.zoneAt?.(this.f.player.getFeetPosition()),within=(t,s)=>t!=null&&now>=t&&now<t+s;
    const charge=q.chargeOpen&&!q.vgCharged&&(zone==='bridge_zone'||q.chargeTalking);
    const ctt1=q.seatedAt!=null&&now>=q.seatedAt+4&&q.switchAt==null&&zone==='generator_zone'||within(q.switchAt,10);
    const ctt2=q.armedAt!=null&&q.swappedAt==null&&zone==='generator_zone'||q.ctt2Full&&q.swappedAt==null||within(q.swappedAt,10);
    const story=q.swappedAt!=null&&now>=q.swappedAt+10&&now<q.swappedAt+50.9,ending=within(q.earthAt,22);
    this.a.skit=!!(charge||ctt1||ctt2||story||ending);
  }
  update(dt){
    const q=this.q,now=q.elapsed;
    for(const t of [...this.trails]){t.age+=dt;t.sprite.position.lerpVectors(t.start,t.end,Math.min(1,t.age/.5));
      if(t.age>=.5){t.sprite.removeFromParent();this.trails.splice(this.trails.indexOf(t),1);this.cue('evt_soul_impact',t.end);}}
    this.tanks.forEach((t,i)=>{
      const cycle=this.cycles(i).filter(c=>now>=c.raise).at(-1);
      if(!cycle){if(t.object)t.object.position.copy(t.origin);if(t.capacitor)t.capacitor.visible=false;if(t.fill)t.fill.visible=false;return;}
      const age=now-cycle.raise,drained=cycle.drain!=null?now-cycle.drain:-1,key=i+'-'+cycle.count;
      // add_tank: the tube rises 57.156 and the capacitor drops 18 into place over 1 s.
      this.once('up-'+key,()=>{this.cue('evt_tube_move_up',t.origin);});if(age>=1)this.once('upstop-'+key,()=>this.cue('evt_tube_stop',t.origin));
      // Drain: the fill sinks 65 in 1.5 s and hides at 2 s; then the tube sinks and the capacitor lifts 12 over 2 s.
      const lower=drained>=2?moveFraction(drained-2,2):0;
      if(t.object)t.object.position.copy(t.origin).setY(t.origin.y+57.156*moveFraction(age,1)*(1-lower));
      if(t.capacitor){t.capacitor.visible=drained<4;t.capacitor.position.copy(V(t.cap.position)).setY(t.cap.position[1]+18*(1-moveFraction(age,1))+12*lower);}
      // do_tank_fill: each soul raises the fill 0.5 s after the kill, when the trail lands.
      if(t.cycle!==key){t.cycle=key;t.shown=0;t.seen=0;t.pending=[];}
      const count=q.tanks[i]??0;if(count>t.seen)for(let n=t.seen;n<count;n++)t.pending.push(now+.5);t.seen=count;
      while(t.pending.length&&now>=t.pending[0]){t.pending.shift();t.shown++;}
      const level=drained>=0?t.capacity:Math.min(t.capacity,t.shown);
      if(t.fill){
        t.fill.visible=level>0&&drained<2;
        t.fill.position.y=t.base+level*t.step-(drained>=0?65*moveFraction(drained,1.5,.1,.1):0);
      }
      // evt_souls_full_loop once the tank holds its capacity, until the flush.
      const full=level>=t.capacity&&drained<0;if(full)this.a.loop?.('souls-full-'+i,SQ+'evt_souls_full_loop_l',{position:t.origin,distance:800});else this.a.unloop?.('souls-full-'+i);
      if(drained>=0)this.once('flush-'+key,()=>this.cue('evt_souls_flush',t.origin));
      if(drained>=2)this.once('down-'+key,()=>this.cue('evt_tube_move_down',t.origin));
      if(drained>=4)this.once('downstop-'+key,()=>this.cue('evt_tube_stop',t.origin));
    });
    // all_tanks_full: evt_souls_full once per cycle.
    if(q.ctt1Full)this.once('full-0',()=>this.a.sound?.(SQ+'evt_souls_full',{bus:'sfx'}));
    if(q.ctt2Full)this.once('full-1',()=>this.a.sound?.(SQ+'evt_souls_full',{bus:'sfx'}));
    // wall_move starts at first_tanks_drained (switch + 4 s): a 4-unit drop in 0.1 s, RotateTo script_angles in 3.5 s
    // (0.3/0.5 ease), then 200 units toward pyramid_walls_retract in 2 s.
    const walls=q.switchAt!=null?now-q.switchAt-4:-1;
    if(walls>=0)this.once('walls',()=>{if(this.f.qed?.zoneAt?.(this.f.player.getFeetPosition())==='generator_zone')this.a.sound?.('moon/evt/zombie_moon/pyramid_open',{bus:'sfx'});});
    for(const w of this.walls){
      if(!w.object)continue;
      if(walls<0){w.object.position.copy(w.origin);w.object.rotation.set(0,0,0);continue;}
      const turn=moveFraction(walls-.1,3.5,.3,.5);euler(w.object.rotation,w.angles.map(n=>n*turn));
      w.object.position.lerpVectors(w.origin,w.dropped,moveFraction(walls,.1,.01)).addScaledVector(w.away,moveFraction(walls-3.7,2,.1,.1));
    }
    // sam_rise_and_bob: at "sm" (rotation done) she rises to her target in 3 s, then bobs 7 units at 75 degrees/s.
    const sam=this.f.samantha,rise=walls-3.6;
    if(sam){
      sam.visible=rise>=0;
      if(rise>=0){
        this.once('sam',()=>this.a.loop?.('sam-loop',SQ+'evt_samantha_reveal_l',{position:this.sam.end,distance:1200}));
        sam.position.lerpVectors(this.sam.start,this.sam.end,Math.min(1,rise/3));
        if(rise>3)sam.position.y+=7*Math.sin(RAD(75*(rise-3)));
      }
    }
    this.updateCovers();this.updateSkit();
    if(this.cap){const t=q.oscDoneAt!=null?moveFraction(now-q.oscDoneAt,1):0,[p,y,r]=this.cap.angles;euler(this.cap.model.rotation,[p,y,r+180*t]);}
    // bob_vg: the placed Vril generator bobs 2 units at 100 degrees/s.
    const g=this.f.generator;if(g?.visible)g.position.y+=2*Math.sin(RAD(100*now));
  }
}
