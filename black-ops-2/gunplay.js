// Gunplay rules driven by the T6 weapon files: damage by range, hip spread,
// view kick with recentring, sprint-out and ADS timing, and flinch. Pure state
// machines with no DOM or Three.js dependency so they run in node tests.
//
// Units follow the weapon files. Ranges are world inches, spread values are
// cone half-angles in degrees, kick values are the files' own kick units,
// scaled into radians by VIEW_KICK_RADIANS below.

const DEG = Math.PI / 180;

// hipViewKickPitchMax of 50 was measured against the pre-existing hand-tuned
// kick of about 0.0065 rad per shot, so the two agree for the M27 and every
// other rifle scales from there.
export const VIEW_KICK_RADIANS = 0.00013;
// viewKickCenterSpeed is in the same kick units per second.
export const VIEW_KICK_CENTER_RADIANS = VIEW_KICK_RADIANS;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** World zoom follows the same eased ADS blend as the weapon raise. */
export function adsFieldOfView(hipFov, adsFov, aimBlend) {
  return hipFov + (adsFov - hipFov) * clamp(aimBlend, 0, 1);
}

/** Preserve small aiming corrections in screen space as the lens zooms. */
export function zoomLookScale(fov, hipFov) {
  return Math.tan(fov * DEG / 2) / Math.tan(hipFov * DEG / 2);
}

/**
 * Stepwise range falloff, as the engine applies it: full damage out to
 * maxDamageRange, then each damageRangeN opens the next band, then minDamage
 * from minDamageRange on. Bands with a zero range are unused.
 */
export function damageAtDistance(ballistics, distance) {
  const d = Math.max(0, Number(distance) || 0);
  const bands = ballistics?.ranges ?? [];
  let damage = ballistics?.damage ?? 0;
  for (const band of bands) {
    if (band.range > 0 && d >= band.range) damage = band.damage;
  }
  return damage;
}

/** Locational multiplier; unknown regions count as the file's locNone. */
export function locationMultiplier(ballistics, region) {
  const table = ballistics?.locations ?? {};
  return table[region] ?? table.none ?? 1;
}

/**
 * Hip spread: a resting minimum by stance, a movement term, and a per-shot
 * bloom that decays at hipSpreadDecayRate per second, clamped to the maximum.
 * ADS blends the whole cone toward adsSpread.
 */
export class SpreadModel {
  constructor(ballistics = {}) {
    this.b = ballistics;
    this.bloom = 0;
  }

  reset() {
    this.bloom = 0;
  }

  onShot() {
    this.bloom += this.b.hipSpread?.fireAdd ?? 0;
    const max = this.b.hipSpread?.max ?? Infinity;
    const min = this.b.hipSpread?.standMin ?? 0;
    this.bloom = clamp(this.bloom, 0, Math.max(0, max - min));
  }

  update(dt) {
    const decay = this.b.hipSpread?.decayRate ?? 0;
    this.bloom = Math.max(0, this.bloom - decay * Math.max(0, dt));
  }

  /** Current cone half-angle in degrees. moveFactor is 0 still to 1 full speed. */
  angleDegrees({ crouched = false, moveFactor = 0, aimBlend = 0 } = {}) {
    const hip = this.b.hipSpread ?? {};
    const rest = crouched ? (hip.duckedMin ?? hip.standMin ?? 0) : (hip.standMin ?? 0);
    const max = crouched ? (hip.duckedMax ?? hip.max ?? Infinity) : (hip.max ?? Infinity);
    const moving = (hip.moveAdd ?? 0) * clamp(moveFactor, 0, 1);
    const hipAngle = Math.min(max, rest + moving + this.bloom);
    const ads = this.b.adsSpread ?? 0;
    const t = clamp(aimBlend, 0, 1);
    return hipAngle * (1 - t) + ads * t;
  }

  /** A random direction offset inside the cone, in radians: [yaw, pitch]. */
  sample(state = {}, random = Math.random) {
    const radius = this.angleDegrees(state) * DEG;
    if (radius <= 0) return [0, 0];
    // Uniform over the disc, not the radius, or shots cluster at the centre.
    const r = radius * Math.sqrt(random());
    const theta = random() * Math.PI * 2;
    return [Math.cos(theta) * r, Math.sin(theta) * r];
  }
}

