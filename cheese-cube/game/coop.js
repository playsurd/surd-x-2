// Friends co-op, as Kino does it: private room codes for two to four players, a ready lobby, and one host browser
// that runs the match. Guests send input and actions through a WebSocket relay (the local dev server or the
// Cloudflare Worker); the host simulates the shared world and every survivor's points, health and inventory, and
// sends snapshots 20 times a second. Guests draw those snapshots and predict only their own movement and gun.
import { relayOrigin } from './coop-config.js';
import { PROTOCOL, CODE_PATTERN, playerName } from './coop-protocol.js';
import { Teammate, PLAYER_COLORS } from './teammate.js';

const $ = id => document.getElementById(id);
const SEND_SECONDS = .05;

export class CheeseCoop {
  constructor(api) {
    this.api = api; this.actors = new Map(); this.avatars = new Map(); this.players = []; this.slots = new Map(); this.names = new Map();
    this.connected = false; this.running = false; this.seq = 0; this.clock = 0; this.tp = 0; this.snapshot = null;
    $('coop-code').value = new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 6) || '';
    try { $('coop-name').value = localStorage.getItem('ccube.coop.name') || ''; } catch {}
    $('coop-open').onclick = () => { this.panel(true); $('coop-open').hidden = true; };
    $('coop-host').onclick = () => this.connect(true);
    $('coop-join').onclick = () => this.connect(false);
    $('coop-code').oninput = () => { $('coop-code').value = $('coop-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('coop-code').onkeydown = e => { if (e.key === 'Enter') this.connect(false); };
    $('coop-ready').onclick = () => this.send({type: 'ready', ready: !this.players.find(p => p.id === this.id)?.ready});
    $('coop-start').onclick = () => this.send({type: 'start'});
    $('coop-leave').onclick = () => this.leave();
    $('coop-exit').onclick = () => this.leave();
    $('coop-copy').onclick = async () => {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('room', this.code);
      try { await navigator.clipboard.writeText(url.href); this.status('Invite link copied.'); }
      catch { this.status(`Share room code ${this.code} with your friends.`); }
    };
    addEventListener('pagehide', () => this.socket?.close(1000, 'Page closed'));
    this.heartbeat = setInterval(() => {
      if (!this.connected) return;
      if (performance.now() - this.lastMessage > 15000) { this.leave('Connection lost. Create or join a new room.'); return; }
      this.send({type: 'ping', at: performance.now()});
    }, 3000);
  }

  get isHost() { return this.running && this.id === 'host'; }
  get isClient() { return this.running && this.id !== 'host'; }
  get localId() { return this.running ? this.id : 'solo'; }
  status(text) { $('coop-status').textContent = text; }
  panel(open) { $('coop-panel').hidden = !open; document.body.classList.toggle('coop-lobby', open); }
  ready() { $('coop-open').disabled = false; if ($('coop-code').value) $('coop-open').click(); }
  name(id) { return this.names.get(id) ?? this.players.find(p => p.id === id)?.name ?? 'Survivor'; }
  slot(id) { return this.slots.get(id) ?? 0; }
  color(id) { return PLAYER_COLORS[this.slot(id) % PLAYER_COLORS.length]; }

  async connect(host) {
    if (this.socket || this.connecting || !this.api.ready()) return;
    const code = $('coop-code').value.trim().toUpperCase();
    if (!host && !CODE_PATTERN.test(code)) { this.status('Enter the six-character room code.'); return; }
    const name = playerName($('coop-name').value);
    try { localStorage.setItem('ccube.coop.name', name); } catch {}
    const attempt = this.connecting = {};
    $('coop-host').disabled = $('coop-join').disabled = true;
    this.status(host ? 'Creating room…' : 'Joining room…');
    let url;
    try { url = new URL('/coop/connect', await relayOrigin()); } catch { url = null; }
    if (this.connecting !== attempt) return;
    this.connecting = null;
    if (!url) { this.leave('Online rooms are not available for this build.'); return; }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', name); url.searchParams.set('v', PROTOCOL); url.searchParams.set(host ? 'host' : 'room', host ? '1' : code);
    const socket = this.socket = new WebSocket(url); this.failure = '';
    const timeout = setTimeout(() => { if (!this.connected && this.socket === socket) this.leave('Could not reach the room service. Please try again.'); }, 12000);
    socket.onmessage = e => {
      if (this.socket !== socket) return;
      this.lastMessage = performance.now();
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'welcome') { clearTimeout(timeout); this.welcome(m); }
      else this.receive(m);
    };
    socket.onclose = e => {
      clearTimeout(timeout);
      if (this.socket === socket) this.leave(this.failure || (e.reason === 'Host left' ? 'The host left. Create or join a new room.' : 'Disconnected. Create or join a new room.'));
    };
    socket.onerror = () => { this.failure ||= 'Could not reach the room service. Please try again.'; };
  }

