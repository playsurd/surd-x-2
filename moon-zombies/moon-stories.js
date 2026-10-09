import * as THREE from 'three';

const V=a=>new THREE.Vector3(...a),VOX='moon/vox/scripted/zombie_moon/radios/';
// zombie_moon_sq_datalogs.gsc: six reels in order, each held at the reel-to-reel player for its delay.
export const DATALOGS=[['vox_story_2_log_1',40],['vox_story_2_log_2',28],['vox_story_2_log_3',29],['vox_story_2_log_4',52],['vox_story_2_log_5',37],['vox_story_2_log_6',138]];
// zombie_moon_amb.gsc radio_setup: the nth radio used plays vox_story_1_log_n for its wait time.
export const RADIO_WAIT=[78,125,164,62,124];

export class MoonStories {
  constructor(features){this.f=features;this.reel=null;}
  get s(){return this.f.s;}
  reset(){
    const f=this.f;this.log=0;this.carrying=false;this.playing=null;this.radios=new Set();this.radioCount=0;
    this.locations=f.all('sq_datalog').slice();this.spawnReel();
  }
  random(n){return Math.floor(this.s.random()*n);}
  // datalog_locs = array_randomize(...)[0]; a used location is removed before the next reel.
  spawnReel(){
    this.reel?.removeFromParent();this.reel=null;this.location=null;
    if(this.log>=DATALOGS.length||!this.locations.length)return;
    this.location=this.locations[this.random(this.locations.length)];
    if(!this.f.models.p_glo_data_recorder01_static_reel)return;
    // Game angles (pitch yaw roll) become R = Rz(yaw)Ry(pitch)Rx(roll); in port axes (x,z,-y) that is Euler(roll,yaw,-pitch,'YZX').
    const [pitch,yaw,roll]=(this.location.angles??'0 0 0').split(' ').map(n=>THREE.MathUtils.degToRad(Number(n)));
    this.reel=this.f.spawnModel('p_glo_data_recorder01_static_reel',this.location.position);this.reel.rotation.set(roll,yaw,-pitch,'YZX');
  }
  // checkfor_radio_override: a "window" radio only plays once a pane within 50 units is broken (damage_state 1).
  radioAllowed(e){
    if(!e.script_noteworthy)return true;
    return this.f.glass.some(g=>g.broken&&g.fx.some(p=>p.distanceTo(V(e.position))<50));
  }
  describe(t){
    if(t.kind==='sq_datalog')return t.e===this.location&&!this.carrying?'Pick up reel':'';
    if(t.kind==='sq_reel_to_reel')return this.carrying&&!this.playing?'Play reel':'';
    // play_radio_eastereggs runs once per radio, independently of the others.
    if(t.kind==='egg_radios')return this.radios.has(t.e.id)?'':'Use radio';
    return undefined;
  }
  interact(t){
    if(t.kind==='sq_datalog'&&t.e===this.location&&!this.carrying){this.carrying=true;this.reel?.removeFromParent();this.reel=null;return true;}
    if(t.kind==='sq_reel_to_reel'&&this.carrying&&!this.playing){
      this.carrying=false;const [line,delay]=DATALOGS[this.log];this.playing={left:delay};this.play(line,t.e.position);return true;
    }
    if(t.kind==='egg_radios'&&!this.radios.has(t.e.id)&&this.radioAllowed(t.e)){
      this.radios.add(t.e.id);const n=++this.radioCount;this.play('vox_story_1_log_'+n,t.e.position);return true;
    }
    return false;
  }
  play(line,position){
    // sound_ent playsound at the player or radio. vox_radio_egg_snapshot streams
    // zombie_temple/radios/vox_radio_snapshot_l.wav, which no shipped archive contains.
    this.f.combat.audio.at?.(VOX+line,V(position),{bus:'vox',distance:2000});
  }
  update(dt){
    if(this.playing&&(this.playing.left-=dt)<=0){this.playing=null;this.log++;this.locations=this.locations.filter(e=>e!==this.location);this.spawnReel();}
  }
}
