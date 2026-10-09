// Play with friends, the way Kino der Toten's and Cheese Cube's co-op rooms work: private room codes for two
// to six players, a ready lobby, and one host browser that runs the match. Guests send input and actions
// through a WebSocket relay (the local dev server or the Cloudflare Worker); the host simulates the bots, the
// match and everyone's health, and sends snapshots 20 times a second. Guests move and aim themselves and draw
// the world from those snapshots. This file is the room and the wire; index.html is the game behind `api`.
import { relayOrigin } from './multiplayer-config.js';
import { PROTOCOL, CODE_PATTERN, MAX_PLAYERS, playerName } from './multiplayer-protocol.js';
import { SNAPSHOT_RATE, SnapshotBuffer } from './multiplayer-sync.js';
import { PLAYER_COLORS } from './remote-players.js';

const $ = (id) => document.getElementById(id);
const SEND_SECONDS = 1 / SNAPSHOT_RATE;
const NAME_KEY = 'hijacked.mp.name';

export class MultiplayerSession {
  constructor(api) {
    this.api = api;
    this.players = [];
    this.slots = new Map();
    this.names = new Map();
    this.connected = false;
    this.running = false;
    this.seq = 0;
    this.clock = 0;
    this.buffer = new SnapshotBuffer();
    this.lastMessage = 0;
    this.snapshotAt = 0;
    $('mp-code').value = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || '';
    try { $('mp-name').value = localStorage.getItem(NAME_KEY) || ''; } catch {}
    // The shell treats a click as "play"; nothing in the room screen should.
    $('mp-lobby').addEventListener('click', (event) => event.stopPropagation());
    $('mp-host').onclick = () => this.connect(true);
    $('mp-join').onclick = () => this.connect(false);
    $('mp-code').oninput = () => { $('mp-code').value = $('mp-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('mp-code').onkeydown = (event) => { if (event.key === 'Enter') this.connect(false); };
    $('mp-ready').onclick = () => this.send({ type: 'ready', ready: !this.me?.ready });
    $('mp-start').onclick = () => this.send({ type: 'start' });
    $('mp-back').onclick = () => this.back();
    $('mp-copy').onclick = async () => {
      const url = new URL(location.href);
      url.search = '';
      url.searchParams.set('map', this.api.mapId);
      url.searchParams.set('room', this.code);
      try { await navigator.clipboard.writeText(url.href); this.status('Invite link copied.'); }
      catch { this.status(`Share room code ${this.code} with your friends.`); }
    };
    addEventListener('pagehide', () => this.socket?.close(1000, 'Page closed'));
    this.heartbeat = setInterval(() => {
      if (!this.connected) return;
      if (performance.now() - this.lastMessage > 15000) { this.leave('Connection lost. Create or join a new room.'); return; }
      this.send({ type: 'ping', at: performance.now() });
    }, 3000);
  }

  get isHost() { return this.running && this.id === 'host'; }
  get isClient() { return this.running && this.id !== 'host'; }
  get me() { return this.players.find((p) => p.id === this.id) ?? null; }
  name(id) { return this.names.get(id) ?? this.players.find((p) => p.id === id)?.name ?? 'Player'; }
  slot(id) { return this.slots.get(id) ?? 0; }
  color(id) { return PLAYER_COLORS[this.slot(id) % PLAYER_COLORS.length]; }
  status(text) { $('mp-status').textContent = text; }

  /** The game finished loading: an invite link opens the room screen with its code filled in. */
  ready() {
    if ($('mp-code').value && this.api.openLobby()) $('mp-name').focus();
  }

  /** Back from the room screen: leave the lobby, or just close the screen when not in one. */
  back() {
    if (this.connected || this.socket) this.leave();
    else this.api.closeLobby();
  }

  async connect(host) {
    if (this.socket || this.connecting || !this.api.ready()) return;
    const code = $('mp-code').value.trim().toUpperCase();
    if (!host && !CODE_PATTERN.test(code)) { this.status('Enter the six-character room code.'); return; }
    const name = playerName($('mp-name').value);
    $('mp-name').value = name;
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    const attempt = this.connecting = {};
    $('mp-host').disabled = $('mp-join').disabled = true;
    this.status(host ? 'Creating room…' : 'Joining room…');
    let url;
    try { url = new URL('/mp/connect', await relayOrigin()); } catch { url = null; }
    if (this.connecting !== attempt) return;
    this.connecting = null;
    if (!url) { this.leave('Online rooms are not available for this build.'); return; }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', name);
    url.searchParams.set('v', PROTOCOL);
    url.searchParams.set('map', this.api.mapId);
    url.searchParams.set(host ? 'host' : 'room', host ? '1' : code);
    const socket = this.socket = new WebSocket(url);
    this.failure = '';
    const timeout = setTimeout(() => {
      if (!this.connected && this.socket === socket) this.leave('Could not reach the room service. Please try again.');
    }, 12000);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessage = performance.now();
      let m;
      try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'welcome') { clearTimeout(timeout); this.welcome(m); }
      else this.receive(m, code);
    };
    socket.onclose = (event) => {
      clearTimeout(timeout);
      if (this.socket !== socket) return;
      this.leave(this.failure || (event.reason === 'Host left' ? 'The host left. Create or join a new room.' : 'Disconnected. Create or join a new room.'));
    };
    socket.onerror = () => { this.failure ||= 'Could not reach the room service. Please try again.'; };
  }

