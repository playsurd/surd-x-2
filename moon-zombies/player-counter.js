import { PLAYER_COUNTER_URL } from './player-counter-config.js';

export class PlayerCounter {
  constructor(map, element) {
    this.map = map;
    this.element = element;
    this.value = element.querySelector('b');
    this.note = element.querySelector('small');
    this.url = PLAYER_COUNTER_URL && `${PLAYER_COUNTER_URL}/players/${map}`;
    this.refresh();
    addEventListener('online', () => { this.refresh(); if (this.played) this.recordPlay(); });
  }
  async request(method = 'GET') {
    const response = await fetch(this.url, { method, mode: 'cors', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(8000), ...(method === 'POST' ? { body: this.playerId(), headers: { 'Content-Type': 'text/plain' } } : {}) });
    if (!response.ok) throw new Error('Counter unavailable');
    const data = await response.json();
    if (data.map !== this.map || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isFinite(Date.parse(data.since))) throw new Error('Invalid counter');
    // A slow menu read must not overwrite the newer result of starting a game.
    this.total = Math.max(this.total ?? 0, data.total);
    this.value.textContent = this.total.toLocaleString();
    this.note.textContent = 'SINCE ' + new Date(data.since).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  playerId() {
    if (this.id) return this.id;
    const key = 't5.player-counter.id';
    for (const storageName of ['localStorage', 'sessionStorage']) {
      try {
        const storage = globalThis[storageName], saved = storage.getItem(key);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved ?? '')) return this.id = saved;
        const id = crypto.randomUUID(); storage.setItem(key, id); return this.id = id;
      } catch { /* Try tab storage when persistent storage is unavailable. */ }
    }
    return this.id = crypto.randomUUID();
  }
  unavailable() { if (this.total === undefined) this.note.textContent = this.url ? 'TEMPORARILY UNAVAILABLE' : 'COUNTING ON THE LIVE SITE'; }
  async refresh() {
    if (!this.url) { this.unavailable(); return; }
    if (Date.now() - (this.lastRead ?? 0) < 30000) return;
    this.lastRead = Date.now();
    try { await this.request(); } catch { this.unavailable(); }
  }
  async recordPlay() {
    this.played = true;
    if (!this.url || this.counted || this.pending) return;
    this.pending = true;
    try { await this.request('POST'); this.counted = true; }
    catch {
      this.unavailable();
      if ((this.retries ?? 0) < 2) { this.retries = (this.retries ?? 0) + 1; setTimeout(() => this.recordPlay(), this.retries * 5000); }
    } finally { this.pending = false; }
  }
}
