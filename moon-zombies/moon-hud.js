// T5 zombie HUD: _zombiemode.gsc chalk/game over, _zombiemode_score.gsc highlights, _zombiemode_perks.gsc perk shaders,
// _zombiemode_powerups.gsc power-up shaders and Max Ammo text, _gameskill.gsc overlay_low_health, P.E.S. overlay.
import { ZombiesHud } from './zombies-hud.js';
const $=id=>document.getElementById(id),T='moon/textures/hud/';
const PERK_ICON={specialty_armorvest:'juggernaut',specialty_quickrevive:'quickrevive',specialty_fastreload:'fastreload',specialty_rof:'doubletap',specialty_longersprint:'marathon',
  specialty_flakjacket:'divetonuke',specialty_deadshot:'ads',specialty_additionalprimaryweapon:'three_guns'};
// Localized hint strings (en_common_zombie / en_patch / en_zombie_moon string tables).
// ZOMBIE_HACK, ZOMBIE_HACK_NO_COST (en_patch) and ZOMBIE_MOON_DISABLE_DIGGER (en_zombie_moon).
const LOC={HACK:'Press & Hold ^3[{+activate}]^7 to hack [Cost: &&1]',HACK_NO_COST:'Press & Hold ^3[{+activate}]^7 to hack',DIGGER_HACK:'Hold ^3[{+activate}]^7 to hack the Excavator',WEAPON:'Hold ^3[{+activate}]^7 to buy &&1 [Cost: &&2]',WEAPONCOSTAMMO:'Hold ^3[{+activate}]^7 Weapon [&&1], Ammo [&&2]',
  OPEN_DOOR:'Hold ^3[{+activate}]^7 to Open Door [Cost: &&1]',CLEAR_DEBRIS:'Hold ^3[{+activate}]^7 to Clear Debris [Cost: &&1]',ELECTRIC_SWITCH:'Hold ^3[{+activate}]^7 to Turn On the Power',
  NEED_POWER:'You must turn on the power first!',RANDOM_WEAPON:'Press^3 [{+activate}] ^7for a Random Weapon [Cost: &&1]',TRADE_WEAPONS:'Hold ^3[{+activate}]^7 to trade Weapons',
  PACKAPUNCH:'Hold ^3[{+activate}]^7 to buy Pack A Punch [Cost: &&1]',GET_UPGRADED:'Hold^3 [{+activate}] ^7to take your upgraded weapon',REBUILD:'Hold ^3[{+activate}]^7 to Rebuild Barrier',
  GASMASK:'Hold ^3[{+activate}]^7 to trade equipment for P.E.S.',HACKER:'Hold ^3[{+activate}]^7 to trade equipment for Hacker',DIGGER:'Hold ^3[{+activate}]^7 to hack the Excavator',
  BOWIE:'Hold ^3[{+activate}]^7 to buy Bowie Knife [Cost: &&1]',RELOAD:'^3[{+reload}]^7 Reload',LOW_AMMO:'Low Ammo',NO_AMMO:'No Ammo'};
const PERK_LOC={specialty_armorvest:'Jugger-Nog',specialty_quickrevive:'a Revive',specialty_fastreload:'Speed Cola',specialty_rof:'Double Tap Root Beer',specialty_longersprint:'Stamin-Up',
  specialty_flakjacket:'PHD Flopper',specialty_deadshot:'Deadshot Daiquiri',specialty_additionalprimaryweapon:'Mule Kick'};
const SQ_ICON={generator:'zom_hud_icon_vril_combo',wire:'hud_wire',cgenerator:'zom_hud_icon_vril_combo_select',datalog:'zom_icon_theater_reel'};
const PERK_COST={specialty_quickrevive:500,specialty_armorvest:2500,specialty_fastreload:3000,specialty_rof:2000,specialty_longersprint:2000,specialty_flakjacket:2000,specialty_deadshot:1000,specialty_additionalprimaryweapon:4000};
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
// redFlashingOverlay()/fadeFunc() keyframes for one pulse.
function pulse(severity,mult){const p=.8,fadeIn=p*.1,stay=p*(.1+severity*.2),half=p*(.1+severity*.1),full=p*.3,rest=Math.max(0,p-fadeIn-stay-half-full);
  return [[fadeIn,mult],[stay,mult],[half,mult*(.8+severity*.1)],[full,mult*(.5+severity*.3)],[rest,mult*(.5+severity*.3)]];}

