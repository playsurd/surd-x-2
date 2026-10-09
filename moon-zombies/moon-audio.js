import * as THREE from 'three';
import { GameAudio } from './audio.js';

const P='moon/vox/scripted/zombie_moon/',PLR=P+'plr3/vox_plr_3_',PLR4=P+'plr4/vox_plr_4_',MCOMP=P+'mcomp/vox_mcomp_',G='moon/evt/zombie_global/',ZV='moon/vox/zmb/',HH='moon/evt/zombie_tron/hellhounds/';
// _zombiemode_audio.gsc init_audio_aliases with zombie_moon_amb.gsc audio_alias_override. Solo Moon is Richtofen (vox_plr_3_).
const PLR_VOX={
  general:{ammo_low:'ammo_low',ammo_out:'ammo_out',perk_deny:'nomoney',no_money:'nomoney',box_move:'box_move',crawl_hit:'crawler_hit',teleport_gersh:'teleport_gersh_device',start:'start',
    astro_spawn:'spawn_astro',quad_spawn:'spawn_quad',biodome:'location_biodome',jumppad:'jumppad',teleporter:'teleporter',airless:'location_airless',moonjump:'moonjump',hack_plr:'hack_plr',poweron:'power_on'},
  perk:{specialty_armorvest:'perk_jugga',specialty_quickrevive:'perk_revive',specialty_fastreload:'perk_speed',specialty_rof:'perk_doubletap',specialty_longersprint:'perk_stamin',
    specialty_flakjacket:'perk_phdflopper',specialty_deadshot:'perk_deadshot',specialty_additionalprimaryweapon:'perk_arsenal'},
  powerup:{nuke:'powerup_nuke',insta_kill:'powerup_insta',full_ammo:'powerup_ammo',double_points:'powerup_double',carpenter:'powerup_carp',firesale:'powerup_firesale',minigun:'powerup_minigun',
    bonus_points_solo:'powerup_pts_solo',lose_points:'powerup_antipts_zmb'},
  kill:{melee:'kill_melee',melee_instakill:'kill_insta',weapon_instakill:'kill_insta',closekill:'kill_close',damage:'kill_damaged',streak:'kill_streak',headshot:'kill_headshot',explosive:'kill_explosive',
    raygun:'kill_ray',bullet:'kill_streak',hellhound:'kill_hellhound',quad:'kill_quad',astro:'kill_astro',gersh_device:'kill_gersh_device',micro_dual:'kill_micro_dual',micro_single:'kill_micro_single',
    quant_good:'kill_quant_good',quant_bad:'kill_quant_bad'},
  weapon_pickup:{pistol:'wpck_crappy',smg:'wpck_smg',dualwield:'wpck_dual',shotgun:'wpck_shotgun',rifle:'wpck_sniper',burstrifle:'wpck_mg',assault:'wpck_mg',sniper:'wpck_sniper',mg:'wpck_mg',
    launcher:'wpck_launcher',grenade:'wpck_launcher',bowie:'wpck_bowie',raygun:'wpck_raygun',upgrade:'wpck_upgrade',upgrade_wait:'wpck_upgrade_wait',favorite:'wpck_favorite',
    favorite_upgrade:'wpck_favorite_upgrade',gersh:'wpck_gersh_device',microwave:'wpck_microwave',quantum:'wpck_quantum',gasmask:'wpck_gasmask',hacker:'wpck_hacker'},
  digger:{incoming:'digger_incoming',breach:'digger_breach',hacked:'digger_hacked'},
  digger:{incoming:'digger_incoming',breach:'digger_breach',hacked:'digger_hacked'},
  eggs:{meteors:'egg_pedastool',music_activate:'secret',quest1:'quest_step1',quest2:'quest_step2',quest3:'quest_step3',quest4:'quest_step4',
    quest5:'quest_step5',quest6:'quest_step6',quest7:'quest_step7',quest8:'quest_step8'},
};
// get_mod_chance(); add_zombie_weapon() vox types (_zombiemode_weapons.gsc, zombie_moon.gsc).
const KILL_CHANCE={melee:40,melee_instakill:99,weapon_instakill:10,explosive:60,raygun:75,headshot:99,quad:30,astro:99,closekill:15,bullet:10,default:1};
const WEAPON_VOX={m1911_zm:'pistol',python_zm:'pistol',cz75_zm:'pistol',ak74u_zm:'smg',mp5k_zm:'smg',mp40_zm:'smg',mpl_zm:'smg',pm63_zm:'smg',spectre_zm:'smg',cz75dw_zm:'dualwield',
  ithaca_zm:'shotgun',spas_zm:'shotgun',rottweil72_zm:'shotgun',hs10_zm:'shotgun',m14_zm:'rifle',m16_zm:'burstrifle',g11_lps_zm:'burstrifle',famas_zm:'burstrifle',fnfal_zm:'burstrifle',
  aug_acog_zm:'assault',galil_zm:'assault',commando_zm:'assault',dragunov_zm:'sniper',l96a1_zm:'sniper',rpk_zm:'mg',hk21_zm:'mg',m72_law_zm:'launcher',china_lake_zm:'launcher',
  ray_gun_zm:'raygun',knife_ballistic_zm:'bowie',microwavegun_zm:'microwave',microwavegundw_zm:'microwave',zombie_black_hole_bomb:'gersh',zombie_quantum_bomb:'quantum'};