/**
 * View kick. Each shot throws the view by a random amount inside the file's
 * pitch and yaw range, then the view recentres at viewKickCenterSpeed toward
 * where it was before the burst. Mouse input during the burst moves that
 * centre with it, so recentring never fights the player's own aim.
 */
export class ViewKick {
  constructor(ballistics = {}) {
    this.b = ballistics;
    this.pitchOffset = 0;
    this.yawOffset = 0;
    this.centerSpeed = 0;
  }

  reset() {
    this.pitchOffset = 0;
    this.yawOffset = 0;
  }

  /** Kick for one shot. Returns the radians applied, positive pitch is up. */
  onShot({ aimBlend = 0 } = {}, random = Math.random) {
    const kick = aimBlend > 0.5 ? this.b.adsKick : this.b.hipKick;
    if (!kick) return { pitch: 0, yaw: 0 };
    let pitch = kick.pitchMin + (kick.pitchMax - kick.pitchMin) * random();
    let yaw = kick.yawMin + (kick.yawMax - kick.yawMin) * random();
    // adsViewKickMinMagnitude keeps aimed shots from landing a null kick.
    const magnitude = Math.hypot(pitch, yaw);
    if (kick.minMagnitude && magnitude > 0 && magnitude < kick.minMagnitude) {
      const scale = kick.minMagnitude / magnitude;
      pitch *= scale;
      yaw *= scale;
    }
    const result = { pitch: pitch * VIEW_KICK_RADIANS, yaw: yaw * VIEW_KICK_RADIANS };
    this.pitchOffset += result.pitch;
    this.yawOffset += result.yaw;
    this.centerSpeed = (kick.centerSpeed ?? 0) * VIEW_KICK_CENTER_RADIANS;
    return result;
  }

  /**
   * A hit taken: the view jolts up and away from the shooter, sized by the
   * damage, and recentres like recoil does.
   */
  flinch(damage, { side = 0 } = {}, random = Math.random) {
    const strength = clamp(damage / 30, 0.2, 2);
    const pitch = (0.012 + random() * 0.01) * strength;
    const yaw = (side || (random() - 0.5) * 2) * (0.006 + random() * 0.006) * strength;
    this.pitchOffset += pitch;
    this.yawOffset += yaw;
    this.centerSpeed = Math.max(this.centerSpeed, 1550 * VIEW_KICK_CENTER_RADIANS);
    return { pitch, yaw };
  }

  /**
   * Recentring for this frame. Returns the radians to add to the camera
   * (negative of what the kick added, spent gradually). Only a share of the
   * kick is returned so a held burst still climbs, as it does in the game.
   */
  update(dt, { returnFraction = 0.55 } = {}) {
    const step = this.centerSpeed * Math.max(0, dt);
    if (step <= 0) return { pitch: 0, yaw: 0 };
    const pitch = clamp(this.pitchOffset * returnFraction, -step, step);
    const yaw = clamp(this.yawOffset * returnFraction, -step, step);
    this.pitchOffset -= pitch / returnFraction;
    this.yawOffset -= yaw / returnFraction;
    if (Math.abs(this.pitchOffset) < 1e-5) this.pitchOffset = 0;
    if (Math.abs(this.yawOffset) < 1e-5) this.yawOffset = 0;
    return { pitch: -pitch, yaw: -yaw };
  }
}

/**
 * Sprint-out: pulling the trigger while sprinting ends the sprint, and firing
 * waits sprintOutTime for the gun to come back up. Letting go of sprint also
 * starts the timer. `sprinting` is what the animation should show.
 */
export class SprintGate {
  constructor(ballistics = {}) {
    this.sprintOutTime = ballistics.sprintOutTime ?? 0.2;
    this.timer = 0;
    this.wasSprinting = false;
    this.interrupted = false;
  }

  reset() {
    this.timer = 0;
    this.wasSprinting = false;
    this.interrupted = false;
  }

  update(dt, { wantsSprint = false, triggerHeld = false, aiming = false } = {}) {
    // Firing or aiming cancels the sprint until the key is released.
    if (wantsSprint && (triggerHeld || aiming)) this.interrupted = true;
    if (!wantsSprint) this.interrupted = false;
    const sprinting = wantsSprint && !this.interrupted;
    if (this.wasSprinting && !sprinting) this.timer = this.sprintOutTime;
    this.wasSprinting = sprinting;
    this.timer = Math.max(0, this.timer - Math.max(0, dt));
    return { sprinting, canFire: !sprinting && this.timer <= 0 };
  }
}

