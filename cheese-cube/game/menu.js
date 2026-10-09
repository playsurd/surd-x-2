// The Black Ops III Zombies menus: the frontend lobby before a match (forest video, "ZOMBIES / OFFLINE", the map's
// torn-paper preview card, the party list, the footer) and the start menu during one (the same layout over the
// paused game, with the objective and the scoreboard). Menu art comes from .tools/build-menu.mjs.
import { DONATION_MESSAGE, DONATION_WALLETS } from './donate-config.js';
const $ = id => document.getElementById(id);
const PLAYER_COLORS = ['#f0d54a', '#5aa9ff', '#ffd23f', '#5fd068'];
const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : Number(v); } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };

export class ZombiesMenu {
  constructor({onPlay, onRestart, onVolume}) {
    this.root = $('help'); this.video = $('menu-video'); this.mode = '';
    this.sensitivity = load('ccube.sensitivity', 1); this.volume = load('ccube.volume', 1);
    $('menu-play').onclick = () => onPlay();
    $('menu-restart').onclick = () => onRestart();
    for (const button of this.root.querySelectorAll('[data-open]')) button.onclick = () => this.open(button.dataset.open);
    for (const button of this.root.querySelectorAll('[data-back]')) button.onclick = () => this.back();
    const slider = (id, value, format, apply) => {
      const input = $(id), output = $(id + '-value');
      input.value = value; output.textContent = format(value);
      input.addEventListener('input', () => { const v = Number(input.value); output.textContent = format(v); apply(v); });
    };
    slider('sensitivity', this.sensitivity, v => v.toFixed(2), v => { this.sensitivity = v; save('ccube.sensitivity', v); });
    slider('volume', this.volume, v => `${Math.round(v * 100)}%`, v => { this.volume = v; save('ccube.volume', v); onVolume(v); });
    onVolume(this.volume);
    // Support the Servers lists the donation wallets; its entry stays hidden until an address is set.
    const wallets = DONATION_WALLETS.filter(w => w.address?.trim());
    $('support-open').hidden = !wallets.length; $('support-message').textContent = DONATION_MESSAGE;
    $('support-wallets').replaceChildren(...wallets.map(w => {
      const code = Object.assign(document.createElement('code'), {textContent: w.address.trim()});
      const copy = Object.assign(document.createElement('button'), {type: 'button', textContent: 'Copy'});
      copy.onclick = () => this.copyAddress(w.coin, code);
      const row = document.createElement('li');
      row.append(Object.assign(document.createElement('span'), {textContent: w.name ? `${w.coin} · ${w.name}` : w.coin}), code, copy);
      return row;
    }));
    // Pointing at an item focuses it, as the game's menus do; arrow keys move focus and Esc steps back.
    this.root.addEventListener('pointerover', e => { const b = e.target.closest('button'); if (b && !b.disabled) b.focus({preventScroll: true}); });
    addEventListener('keydown', e => {
      if (this.root.hidden || e.target.matches?.('input[type=text], input:not([type])')) return;
      if (e.code === 'Escape' && this.openPanel()) { e.preventDefault(); this.back(); return; }
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      const items = [...this.root.querySelectorAll('.menu-left button')].filter(b => b.offsetParent && !b.disabled);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      items[(i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      e.preventDefault();
    });
  }

  openPanel() { return [...this.root.querySelectorAll('.menu-sub')].find(p => !p.hidden && p.id !== 'coop-panel'); }
  open(id) { for (const p of this.root.querySelectorAll('.menu-sub')) if (p.id !== 'coop-panel') p.hidden = p.id !== id; $(id).querySelector('button, input')?.focus(); }
  back() { const panel = this.openPanel(); if (panel) { panel.hidden = true; $('support-status').textContent = ''; this.root.querySelector('#menu-main button')?.focus(); } }
  async copyAddress(coin, code) {
    try { await navigator.clipboard.writeText(code.textContent); $('support-status').textContent = `${coin} address copied`; }
    catch { getSelection().selectAllChildren(code); $('support-status').textContent = `Copy blocked by the browser. The ${coin} address is selected; copy it manually.`; }
  }

  /** Called every frame while the menu may be visible. */
  update(s) {
    if (!s.visible) { if (!this.video.paused) this.video.pause(); return; }
    if (s.mode !== this.mode) {
      this.mode = s.mode;
      this.root.classList.remove('frontend', 'pause', 'room'); this.root.classList.add(s.mode);
      $('menu-play').textContent = s.mode === 'pause' ? 'Resume Game' : 'Start Game';
    }
    // The forest only plays behind the frontend; the start menu sits over the paused game.
    if (s.mode === 'pause') { if (!this.video.paused) this.video.pause(); }
    else if (this.video.paused) this.video.play().catch(() => {});
    this.text('menu-title', s.title); this.text('help-status', s.status); this.text('menu-hint', s.hint); this.text('menu-back-key', s.backKey ?? 'ESC');
    // The Controls page lists the controller's buttons while one is in use.
    const padList = $('menu-controls-pad'), keyList = padList.previousElementSibling, padKey = JSON.stringify(s.padControls ?? null);
    if (padKey !== this.padKey) {
      this.padKey = padKey; padList.hidden = !s.padControls; keyList.hidden = Boolean(s.padControls);
      padList.replaceChildren(...(s.padControls ?? []).flatMap(([key, label]) => [Object.assign(document.createElement('dt'), {textContent: key}), Object.assign(document.createElement('dd'), {textContent: label})]));
    }
    $('menu-restart').hidden = !(s.mode === 'pause' && s.canRestart);
    this.text('menu-party-head', s.mode === 'pause' ? 'Scoreboard' : `${s.party.length} Player${s.party.length === 1 ? '' : 's'} (4 Max)`);
    this.text('menu-leader', s.mode === 'room' ? (s.leader ? 'You are Party Leader' : 'Waiting for the Party Leader') : s.mode === 'frontend' ? 'You are Party Leader' : '');
    const key = JSON.stringify(s.party) + s.mode;
    if (key !== this.partyKey) {
      this.partyKey = key;
      $('menu-party-list').replaceChildren(...s.party.map(p => {
        const row = document.createElement('li');
        row.className = `${p.leader ? 'leader' : ''}${p.down ? ' down' : ''}${p.dead ? ' dead' : ''}${p.ready ? ' ready' : ''}`;
        row.innerHTML = '<i></i><span class="name"></span><span class="score"></span><span class="kills"></span><span class="heads"></span>';
        row.querySelector('.name').textContent = p.name; row.querySelector('.name').style.color = PLAYER_COLORS[p.slot % PLAYER_COLORS.length];
        if (s.mode === 'pause') { row.querySelector('.score').textContent = p.points; row.querySelector('.kills').textContent = p.kills; row.querySelector('.heads').textContent = p.headshots; }
        if (s.mode === 'room') row.querySelector('.score').textContent = p.ready ? 'Ready' : 'Not Ready';
        return row;
      }));
    }
    this.text('objective', s.objective); this.text('hazard', s.hazard);
    $('hazard').classList.toggle('danger', s.danger);
  }
  text(id, value) { const e = $(id); if (e && e.textContent !== value) e.textContent = value; }
}

/** The game's end screen: "GAME OVER" and how far the team got. */
export function endScreen(element, title, lines) {
  element.classList.add('ending');
  const heading = document.createElement('strong'); heading.textContent = title;
  element.replaceChildren(heading, ...lines.map(line => { const p = document.createElement('span'); p.textContent = line; return p; }));
  element.hidden = false;
}