// level.zmb_vox (zmb_vocals_<animname>_<type>) resolved to the resident vocal folders.
const ZMB_VOX={zombie:{ambient:ZV+'standard/amb/',sprint:ZV+'standard/sprint/',attack:ZV+'standard/attack/',teardown:ZV+'standard/attack/',taunt:ZV+'standard/taunt/',behind:ZV+'standard/behind/',death:ZV+'standard/death/'},
  nova:{ambient:ZV+'quads/ambient/',sprint:ZV+'quads/ambient/',attack:ZV+'quads/attack/',behind:ZV+'quads/attack/',death:ZV+'quads/death/'},
  dog:{ambient:HH+'vox/move/',sprint:HH+'vox/move/',attack:HH+'vox/attack/',behind:HH+'vox/close/',death:HH+'explode/'}};
// zombie_moon_amb.csc declareMusicState / _zombiemode_audio.gsc init_music_states.
const MUSIC={round_start:{alias:'round',state:'WAVE',override:true,round:true},round_end:{alias:'round_end',state:'SILENCE',override:true,round:true},wave_loop:{state:'WAVE',override:true},
  game_over:{alias:'moon/evt/zombie_moon/gameover',state:'SILENCE'},egg:{state:'EGG'},sam_reveal:{state:'SAM'}};
const STATES={WAVE:['moon/mus/zombie/moon/underscore_l',true],EGG:['moon/mus/zombie/moon/coming_home',false],SAM:['moon/mus/zombie/moon/see_sam',false],SILENCE:null};
const ANNOUNCE={carpenter:'carpenter',insta_kill:'insta_kill',double_points:'double_points',nuke:'nuke',full_ammo:'full_ammo',fire_sale:'moon/vox/scripted/zmb/announcer/firesale',
  minigun:'moon/vox/scripted/zmb/announcer/death_machine',magicbox:'moon/vox/scripted/zmb/ann/ann_special_magicbox_full'};
const RICH={carpenter:'carpenter',insta_kill:'instakill',double_points:'doublepoints',nuke:'nuke',full_ammo:'maxammo',fire_sale:'firesale',minigun:'death_machine',magicbox:'magicbox'};
// vox_plr_4_quest_step8_10 points at the file vox_plr_4_quest_step8_9b.
const FILE_VARIANT={[P+'plr4/vox_plr_4_quest_step8']:{10:'9b'}};
const v3=a=>new THREE.Vector3(...a),rand=(a,b)=>a+Math.random()*(b-a);

