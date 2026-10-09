const safeName = (value, fallback) => String(value ?? fallback).trim() || fallback;

export class FreeForAllMatch {
  constructor({ scoreLimit = 30, timeLimitSeconds = 300, feedLimit = 5 } = {}) {
    this.scoreLimit = Math.max(1, Math.trunc(Number(scoreLimit) || 30));
    this.timeLimitSeconds = Math.max(1, Number(timeLimitSeconds) || 300);
    this.feedLimit = Math.max(1, Math.trunc(Number(feedLimit) || 5));
    this.combatants = new Map();
    this.reset();
  }

  register(id, name = id, { human = false } = {}) {
    const key = String(id);
    const previous = this.combatants.get(key);
    const entry = previous ?? { id: key, kills: 0, deaths: 0, streak: 0 };
    entry.name = safeName(name, key);
    entry.human = Boolean(human);
    this.combatants.set(key, entry);
    return entry;
  }

  /** Takes a combatant out of the standings: a benched bot, or a player who left. */
  unregister(id) {
    return this.combatants.delete(String(id));
  }

  reset() {
    this.phase = 'playing';
    this.elapsedSeconds = 0;
    this.winnerId = null;
    this.feed = [];
    for (const entry of this.combatants?.values?.() ?? []) {
      entry.kills = 0;
      entry.deaths = 0;
      entry.streak = 0;
    }
    return this.getState();
  }

  update(deltaSeconds) {
    if (this.phase !== 'playing') return;
    const dt = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.25));
    this.elapsedSeconds = Math.min(this.timeLimitSeconds, this.elapsedSeconds + dt);
    if (this.elapsedSeconds >= this.timeLimitSeconds) this.finish();
  }

  // `detail` rides along on the feed event: the kill's range, for the long
  // shot readout, or anything else the HUD wants to show beside the names.
  recordKill(killerId, victimId, detail = null) {
    if (this.phase !== 'playing') return null;
    const killer = this.combatants.get(String(killerId));
    const victim = this.combatants.get(String(victimId));
    if (!victim) return null;

    victim.deaths += 1;
    victim.streak = 0;
    const credited = killer && killer !== victim;
    if (credited) {
      killer.kills += 1;
      killer.streak += 1;
    }
    const event = {
      killerId: credited ? killer.id : null,
      killer: credited ? killer.name : 'The environment',
      victimId: victim.id,
      victim: victim.name,
      at: this.elapsedSeconds,
      ...(detail && typeof detail === 'object' ? detail : {}),
    };
    this.feed.unshift(event);
    this.feed.length = Math.min(this.feed.length, this.feedLimit);
    if (credited && killer.kills >= this.scoreLimit) this.finish(killer.id);
    return event;
  }

  finish(winnerId = null) {
    if (this.phase === 'ended') return this.winnerId;
    this.phase = 'ended';
    this.winnerId = winnerId && this.combatants.has(String(winnerId))
      ? String(winnerId)
      : this.standings[0]?.id ?? null;
    return this.winnerId;
  }

  get standings() {
    return [...this.combatants.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || Number(b.human) - Number(a.human) ||
        a.name.localeCompare(b.name));
  }

  get remainingSeconds() {
    return Math.max(0, this.timeLimitSeconds - this.elapsedSeconds);
  }

  /**
   * The match as a multiplayer host sends it. The clock travels separately in
   * every snapshot; this part only changes on a kill, a join or the end.
   */
  snapshot() {
    return {
      phase: this.phase,
      scoreLimit: this.scoreLimit,
      timeLimitSeconds: this.timeLimitSeconds,
      winnerId: this.winnerId,
      combatants: [...this.combatants.values()].map((entry) => [
        entry.id, entry.name, entry.human ? 1 : 0, entry.kills, entry.deaths, entry.streak,
      ]),
      feed: this.feed.map((event) => ({ ...event })),
    };
  }

  /** A guest adopts the host's match: standings, feed, phase and clock. */
  applySnapshot(state, elapsedSeconds = null) {
    if (state) {
      this.phase = state.phase === 'ended' ? 'ended' : 'playing';
      this.scoreLimit = Math.max(1, Math.trunc(Number(state.scoreLimit) || this.scoreLimit));
      this.timeLimitSeconds = Math.max(1, Number(state.timeLimitSeconds) || this.timeLimitSeconds);
      this.winnerId = state.winnerId ?? null;
      this.combatants = new Map((state.combatants ?? []).map(([id, name, human, kills, deaths, streak]) => [
        String(id),
        { id: String(id), name: safeName(name, id), human: Boolean(human), kills: kills | 0, deaths: deaths | 0, streak: streak | 0 },
      ]));
      this.feed = (state.feed ?? []).slice(0, this.feedLimit).map((event) => ({ ...event }));
    }
    if (Number.isFinite(elapsedSeconds)) this.elapsedSeconds = Math.max(0, Math.min(this.timeLimitSeconds, elapsedSeconds));
    return this;
  }

  getState() {
    const standings = this.standings.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      human: entry.human,
      kills: entry.kills,
      deaths: entry.deaths,
      streak: entry.streak,
      place: index + 1,
    }));
    return {
      phase: this.phase,
      scoreLimit: this.scoreLimit,
      timeLimitSeconds: this.timeLimitSeconds,
      elapsedSeconds: Math.round(this.elapsedSeconds * 1000) / 1000,
      remainingSeconds: Math.ceil(this.remainingSeconds),
      winnerId: this.winnerId,
      standings,
      feed: this.feed.map((event) => ({ ...event })),
    };
  }
}

export default FreeForAllMatch;
