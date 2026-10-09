import { Session, PowerupDirector } from './rules.js';

// _zombiemode_perks.gsc vending_trigger_think (solo Quick Revive 500; Deadshot 1000 in the final patch).
export const MOON_PERKS = {
  specialty_quickrevive:{name:'Quick Revive',price:500,color:'#64bad7',icon:'QR'},
  specialty_armorvest:{name:'Juggernog',price:2500,color:'#c84343',icon:'J'},
  specialty_fastreload:{name:'Speed Cola',price:3000,color:'#65bd76',icon:'SC'},
  specialty_rof:{name:'Double Tap',price:2000,color:'#d6a647',icon:'DT'},
  specialty_longersprint:{name:'Stamin-Up',price:2000,color:'#ebbd4b',icon:'S'},
  specialty_flakjacket:{name:'PhD Flopper',price:2000,color:'#be83da',icon:'PhD'},
  specialty_deadshot:{name:'Deadshot Daiquiri',price:1000,color:'#9da8ac',icon:'DS'},
  specialty_additionalprimaryweapon:{name:'Mule Kick',price:4000,color:'#82a86c',icon:'MK'},
};
// _zombiemode.gsc last_stand_pistol_rank_init (solo order); rank <= 4 is replaced by Mustang & Sally.
const PISTOLS=['m1911_zm','cz75_zm','cz75dw_zm','python_zm','python_upgraded_zm','cz75_upgraded_zm','cz75dw_upgraded_zm','m1911_upgraded_zm','ray_gun_zm','freezegun_zm','ray_gun_upgraded_zm','freezegun_upgraded_zm','microwavegundw_zm','microwavegundw_upgraded_zm'];
const roundUpToTen=n=>Math.ceil(n/10)*10;
const MULE='specialty_additionalprimaryweapon';

// _zombiemode_powerups.gsc get_valid_powerup: no round gating; the Death Machine needs power or a bought solo life.
class MoonDrops extends PowerupDirector {
  tryDrop(s,{playable=true,kind='zombie',destroyedWindows=0,boxMoves=0}={}){
    this.observe(s);
    if(kind==='dog'||this.count>=(s.data.rules.zombie_powerup_drop_max_per_round??4))return null;
    if(s.random()>=.03&&!this.pending)return null;
    if(!playable)return null;
    const types=['nuke','insta_kill','double_points','full_ammo','carpenter','fire_sale','minigun'];
    for(let attempts=0;attempts<types.length*2;attempts++){
      if(!this.deck.length){this.deck=types.slice();for(let i=this.deck.length-1;i>0;i--){const j=Math.floor(s.random()*(i+1));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}}
      const type=this.deck.shift();
      if(type==='carpenter'&&destroyedWindows<5||type==='fire_sale'&&(!boxMoves||s.effects.fire_sale>s.time)||type==='minigun'&&(s.effects.death_machine>s.time||!s.power&&!s.soloLivesGiven))continue;
      this.count++;this.pending=false;return type;
    }
    return null;
  }
}

// default_max_zombie_func once the opening No Man's Land round has cleared level.first_round.
export function moonMaxZombies(round,rules={},max=null){
  if(max===null){const m=Math.max(1,round/5)*(round>=10?round*.15:1);max=(rules.zombie_max_ai??24)+Math.trunc(.5*(rules.zombie_ai_per_player??6)*m);}
  return Math.trunc(max*(round<3?.3:round<4?.5:round<5?.7:round<6?.9:1));
}