/**
 * ADS raise and lower on the weapon file's timings, with an ease so the
 * motion settles instead of stopping dead. Returns the eased blend in 0..1.
 */
export class AdsBlend {
  constructor(ballistics = {}) {
    this.inTime = Math.max(0.01, ballistics.adsTransInTime ?? 0.25);
    this.outTime = Math.max(0.01, ballistics.adsTransOutTime ?? 0.25);
    this.t = 0;
  }

  reset() {
    this.t = 0;
  }

  update(dt, aiming) {
    const step = Math.max(0, dt) / (aiming ? this.inTime : this.outTime);
    this.t = clamp(this.t + (aiming ? step : -step), 0, 1);
    return this.value;
  }

  get value() {
    const t = this.t;
    return t * t * (3 - 2 * t);
  }
}

// Bullet penetration. The weapon file's penetrateType sets how many thin
// surfaces a round can pass; glass and open fences never count against it.
// Each surface passed and each body passed scales the damage that follows.
export const PENETRATION_BUDGET = Object.freeze({ none: 0, small: 1, medium: 2, large: 3 });
export const SURFACE_PENETRATION_SCALE = 0.75;
export const BODY_PENETRATION_SCALE = 0.7;
export const MAX_PENETRATIONS = 4;

const FREE_PASS = /fence|chainlink|chain_link|wire|mesh|net\b|grate|railing|banister|lattice/;
const THIN_SURFACES = new Set(['wood', 'paper', 'cloth', 'plastic', 'foliage', 'plaster', 'carpet', 'ceramic']);

/**
 * 'free': glass and see-through barriers, no budget spent, no damage lost.
 * 'thin': wood, plaster and the like, one budget point and a damage scale.
 * 'solid': everything else stops the round.
 */
export function penetrationClass(surface, materialName = '') {
  const name = String(materialName ?? '').toLowerCase();
  if (surface === 'glass' || FREE_PASS.test(name)) return 'free';
  if (THIN_SURFACES.has(surface)) return 'thin';
  return 'solid';
}

/**
 * Whether a round with `remaining` budget passes a surface, and what is left.
 * Returns null when the surface stops it.
 */
export function passSurface(surface, materialName, remaining) {
  const kind = penetrationClass(surface, materialName);
  if (kind === 'free') return { remaining, scale: 1 };
  if (kind === 'thin' && remaining > 0) return { remaining: remaining - 1, scale: SURFACE_PENETRATION_SCALE };
  return null;
}

// Melee. The knife reaches `range` inches; a target a little further out but
// nearly dead ahead is lunged to, as the engine does. `targets` are candidate
// positions (torso centres) with whatever the caller wants back; the pick is
// the nearest inside the reach cone, or null. Distances are eye-to-torso.
export function selectMeleeTarget(origin, forward, targets, {
  range = 64, lunge = 40, coneDegrees = 32,
} = {}) {
  const minDot = Math.cos(coneDegrees * DEG);
  const reach = range + lunge;
  let best = null;
  for (const target of targets ?? []) {
    const p = target.position;
    if (!p) continue;
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dz = p.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > reach || distance <= 0) continue;
    const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / distance;
    // Inside the plain reach any angle in the cone counts; the lunge band
    // needs the target nearly centred.
    const lungeDot = Math.cos((coneDegrees * 0.45) * DEG);
    if (dot < (distance <= range ? minDot : lungeDot)) continue;
    if (!best || distance < best.distance) best = { target, distance };
  }
  return best;
}

/**
 * Grenade blast damage by distance from the burst, linear between the inner
 * and outer figures out to the radius and nothing past it, as
 * explosionInnerDamage / explosionOuterDamage / explosionRadius are applied.
 */
export function explosionDamage({ innerDamage = 0, outerDamage = 0, radius = 0 } = {}, distance) {
  const d = Math.max(0, Number(distance) || 0);
  if (radius <= 0 || d >= radius) return 0;
  const t = d / radius;
  return innerDamage + (outerDamage - innerDamage) * t;
}

// A kill from further than this is a Long Shot, the game's medal for it.
export const LONGSHOT_DISTANCE = 1500;
// The world is in inches; the HUD reads metres.
export const INCHES_PER_METRE = 39.3701;

export function metresFromUnits(units) {
  return Math.max(0, Number(units) || 0) / INCHES_PER_METRE;
}