  welcome(m) {
    this.id = m.id; this.code = m.code; this.connected = true;
    $('coop-connect').hidden = true; $('coop-room').hidden = false; $('coop-room-code').textContent = this.code; $('coop-leave').textContent = 'Leave Room';
    this.status(this.id === 'host' ? 'Share the code. Everyone must be ready before you start.' : 'Press READY. The host starts the match.');
    this.api.lobby();
  }

  receive(m) {
    if (m.type === 'roster') {
      const left = this.players.filter(p => !m.players.some(q => q.id === p.id));
      this.players = m.players; this.renderLobby();
      if (this.isHost) for (const p of left) {
        const actor = this.actors.get(p.id);
        if (actor) { this.api.removeActor(actor); this.actors.delete(p.id); this.api.notice(`${this.name(p.id)} left the game`, 3); }
      }
    } else if (m.type === 'start') this.begin(m.players);
    else if (m.type === 'input' || m.type === 'action') {
      const actor = this.isHost && this.actors.get(m.from);
      if (!actor) return;
      this.api.applyInput(actor, m.input);
      if (m.type === 'action') this.api.action(actor, m.action, m.value ?? {}, m.input);
    } else if (m.type === 'state' && this.isClient) {
      this.snapshot = m.state; this.snapshotAt = performance.now();
      this.api.applyState(m.state);
    } else if (m.type === 'event' && this.isClient) this.api.event(m.event);
    else if (m.type === 'pong') this.ping = Math.round(performance.now() - m.at);
    else if (m.type === 'error') { this.failure = m.message; this.status(m.message); }
    else if (m.type === 'ended') this.leave(m.message);
  }