// Lunar waves use the common T5 round rules. Area 51 is an endless encounter;
// travelling there suspends the lunar wave and preserves its remaining count.
export class MoonSession extends Session {
  reset() {
    super.reset(); this.area = 'earth'; this.moonStarted = false; this.savedWave = null;
    this.earthTime = 0; this.phase = 'fighting'; this.total = 0; this.nextDogRound = Infinity;
    this.equipment = null; this.equipmentAmmo = 0; this.permanentPerks = false;
    this.hacker = false; this.earthVisits = 0; this.pack = null; this.hackedWeapons = new Set(); this.nmlDogsAt = 30;
    this.drops=new MoonDrops(this);this.inventory=[this.newWeapon('m1911_zm')];
    // round_think awards two grenades on the first (No Man's Land) round.
    this.grenades=2;this.lethal='frag_grenade_zm';this.claymores=0;this.claymoresOwned=false;
    this.lives=0;this.soloLivesGiven=0;this.lastStand=null;this.retainGranted=false;this.veryHurt=false;this.hurtTime=-100;
    this.leftFireLeft=0;this.reloadAdded=false;this.spread=0;this.sprintLeft=4;this.sprintLock=0;this.spin=0;
    this.hackerOut=false;this.hackerSwap=0;this.hackerLowering=false;this.hackerRound=null;this.hitInfo=null;this.switching=null;
  }
  get weapon(){return this.lastStand?.weapon??this.inventory[this.slot];}
  get def() {
    if(this.effects?.death_machine>this.time&&!this.lastStand&&this.data.weapons.minigun_zm)return this.data.weapons.minigun_zm;
    return this.weaponDef(this.weapon);
  }
  weaponDef(w){
    const base=this.data.weapons[w.id];if(!base)return base;
    let d=w.upgraded&&base.upgrade?{...base,...base.upgrade,id:w.id,upgraded:true}:base;
    if(w.alt){
      if(base.alt){const a=this.data.weapons[base.alt];d=w.upgraded?{...a,...a.upgrade,id:a.id,upgraded:true,altActive:true}:{...a,altActive:true};}
      else if(d.attachment)d={...d.attachment,id:w.id,name:d.name+' · '+d.attachment.name,upgraded:true,attachmentActive:true,altActive:true};
    }
    if(this.bowie&&d.bowie)d={...d,id:d.bowie.id,model:d.bowie.model,melee:d.bowie.melee};
    return d;
  }
  newWeapon(id,upgraded=false){
    const w={id,upgraded,alt:false},d=this.weaponDef(w);
    w.mag=d.clipSize;w.reserve=d.startAmmo??d.maxAmmo;if(d.dualWield)w.leftMag=d.left?.clipSize??d.clipSize;return w;
  }
  fillWeapon(w){
    for(const alt of [false,true]){
      const d=this.weaponDef({...w,alt});if(alt&&!this.data.weapons[w.id].alt&&!d.attachmentActive)continue;
      const ammo={mag:d.clipSize,reserve:d.startAmmo??d.maxAmmo,leftMag:d.dualWield?d.left?.clipSize??d.clipSize:undefined};
      if(alt===!!w.alt)Object.assign(w,ammo);else w[alt?'altAmmo':'mainAmmo']=ammo;
    }
  }
  get maxHealth(){return this.perks.has('specialty_armorvest')?this.data.rules.zombie_perk_juggernaut_health??250:100;}
  get canAct(){return !['gameover','reviving'].includes(this.phase)&&!this.drinking&&!this.meleeLeft&&!this.hackerSwap&&!(this.effects.death_machine>this.time);}
  get armed(){return this.canAct&&!this.hackerOut&&this.weapon&&this.weapon!==this.pack?.weapon;}
  // Speed Cola: replace_chunk 0.15 s rotate + 0.1 s wait, otherwise ~0.7 s per board.
  get boardRepairTime(){return this.perks.has('specialty_fastreload')?.25:.7;}
  // _zombiemode_equip_hacker.gsc hacker_do_hack: Speed Cola x0.66, never below 1.5 s.
  hackTime(seconds){return Math.max(1.5,seconds*(this.perks.has('specialty_fastreload')?.66:1));}
  update(dt){
    if(this.phase==='gameover')return;
    this.time+=dt;this.fireLeft=Math.max(0,this.fireLeft-dt);this.leftFireLeft=Math.max(0,this.leftFireLeft-dt);this.meleeLeft=Math.max(0,this.meleeLeft-dt);
    // watch_for_drop waits on zombie_drop_powerups, which No Man's Land clears, so the threshold only grows on the Moon.
    if(this.area!=='earth')this.drops.observe(this);
    if(this.permanentPerks&&!this.retainGranted){this.retainGranted=true;if(!this.lives){this.lives=1;this.soloLivesGiven++;}}
    if(this.hackerSwap){this.hackerSwap=Math.max(0,this.hackerSwap-dt);if(!this.hackerSwap&&this.hackerLowering){this.hackerOut=false;this.hackerLowering=false;this.fireLeft=Math.max(this.fireLeft,this.def?.raiseTime??0);}}
    if(this.drinking){this.drinkLeft=Math.max(0,this.drinkLeft-dt);if(!this.drinkLeft){const id=this.drinking;this.drinking=null;if(MOON_PERKS[id])this.givePerk(id);else this.finishAction(id);}}
    let reloadDt=dt;
    while(this.reloadLeft>0&&reloadDt>=this.reloadLeft){reloadDt-=this.reloadLeft;this.finishReloadStage();}
    if(this.reloadLeft>0){this.reloadLeft-=reloadDt;this.checkReloadAdd();}
    if(this.area==='earth')this.earthTime+=dt;
    if(this.lastStand){this.lastStand.left-=dt;if(this.lastStand.left<=0)this.revive();return;}
    this.spread=Math.max(0,this.spread-(this.def?.spread?.decay??5)*dt);
    // _gameskill.gsc playerHealthRegen at normal (0.75): 2.4 s delay, full unless below 20%, then 5 s and 10% per 0.05 s.
    if(this.health>=this.maxHealth)this.veryHurt=false;
    else if(this.time-this.hurtTime>=2.4){if(!this.veryHurt)this.health=this.maxHealth;else if(this.time-this.hurtTime>5)this.health=Math.min(this.maxHealth,this.health+this.maxHealth*2*dt);}
    if(this.phase==='preparing'){this.countdown-=dt;if(this.countdown<=0){this.phase='fighting';this.lastEvent='Round '+this.round;}}
  }
  // nml_dogs_init: every teleport disables No Man's Land hellhounds for 30 seconds.
  get nmlDogsEnabled() { return this.time >= this.nmlDogsAt; }
  // Leaving between rounds remembers the next round (nml_setup_round_spawner). Arriving on
  // the Moon ends the No Man's Land round: chalk_round_over (10 s) and chalk_one_up (2.5 s)
  // run before the saved remainder resumes (moon_round_think_func / resume_moon_rounds).
  enterArea(lunar) {
    const next = lunar ? 'moon' : 'earth'; if (next === this.area) return;
    this.nmlDogsAt = this.time + 30;
    if (!lunar) {
      // Init_Moon_NML_Round deletes the lunar wave, so a round in progress ends (end_of_round) on arrival.
      if(this.moonStarted&&this.phase!=='preparing')this.hackerReward();
      // nml_setup_round_spawner: between rounds the next round resumes with max_zombie_func(zombie_max_ai).
      const between=this.phase==='preparing'&&this.moonStarted;
      this.savedWave = between?{round:this.round,total:moonMaxZombies(this.round-1,this.data.rules,this.data.rules.zombie_max_ai??24),killed:0}:{round:this.round,total:this.total,killed:this.killed};
      this.area = 'earth'; this.phase = 'fighting'; this.total = 0; this.spawned = this.killed = 0; this.earthTime = 0;
      this.earthVisits++;
    } else {
      // resume_moon_rounds ends the round; the wave restarts after zombie_between_round_time, and with a full count when none remained.
      this.area = 'moon'; const w=this.savedWave;
      if (w&&w.total>w.killed) Object.assign(this,{round:w.round,total:w.total,killed:w.killed});
      else { this.round = w?.round??1; this.killed = 0; this.total = moonMaxZombies(this.round,this.data.rules); }
      this.phase = 'preparing'; this.countdown = 10; this.spawned = this.killed; this.moonStarted = true; this.savedWave = null;
    }
  }
  // _zombiemode_equip_hacker.gsc hacker_round_reward on end_of_round: 500 per extra round held, at most 2500.
  hackerReward(){if(this.hacker&&this.hackerRound!==null){const kept=Math.min(5,this.round-this.hackerRound-1);if(kept>0){this.points+=kept*500;this.totalScore+=kept*500;}}}
  nextRound() {
    this.hackerReward();
    this.nextDogRound = Infinity; super.nextRound();
    this.total=moonMaxZombies(this.round,this.data.rules);
    if(this.claymoresOwned)this.claymores=2;
  }
  // give_perk: Juggernog only raises the maximum (SetMaxHealth); no perk heals by itself.
  givePerk(id){
    this.perks.add(id);
    // give_perk: a solo Quick Revive grants one life.
    if(id==='specialty_quickrevive'){this.lives=1;this.soloLivesGiven++;}
  }
  buyPerk(id,free=false){
    const p=MOON_PERKS[id];
    if(!p||!this.canAct||this.hackerOut||this.perks.has(id)||(!free&&this.perks.size>=4)||
       (!free&&id==='specialty_quickrevive'&&this.soloLivesGiven>=3)||
       (!free&&!this.power&&this.area!=='earth'&&id!=='specialty_quickrevive')||(!free&&this.points<p.price))return false;
    if(!this.drink(id))return false;
    if(!free)this.spend(p.price);return true;
  }
  addRaw(n){this.points+=n;this.totalScore+=n;}
  losePerk(id){
    if(this.permanentPerks||!this.perks.has(id))return;
    this.perks.delete(id);this.health=Math.min(this.health,this.maxHealth);
    if(id==='specialty_quickrevive'&&this.lives>0)this.lives--;
    if(id===MULE&&this.inventory.length>2)this.takeThirdWeapon();
  }
  takeThirdWeapon(){
    const lost=this.inventory.splice(2)[0];if(this.pack?.weapon===lost)this.pack=null;
    if(this.slot>=this.inventory.length){this.slot=this.inventory.length-1;this.cancelReload();}return lost;
  }
  // _zombiemode.gsc player_damage_override: explosives deal 0 with PhD and 75 while above 75 health.
  damage(n,{explosive=false}={}){
    if(this.phase==='gameover'||this.lastStand||this.effects.invulnerable>this.time)return false;
    if(explosive){if(this.perks.has('specialty_flakjacket'))return false;if(this.health>75)n=75;}
    this.health=Math.max(0,this.health-n);this.damageTime=this.hurtTime=this.time;
    if(this.health/this.maxHealth<=.2)this.veryHurt=true;
    if(this.health<=0)this.down();
    return true;
  }
  down(){
    this.drinking=null;this.drinkLeft=0;this.cancelReload();this.hackerOut=false;this.hackerSwap=0;this.hackerLowering=false;this.effects.death_machine=0;
    // player_laststand: 5% (penalty_downed) rounded up to ten, the Mule Kick weapon, offhand grenades and all perks.
    this.points=Math.max(0,this.points-roundUpToTen(Math.trunc(this.points*(this.data.rules.penalty_downed??.05))));
    if(this.perks.has(MULE)&&!this.permanentPerks&&this.inventory.length>2)this.takeThirdWeapon();
    // perk_think: _retain_perks keeps every perk except a solo Quick Revive, which can then be bought again.
    if(!this.permanentPerks)this.perks.clear();else this.perks.delete('specialty_quickrevive');
    if(this.lives<=0){this.phase='gameover';this.lastEvent='Game over';return;}
    const best=this.inventory.map(w=>({w,rank:PISTOLS.indexOf(w.upgraded?w.id.replace('_zm','_upgraded_zm'):w.id)})).filter(p=>p.rank>=0).sort((a,b)=>b.rank-a.rank)[0];
    let weapon,source=null;
    if(!best||best.rank<=4){weapon=this.newWeapon('m1911_zm',true);weapon.reserve=weapon.mag*2;}
    else{
      source=best.w;const zapStored=source.alt&&source.altAmmo,ammo=zapStored?source.altAmmo:source,d=this.weaponDef({...source,alt:false});
      weapon={id:source.id,upgraded:source.upgraded,alt:false,mag:ammo.mag,leftMag:ammo.leftMag,reserve:Math.min(ammo.reserve,d.clipSize*2)};
      if(source.id==='ray_gun_zm'){const total=ammo.mag+ammo.reserve;weapon.mag=Math.min(d.clipSize,total);weapon.reserve=0;}
    }
    this.lastStand={left:10,weapon,source,given:weapon.mag+(weapon.leftMag??0)+weapon.reserve,grenades:this.grenades,tactical:this.equipmentAmmo,claymores:this.claymores,phase:this.phase,slot:this.slot};
    this.grenades=0;this.equipmentAmmo=0;this.claymores=0;this.phase='reviving';this.lastEvent='Last stand';this.fireLeft=this.leftFireLeft=.5;this.cancelReload();
  }
  // wait_and_revive: 10 s solo revive, then auto_revive and one life is spent.
  revive(){
    const ls=this.lastStand;this.lastStand=null;this.cancelReload();
    if(ls.source){
      const s=ls.source,ammo=s.alt&&s.altAmmo?s.altAmmo:s,used=ls.given-(ls.weapon.mag+(ls.weapon.leftMag??0)+ls.weapon.reserve);
      let left=used;const stock=Math.min(left,ammo.reserve);ammo.reserve-=stock;left-=stock;
      const clip=Math.min(left,ammo.mag);ammo.mag-=clip;left-=clip;if(ammo.leftMag!==undefined)ammo.leftMag=Math.max(0,ammo.leftMag-left);
    }
    this.grenades=ls.grenades;this.equipmentAmmo=ls.tactical;this.claymores=ls.claymores;
    this.phase=ls.phase==='preparing'&&this.countdown>0?'preparing':'fighting';
    this.health=this.maxHealth;this.veryHurt=false;this.lives=Math.max(0,this.lives-1);this.revives++;this.lastEvent='Revived';
    this.slot=Math.min(ls.slot,this.inventory.length-1);if(this.inventory[this.slot]===this.pack?.weapon)this.slot=Math.max(0,this.inventory.findIndex(w=>w!==this.pack.weapon));
    this.fireLeft=this.leftFireLeft=Math.max(.2,this.def.raiseTime??0);
  }
  fire(hand='right'){
    if(this.phase==='gameover'||this.phase==='reviving'&&!this.lastStand||this.drinking||this.meleeLeft>0||this.hackerOut||this.hackerSwap)return false;
    if(this.effects.death_machine>this.time&&!this.lastStand){if(this.fireLeft>0)return false;this.fireLeft=this.def.fireTime;this.shots++;return true;}
    const w=this.weapon,d=this.def,rof=this.perks.has('specialty_rof')?1.33:1;
    if(!w||!d||w===this.pack?.weapon||this.reloadLeft>0)return false;
    if(hand==='left'){if(!d.dualWield||this.leftFireLeft>0||!(w.leftMag>0))return false;w.leftMag--;this.leftFireLeft=(d.left?.fireTime||d.fireTime)/rof;}
    else{if(this.fireLeft>0||w.mag<=0)return false;w.mag--;this.fireLeft=d.fireTime/rof;}
    this.shots++;this.spread=Math.min(1,this.spread+(d.spread?.fireAdd??0));return true;
  }
  reload(){
    if(this.phase==='gameover'||this.phase==='reviving'&&!this.lastStand||this.drinking||this.meleeLeft>0||this.reloadLeft>0||this.hackerOut||this.hackerSwap||this.effects.death_machine>this.time&&!this.lastStand)return false;
    const w=this.weapon,d=this.def;if(!w||w===this.pack?.weapon||w.reserve<=0)return false;
    if(w.mag>=d.clipSize&&(!d.dualWield||(w.leftMag??0)>=(d.left?.clipSize??d.clipSize)))return false;
    this.reloadEmpty=w.mag===0;this.reloadInterrupted=false;this.reloadAdded=false;
    this.setReloadStage(d.segmentedReload?(d.reloadStartTime>0?'start':'shell'):'magazine');return true;
  }
  loadMagazine(){
    const d=this.def,w=this.weapon;let amount=Math.min(d.clipSize-w.mag,w.reserve);w.mag+=amount;w.reserve-=amount;
    if(d.dualWield){amount=Math.min((d.left?.clipSize??d.clipSize)-(w.leftMag??0),w.reserve);w.leftMag=(w.leftMag??0)+amount;w.reserve-=amount;}
    this.reloadAdded=true;
  }
  // Weapon files' reloadAddTime: ammunition enters the magazine before the animation ends.
  checkReloadAdd(){
    if(this.reloadStage!=='magazine'||this.reloadAdded)return;const d=this.def,add=(this.reloadEmpty?d.reloadEmptyAddTime:d.reloadAddTime)||0;
    if(add>0&&this.reloadDuration-this.reloadLeft>=add/(this.perks.has('specialty_fastreload')?2:1))this.loadMagazine();
  }
  finishReloadStage(){if(this.reloadStage==='magazine'){if(!this.reloadAdded)this.loadMagazine();this.cancelReload();return;}super.finishReloadStage();}
  // A switch lowers the current gun for its dropTime, then raises the next for its raiseTime (firstRaiseTime when new).
  switchWeapon(slot){
    if(!this.canAct||this.hackerOut||this.lastStand)return;
    const options=this.inventory.map((w,i)=>i).filter(i=>this.inventory[i]!==this.pack?.weapon);if(!options.length)return;
    const next=slot??options[(options.indexOf(this.slot)+1)%options.length];
    if(next===this.slot||!options.includes(next))return;
    const drop=this.def?.dropTime??0;this.slot=next;this.cancelReload();this.switching={drop,first:false};
    this.fireLeft=this.leftFireLeft=Math.max(.2,drop+(this.def.raiseTime??0));
  }
  giveWeapon(id,upgraded=false){
    let alt=false;if(id==='microwavegun_zm'){id='microwavegundw_zm';alt=true;}
    if(!this.data.weapons[id])return false;
    const owned=this.inventory.find(w=>w.id===id);
    if(owned){this.fillWeapon(owned);if(owned!==this.pack?.weapon)this.slot=this.inventory.indexOf(owned);this.cancelReload();return true;}
    const w=this.newWeapon(id,upgraded);this.fillWeapon(w);if(alt)this.setAlt(w,true);
    const drop=this.weapon&&this.weapon!==this.pack?.weapon?this.def?.dropTime??0:0,limit=this.perks.has(MULE)?3:2;
    if(this.inventory.length<limit){this.inventory.push(w);this.slot=this.inventory.length-1;}
    else{if(this.inventory[this.slot]===this.pack?.weapon)this.slot=this.inventory.findIndex(x=>x!==this.pack.weapon);this.inventory[this.slot]=w;}
    this.cancelReload();this.switching={drop,first:true};this.fireLeft=this.leftFireLeft=Math.max(.2,drop+(this.def.firstRaiseTime??this.def.raiseTime??0));return true;
  }
  setAlt(w,alt){
    if(!!w.alt===alt)return;
    w[w.alt?'altAmmo':'mainAmmo']={mag:w.mag,reserve:w.reserve,leftMag:w.leftMag};w.alt=alt;
    const d=this.weaponDef(w),ammo=w[alt?'altAmmo':'mainAmmo']??{mag:d.clipSize,reserve:d.startAmmo??d.maxAmmo,leftMag:d.dualWield?d.left?.clipSize??d.clipSize:undefined};
    Object.assign(w,{mag:ammo.mag,reserve:ammo.reserve,leftMag:ammo.leftMag});
  }
  // Alternate weapons (Wave Gun / Zap Guns, upgraded M16 and AUG attachments) switch with altDropTime + altRaiseTime.
  toggleAlt(){
    const w=this.weapon,base=w&&this.data.weapons[w.id];
    if(!this.armed||this.lastStand||this.reloadLeft||!base||!(base.alt||w.upgraded&&base.upgrade?.attachment))return false;
    const before=this.def;this.setAlt(w,!w.alt);const after=this.def;
    this.fireLeft=this.leftFireLeft=Math.max(.3,(before.altDropTime||0)+(after.altRaiseTime||0));this.spread=0;return true;
  }
  toggleWave(){return this.weapon?.id==='microwavegundw_zm'&&this.toggleAlt();}
  // Timed non-perk viewmodel actions share the perk-bottle lockout.
  startAction(id){if(!this.data.perkDrinks?.[id]||this.drinking||this.lastStand||this.phase==='gameover')return false;return this.drink(id);}
  finishAction(id){
    // The gun is raised again after the P.E.S. mask animation.
    if(id==='pes_on'||id==='pes_off')this.fireLeft=this.leftFireLeft=Math.max(this.fireLeft,this.def?.raiseTime??0);
    if(id==='knuckle'&&this.weapon===this.pack?.weapon){const other=this.inventory.findIndex(w=>w!==this.pack.weapon);if(other>=0){this.slot=other;this.fireLeft=Math.max(.2,this.def.raiseTime??0);}}
    this.onAction?.(id);
  }
  giveEquipment(type){if(!this.data.equipment?.[type])return false;this.equipment=type;this.equipmentAmmo=this.data.equipment[type].maxAmmo||3;return true;}
  takeHacker(){this.hacker=true;this.hackerRound=this.round;this.hackerOut=false;}
  // _zombiemode_equip_hacker.gsc: equip_hacker_zm raiseTime 1.0, dropTime 0.75; the gun is unavailable while it is out.
  toggleHacker(){
    if(!this.hacker||this.lastStand||this.drinking||this.meleeLeft||this.hackerSwap||this.phase==='gameover'||this.effects.death_machine>this.time)return false;
    this.cancelReload();
    if(this.hackerOut){this.hackerLowering=true;this.hackerSwap=this.data.hacker?.dropTime??.75;}
    else{this.hackerOut=true;this.hackerSwap=this.data.hacker?.raiseTime??1;}
    return true;
  }
  buyLethal(id){
    const def=this.data.lethal?.[id];if(!def||!this.canAct||this.hackerOut)return false;
    if(this.lethal===id){const cost=roundUpToTen(def.price*.5);if(this.grenades>=def.maxAmmo||!this.spend(cost))return false;this.grenades=def.maxAmmo;return true;}
    if(!this.spend(def.price))return false;this.lethal=id;this.grenades=def.maxAmmo;return true;
  }
  buyClaymores(){if(!this.canAct||this.hackerOut||this.claymoresOwned||!this.spend(1000))return false;this.claymoresOwned=true;this.claymores=2;return true;}
  scoreHit(killed=false,head=false,melee=false){
    const info=this.hitInfo??{},location=typeof head==='string'?head:head?'head':info.location;
    this.hits++;if(killed){this.kills++;this.killed++;if(location==='head'||location==='helmet')this.headshots++;}
    if(this.lastStand)return;
    if(!killed){if(!info.noDamagePoints)this.addPoints(10);return;}
    if(info.points!==undefined){this.addPoints(info.points);return;}
    // _zombiemode_score.gsc player_add_points_kill_bonus; ballistic_knife_death adds the melee bonus.
    const bonus=melee||info.cause==='melee'||info.cause==='ballistic'?80:{head:50,helmet:50,neck:20,torso_upper:10,torso_lower:10}[location]??0;
    this.addPoints(50+bonus);
  }
  powerup(type){
    if(type==='full_ammo'){
      if(this.lastStand)return;
      for(const w of this.inventory)this.fillReserve(w);
      this.grenades=this.data.lethal?.[this.lethal]?.maxAmmo??4;if(this.equipment)this.equipmentAmmo=this.data.equipment[this.equipment].maxAmmo||3;if(this.claymoresOwned)this.claymores=2;
      return;
    }
    super.powerup(type);
  }
  fillReserve(w){
    for(const alt of [false,true]){const d=this.weaponDef({...w,alt});if(alt&&!this.data.weapons[w.id].alt&&!d.attachmentActive)continue;
      if(alt===!!w.alt)w.reserve=d.maxAmmo;else if(w[alt?'altAmmo':'mainAmmo'])w[alt?'altAmmo':'mainAmmo'].reserve=d.maxAmmo;}
  }
  beginPack(){
    const w=this.inventory[this.slot];
    if(!this.armed||this.lastStand||this.pack||w.upgraded||!this.data.weapons[w.id]?.upgrade||this.points<5000)return false;
    // third_person_weapon_upgrade: 0.5 + 0.35 + 3 + 0.5 s before collection; packapunch_timeout 15 s.
    this.spend(5000);this.cancelReload();this.pack={weapon:w,readyAt:this.time+4.35,expires:this.time+19.35};this.startAction('knuckle');return true;
  }
  takePack(){
    if(['gameover','reviving'].includes(this.phase)||this.hackerOut||!this.pack||!this.inventory.includes(this.pack.weapon)||this.time<this.pack.readyAt||this.time>this.pack.expires)return false;
    // The upgraded gun is a new weapon: the held one drops, then the upgrade plays its first raise.
    const w=this.pack.weapon,drop=this.weapon!==w?this.def?.dropTime??0:0;w.upgraded=true;w.alt=false;w.altAmmo=w.mainAmmo=undefined;this.fillWeapon(w);
    this.slot=this.inventory.indexOf(w);this.pack=null;this.cancelReload();this.switching={drop,first:true};this.fireLeft=this.leftFireLeft=Math.max(.2,drop+(this.def.firstRaiseTime??this.def.raiseTime??0));return true;
  }
  // T5 player_sprintTime 4 s; Stamin-Up (specialty_longersprint) doubles it.
  sprint(dt,wanting){
    const max=this.perks.has('specialty_longersprint')?8:4;
    if(wanting&&this.sprintLeft>0&&!this.sprintLock){this.sprintLeft=Math.max(0,this.sprintLeft-dt);if(!this.sprintLeft)this.sprintLock=1;return true;}
    this.sprintLeft=Math.min(max,this.sprintLeft+dt);this.sprintLock=Math.max(0,this.sprintLock-dt);return false;
  }
  buyDoor(door) {
    if (!this.canAct || this.hackerOut || this.openDoors.has(door.name) || !this.spend(door.cost)) return false;
    this.openDoors.add(door.name); if (door.flag) this.flags.add(door.flag); return true;
  }
  // A refusal for points sets lastDenied (no_purchase and the no_money line); a full refill is silent.
  buyWeapon(id) {
    this.lastDenied = false;
    if (!this.canAct || this.hackerOut) return false;
    const def = this.data.weapons[id]; if (!def) return false;
    const owned = this.inventory.find(w => w.id === id);
    if (owned) {
      const od=this.weaponDef({...owned,alt:false}),capacity = od.startAmmo??od.maxAmmo,ammo=owned.alt&&owned.mainAmmo?owned.mainAmmo:owned;
      // _zombiemode_weapons.gsc weapon_spawn_think: hacked wall buys reverse the upgraded ammo price.
      const basePrice=def.ammoPrice??roundUpToTen(def.price*.5),price=this.hackedWeapons.has(id)?owned.upgraded?basePrice:4500:owned.upgraded?4500:basePrice;
      if (ammo.reserve >= capacity) return false;
      if (!this.spend(price)) { this.lastDenied = true; return false; }
      ammo.reserve = capacity; return true;
    }
    if (!this.spend(def.price)) { this.lastDenied = true; return false; }
    this.giveWeapon(id); return true;
  }
  snapshot(){return {...super.snapshot(),lives:this.lives,soloLivesGiven:this.soloLivesGiven,lastStand:this.lastStand?{left:this.lastStand.left,weapon:{...this.lastStand.weapon}}:null,lethal:this.lethal,claymores:this.claymores,hackerOut:this.hackerOut,leftFireLeft:this.leftFireLeft};}
}