  welcome(m) {
    this.id = m.id;
    this.code = m.code;
    this.connected = true;
    $('mp-connect').hidden = true;
    $('mp-room').hidden = false;
    $('mp-room-code').textContent = this.code;
    $('mp-back').textContent = 'Leave room';
    $('mp-bots-row').hidden = this.id !== 'host';
    document.body.classList.add('mp-connected');
    this.status(this.id === 'host' ? 'Share the code. Everyone must be ready before you start.' : 'Press Ready. The host starts the match.');
  }

  receive(m, code) {
    if (m.type === 'roster') {
      const left = this.players.filter((p) => !m.players.some((q) => q.id === p.id));
      this.players = m.players;
      this.renderLobby();
      if (this.running) for (const p of left) this.api.playerLeft(p.id, this.name(p.id));
    } else if (m.type === 'start') this.begin(m.players);
    else if (m.type === 'input' || m.type === 'action') {
      if (!this.isHost) return;
      this.api.applyInput(m.from, m.input);
      if (m.type === 'action') this.api.action(m.from, m.action, m.value ?? {}, m.input);
    } else if (m.type === 'state' && this.isClient) {
      if (!m.state || !this.buffer.push(m.state.t, m.state, performance.now() / 1000)) return;
      this.snapshotAt = performance.now();
      this.api.applyState(m.state);
    } else if (m.type === 'event' && this.isClient) this.api.event(m.event);
    else if (m.type === 'pong') this.ping = Math.round(performance.now() - m.at);
    else if (m.type === 'error') {
      // The room plays another map: reload onto it with the code filled in.
      if (m.map && m.map !== this.api.mapId && this.api.switchMap(m.map, code)) {
        this.failure = 'Switching to the room’s map…';
        this.status(this.failure);
        return;
      }
      this.failure = m.message;
      this.status(m.message);
    } else if (m.type === 'ended') this.leave(m.message);
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 256 * 1024) this.socket.send(JSON.stringify(message));
  }

  renderLobby() {
    $('mp-roster').replaceChildren(...this.players.map((p, i) => {
      const row = document.createElement('li');
      row.textContent = `${p.name}${p.id === 'host' ? ' · host' : ''}${p.id === this.id ? ' · you' : ''}`;
      const state = document.createElement('span');
      state.textContent = p.ready ? 'Ready' : 'Not ready';
      row.append(state);
      row.style.borderLeftColor = PLAYER_COLORS[i % PLAYER_COLORS.length];
      row.classList.toggle('ready', p.ready);
      return row;
    }));
    $('mp-count').textContent = `${this.players.length} / ${MAX_PLAYERS}`;
    $('mp-ready').textContent = this.me?.ready ? 'Not ready' : 'Ready';
    $('mp-start').hidden = this.id !== 'host';
    $('mp-start').disabled = this.players.length < 2 || !this.players.every((p) => p.ready);
    if (this.id === 'host') {
      this.status(this.players.length < 2 ? 'Share the room code. A friend must join before you can start.'
        : this.players.every((p) => p.ready) ? 'Everyone is ready. Start the match.' : 'Everyone must be ready before you start.');
    }
  }

  async begin(players) {
    // Colours, skins and names stay fixed for the match, even when someone leaves.
    this.slots = new Map(players.map((p, i) => [p.id, i]));
    this.names = new Map(players.map((p) => [p.id, p.name]));
    this.clock = 0;
    this.seq = 0;
    this.buffer.clear();
    this.status('Starting…');
    await this.api.begin(players, { host: this.id === 'host', bots: $('mp-bots').checked });
    if (!this.connected) return;
    this.running = true;
    this.snapshotAt = performance.now();
    this.sentAt = 0;
    // Anyone who left while the match was being set up is gone from the start.
    for (const p of players) if (!this.players.some((q) => q.id === p.id)) this.api.playerLeft(p.id, p.name);
    document.body.classList.add('mp-running');
    $('mp-banner').textContent = `Online · room ${this.code}`;
    this.api.started();
  }

  leave(message = '') {
    this.connecting = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(1000, 'Left room'); } catch {}
    const hadGame = this.running;
    this.running = false;
    this.connected = false;
    this.id = null;
    this.code = null;
    this.players = [];
    this.buffer.clear();
    document.body.classList.remove('mp-connected', 'mp-running');
    $('mp-connect').hidden = false;
    $('mp-room').hidden = true;
    $('mp-back').textContent = 'Back';
    $('mp-host').disabled = $('mp-join').disabled = false;
    this.notice('');
    this.status(message);
    this.api.end(hadGame, message);
  }

  // ---- Guest ----
  action(name, value = {}) {
    if (!this.isClient) return false;
    this.send({ type: 'action', action: name, value, seq: ++this.seq, input: this.api.readInput() });
    return true;
  }

  updateClient(dt) {
    this.clock += dt;
    if (this.clock >= SEND_SECONDS) {
      this.clock %= SEND_SECONDS;
      this.send({ type: 'input', seq: ++this.seq, input: this.api.readInput() });
    }
    const silent = performance.now() - this.snapshotAt;
    if (silent > 12000) { this.leave('The host stopped responding. Create or join a new room.'); return; }
    this.notice(silent > 2000 ? 'Waiting for the host…' : '');
  }

  // ---- Host ----
  // Paced by the wall clock: a hidden host catching up runs many short steps at once, and their snapshots
  // would carry the same timestamp.
  afterHost() {
    const now = performance.now();
    if (now - this.sentAt < SEND_SECONDS * 1000 - 4) return;
    this.sentAt = now;
    this.send({ type: 'state', state: this.api.capture() });
  }

  event(event, to = null) {
    if (this.isHost) this.send({ type: 'event', event, to: to ?? undefined });
  }

  notice(text) {
    const element = $('mp-notice');
    element.hidden = !text;
    if (text && element.textContent !== text) element.textContent = text;
  }

  debug() {
    return {
      connected: this.connected,
      running: this.running,
      host: this.isHost,
      id: this.id ?? null,
      code: this.code ?? null,
      ping: this.ping ?? null,
      players: this.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready })),
      snapshots: this.buffer.frames.length,
    };
  }
}
