import * as THREE from 'three';

const V=a=>new THREE.Vector3(...a),G='moon/evt/zombie_global/',MUS='moon/mus/zombie/perksacola/',rand=(a,b)=>a+Math.random()*(b-a);
// Machine sound aliases from common_zombie.ff.
const SOUND={hum:G+'perksacola/hum/hum_loop_l',packHum:G+'perksacola/hum/packa_loop_l',powerOn:G+'perksacola/power_on/power_on',
  surge:G+'switch/surge/',broken:G+'perksacola/random/',dispense:G+'perksacola/bottle/dispensemn_00',perkDeny:G+'perksacola/bottle/deny_00',
  upgrade:G+'pap/upgrade',ready:G+'pap/ready',ticktock:G+'pap/loop_l',packDeny:G+'pap/deny'};
// mus_perks_<name>_sting / _jingle aliases point at mus_<name>_sting.wav / _jingle.wav.
const music=alias=>alias&&MUS+alias.replace('mus_perks_packa','mus_packapunch').replace('mus_perks_','mus_');

// _zombiemode_perks.gsc vending_trigger_think / vending_weapon_upgrade and _zombiemode_audio.gsc perks_a_cola_jingle_timer.
export class MoonMachineAudio {
  constructor(features){this.f=features;this.machines=[];this.pack=null;}
  get a(){return this.f.combat.audio;}
  get s(){return this.f.s;}
  build(){
    const f=this.f;
    this.machines=f.all('zombie_vending').map(e=>({e,perk:e.script_noteworthy,label:e.script_label??null,jingle:e.script_sound??null,position:V(e.position)}));
    // place_additionalprimaryweapon_machine spawns Mule Kick without a script_label or script_sound.
    if(f.muleVending)this.machines.push({e:f.muleVending,perk:f.muleVending.script_noteworthy,label:null,jingle:null,position:V(f.muleVending.position)});
    const pack=f.one('zombie_vending_upgrade');this.pack=pack?{e:pack,position:V(pack.position)}:null;
    this.reset();
  }
  reset(){
    for(const [i,m] of this.machines.entries()){this.a.unloop?.('perk-hum-'+i);Object.assign(m,{on:false,playing:0,jingleAt:0,brokenAt:0});}
    this.a.unloop?.('pack-hum');this.a.unloop?.('pack-tick');this.packOn=false;this.packStep=null;
  }
  // Solo Quick Revive never waits for power; no_mans_land_power powers Area 51's Juggernog, Speed Cola and Pack-a-Punch at load.
  powered(m){return m.perk==='specialty_quickrevive'||m.position.x>10000||this.s.power;}
  find(perk){return this.machines.find(m=>m.perk===perk&&(perk!=='specialty_armorvest'&&perk!=='specialty_fastreload'||(m.position.x>10000)===(this.s.area==='earth')));}
  at(key,position,options={}){this.a.at?.(key,position,options);}
  // play_jingle_or_stinger: an electrical surge, then the alias unless one is still playing or the music egg overrides it.
  jingle(m,alias){
    this.at(SOUND.surge,m.position,{distance:1000});
    const key=music(alias);if(!key||m.playing>this.s.time||this.a.musicOverride||!this.a.manifest?.[key])return;
    m.playing=this.s.time+30;this.a.sound?.(key,{position:m.position.clone(),bus:'music',distance:1500})?.then(src=>src.addEventListener('ended',()=>{m.playing=0;})).catch(()=>{m.playing=0;});
  }
  // A perk purchase: evt_bottle_dispense, then the machine's script_label sting.
  purchased(perk){const m=this.find(perk);if(!m)return;this.at(SOUND.dispense,m.position);this.jingle(m,m.label);}
  // evt_perk_deny when points or the four-perk limit refuse a purchase; an owned perk only gets the vox.
  denied(perk,reason){const m=this.find(perk);if(m&&reason!=='owned')this.at(SOUND.perkDeny,m.position);}
  // vending_weapon_upgrade: dispense and the packa sting at the machine; third_person_weapon_upgrade plays zmb_perks_packa_upgrade
  // 0.5 s in and zmb_perks_packa_ready 3.85 s in; the ticktock loops until the weapon is taken or times out (zmb_perks_packa_deny).
  packStarted(){if(!this.pack)return;this.at(SOUND.dispense,this.pack.position);this.jingle(this.pack,'mus_perks_packa_sting');this.packStep={start:this.s.time,stage:0};}
  packTaken(){this.a.unloop?.('pack-tick');this.packStep=null;}
  update(){
    const s=this.s,a=this.a;if(!a.ready?.())return;
    for(const [i,m] of this.machines.entries()){
      const on=this.powered(m);
      if(on&&!m.on){
        // turn_*_on plays zmb_perks_power_on when the switch powers a machine.
        if(s.power&&m.perk!=='specialty_quickrevive'&&m.position.x<10000)this.at(SOUND.powerOn,m.position);
        a.loop?.('perk-hum-'+i,SOUND.hum,{position:m.position,distance:600,volume:.6});m.jingleAt=s.time+rand(31,45);m.brokenAt=s.time+rand(7,18);
      }
      m.on=on;if(!on)continue;
      if(s.time>=m.jingleAt){m.jingleAt=s.time+rand(31,45);if(Math.random()<.15)this.jingle(m,m.jingle);}
      // play_random_broken_sounds: a surge every 7-18 s, and the broken jingle at Quick Revive.
      if(s.time>=m.brokenAt){m.brokenAt=s.time+rand(7,18);if(m.jingle==='mus_perks_revive_jingle')this.at(SOUND.broken,m.position,{distance:1000});this.at(SOUND.surge,m.position,{distance:1000});}
    }
    if(this.pack&&!this.packOn){this.packOn=true;a.loop?.('pack-hum',SOUND.packHum,{position:this.pack.position,distance:600,volume:.6});}
    const p=this.packStep;
    if(p){
      const age=s.time-p.start;
      if(p.stage===0&&age>=.5){p.stage=1;this.at(SOUND.upgrade,this.pack.position);}
      if(p.stage===1&&age>=3.85){p.stage=2;this.at(SOUND.ready,this.pack.position);}
      if(p.stage===2&&age>=4.35){p.stage=3;a.loop?.('pack-tick',SOUND.ticktock,{position:this.pack.position,distance:800});}
      if(p.stage===3&&!s.pack){a.unloop?.('pack-tick');if(age>=19.3)this.at(SOUND.packDeny,this.pack.position);this.packStep=null;}
    }
  }
}
