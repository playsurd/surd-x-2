// Frontend / pause / options flow shared by the two T5 maps. Follows Cheese Cube's menu navigation.
import { PlayerCounter } from './player-counter.js';
import { DONATION_MESSAGE, DONATION_WALLETS } from './donate-config.js';
const $ = id => document.getElementById(id);
export class ZombiesMenu {
  constructor({moon = false} = {}) {
    this.moon = moon; this.root = $('menu'); this.root.className = 'game-menu frontend';
    const name = moon ? 'MOON' : 'KINO DER TOTEN', image = moon ? 'moon' : 'theater';
    this.root.innerHTML = `<img class="menu-backdrop" src="ui/loadscreen_zombie_${image}.png" alt=""><div class="menu-shade"></div>
      <div class="menu-content panel"><header class="menu-heading"><p>CALL OF DUTY: BLACK OPS</p><h1 id="menu-title">ZOMBIES</h1><p id="mode-label">SOLO PLAY</p></header>
      <nav id="menu-main" class="menu-list" aria-label="Zombies menu">
        <button id="start" data-nav-default disabled>START GAME</button>
        <button data-open="menu-options">OPTIONS</button><button data-open="menu-controls">CONTROLS</button>
        ${moon ? '<button id="new-run" disabled hidden>RESTART GAME</button><button id="explore" disabled>EXPLORE MAP</button>' : '<button id="restart" hidden>RESTART GAME</button>'}
        <button id="support-open" data-open="menu-support" hidden>SUPPORT THE SERVERS</button>
      </nav>
      <section id="menu-options" class="menu-sub" hidden><h2>OPTIONS</h2>
        <label>Look sensitivity <input id="menu-sensitivity" type="range" min="0.25" max="3" step="0.05"><output></output></label>
        <label>Field of view <input id="menu-fov" type="range" min="60" max="110" step="1"><output></output></label>
        <label>Volume <input id="menu-volume" type="range" min="0" max="1" step="0.05"><output></output></label>
        <button data-back>BACK</button></section>
      <section id="menu-controls" class="menu-sub" hidden><h2>CONTROLS</h2>
        <p class="controls keyboard-controls">WASD · Move &nbsp; Mouse · Look / Fire / Aim<br>Shift · Sprint &nbsp; Space · Jump &nbsp; C · Crouch<br>R · Reload &nbsp; F / E · Interact &nbsp; V · Knife<br>G · Grenade &nbsp; 1 / 2 · Weapon &nbsp; X · ${moon ? 'Gersh / QED' : 'Monkey Bomb'}<br>${moon ? 'Q / H · P.E.S. / Hacker &nbsp; B · Wave Gun<br>Tab · Objective' : '4 · Claymore &nbsp; 5 · Attachment'}<br>Esc · Pause &nbsp; M · Mute</p>
        <p id="pad-controls" class="controls" hidden></p><p class="preview" hidden>Tab shows your current objective.</p><button data-back>BACK</button></section>
      <section id="menu-support" class="menu-sub" hidden><h2>SUPPORT THE SERVERS</h2><p class="support-message"></p><ul id="support-wallets"></ul><p id="support-status" role="status"></p><button data-back>BACK</button></section>
      ${moon ? '<div id="destinations" hidden><button data-destination="area51" disabled>No Man’s Land</button><button data-destination="receiving" disabled>Receiving Bay</button><button data-destination="power" disabled>Power / MPD</button><button data-destination="biodome" disabled>Biodome</button></div><p id="status" role="status">Loading Moon…</p><p id="error" hidden role="alert"></p>' : '<div id="loading"><span id="load-label">Loading Kino der Toten…</span><div><i id="load-progress"></i></div></div><p id="menu-status" role="status">Loading map…</p><div id="results" hidden></div>'}
      </div><aside class="menu-right"><h2>${name}</h2><figure><img src="ui/loadscreen_zombie_${image}.png" alt="${name} loading artwork"></figure>
      <p class="menu-map-mode">${moon ? 'SOLO SURVIVAL' : 'SOLO / PRIVATE MATCH'}</p><div class="menu-scoreboard"><span>ROUND <b id="menu-round">—</b></span><span>KILLS <b id="menu-kills">0</b></span><span>POINTS <b id="menu-points">500</b></span></div><p id="menu-objective"></p></aside>
      <footer class="menu-footer"><span id="menu-navigation">↑ ↓ Navigate &nbsp; ENTER Select &nbsp; ESC Back</span><span>BLACK OPS ZOMBIES</span></footer>`;
    const counter=document.createElement('p');counter.className='menu-player-count';counter.id='player-count';
    counter.title='Unique browsers that started a game on this map. Returning players count once; clearing browser data or using another device counts again.';
    counter.innerHTML='<span>TOTAL PLAYERS</span><b>—</b><small>LOADING TOTAL…</small>';
    this.root.querySelector('.menu-heading').append(counter);
    this.playerCounter=new PlayerCounter(moon?'moon':'kino',counter);
    const wallets=DONATION_WALLETS.filter(w=>w.address?.trim());$('support-open').hidden=!wallets.length;this.root.querySelector('.support-message').textContent=DONATION_MESSAGE;
    $('support-wallets').append(...wallets.map(w=>{const li=document.createElement('li'),label=document.createElement('span'),code=document.createElement('code'),copy=document.createElement('button');
      label.textContent=w.name?`${w.coin} · ${w.name}`:w.coin;code.textContent=w.address.trim();copy.textContent='COPY';copy.addEventListener('click',()=>this.copyAddress(w.coin,code,copy));li.append(label,code,copy);return li;}));
    this.settings = {sensitivity:1, fov:moon ? 65 : 78, volume:1};
    for (const key of Object.keys(this.settings)) {
      const input = $('menu-' + key), output = input.nextElementSibling;
      try { const raw = localStorage.getItem('t5.' + (moon ? 'moon.' : 'kino.') + key); if(raw !== null && Number.isFinite(+raw)) this.settings[key] = Math.max(+input.min,Math.min(+input.max,+raw)); } catch {}
      input.value = this.settings[key];
      const update = () => { this.settings[key] = +input.value; output.textContent = key === 'volume' ? Math.round(+input.value*100)+'%' : key === 'fov' ? input.value+'°' : (+input.value).toFixed(2); };
      update(); input.addEventListener('input', () => { update(); try {localStorage.setItem('t5.'+(moon?'moon.':'kino.')+key,input.value);} catch {} });
    }
    this.root.addEventListener('click', e => {const button=e.target.closest('[data-open],[data-back]'); if(button?.dataset.open)this.open(button.dataset.open);else if(button?.hasAttribute('data-back'))this.back();});
    this.root.addEventListener('pointerover', e => {const b=e.target.closest('button,a');if(b&&!b.disabled&&e.pointerType!=='touch')b.focus({preventScroll:true});});
    addEventListener('keydown',e=>{
      if(this.root.hidden||e.target.matches('input:not([type=range]),textarea'))return;
      if(e.code==='Escape'&&this.back()){e.preventDefault();e.stopImmediatePropagation();return;}
      if(e.code==='Escape'&&this.root.classList.contains('pause')){e.preventDefault();e.stopImmediatePropagation();$('start').click();return;}
      if(!['ArrowDown','ArrowUp'].includes(e.code))return;
      const all=[...this.root.querySelectorAll('button,input,a')].filter(b=>!b.disabled&&b.getClientRects().length&&!b.closest('[hidden]'));
      const index=all.indexOf(document.activeElement);all[index<0?(e.code==='ArrowDown'?0:all.length-1):(index+(e.code==='ArrowDown'?1:-1)+all.length)%all.length]?.focus();e.preventDefault();
    },true);
  }
  open(id){this.close();$(id).hidden=false;this.root.classList.add('submenu');$(id).querySelector('input,button')?.focus();}
  close(){for(const p of this.root.querySelectorAll('.menu-sub'))p.hidden=true;this.root.classList.remove('submenu');$('support-status').textContent='';}
  async copyAddress(coin,code,button){const status=$('support-status');try{await navigator.clipboard.writeText(code.textContent);status.textContent='';button.textContent='COPIED';clearTimeout(button.reset);button.reset=setTimeout(()=>button.textContent='COPY',1500);}catch{getSelection().selectAllChildren(code);status.textContent=`Copy blocked by the browser. The ${coin} address is selected; copy it manually.`;}}
  back(){const p=[...this.root.querySelectorAll('.menu-sub')].find(p=>!p.hidden);if(p){this.close();this.root.querySelector(`[data-open="${p.id}"]`)?.focus();return true;}if($('coop-panel')&&!$('coop-panel').hidden&&!this.coop?.running){$('coop-leave').click();$('coop-open').focus();return true;}return false;}
  attachCoop(coop){this.coop=coop;this.root.querySelector('.menu-content').append($('coop-panel'));$('coop-open').addEventListener('click',()=>this.close());}
  update({started=false,session,controller,objective='',audio}={}){
    if(audio){audio.volume=this.settings.volume;}
    if(this.root.hidden){this.visible=false;return;}
    if(!this.visible){this.visible=true;this.root.scrollTop=0;this.playerCounter.refresh();}
    const paused=started&&session?.phase!=='gameover';this.root.classList.toggle('pause',paused);this.root.classList.toggle('frontend',!paused);
    $('menu-title').textContent=session?.phase==='gameover'?'GAME OVER':paused?'PAUSED':'ZOMBIES';
    if(!this.moon)$('mode-label').textContent=this.coop?.connected?'PRIVATE MATCH':'SOLO PLAY';
    const restart=$(this.moon?'new-run':'restart');restart.hidden=!started||!!this.coop?.running;
    $('menu-round').textContent=started?session?.round??'—':'—';$('menu-kills').textContent=session?.kills??0;$('menu-points').textContent=session?.points??500;$('menu-objective').textContent=objective;
    const pad=controller?.usingPad;document.body.classList.toggle('pad-mode',!!pad);$('pad-controls').hidden=!pad;
    $('menu-navigation').textContent=pad?`${controller.glyph('jump')} Select     ${controller.glyph('crouch')} Back     D-pad Navigate`:document.body.classList.contains('touch-mode')?'Tap to select     Swipe to scroll':'↑ ↓ Navigate     ENTER Select     ESC Back';
  }
}
