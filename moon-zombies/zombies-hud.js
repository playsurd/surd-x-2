// Native T5 menu coordinates: .work/menus_t5/hud_zombie_digest.txt, weaponinfo_zombie and dpad_zombie.
const $=id=>document.getElementById(id), U='ui/';
const perkIcons={specialty_armorvest:'juggernaut',specialty_quickrevive:'quickrevive',specialty_fastreload:'fastreload',specialty_rof:'doubletap'};
export class ZombiesHud {
  constructor({moon=false}={}){
    this.moon=moon;document.body.classList.add('native-hud',moon?'moon-ui':'kino-ui');
    const root=moon?$('combat-hud'):document.body;
    const panel=document.createElement('div');panel.id='native-weapon';panel.innerHTML='<i class="ammo-blood"></i><i class="ammo-lines"></i><i class="dpad-light"></i><i class="dpad-frame"></i><i class="dpad-rim"></i><span id="native-up-key"></span><span id="native-right-key"></span><span id="native-down-key"></span><span id="native-claymore"></span><span id="native-attachment"></span>';
    root.append(panel);this.panel=panel;
    panel.append($(moon?'weapon':'weapon-name'),$('ammo'));
    const left=document.createElement('span');left.id='clip-left';$('ammo').prepend(left);
    if(!moon){
      const score=document.createElement('div');score.id='score';score.append($('points'));root.append(score);
      const slots=document.createElement('div');slots.id='offhand';slots.innerHTML='<span id="equip-slot"></span><span id="tactical"></span>';slots.append($('grenades'));root.append(slots);
      const chalk=document.createElement('div');chalk.id='native-round';chalk.innerHTML='<i></i><i></i><b></b>';root.append(chalk);
      root.append($('perks'),$('reload-label'));$('perks').classList.add('native-perks');
      const popups=document.createElement('div');popups.id='score-popups';root.append(popups);
    }
    panel.append($('offhand'));this.key='';this.lastPoints=null;
  }
  update(s,{state,controller,touch,active=true}={}){
    const moon=this.moon,def=s.def,weapon=s.weapon,pad=controller?.usingPad;
    this.panel.hidden=!active||s.phase==='gameover';if(!moon){$('score').hidden=$('native-round').hidden=$('perks').hidden=!active;}
    const dual=def.dualWield&&Number.isFinite(weapon.leftMag);$('clip-left').hidden=!dual;$('clip-left').textContent=dual?weapon.leftMag:'';
    const key=[s.grenades,s.equipment,s.equipmentAmmo,s.hacker,state?.hasSuit,s.claymoresOwned,s.claymores,s.monkeysOwned,s.monkeys,def.id,pad,touch?.mode].join('|');
    if(key!==this.key){this.key=key;
      const icon=(path,count,label)=>`<img src="${path}" alt="${label}"><b>${count}</b>`;
      $('grenades').innerHTML=icon(U+'hud_us_grenade.png',s.grenades,'Grenades');
      $('tactical').innerHTML=moon?(s.equipment?icon('moon/textures/hud/'+(s.equipment==='zombie_black_hole_bomb'?'hud_blackhole':'hud_quantum_bomb')+'.png',s.equipmentAmmo,'Tactical equipment'):''):(s.monkeysOwned?icon('textures/hud_cymbal_monkey.png',s.monkeys,'Monkey bombs'):'');
      $('equip-slot').innerHTML=moon&&(s.hacker||state?.hasSuit)?`<img alt="${s.hacker?'Hacker':'P.E.S.'}" src="moon/textures/hud/${s.hacker?'zom_hud_icon_hacker':'icon_helmet'}.png">`:'';
      $('native-claymore').innerHTML=s.claymoresOwned?icon('textures/hud_claymore.png',s.claymores,'Claymores'):'';
      $('native-up-key').textContent=moon?(pad?'↑':touch?.mode?'P.E.S.':'[Q]'):'';
      $('native-down-key').textContent=s.claymoresOwned?(pad?'↓':touch?.mode?'':'[4]'):'';
      $('native-right-key').textContent=(moon&&def.id.includes('microwave')||def.upgraded&&def.attachment)?(pad?'→':moon?'[B]':'[5]'):'';
    }
    if(!moon){
      const round=$('native-round'),n=s.round;round.style.setProperty('--chalk',s.phase==='preparing'?'#ddd':'#360000');
      [...round.querySelectorAll('i')].forEach((el,i)=>{const count=n<=10?Math.min(5,Math.max(0,n-i*5)):0;el.hidden=!count;el.style.setProperty('--mark',count?`url(${U}chalkmarks_${count}.png)`:'none');});round.querySelector('b').textContent=n>10?n:'';
      const perks=[...s.perks].filter(k=>perkIcons[k]).map(k=>`<img title="${k.replace('specialty_','')}" alt="${perkIcons[k]}" src="${U}specialty_${perkIcons[k]}_zombies.png">`).join('');if($('perks').innerHTML!==perks)$('perks').innerHTML=perks;
      $('points').textContent=s.points;
      if(this.lastPoints!==null&&this.lastPoints!==s.points&&s.time>=this.lastTime){const p=document.createElement('span'),diff=s.points-this.lastPoints;p.textContent=(diff>0?'+':'')+diff;p.className=diff<0?'minus':'';$('score-popups').append(p);setTimeout(()=>p.remove(),650);}
      this.lastPoints=s.points;this.lastTime=s.time;
      const low=!s.reloadLeft&&!s.weaponUnavailable&&weapon.mag<=Math.max(1,Math.floor(def.clipSize/4));
      $('reload-label').textContent=low?(weapon.reserve>0?`[${pad?controller.glyph('reload'):touch?.mode?'RELOAD':'R'}] Reload`:weapon.mag?'Low Ammo':'No Ammo'):'';
      if(pad){$('prompt').innerHTML=$('prompt').innerHTML.replace(/<kbd>F<\/kbd>/g,`<kbd>${controller.glyph('use')}</kbd>`).replace(/Hold F/g,'Hold '+controller.glyph('use'));}
    }
  }
}