export class MoonAudio extends GameAudio {
  constructor(){super();this.music={stop(){}};this.ambientKey=null;this.ambientToken=0;this.loops=new Map();this.voxAvail=new Map();this.voxLists=new Map();this.timers=[];this.reset();}
  async load(){await super.load();const r=await fetch('moon/audio/manifest.json');if(!r.ok)throw new Error('Missing Moon audio. Run build:moon.');Object.assign(this.manifest,await r.json());}
  start(){
    const fresh=!this.ctx;this.preload=false;super.start();if(!this.ctx||!fresh)return;
    const c=this.ctx;this.buses={};
    for(const name of ['music','sfx','vox','ui'])this.buses[name]=c.createGain();
    // Airless rooms use the zmb_moon_airless snapshot and the P.E.S. the zmb_moon_gasmask snapshot; both muffle world sound.
    this.muffle=c.createBiquadFilter();this.muffle.type='lowpass';this.muffle.frequency.value=20000;
    this.buses.sfx.connect(this.muffle);this.muffle.connect(this.master);
    for(const name of ['music','vox','ui'])this.buses[name].connect(this.master);
    for(const key of Object.keys(this.manifest))if(/^moon\/(vox\/zmb\/standard\/(amb|attack|death)|evt\/zombie_global\/(purchase|powerup\/grab|box\/(open|close|music_box)))|^(round|round_end|nuke|full_ammo|insta_kill|double_points|carpenter)$|^specialty_/.test(key))this.buffer(key).catch(()=>{});
  }
  reset(){
    this.musicToken=(this.musicToken??0)+1;this.music?.stop?.();this.musicSource?.stop();this.clientMusic=null;this.music={stop(){}};this.musicState=null;this.musicSource=null;this.musicOverride=false;this.musicRoundOverride=false;
    this.ambientToken++;this.ambient?.stop();this.ambient=null;this.ambientKey=null;
    for(const loop of this.loops?.values()??[])loop.stop();this.loops?.clear();for(const t of this.timers??[])clearTimeout(t);this.timers=[];
    this.speaking=false;this.mcompSpeaking=false;this.announcing=false;this.saleOn=false;this.pendingPerk=null;this.skit=false;this.killWait=0;this.killTimes=[];this.voxAvail?.clear();this.watch=null;this.lastBehind=0;this.helmet=false;this.vacuum=false;this.reviving=false;
  }
  // player_4_override(): after the soul swap Richtofen speaks as Samantha and the box, fire sale and laughs use her variants.
  get samantha(){return !!this.session?.permanentPerks;}
  event(path,volume=1,position=null){this.sound(G+path,{volume,...position?{position:position.clone()}:{}});}
  // play_crazi_sound: zmb_laugh_child, or zmb_laugh_rich after the swap, to every player.
  laugh(){this.sound(this.samantha?ZV+'box/laugh/rich_00':ZV+'box/laugh/child/child_00',{bus:'vox'});}
  // treasure_chest_move: zmb_vox_ann_magicbox (zmb_vox_rich_magicbox after the swap) at the chest.
  boxVox(position){this.at(this.samantha?'moon/vox/scripted/zmb/rich/zmb_vox_rich_magicbox':ANNOUNCE.magicbox,position,{bus:'vox',distance:2500});}
  // setup_firesale_audio: mus_fire_sale (mus_fire_sale_rich after the swap) loops on every intercom while the sale lasts.
  fireSale(on){
    if(this.saleOn===on)return;this.saleOn=on;
    for(const [i,p] of (this.intercoms??[]).entries()){
      if(on)this.loop('firesale-'+i,'moon/mus/zombie/firesale/'+(this.samantha?'omnov001l_1_l':'mus_chap205_19.00_l'),{position:p,distance:1500,bus:'music'});else this.unloop('firesale-'+i);
    }
  }
  noMoney(){this.play('deny');this.vox('general','no_money');}
  // perk_vox(): 1.5 s after a bought perk is given; free and quest perks are silent.
  perkBought(perk){this.pendingPerk=perk;}
  // play_weapon_vo / weapon_type_check_custom: favourites (Spectre and upgraded G11; SPAS and upgraded MP40 as Samantha),
  // any other upgraded weapon, then the weapon's add_zombie_weapon vox type.
  weaponVox(id,upgraded){
    const [favorite,favoriteUpgrade]=this.samantha?['spas_zm','mp40_zm']:['spectre_zm','g11_lps_zm'];
    this.vox('weapon_pickup',!upgraded&&id===favorite?'favorite':upgraded&&id===favoriteUpgrade?'favorite_upgrade':upgraded?'upgrade':WEAPON_VOX[id]);
  }
  later(seconds,fn){const t=setTimeout(()=>{this.timers.splice(this.timers.indexOf(t),1);fn();},seconds*1000);this.timers.push(t);}
  // Moon-only native routing: buses, optional 3D panner. Kino keeps GameAudio.native.
  async native(key,volume=1,loop=false,{bus='sfx',position=null,distance=1500}={}){
    const b=await this.buffer(key),c=this.ctx,source=c.createBufferSource(),gain=c.createGain();source.buffer=b;source.loop=loop;gain.gain.value=volume;source.connect(gain);
    let tail=gain,panner=null;
    if(position){panner=c.createPanner();panner.panningModel='equalpower';panner.distanceModel='linear';panner.refDistance=Math.min(150,distance*.15);panner.maxDistance=distance;panner.rolloffFactor=1;
      this.place(panner,typeof position==='function'?position():position);gain.connect(panner);tail=panner;source.panner=panner;}
    tail.connect(this.buses?.[bus]??this.master);source.gain=gain;
    source.onended=()=>{source.disconnect();gain.disconnect();panner?.disconnect();};source.start();
    this.played.push(key);if(this.played.length>60)this.played.shift();return source;
  }
  place(panner,p){if(!p)return;if(panner.positionX){panner.positionX.value=p.x;panner.positionY.value=p.y;panner.positionZ.value=p.z;}else panner.setPosition(p.x,p.y,p.z);}
  listen(camera){
    const l=this.ctx?.listener;if(!l)return;const p=camera.position,f=camera.getWorldDirection(new THREE.Vector3()),u=camera.up;
    if(l.positionX){l.positionX.value=p.x;l.positionY.value=p.y;l.positionZ.value=p.z;l.forwardX.value=f.x;l.forwardY.value=f.y;l.forwardZ.value=f.z;l.upX.value=u.x;l.upY.value=u.y;l.upZ.value=u.z;}
    else{l.setPosition(p.x,p.y,p.z);l.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z);}
  }
  ready(){return this.enabled&&this.ctx&&this.ctx.state==='running'&&this.buses;}
  // Plays a manifest key, or a random variant of a folder prefix ending in "/".
  sound(key,{volume=1,...options}={}){
    if(!this.ready())return null;const k=key.endsWith('/')?this.select(key):key;if(!k||!this.manifest[k])return null;
    const p=this.native(k,volume,false,options);p.catch(console.error);return p;
  }
  at(key,position,options={}){return this.sound(key,{...options,position:position.clone?position.clone():position});}
  loop(id,key,{volume=1,position=null,distance=1500,bus='sfx'}={}){
    if(!this.ready()||this.loops.has(id)||!this.manifest[key])return;
    const entry={source:null,stopped:false,position,stop(fade=.5){this.stopped=true;const s=this.source;if(!s)return;const t=s.context.currentTime;s.gain.gain.setTargetAtTime(0,t,fade/4);s.stop(t+fade);}};
    this.loops.set(id,entry);
    this.native(key,volume,true,{bus,position:position&&(typeof position==='function'?position():position),distance}).then(s=>{if(entry.stopped)s.stop();else entry.source=s;}).catch(console.error);
  }
  unloop(id,fade){this.loops.get(id)?.stop(fade);this.loops.delete(id);}
  cue(path,volume=1){this.play('moon/evt/zombie_moon/'+path,volume);}
  play(kind,volume=1,position=null){
    const s=this.session;
    if(kind==='growl')return;
    if(kind==='round'){if(s?.area==='earth')this.sound('moon/amb/alarms/radar_station/amb_alarm_radar_station',{bus:'ui',volume:.7});return;}
    if(kind==='buy'){this.sound(G+'purchase/accept/accept_00',{bus:'ui',volume:.8});return;}
    if(kind==='deny'){this.sound(G+'purchase/deny/deny_00',{bus:'ui',volume:.8});return;}
    if(kind==='hit'){this.sound('moon/fly/melee/zmb/swing/',{volume:.8});return;}
    if(kind==='board'){this.sound('moon/evt/zombie_moon/vent_slats/'+(volume>=1?'repair/':'remove/'),{volume:Math.max(.15,volume)});return;}
    if(kind==='explosion'){const o={volume:1,distance:3000,...position?{position}:{}};this.sound('moon/wpn/grenade/explosion/explode/',o);this.sound('moon/wpn/grenade/explosion/flux_l/',{...o,volume:.6});return;}
    if(kind==='gersh'){if(position)this.at('moon/wpn/grenade/gersh_device/exp/wpn_gersh_exp',position,{distance:2500});return;}
    if(kind==='qed'){if(position)this.at('moon/wpn/quantum/quantum_detonate',position,{distance:2500});return;}
    if(kind==='jump_pad'||kind==='teleport'){this.sound('moon/evt/zombie_moon/jump_pad/evt_jump_pad_launch',{volume:.9});return;}
    if(kind==='packapunch'){this.sound(G+'pap/upgrade',{volume:.9});super.play(kind,volume);return;}
    if(kind in ANNOUNCE&&kind!=='magicbox'){this.powerup(kind);return;}
    if(!this.manifest[kind]){console.warn('Missing Moon audio cue',kind);return;}
    if(position){this.at(kind,position,{volume});return;}
    super.play(kind,volume);
  }
  // powerup_grab(): grab sound, announcer, effect loop and powerup_vo() 4.5-5.5 s later.
  powerup(type){
    this.onPowerup?.(type);
    this.sound(G+'powerup/grab/grab_00',{bus:'ui'});this.announce(type);
    if(type==='nuke')this.sound(G+'nuke/nuke_flash',{bus:'ui'});
    if(type==='full_ammo')this.sound(G+'powerup/max_ammo/max_ammo_00',{bus:'ui',volume:.8});
    this.later(rand(4.5,5.5),()=>this.vox('powerup',type==='fire_sale'?'firesale':type));
  }
  announce(type){
    if(this.announcing)return;const rich=this.session?.permanentPerks,key=rich?'moon/vox/scripted/zmb/rich/zmb_vox_rich_'+RICH[type]:ANNOUNCE[type];if(!key)return;
    this.announcing=true;this.later(2,()=>{this.announcing=false;});this.sound(key,{bus:'vox'});
  }
  // create_and_play_dialog(): shuffled variants, no overlap, "_f" helmet line, silent in vacuum without the P.E.S.
  // override only bypasses level.skit_vox_override; level.player_is_speaking still blocks the line.
  vox(category,type,{variant=null,override=false}={}){
    const suffix=PLR_VOX[category]?.[type];if(!suffix||!this.ready()||this.reviving)return false;
    const prefix=(this.samantha?PLR4:PLR)+suffix;
    if(!this.voxLists.has(prefix)){const re=new RegExp('^'+prefix+'_(\\d+)$');this.voxLists.set(prefix,Object.keys(this.manifest).map(k=>re.exec(k)?.[1]).filter(Boolean).map(Number));}
    // get_number_variants counts up from _0: a category without _0 is silent, and a forced variant plays only if it exists.
    const all=this.voxLists.get(prefix);if(!all.includes(0)||this.skit&&!override)return false;
    if(variant!=null){const file=FILE_VARIANT[prefix]?.[variant]??variant;return this.manifest[prefix+'_'+file]?this.speak(prefix+'_'+file):false;}
    let avail=this.voxAvail.get(prefix);if(!avail?.length){avail=all.slice();this.voxAvail.set(prefix,avail);}
    return this.speak(prefix+'_'+avail.splice(Math.floor(Math.random()*avail.length),1)[0]);
  }
  speak(key){
    if(this.vacuum&&!this.helmet||this.speaking||!this.ready())return false;
    const k=this.helmet&&this.manifest[key+'_f']?key+'_f':key;if(!this.manifest[k])return false;
    this.speaking=true;this.lastLine=k;
    this.native(k,.95,false,{bus:'vox'}).then(s=>s.addEventListener('ended',()=>this.later(.25,()=>{if(this.lastLine===k)this.speaking=false;}))).catch(e=>{this.speaking=false;console.error(e);});
    return true;
  }
  // play_mooncomp_vox(): one computer line at a time; "_f" when the P.E.S. is on or in vacuum.
  // Maxis (vox_xcomp_*) speaks through play_sound_2d anywhere on the map.
  xcomp(alias){const key=P+'xcomp/vox_xcomp_'+alias;if(this.ready()&&this.manifest[key])this.native(key,.9,false,{bus:'vox'}).catch(()=>{});}
  mcomp(alias,onEnd=null){
    if(!this.ready()||this.mcompSpeaking||this.session?.area!=='moon')return;
    const base=MCOMP+alias,key=(this.helmet||this.vacuum)&&this.manifest[base+'_f']?base+'_f':base;if(!this.manifest[key])return;
    this.mcompSpeaking=true;this.native(key,.9,false,{bus:'vox'}).then(s=>s.addEventListener('ended',()=>{this.mcompSpeaking=false;onEnd?.();})).catch(()=>{this.mcompSpeaking=false;});
  }
  // A computer line played on several entities at once (the lids, the security terminals); onEnd follows the first.
  mcompAt(alias,positions,onEnd=null){
    if(!this.ready()||!positions.length)return;const base=MCOMP+alias,key=(this.helmet||this.vacuum)&&this.manifest[base+'_f']?base+'_f':base;if(!this.manifest[key])return;
    positions.forEach((p,i)=>this.native(key,.9,false,{bus:'vox',position:p.clone?p.clone():v3(p),distance:1500}).then(s=>{if(!i&&onEnd)s.addEventListener('ended',onEnd);}).catch(()=>{}));
  }
  // A direct PlaySound / play_sound_in_space line: no helmet variant, no speaking check; resolves when it ends.
  line(key,position=null){
    const k=P+key;if(!this.ready()||!this.manifest[k])return Promise.resolve();
    return this.native(k,.95,false,{bus:'vox',...position?{position:position.clone?position.clone():v3(position)}:{},distance:2000})
      .then(s=>new Promise(r=>s.addEventListener('ended',r))).catch(()=>{});
  }
  zombieVox(z,type,force=false){
    const kind=z.kind==='nova'?'nova':z.kind==='dog'?'dog':'zombie',prefix=ZMB_VOX[kind]?.[type];if(!prefix||z.kind==='astronaut')return;
    // Ambient/sprint lines wait for the previous one; attack/behind/death interrupt (do_zombies_playvocals).
    if(!force&&['ambient','sprint'].includes(type)){if(z.talking>this.now)return;z.talking=this.now+2.2;}
    this.at(prefix,z.root.position.clone().add(new THREE.Vector3(0,55,0)),{volume:type==='death'?.9:.75,distance:type==='behind'?900:1300});
  }
  weapon(kind,def){
    const special=def.id==='microwavegun_zm'?'moon/wpn/microwave/rifle/plr/microwave_rifle_shot':def.id==='microwavegundw_zm'?'moon/wpn/microwave/dw/plr/microwave_shot':null;
    if(kind==='shot'&&special){super.play(special,.8);return;}
    if(kind==='shot'){
      const alias=def.sounds?.fireSound??def.sounds?.fireSoundPlayer,name=alias?.replace(/_plr$/,'');
      const native=name&&Object.keys(this.manifest).find(k=>k.endsWith('/'+name)||k.endsWith('/'+name+'_00'));
      if(native){super.play(native,.8);return;}
      const base=def.id.replace(/_zm$/,'').replace(/_acog|_lps|dw/g,'');
      const found=Object.keys(this.manifest).find(k=>k.startsWith('moon/wpn/')&&k.includes('/'+base+'/')&&k.includes('/plr/shot/'));
      if(found){super.play(found,.8);return;}
    }
    super.weapon(kind,def);
  }
  // change_zombie_music(): alias stinger plus client music state; game over latches.
  setMusic(name){
    const m=MUSIC[name];if(!m||!this.ready())return;
    if(this.musicState===m||this.musicState===MUSIC.game_over)return;
    if(m.override&&this.musicOverride||m.round&&this.musicRoundOverride)return;
    this.musicState=m;if(m.alias)this.sound(m.alias,{bus:'music',volume:.75});this.musicTo(m.state);
  }
  musicTo(state){
    if(this.clientMusic===state)return;this.clientMusic=state;const token=++this.musicToken,old=this.musicSource;this.musicSource=null;
    if(old){const t=this.ctx.currentTime;old.gain.gain.setTargetAtTime(0,t,.5);old.stop(t+2);}
    const def=STATES[state];if(!def)return;
    this.native(def[0],0,def[1],{bus:'music'}).then(s=>{if(token!==this.musicToken){s.stop();return;}this.musicSource=s;s.gain.gain.setTargetAtTime(def[1]?.32:.7,this.ctx.currentTime,def[1]?1:.05);}).catch(console.error);
  }
  // zombie_moon_sq_sc.gsc reveal_music: see_sam for 40 s under a music override, then the wave loop.
  musicReveal(){
    if(!this.ready())return;this.musicOverride=true;this.musicState=MUSIC.sam_reveal;this.musicTo('SAM');
    this.later(40,()=>{this.musicOverride=false;this.musicState=null;if(!this.musicRoundOverride)this.setMusic('wave_loop');});
  }
  // Coming Home: play_music_egg(); 199 s, then back to the wave loop.
  musicEgg(){
    if(!this.ready()||this.musicOverride)return;this.musicOverride=true;this.musicState=MUSIC.egg;this.musicTo('EGG');
    this.later(4,()=>this.vox('eggs','music_activate'));this.later(199,()=>{this.musicOverride=false;this.musicState=null;if(!this.musicRoundOverride)this.setMusic('wave_loop');});
  }
  // 8-bit songs (eight_bit_easteregg): power-gated, independent of the music state, positional.
  eightBit(entity){
    if(!this.ready())return false;const p=v3(entity.position),n=Number(String(entity.script_string??'').at(-1))||0;
    this.at('moon/mus/zombie/moon/bit/tinyloop_8bit',p,{bus:'music',distance:1500});
    this.later(4,()=>this.at('moon/mus/zombie/moon/bit/'+['new_chorus_8bit','paradol_8bit','redamned'][n],p,{bus:'music',distance:2000,volume:.9}));return true;
  }
  // Room tones from ambient_package triggers (zombie_moon_amb.csc reset_ambient_packages): tone only while pressurised.
  environment(env){
    this.env=env;if(!this.ctx||!this.buses)return;
    const room=this.room?.(),key=room&&env.breathable&&room.script_string?{amb_labs:'moon/evt/zombie_moon/amb/lab_bg_l',amb_caves:'moon/evt/zombie_moon/amb/cave_bg_l',amb_biodome:'moon/evt/zombie_moon/amb/biodome_bg_l',amb_airlock:'moon/evt/zombie_moon/amb/airlock_bg_l'}[room.script_string]:null;
    if(room&&room===this.lastRoom&&this.lastBreathable!==env.breathable&&env.lunar){if(env.breathable)this.sound('moon/evt/zombie_moon/repressurize',{bus:'ui'});else this.sound('moon/evt/zombie_moon/airrelease',{bus:'ui'});}
    this.lastRoom=room;this.lastBreathable=env.breathable;
    const muffle=env.lunar&&!env.breathable?700:this.helmet?3200:20000;this.muffle.frequency.setTargetAtTime(muffle,this.ctx.currentTime,.15);
    if(key===this.ambientKey)return;this.ambientKey=key;const token=++this.ambientToken,old=this.ambient;this.ambient=null;
    if(old){const t=this.ctx.currentTime;old.gain.gain.setTargetAtTime(0,t,.08);old.stop(t+.3);}
    if(key)this.native(key,0,true,{bus:'sfx'}).then(source=>{if(token!==this.ambientToken)source.stop();else{this.ambient=source;source.gain.gain.setTargetAtTime(.32,this.ctx.currentTime,.08);}}).catch(console.error);
  }
  update(dt,{camera,environment,features}){
    const s=this.session;if(!s)return;this.quest=features.quest;this.now=s.time;
    this.helmet=features.state.suit;this.vacuum=!environment.breathable;this.reviving=s.phase==='reviving';this.listen(camera);
    this.room=()=>features.data.entities.find(e=>e.targetname==='ambient_package'&&e.bounds&&camera.position.toArray().every((v,i)=>v>=e.bounds[0][i]&&v<=e.bounds[1][i]));
    const current={round:s.round,phase:s.phase,area:s.area,power:s.power,perks:[...s.perks],zone:environment.zone,down:!!s.lastStand||s.phase==='reviving',inventory:s.inventory.map(w=>w.id+(w.upgraded?'+':''))};
    const last=this.watch;this.watch=current;
    if(!last){this.vox('general','start');return;}
    if(last.phase!==s.phase){if(s.phase==='fighting')this.setMusic('round_start');else if(s.phase==='preparing')this.setMusic('round_end');else if(s.phase==='gameover')this.setMusic('game_over');}
    if(last.area!==s.area)this.vox('general','teleporter');
    if(!last.power&&s.power)this.vox('general','poweron');
    // Weapons acquired from the box, a wall or Pack-a-Punch; last stand swaps and restores are not pickups.
    if(!current.down&&!last.down)for(const k of current.inventory)if(!last.inventory.includes(k))this.weaponVox(k.replace('+',''),k.endsWith('+'));
    if(last.zone!==current.zone&&current.zone==='forest_zone')this.vox('general','biodome');
    for(const perk of current.perks)if(!last.perks.includes(perk)&&perk===this.pendingPerk){this.pendingPerk=null;this.later(1.5,()=>this.vox('perk',perk));}
    for(const z of features.combat.enemies.list){
      if(z.audioState!==z.state){z.audioState=z.state;if(z.state==='attack')this.zombieVox(z,'attack',true);}
      if((z.audioAt??0)<=s.time){z.audioAt=s.time+3+Math.random()*4;this.zombieVox(z,z.moveSpeed==='sprint'?'sprint':'ambient');}
      if(z.kind==='astronaut')this.loop('astro-'+z.id,'moon/evt/zombie_moon/astro/astro_loop',{position:()=>z.root.position,distance:1200});
    }
    for(const [id,loop] of this.loops){if(id.startsWith('astro-')&&!features.combat.enemies.list.some(z=>'astro-'+z.id===id)){this.unloop(id);continue;}if(loop.source?.panner&&typeof loop.position==='function')this.place(loop.source.panner,loop.position());}
  }
  snapshot(){return {...super.snapshot(),music:this.clientMusic??null,musicState:Object.keys(MUSIC).find(k=>MUSIC[k]===this.musicState)??null,ambient:this.ambientKey,speaking:this.speaking,lastLine:this.lastLine??null,loops:[...this.loops.keys()]};}
}
