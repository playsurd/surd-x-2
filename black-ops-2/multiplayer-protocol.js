// Room protocol shared by browsers, the local relay (.tools/multiplayer-relay.mjs) and the Cloudflare Worker
// (.tools/multiplayer-worker.js). Built the way Kino der Toten's and Cheese Cube's co-op rooms are: one host
// browser runs the match, guests send input and actions, and the relay assigns identities so no client can
// speak for another player, start the match or publish world state. Data only, no DOM, so node tests load it.
export const PROTOCOL = 1;
export const MAX_PLAYERS = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const MAP_PATTERN = /^[a-z0-9_]{1,40}$/;

export function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

export function playerName(name) {
  return String(name || 'Player').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
}

const finite = (v, limit) => Number.isFinite(v) && Math.abs(v) <= limit;
const vector = (v, limit) => Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, limit));

/** A guest's movement report: axes, view angles and where it stands. */
export function validInput(input) {
  if (!input || typeof input !== 'object') return false;
  if (!finite(input.forward, 1) || !finite(input.strafe, 1) || !finite(input.pitch, 1.6) || !finite(input.yaw, 1e6)) return false;
  if (input.pos !== undefined && !vector(input.pos, 1e5)) return false;
  return true;
}

export class RoomRelay {
  constructor() {
    this.peers = new Map();
    this.started = false;
    this.map = null;
  }

  join(socket, { host = false, name, code, map = null }) {
    const sameMap = host || !this.map || !map || map === this.map;
    const error = host && this.peers.size ? 'Room already exists.'
      : !host && !this.peers.has('host') ? 'Room not found.'
      : this.started ? 'This match has already started.'
      : this.peers.size >= MAX_PLAYERS ? `Room is full (${MAX_PLAYERS} players).`
      : !sameMap ? 'This room is on another map.'
      : null;
    if (error) {
      // A guest on the wrong map learns which one, so its page can switch and rejoin.
      socket.send(JSON.stringify({ type: 'error', message: error, ...(sameMap ? {} : { map: this.map }) }));
      socket.close(1008, error);
      return null;
    }
    const id = host ? 'host' : crypto.randomUUID();
    if (host) this.map = MAP_PATTERN.test(map ?? '') ? map : null;
    this.peers.set(id, { socket, name: playerName(name), ready: false });
    socket.send(JSON.stringify({ type: 'welcome', id, code, map: this.map, protocol: PROTOCOL }));
    this.roster();
    return id;
  }

  send(id, message) {
    const peer = this.peers.get(id);
    if (!peer || peer.socket.bufferedAmount > 512 * 1024) return;
    try { peer.socket.send(typeof message === 'string' ? message : JSON.stringify(message)); } catch { this.leave(id); }
  }

  broadcast(message, except = null) {
    const text = JSON.stringify(message);
    for (const id of [...this.peers.keys()]) if (id !== except) this.send(id, text);
  }

  roster() {
    this.broadcast({ type: 'roster', started: this.started, players: [...this.peers].map(([id, p]) => ({ id, name: p.name, ready: p.ready })) });
  }

  receive(id, text) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (typeof text !== 'string' || text.length > (id === 'host' ? 128 * 1024 : 4096)) { peer.socket.close(1009, 'Message too large'); return; }
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    if (now - (peer.rateAt || 0) >= 1000) { peer.rateAt = now; peer.rate = 0; }
    if (++peer.rate > (id === 'host' ? 600 : 120)) { peer.socket.close(1008, 'Too many messages'); return; }
    if (m.type === 'ping') { this.send(id, { type: 'pong', at: m.at }); return; }
    if (m.type === 'ready' && !this.started) { peer.ready = Boolean(m.ready); this.roster(); return; }
    if (m.type === 'start' && id === 'host' && !this.started && this.peers.size >= 2 && [...this.peers.values()].every((p) => p.ready)) {
      this.started = true;
      this.broadcast({ type: 'start', players: [...this.peers].map(([pid, p]) => ({ id: pid, name: p.name })) });
      return;
    }
    if (!this.started) return;
    if (m.type === 'state' && id === 'host') this.broadcast({ type: 'state', state: m.state }, 'host');
    else if ((m.type === 'input' || m.type === 'action') && id !== 'host') {
      if (!validInput(m.input) || (m.action !== undefined && typeof m.action !== 'string')) return;
      this.send('host', { type: m.type, from: id, input: m.input, action: m.action, value: m.value, seq: m.seq });
    } else if (m.type === 'event' && id === 'host') {
      if (m.to) { if (m.to !== 'host') this.send(m.to, { type: 'event', event: m.event }); }
      else this.broadcast({ type: 'event', event: m.event }, 'host');
    }
  }

  leave(id) {
    if (!this.peers.delete(id)) return;
    if (id === 'host') {
      const others = [...this.peers.values()];
      this.broadcast({ type: 'ended', message: 'The host left. Create or join a new room.' });
      this.peers.clear();
      this.started = false;
      for (const p of others) try { p.socket.close(1000, 'Host left'); } catch {}
    } else this.roster();
  }
}