export class MoonHud {
  constructor({combat,features,state,touch,controller}){Object.assign(this,{combat,features,state,touch,controller});this.clock=0;this.queue=[];this.popups=[];this.reset();
    this.weaponHud=new ZombiesHud({moon:true});combat.audio.onPowerup=type=>this.powerup(type);}
  reset(){
    this.queue.length=0;this.clock=0;this.round=null;this.area=null;this.phase=null;this.points=null;this.weaponKey=null;this.weaponShown=0;this.perkKey='';this.nmlShown=0;this.moonStarted=null;this.sqIcons=[];this.sqKey=null;this.flashing=null;this.hurtAt=null;this.blur=0;this.blurUntil=0;this.fadingBlur=null;
    for(const p of this.popups)p.el.remove();this.popups=[];this.over?.cancel();this.over=null;
    const chalk=$('chalk');if(chalk){chalk.style.transition='none';chalk.style.opacity=0;this.setChalk(0);this.chalkColor('red',0);}
    if($('gameover')){$('gameover').hidden=true;$('gameover').classList.remove('shown');$('combat-hud').classList.remove('over');$('nml-survived')?.classList.remove('shown');}
    if($('maxammo'))$('maxammo').style.opacity=0;if($('nuke-flash'))$('nuke-flash').style.opacity=0;if($('lowhealth'))$('lowhealth').style.opacity=0;
  }
  after(seconds,fn){this.queue.push({at:this.clock+seconds,fn});}
  key(){return this.controller?.usingPad?this.controller.glyph('use'):this.touch?.mode?'USE':'F';}
  // "^3" yellow, "^7" white; [{+activate}] becomes the bound key.
  format(text,...args){
    let s=esc(text).replace(/&amp;&amp;(\d)/g,(m,n)=>esc(args[n-1]??''));
    s=s.replace(/\[\{\+activate\}\]/g,'['+this.key()+']').replace(/\[\{\+reload\}\]/g,'['+(this.controller?.usingPad?this.controller.glyph('reload'):this.touch?.mode?'RELOAD':'R')+']');
    let open=false;s=s.replace(/\^(\d)/g,(m,c)=>{const out=(open?'</span>':'')+(c==='7'?'':'<span class="c'+c+'">');open=c!=='7';return out;});return s+(open?'</span>':'');
  }
  hint(target){
    if(!target)return '';const s=this.combat.session,f=this.features;
    if(target.kind==='door')return this.format(target.entity.targetname==='zombie_debris'?LOC.CLEAR_DEBRIS:LOC.OPEN_DOOR,target.door.cost);
    if(target.kind==='suit')return this.format(LOC.GASMASK);
    if(target.kind==='power')return this.format(LOC.ELECTRIC_SWITCH);
    if(target.kind==='weapon'){const w=target.weapon,owned=s.inventory.find(i=>i.id===w.id);
      return owned?this.format(LOC.WEAPONCOSTAMMO,w.price,target.label?.match(/(\d+)\s*$/)?.[1]??w.ammoPrice??Math.ceil(w.price/2)):this.format(LOC.WEAPON,w.name,w.price);}
    if(target.kind!=='feature')return '';
    const t=target.feature,q=f.quest;
    if(t.silent)return '';
    if(t.kind==='hack'){const h=f.hacker.hint(t.spot);return h.loc==='DIGGER'?this.format(LOC.DIGGER_HACK):h.loc==='HACK'?this.format(LOC.HACK,h.cost):this.format(LOC.HACK_NO_COST);}
    if(t.kind==='perk'){if(!PERK_LOC[t.perk])return esc(t.label);if(!s.power&&s.area!=='earth'&&t.perk!=='specialty_quickrevive')return this.format(LOC.NEED_POWER);
      if(s.hacker&&s.perks.has(t.perk)&&!s.permanentPerks)return esc(t.label.replace('Hold F','Hold '+this.key()));
      return this.format('Hold ^3[{+activate}]^7 to buy '+PERK_LOC[t.perk]+' [Cost: &&1]',PERK_COST[t.perk]);}
    if(t.kind==='box'){const roll=f.box.at(t.e);return roll?roll.ready&&!roll.teddy?this.format(LOC.TRADE_WEAPONS):'':this.format(LOC.RANDOM_WEAPON,s.effects.fire_sale>s.time?10:950);}
    if(t.kind==='pack')return s.pack?s.time>=s.pack.readyAt?this.format(LOC.GET_UPGRADED):'':this.format(LOC.PACKAPUNCH,5000);
    if(t.kind==='barrier')return this.format(LOC.REBUILD);
    if(t.kind==='hacker')return this.format(LOC.HACKER);
    if(t.kind==='digger'&&s.hacker)return this.format(LOC.DIGGER);
    if(t.kind==='bowie'&&!s.bowie)return this.format(LOC.BOWIE,3000);
    return esc(t.label.replace(/\b(Press|Hold) F\b/g,(_,verb)=>(this.controller?.usingPad?'Hold':verb)+' '+this.key()));
  }
  setChalk(round){
    const [a,b]=document.querySelectorAll('#chalk i'),n=$('round');
    const mark=k=>k?`url(${T}chalkmarks_${k}.png)`:'none';
    a.style.setProperty('--mark',mark(round>=1&&round<=10?Math.min(5,round):0));b.style.setProperty('--mark',mark(round>5&&round<=10?round-5:0));
    a.hidden=!(round>=1&&round<=10);b.hidden=!(round>5&&round<=10);n.textContent=round>10?String(round):'';
  }
  chalkColor(color,seconds){const c=$('chalk');c.style.setProperty('--chalk',color==='white'?'#ffffff':'#360000');
    for(const el of c.children)el.style.transition=`background-color ${seconds}s linear, color ${seconds}s linear`;}
  chalkFade(alpha,seconds){const c=$('chalk');c.style.transition=`opacity ${seconds}s linear`;c.style.opacity=alpha;}
  // chalk_one_up() for a non-intro round.
  chalkUp(round){
    this.chalkSeq=(this.chalkSeq??0)+1;const seq=this.chalkSeq;
    this.chalkFade(0,.5);
    this.after(.5,()=>{if(seq!==this.chalkSeq)return;this.setChalk(round);this.chalkColor('white',0);this.chalkFade(1,2);});
    this.after(2.5,()=>{if(seq===this.chalkSeq)this.chalkColor('red',1);});
  }
  // chalk_round_over(): to white, pulse, back to red while fading out.
  chalkOver(time){
    this.chalkSeq=(this.chalkSeq??0)+1;const seq=this.chalkSeq;this.chalkColor('white',time*.25);
    for(let q=0;q<time;q++){this.after(q,()=>{if(seq===this.chalkSeq)this.chalkFade(0,.5);});this.after(q+.5,()=>{if(seq===this.chalkSeq)this.chalkFade(1,.5);});}
    this.after(time,()=>{if(seq!==this.chalkSeq)return;this.chalkColor('red',time*.25);this.chalkFade(0,time*.25);});
  }
  powerup(type){
    if(type==='full_ammo'){const el=$('maxammo');el.textContent='Max Ammo!';el.style.transition='opacity .5s linear, transform 0s';el.style.transform='none';el.style.opacity=1;
      this.after(.5,()=>{el.style.transition='opacity 1.5s linear, transform 1.5s linear';el.style.opacity=0;el.style.transform=`translateY(calc(var(--u)*-20))`;});}
    if(type==='nuke'){const el=$('nuke-flash');el.style.transition='opacity .2s linear';el.style.opacity=.8;this.after(.5,()=>{el.style.transition='opacity 1s linear';el.style.opacity=0;});}
  }
  popup(value){
    const el=document.createElement('span');el.textContent=(value>0?'+':'-')+Math.abs(value);if(value<0)el.classList.add('minus');$('score-popups').append(el);
    this.popups.push({el,age:0,dx:20+Math.floor(Math.random()*40),dy:-15+Math.floor(Math.random()*30)});
  }
  update(dt,{active,environment,exposure}){
    const c=this.combat,s=c.session,f=this.features,st=this.state;this.clock+=dt;
    for(const item of this.queue.filter(q=>q.at<=this.clock)){this.queue.splice(this.queue.indexOf(item),1);item.fn();}
    $('visor').hidden=!(st.overlay??st.suit)||!active;
    // Chalk: blank in No Man's Land (level.chalk_override = " "), chalk_one_up at round start, chalk_round_over at round end.
    if(s.area!==this.area){
      if(s.area==='moon'&&s.phase==='fighting')this.chalkUp(s.round);else{this.chalkSeq=(this.chalkSeq??0)+1;this.chalkFade(0,.5);}
      this.area=s.area;this.phase=s.phase;
    }else if(s.area==='moon'&&s.phase!==this.phase){
      if(s.phase==='fighting')this.chalkUp(s.round);else if(this.phase==='fighting'&&s.phase==='preparing')this.chalkOver(Math.max(1,Math.round((s.countdown||10)-2)));
      this.phase=s.phase;
    }
    // Score and set_player_score_hud() highlights.
    if(this.points!==null&&s.points!==this.points)this.popup(s.points-this.points);this.points=s.points;$('points').textContent=s.points;
    for(const p of [...this.popups]){p.age+=dt;const t=Math.min(1,p.age/.5);p.el.style.translate=`${-p.dx*t}em ${p.dy*t}em`;p.el.style.fontSize='';
      p.el.style.translate=`calc(var(--u)*${-p.dx*t}) calc(var(--u)*${p.dy*t})`;p.el.style.opacity=p.age<.25?1:Math.max(0,1-(p.age-.25)/.25);
      if(p.age>=.5){p.el.remove();this.popups.splice(this.popups.indexOf(p),1);}}
    const perks=[...s.perks].join();if(perks!==this.perkKey){this.perkKey=perks;$('perk-icons').innerHTML=[...s.perks].filter(p=>PERK_ICON[p]).map(p=>`<img alt="" data-perk="${p}" src="${T}specialty_${PERK_ICON[p]}_zombies.png">`).join('');}
    if(this.moonStarted===false&&s.moonStarted)this.nmlSurvived(s);this.moonStarted=s.moonStarted;
    // add_sidequest_icon / remove_sidequest_icon: 32x32 shaders centred at user_right -257 + 34n on the bottom edge,
    // re-packed on removal. Solo Richtofen starts with the Vril generator (init_sidequest with COTD and EOA done).
    const q=this.features.quest,held={generator:!q.vgPlaced,wire:q.wire&&!q.wirePlaced,cgenerator:q.vgCharged&&q.swappedAt===null,datalog:this.features.stories.carrying};
    this.sqIcons=this.sqIcons.filter(k=>held[k]);for(const k in held)if(held[k]&&!this.sqIcons.includes(k))this.sqIcons.push(k);
    if(this.sqIcons.join()!==this.sqKey){this.sqKey=this.sqIcons.join();$('sq-icons').innerHTML=this.sqIcons.map((k,i)=>`<img alt="" src="${T}${SQ_ICON[k]}.png" style="right:calc(var(--u)*${241-34*i})">`).join('');}
    for(const el of document.querySelectorAll('#powerups i')){const left=(s.effects[el.dataset.powerup]??0)-s.time,phase=(this.clock%(left<5?.25:.43));
      el.style.opacity=left<=0?0:left<5?phase<.15?1:0:left<10?phase<.25?1:0:1;}
    // Ammo counter, weapon name (shown after a switch), offhand and equipment icons.
    const dm=s.effects.death_machine>s.time,def=s.def,key=def.id+(def.upgraded?'+':'')+s.slot;
    if(key!==this.weaponKey){this.weaponKey=key;this.weaponShown=this.clock;$('weapon').classList.remove('faded');}
    if(this.clock-this.weaponShown>3)$('weapon').classList.add('faded');
    $('weapon').textContent=dm?'Death Machine':def.name;$('clip').textContent=dm?'':s.weapon.mag;$('stock').textContent=dm?'':s.weapon.reserve;
    this.weaponHud.update(s,{state:st,controller:this.controller,touch:this.touch,active});
    const low=!dm&&!s.reloadLeft&&s.phase!=='reviving'&&def.clipSize>1&&s.weapon.mag<=Math.max(1,Math.floor(def.clipSize/4));
    $('ammo-warning').innerHTML=!active||!low?'':s.weapon.mag===0&&s.weapon.reserve===0?this.format(LOC.NO_AMMO):s.weapon.reserve>0?this.format(LOC.RELOAD):this.format(LOC.LOW_AMMO);
    $('hacking').hidden=!f.hack;
    // old_style_health_overlay(): red flashing below healthOverlayCutoff (0.2 on normal), restarted by damage.
    const ratio=s.health/s.maxHealth,overlay=$('lowhealth');
    if(s.phase==='gameover'||ratio>=1){if(this.flashing){this.flashing=null;overlay.style.transition='opacity .5s linear';overlay.style.opacity=0;}}
    else if(ratio<=.2&&(!this.flashing||this.hurtAt!==s.damageTime)){
      if(!this.flashing){this.fadingBlur={from:3.6,time:0,duration:2};}
      this.hurtAt=s.damageTime;const frames=[...pulse(1,1)];for(let t=frames.reduce((a,f)=>a+f[0],0);t<5;t+=.8)frames.push(...pulse(.9,1));frames.push(...pulse(.65,.8),...pulse(0,.6),[.5,0]);
      this.flashing={frames,age:0,from:+overlay.style.opacity||0};overlay.style.transition='none';
    }
    if(this.flashing){const fl=this.flashing;fl.age+=dt;let t=fl.age,from=fl.from,alpha=0,done=true;
      for(const [d,to] of fl.frames){if(t<=d){alpha=d?from+(to-from)*(t/d):to;done=false;break;}t-=d;from=to;}
      overlay.style.opacity=done?0:alpha;if(done)this.flashing=null;}
    // SetBlur pulses (suffocation) and startfadingblur(3.6, 2) when very hurt.
    let blur=Math.max(this.clock<this.blurUntil?this.blur:0,f.gassed?8:s.time<f.shockUntil?6:0);
    if(this.fadingBlur){const b=this.fadingBlur;b.time+=dt;blur=Math.max(blur,b.from*(1-b.time/b.duration));if(b.time>=b.duration)this.fadingBlur=null;}
    const canvas=document.querySelector('body>canvas');if(canvas){const css=blur>.05?`blur(${(blur*.5*innerHeight/480).toFixed(2)}px)`:'';if(canvas.style.filter!==css)canvas.style.filter=css;}
  }
  setBlur(intensity,duration){this.blur=intensity;this.blurUntil=this.clock+duration;}
  // end_game(): GAME OVER and the survival line fade in over 1 s; the overlay holds, fades out, then the menu returns.
  nmlSurvived(s){
    const t=Math.floor(s.earthTime),p=n=>String(n).padStart(2,'0'),el=$('nml-survived');if(!el)return;
    el.textContent=`You Survived ${p(Math.floor(t/3600))}:${p(Math.floor(t/60)%60)}:${p(t%60)}`;this.nmlShown=this.clock+4;
    el.classList.remove('shown');void el.offsetWidth;el.classList.add('shown');this.after(4,()=>el.classList.remove('shown'));
  }
  gameOver(s,done){
    const el=$('gameover');let cancelled=false;
    const time=t=>{t=Math.floor(t);const p=n=>String(n).padStart(2,'0');return `${p(Math.floor(t/3600))}:${p(Math.floor(t/60)%60)}:${p(t%60)}`;};
    // end_game: ZOMBIE_SURVIVED_NOMANS before the first Moon arrival, nothing while display_time_survived is up, then rounds.
    $('survived').textContent=!s.moonStarted?'You Survived '+time(s.earthTime):this.nmlShown>this.clock?'':s.round<2?'You Survived 1 Round':`You Survived ${s.round} Rounds`;
    // The ammo counter and score hide (ammoCounterHide, miniscoreboardhide) and destroy_chalk_hud removes the round.
    $('combat-hud').classList.add('over');
    el.hidden=false;el.classList.remove('shown');void el.offsetWidth;el.classList.add('shown');
    // 0.1 + 1 + 2 s to intermission(), zombie_intermission_time (15 s), a 1 s fade and 1.5 s before the level ends.
    const timers=[setTimeout(()=>el.classList.remove('shown'),18100),setTimeout(()=>{if(!cancelled){el.hidden=true;done();}},19600)];
    this.over={cancel(){cancelled=true;timers.forEach(clearTimeout);el.hidden=true;el.classList.remove('shown');$('combat-hud').classList.remove('over');}};
  }
}
