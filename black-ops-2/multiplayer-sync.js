// The numbers behind multiplayer: snapshot packing, the guest's view of the host's clock, the host's pose
// history for rewinding shots, and the checks the host applies to what guests report. Data only, no DOM or
// Three.js, so node tests load it. The session (multiplayer.js) and the page (index.html) use these.

/** Snapshots per second the host sends, and how far behind the newest one a guest draws the world. */
export const SNAPSHOT_RATE = 20;
export const INTERPOLATION_DELAY = 0.1;
/**
 * The furthest back the host rewinds a guest's shot: what the guest saw, but
 * no further than this. A guest draws 0.1 s behind the snapshots it has, which
 * left the host half a round trip earlier, and its shot takes the other half
 * to arrive: 0.6 s covers round trips up to about 400 ms.
 */
export const MAX_REWIND = 0.6;

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
export const round1 = r1;
export const round3 = r3;

export function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

// ---------- snapshot rows ----------

export const PLAYER_FLAGS = Object.freeze({ crouch: 1, dead: 2, protected: 4, ads: 8, sprint: 16 });
const BOT_STATES = ['idle', 'run', 'death'];

/** A human in a snapshot: [id, x, y, z, yaw, pitch, flags, weapon, health, tp, killer, respawn]. */
export function packPlayer(p) {
  const flags = (p.crouch ? PLAYER_FLAGS.crouch : 0) | (p.dead ? PLAYER_FLAGS.dead : 0) |
    (p.protected ? PLAYER_FLAGS.protected : 0) | (p.ads ? PLAYER_FLAGS.ads : 0) | (p.sprint ? PLAYER_FLAGS.sprint : 0);
  return [p.id, r1(p.feet[0]), r1(p.feet[1]), r1(p.feet[2]), r3(p.yaw), r3(p.pitch ?? 0), flags,
    p.weapon ?? null, Math.ceil(p.health ?? 0), p.tp ?? 0, p.killer ?? null, r1(p.respawn ?? 0)];
}

export function unpackPlayer(row) {
  const [id, x, y, z, yaw, pitch, flags, weapon, health, tp, killer, respawn] = row;
  return {
    id, feet: [x, y, z], yaw, pitch, weapon, health, tp, killer, respawn,
    crouch: Boolean(flags & PLAYER_FLAGS.crouch), dead: Boolean(flags & PLAYER_FLAGS.dead),
    protected: Boolean(flags & PLAYER_FLAGS.protected), ads: Boolean(flags & PLAYER_FLAGS.ads),
    sprint: Boolean(flags & PLAYER_FLAGS.sprint),
  };
}

/** A bot in a snapshot: [index, x, y, z, yaw, state, speed]. Benched bots are left out. */
export function packBot(b) {
  return [b.index, r1(b.x), r1(b.y), r1(b.z), r3(b.yaw), Math.max(0, BOT_STATES.indexOf(b.state)), Math.round(b.speed ?? 0)];
}

export function unpackBot([index, x, y, z, yaw, state, speed]) {
  return { index, x, y, z, yaw, state: BOT_STATES[state] ?? 'idle', speed };
}

// ---------- the guest's clock ----------

/**
 * Snapshots in arrival order, and the guest's estimate of the host's clock.
 * The fastest-arriving snapshot sets the offset; slower ones were delayed on
 * the way, so the estimate only creeps down after them. Drawing at
 * `renderTime()` puts two snapshots either side of the frame almost always.
 */
export class SnapshotBuffer {
  constructor({ delay = INTERPOLATION_DELAY, keep = 1 } = {}) {
    this.delay = delay;
    this.keep = keep;
    this.frames = [];
    this.offset = null;
  }

  push(t, state, now) {
    if (!Number.isFinite(t) || (this.frames.length && t <= this.frames.at(-1).t)) return false;
    this.frames.push({ t, state });
    while (this.frames.length > 2 && this.frames[0].t < t - this.keep) this.frames.shift();
    const sample = t - now;
    if (this.offset === null || sample > this.offset) this.offset = sample;
    else this.offset -= Math.min(this.offset - sample, 0.002);
    return true;
  }

  get latest() {
    return this.frames.at(-1) ?? null;
  }

  hostTime(now) {
    return this.offset === null ? null : now + this.offset;
  }

  renderTime(now) {
    return this.offset === null ? null : now + this.offset - this.delay;
  }

