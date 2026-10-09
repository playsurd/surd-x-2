// Shared by browsers, the local relay, and the Cloudflare room service.
export const PROTOCOL = 1;
export const MAX_PLAYERS = 4;
export const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}
export function playerName(name) { return String(name || 'Survivor').trim().slice(0, 20) || 'Survivor'; }
export function validInput(input) {
  return input && ['forward', 'strafe', 'yaw', 'pitch'].every(k => Number.isFinite(input[k])) &&
    Math.abs(input.forward) <= 1 && Math.abs(input.strafe) <= 1 && Math.abs(input.pitch) <= 1.6 && Math.abs(input.yaw) <= 1e6;
}

// No client may choose its identity or send authoritative state. The relay
// supplies identity from the socket and only accepts snapshots from the host.
export class RoomRelay {
  constructor() { this.peers = new Map(); this.started = false; }
  join(socket, { host = false, name, code }) {
    const error = host && this.peers.size ? 'Room already exists.' : !host && !this.peers.has('host') ? 'Room not found.' :
      this.started ? 'This game has already started.' : this.peers.size >= MAX_PLAYERS ? 'Room is full (4 players).' : null;
    if (error) { socket.send(JSON.stringify({ type: 'error', message: error })); socket.close(1008, error); return null; }
    const id = host ? 'host' : crypto.randomUUID();
    this.peers.set(id, { socket, name: playerName(name), ready: false });
    socket.send(JSON.stringify({ type: 'welcome', id, code, protocol: PROTOCOL }));
    this.roster(); return id;
  }
  send(id, message) {
    const peer = this.peers.get(id);
    if (!peer || peer.socket.bufferedAmount > 512 * 1024) return;
    try { peer.socket.send(JSON.stringify(message)); } catch { this.leave(id); }
  }
  broadcast(message) { for (const id of [...this.peers.keys()]) this.send(id, message); }
  roster() { this.broadcast({ type: 'roster', started: this.started, players: [...this.peers].map(([id, p]) => ({ id, name: p.name, ready: p.ready })) }); }
  receive(id, text) {
    const peer = this.peers.get(id); if (!peer) return;
    if (typeof text !== 'string' || text.length > (id === 'host' ? 128 * 1024 : 4096)) { peer.socket.close(1009, 'Message too large'); return; }
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    if (now - (peer.rateAt || 0) >= 1000) { peer.rateAt = now; peer.rate = 0; }
    if (++peer.rate > (id === 'host' ? 600 : 100)) { peer.socket.close(1008, 'Too many messages'); return; }
    if (m.type === 'ping') { this.send(id, { type: 'pong', at: m.at }); return; }
    if (m.type === 'ready' && !this.started) { peer.ready = !!m.ready; this.roster(); return; }
    if (m.type === 'start' && id === 'host' && !this.started && this.peers.size >= 2 && [...this.peers.values()].every(p => p.ready)) {
      this.started = true; this.broadcast({ type: 'start' }); return;
    }
    if (m.type === 'state' && id === 'host' && this.started) {
      for (const other of this.peers.keys()) if (other !== id) this.send(other, { type: 'state', state: m.state });
    } else if ((m.type === 'input' || m.type === 'action') && id !== 'host' && this.started) {
      if (!validInput(m.input)) return;
      this.send('host', { type: m.type, from: id, input: m.input, action: m.action, value: m.value, seq: m.seq });
    } else if (m.type === 'event' && id === 'host' && this.started) {
      if (m.to) this.send(m.to, { type: 'event', event: m.event });
      else for (const other of this.peers.keys()) if (other !== id) this.send(other, { type: 'event', event: m.event });
    }
  }
  leave(id) {
    if (!this.peers.delete(id)) return;
    if (id === 'host') {
      const others = [...this.peers.values()]; this.broadcast({ type: 'ended', message: 'The host left. Create or join a new room.' });
      this.peers.clear(); this.started = false;
      for (const p of others) p.socket.close(1000, 'Host left');
    } else this.roster();
  }
}