  send(message) { if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 256 * 1024) this.socket.send(JSON.stringify(message)); }

  renderLobby() {
    $('coop-roster').replaceChildren(...this.players.map((p, i) => {
      const row = document.createElement('li');
      row.textContent = `${p.name}${p.id === 'host' ? ' · HOST' : ''}${p.id === this.id ? ' · YOU' : ''} — ${p.ready ? 'READY' : 'NOT READY'}`;
      row.style.borderLeftColor = PLAYER_COLORS[i % PLAYER_COLORS.length]; row.classList.toggle('ready', p.ready); return row;
    }));
    $('coop-ready').textContent = this.players.find(p => p.id === this.id)?.ready ? 'Not Ready' : 'Ready';
    $('coop-start').hidden = this.id !== 'host';
    $('coop-start').disabled = this.players.length < 2 || !this.players.every(p => p.ready);
    if (this.id === 'host') this.status(this.players.length < 2 ? 'Share the room code. A friend must join before you can start.'
      : this.players.every(p => p.ready) ? 'Everyone is ready — start co-op.' : 'Everyone must be ready before you start.');
  }

  async begin(players) {
    // Survivor colours stay fixed for the match, even if someone leaves.
    this.slots = new Map(players.map((p, i) => [p.id, i])); this.names = new Map(players.map(p => [p.id, p.name]));
    this.snapshot = null; this.tp = 0; this.clock = 0; this.seq = 0;
    await this.api.reset();
    this.running = true; this.snapshotAt = performance.now();
    if (this.id === 'host') {
      this.actors.set('host', this.api.localActor('host'));
      for (const p of players) if (p.id !== 'host') this.actors.set(p.id, this.api.createActor(p.id, this.slot(p.id)));
    }
    this.panel(false); $('coop-open').hidden = true; $('coop-exit').hidden = false;
    this.api.begin();
  }

  leave(message = '') {
    this.connecting = null;
    const socket = this.socket; this.socket = null; try { socket?.close(1000, 'Left room'); } catch {}
    const hadGame = this.running;
    this.running = false; this.connected = false; this.id = null; this.code = null; this.players = []; this.snapshot = null;
    for (const actor of this.actors.values()) if (!actor.local) this.api.removeActor(actor);
    this.actors.clear(); this.clearAvatars();
    $('coop-connect').hidden = false; $('coop-room').hidden = true; $('coop-notice').hidden = true; $('coop-exit').hidden = true; $('coop-leave').textContent = 'Back';
    // With an explanation the lobby stays open to show it; leaving on purpose returns to the solo menu.
    $('coop-host').disabled = $('coop-join').disabled = false; this.panel(Boolean(message)); $('coop-open').hidden = Boolean(message);
    this.status(message);
    this.api.end(hadGame);
  }

  // ---- Guest ----
  action(name, value = {}) {
    if (!this.isClient) return false;
    this.send({type: 'action', action: name, value, seq: ++this.seq, input: this.api.readInput()});
    return true;
  }

  updateClient(dt) {
    this.clock += dt;
    if (this.clock >= SEND_SECONDS) { this.clock %= SEND_SECONDS; this.send({type: 'input', seq: ++this.seq, input: this.api.readInput()}); }
    const silent = performance.now() - this.snapshotAt;
    if (silent > 12000) { this.leave('The host stopped responding. Create or join a new room.'); return; }
    if (this.snapshot) {
      const others = this.snapshot.players.filter(p => p.id !== this.id);
      this.drawPlayers(dt, others); this.team(this.snapshot.players);
    }
    if (silent > 2000) this.notice('Waiting for the host…');
  }

  // ---- Host ----
  afterHost(dt) {
    const actors = [...this.actors.values()];
    this.clock += dt;
    if (this.clock >= SEND_SECONDS) { this.clock %= SEND_SECONDS; this.send({type: 'state', state: this.api.capture()}); }
    const players = actors.map(a => this.api.describe(a));
    this.drawPlayers(dt, players.filter(p => p.id !== this.id)); this.team(players);
  }
  event(event, to) { if (this.isHost) this.send({type: 'event', event, to}); }
  actorList() { return [...this.actors.values()]; }
  remoteActors() { return this.actorList().filter(a => !a.local); }

  // ---- Shared presentation ----
  drawPlayers(dt, players) {
    for (const [id, avatar] of this.avatars) if (!players.some(p => p.id === id)) { avatar.dispose(); this.avatars.delete(id); }
    for (const p of players) {
      let avatar = this.avatars.get(p.id);
      if (!avatar) { avatar = new Teammate({...this.api.scene(), name: this.name(p.id), slot: this.slot(p.id)}); avatar.root.position.fromArray(p.feet); this.avatars.set(p.id, avatar); }
      avatar.update(dt, p);
    }
  }
  shot(id) { this.avatars.get(id)?.shot(); }
  /** Teammates' scores are part of the HUD (hud.js); this explains our own last stand. */
  team(players) {
    const me = players.find(p => p.id === this.id);
    const text = this.api.gameOver() ? 'The match is over. Leave co-op to play again.'
      : me?.dead ? 'You bled out. You will return next round.'
      : me?.down ? (me.revive > 0 ? `Being revived… ${Math.round(me.revive / 3 * 100)}%` : `You are down! A teammate can hold F to revive you · ${Math.max(0, Math.ceil(me.bleed))}s`) : '';
    this.notice(text);
  }
  notice(text) { $('coop-notice').hidden = !text; if (text) $('coop-notice').textContent = text; }
  clearAvatars() { for (const avatar of this.avatars.values()) avatar.dispose(); this.avatars.clear(); }

  debug() {
    return {connected: this.connected, running: this.running, host: this.isHost, id: this.id, code: this.code, players: this.players, ping: this.ping,
      avatars: [...this.avatars].map(([id, a]) => ({id, weapon: a.weapon, position: a.root.position.toArray().map(Math.round), status: a.status, gun: a.gun ? 1 : 0, model: Boolean(a.model), clip: a.state})),
      survivors: this.isHost ? this.actorList().map(a => this.api.describe(a)) : this.snapshot?.players ?? []};
  }
}