  /** The two snapshots around `time` and how far between them it falls. */
  sample(time) {
    const frames = this.frames;
    if (!frames.length) return null;
    if (time <= frames[0].t) return { a: frames[0], b: frames[0], alpha: 0 };
    for (let i = frames.length - 1; i > 0; i -= 1) {
      const a = frames[i - 1];
      const b = frames[i];
      if (time >= a.t && time <= b.t) return { a, b, alpha: (time - a.t) / Math.max(1e-6, b.t - a.t) };
    }
    const last = frames.at(-1);
    return { a: last, b: last, alpha: 0 };
  }

  clear() {
    this.frames.length = 0;
    this.offset = null;
  }
}

// ---------- the host's view of the past ----------

/** One pose between two: positions and view angles blend, flags come from the nearer one. */
export function blendPose(a, b, alpha) {
  if (!a || !b) return a ?? b ?? null;
  const pose = alpha < 0.5 ? { ...a } : { ...b };
  pose.x = a.x + (b.x - a.x) * alpha;
  pose.y = a.y + (b.y - a.y) * alpha;
  pose.z = a.z + (b.z - a.z) * alpha;
  pose.yaw = lerpAngle(a.yaw, b.yaw, alpha);
  return pose;
}

/**
 * Where every combatant stood over the last moments on the host, so a guest's
 * shot can be checked against the world that guest was drawing.
 */
export class PoseHistory {
  constructor(keep = MAX_REWIND + 0.15) {
    this.keep = keep;
    this.frames = [];
  }

  /** `poses`: Map of combatant key to { x, y, z, yaw, crouch }. */
  record(t, poses) {
    if (this.frames.length && t <= this.frames.at(-1).t) return;
    this.frames.push({ t, poses });
    while (this.frames.length > 2 && this.frames[0].t < t - this.keep) this.frames.shift();
  }

  at(key, time) {
    const frames = this.frames;
    if (!frames.length) return null;
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const a = frames[i];
      if (a.t > time) continue;
      const b = frames[i + 1];
      if (!b) return a.poses.get(key) ?? null;
      return blendPose(a.poses.get(key), b.poses.get(key), (time - a.t) / Math.max(1e-6, b.t - a.t));
    }
    return frames[0].poses.get(key) ?? null;
  }

  clear() {
    this.frames.length = 0;
  }
}

// ---------- what the host accepts from guests ----------

/**
 * A guest's legs, metered on the host. Distance and climb accrue at a little
 * over sprint and jump speed, up to half a second's worth so reports bunched
 * by the network still pass; each accepted move spends them. Faster than a
 * sprint, or climbing faster than a jump or a ladder, is refused. Falls are
 * always fast enough.
 */
export class MoveBudget {
  constructor({ speed = 470, climb = 420, slack = 240 } = {}) {
    Object.assign(this, { speed, climb, slack });
    this.reset(null);
  }

  /** Full allowance again: after a spawn or any other teleport. */
  reset(time) {
    this.distance = this.slack;
    this.rise = this.slack;
    this.at = time;
  }

  /** Whether `from` to `to` (feet, [x, y, z]) fits at host time `time`; an accepted move is spent. */
  allow(from, to, time) {
    const dt = this.at === null ? 0 : Math.max(0, time - this.at);
    this.at = time;
    this.distance = Math.min(this.slack, this.distance + this.speed * dt);
    this.rise = Math.min(this.slack, this.rise + this.climb * dt);
    const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const rise = Math.max(0, to[1] - from[1]);
    if (distance > this.distance || rise > this.rise) return false;
    this.distance -= distance;
    this.rise -= rise;
    return true;
  }
}

/**
 * A guest's trigger, metered on the host. Messages bunch up on the network,
 * so a short burst is allowed, but never a sustained rate above the weapon's.
 */
export class FireBudget {
  constructor({ burst = 3 } = {}) {
    this.burst = burst;
    this.budget = 0;
    this.last = -Infinity;
  }

  allow(time, interval) {
    this.budget = Math.min(this.burst, this.budget + (time - this.last) / Math.max(0.02, interval));
    this.last = time;
    if (this.budget < 0.9) return false;
    this.budget -= 1;
    return true;
  }
}

/**
 * Which pose a remote player shows: still, running in one of four directions
 * relative to where it looks, crouched, or dead. `yaw` is the camera's, so
 * the view looks along (-sin yaw, -cos yaw).
 */
export function locomotionState({ vx = 0, vz = 0, yaw = 0, crouch = false, dead = false, still = 25 } = {}) {
  if (dead) return 'death';
  if (Math.hypot(vx, vz) < still) return crouch ? 'crouch' : 'idle';
  if (crouch) return 'crouchRun';
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const forward = -vx * s - vz * c;
  const right = vx * c - vz * s;
  if (Math.abs(forward) >= Math.abs(right)) return forward >= 0 ? 'run' : 'runBack';
  return right >= 0 ? 'runRight' : 'runLeft';
}
