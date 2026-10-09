// Hand grenades: the frag and the smoke. A thrown grenade is a small rigid
// body that flies from the hand, bounces off the collision world with the
// game's grenade restitution, rolls to a stop, and goes off when its fuse
// runs out. The frag deals explosionInner/OuterDamage over explosionRadius;
// the smoke stands a cloud that blocks sight for smokeDuration.
//
// The simulation and the damage query are plain Three.js math with no DOM so
// they run in node tests; the visuals (models, flash, smoke sprites) attach
// only when a scene is supplied.

import * as THREE from 'three';
import { explosionDamage } from './gunplay.js';
import { tintUntexturedGrenade } from './viewmodel.js';

// Inches per second squared, matching the player controller's fall.
export const GRAVITY = 980;
// T6's grenade bounce: parallelBounce 0.7, perpendicularBounce 0.35 or so;
// the projectile loses most of its normal speed and some tangential.
export const BOUNCE_NORMAL = 0.35;
export const BOUNCE_TANGENT = 0.7;
export const ROLL_FRICTION = 3.2;
export const REST_SPEED = 25;
export const GRENADE_RADIUS = 2.5;
// Throw pitch: the game lofts grenades a little above the aim line.
export const THROW_LIFT = 0.12;
// A grenade thrown from the shoulder rather than the eye.
export const THROW_OFFSET = Object.freeze({ right: 6, down: 4, forward: 10 });
const MAX_LIFETIME = 30;
const MAX_STEP = 1 / 60;

const _normal = new THREE.Vector3();
const _step = new THREE.Vector3();
const _ray = new THREE.Ray();
const _delta = new THREE.Vector3();

/**
 * One grenade in flight. `spec` is a row from weapons.js EQUIPMENT.
 * `collision` needs raycastFirst(ray, near, far) -> { distance, point, normal? }.
 */
export class Grenade {
  constructor(spec, { position, velocity, fuse = spec.fuse, owner = null } = {}) {
    this.spec = spec;
    this.kind = spec.kind;
    this.owner = owner;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.fuse = Math.max(0.05, Number(fuse) || spec.fuse || 3);
    this.age = 0;
    this.resting = false;
    this.exploded = false;
    this.done = false;
    this.bounces = 0;
    this.lastBounce = null;
    this.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18,
    );
    this.rotation = new THREE.Euler();
    this.object = null;
  }

  /**
   * Advances the body. Returns 'bounce' when it struck something this step,
   * 'explode' the step its fuse runs out, else null.
   */
  //
  // A long frame is integrated in sub-steps rather than clamped, so the fuse
  // and the flight keep real time on a slow machine instead of stretching.
  update(dt, collision) {
    if (this.done) return null;
    let remaining = Math.max(0, Math.min(Number(dt) || 0, 0.5));
    let event = null;
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_STEP);
      remaining -= step;
      const result = this.step(step, collision);
      if (result === 'explode') return result;
      if (result) event = result;
    }
    return event;
  }

  step(step, collision) {
    this.age += step;
    this.fuse -= step;
    if (this.fuse <= 0) {
      this.exploded = true;
      this.done = true;
      return 'explode';
    }
    if (this.age > MAX_LIFETIME) {
      this.done = true;
      return null;
    }

    let event = null;
    if (!this.resting) {
      this.velocity.y -= GRAVITY * step;
      _step.copy(this.velocity).multiplyScalar(step);
      const travel = _step.length();
      if (travel > 0 && collision) {
        _ray.origin.copy(this.position);
        _ray.direction.copy(_step).normalize();
        const hit = collision.raycastFirst(_ray, 0, travel + GRENADE_RADIUS);
        if (hit) {
          this.bounce(hit);
          event = 'bounce';
          // Land just short of the surface and carry on with the reflected velocity.
          this.position.copy(_ray.origin).addScaledVector(_ray.direction, Math.max(0, hit.distance - GRENADE_RADIUS));
          _step.copy(this.velocity).multiplyScalar(step * 0.5);
        }
      }
      this.position.add(_step);
      // Rolling on the ground: slow down and settle.
      if (this.lastBounce && this.lastBounce.normal.y > 0.7 && Math.abs(this.velocity.y) < 60) {
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        const friction = Math.max(0, 1 - ROLL_FRICTION * step);
        this.velocity.x *= friction;
        this.velocity.z *= friction;
        if (speed < REST_SPEED) {
          this.velocity.set(0, 0, 0);
          this.resting = true;
        }
      }
      this.rotation.x += this.spin.x * step;
      this.rotation.y += this.spin.y * step;
      this.rotation.z += this.spin.z * step;
    }
    if (this.object) {
      this.object.position.copy(this.position);
      this.object.rotation.copy(this.rotation);
    }
    return event;
  }

  bounce(hit) {
    _normal.copy(hit.normal ?? hit.face?.normal ?? new THREE.Vector3(0, 1, 0)).normalize();
    // Reflect: split the velocity into the normal and tangent parts and damp each.
    const into = this.velocity.dot(_normal);
    if (into < 0) {
      this.velocity.addScaledVector(_normal, -into * (1 + BOUNCE_NORMAL));
      const alongNormal = this.velocity.dot(_normal);
      _delta.copy(_normal).multiplyScalar(alongNormal);
      this.velocity.sub(_delta).multiplyScalar(BOUNCE_TANGENT).add(_delta);
    }
    this.bounces += 1;
    this.spin.multiplyScalar(0.6);
    this.lastBounce = { point: hit.point?.clone?.() ?? this.position.clone(), normal: _normal.clone() };
  }
}

/**
 * Initial velocity for a throw from the camera: the aim direction lifted by
 * THROW_LIFT, scaled by the weapon file's projectileSpeed, plus the thrower's
 * own velocity so a running throw carries.
 */
export function throwVelocity(forward, speed, throwerVelocity = null, out = new THREE.Vector3()) {
  out.copy(forward).normalize();
  out.y += THROW_LIFT;
  out.normalize().multiplyScalar(speed);
  if (throwerVelocity) out.addScaledVector(throwerVelocity, 0.6);
  return out;
}

/**
 * Where a throw leaves the hand, from the camera: a little right, down and
 * forward of the eye, so it never spawns inside the player's own capsule.
 */
export function throwOrigin(camera, out = new THREE.Vector3()) {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  return out.copy(camera.position)
    .addScaledVector(right, THROW_OFFSET.right)
    .addScaledVector(camera.up, -THROW_OFFSET.down)
    .addScaledVector(forward, THROW_OFFSET.forward);
}

/**
 * Blast damage to each actor. `actors` are { id, position, ... }; the
 * collision world, when given, blocks damage through solid cover (a ray from
 * the burst to the actor's centre that hits a wall first).
 */
export function blastDamage(spec, burst, actors, collision = null) {
  const results = [];
  const radius = spec.explosionRadius ?? 0;
  for (const actor of actors ?? []) {
    if (!actor?.position) continue;
    const distance = actor.position.distanceTo(burst);
    if (distance >= radius) continue;
    if (collision && distance > 1) {
      _ray.origin.copy(burst);
      _ray.direction.copy(actor.position).sub(burst).normalize();
      const wall = collision.raycastFirst(_ray, 0.5, distance);
      if (wall && wall.distance < distance - 12) continue;
    }
    const damage = explosionDamage({
      innerDamage: spec.innerDamage, outerDamage: spec.outerDamage, radius,
    }, distance);
    if (damage > 0) results.push({ actor, distance, damage });
  }
  return results;
}

// One standing smoke cloud: a sphere that blocks line of sight while it lasts.
export class SmokeCloud {
  constructor(position, { radius = 220, duration = 12 } = {}) {
    this.position = position.clone();
    this.radius = radius;
    this.duration = duration;
    this.age = 0;
    this.object = null;
    this.sprites = [];
  }

  /** 0 while forming, 1 at full density, back to 0 as it thins. */
  get density() {
    const rise = Math.min(1, this.age / 1.2);
    const fade = Math.min(1, Math.max(0, (this.duration - this.age) / 3));
    return Math.min(rise, fade);
  }

  get done() {
    return this.age >= this.duration;
  }

  update(dt) {
    this.age += Math.max(0, Number(dt) || 0);
    const density = this.density;
    const swell = 0.6 + 0.4 * Math.min(1, this.age / 2.5);
    for (const sprite of this.sprites) {
      sprite.material.opacity = density * sprite.userData.opacity;
      const s = sprite.userData.size * swell;
      sprite.scale.set(s, s, 1);
      sprite.position.copy(sprite.userData.offset).multiplyScalar(swell).add(this.position);
      sprite.position.y += this.age * sprite.userData.rise;
      sprite.material.rotation += dt * sprite.userData.turn;
    }
  }

  /** Whether the segment from a to b passes through the cloud while it is dense. */
  blocks(a, b, threshold = 0.35) {
    if (this.density < threshold) return false;
    _delta.subVectors(b, a);
    const length = _delta.lengthSq();
    const t = length > 0 ? THREE.MathUtils.clamp(this.position.clone().sub(a).dot(_delta) / length, 0, 1) : 0;
    _step.copy(a).addScaledVector(_delta, t);
    return _step.distanceTo(this.position) < this.radius * 0.8;
  }
}

/**
 * Manages the live grenades and smoke clouds, their visuals and cues.
 * `hooks` supply the world: collision, the actors to damage, the audio.
 */
export class GrenadeManager {
  constructor({
    scene = null, collision = null, world = null, surfaceProbe = null,
    onExplode = null, onBounce = null,
  } = {}) {
    this.scene = scene;
    this.collision = collision;
    this.world = world;
    this.surfaceProbe = surfaceProbe;
    this.onExplode = onExplode;
    this.onBounce = onBounce;
    this.grenades = [];
    this.clouds = [];
    this.flashes = [];
    this.models = new Map();
    this.smokeTexture = null;
  }

  /** Registers a loaded projectile model to clone for a grenade kind. */
  setModel(kind, object) {
    this.models.set(kind, object);
  }

  throw(spec, { position, velocity, fuse, owner = null } = {}) {
    const grenade = new Grenade(spec, { position, velocity, fuse, owner });
    const template = this.models.get(spec.kind);
    if (this.scene) {
      grenade.object = template ? template.clone(true) : new THREE.Mesh(
        new THREE.SphereGeometry(GRENADE_RADIUS, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a4a33, roughness: 0.7 }),
      );
      grenade.object.position.copy(position);
      grenade.object.traverse((node) => {
        node.frustumCulled = false;
        if (node.isMesh) tintUntexturedGrenade(node);
      });
      this.scene.add(grenade.object);
    }
    this.grenades.push(grenade);
    return grenade;
  }

  /** Removes every grenade still in flight, without a blast. Smoke clouds stay to clear on their own. */
  clear() {
    for (const grenade of this.grenades) grenade.object?.removeFromParent();
    this.grenades = [];
  }

  update(dt, { actors = [] } = {}) {
    for (const grenade of this.grenades) {
      const event = grenade.update(dt, this.collision);
      if (event === 'bounce') {
        const surface = this.surfaceProbe?.surfaceAt(grenade.position) ?? 'default';
        this.onBounce?.(grenade, surface);
        this.world?.play(
          this.world.resolve([`${grenade.spec.sounds.bounce}_${surface}`, `${grenade.spec.sounds.bounce}_default`]),
          { position: grenade.position.clone(), gain: 0.9 },
        );
      } else if (event === 'explode') {
        this.explode(grenade, actors);
      }
    }
    for (const grenade of this.grenades) {
      if (grenade.done && grenade.object) {
        grenade.object.removeFromParent();
        grenade.object = null;
      }
    }
    this.grenades = this.grenades.filter((grenade) => !grenade.done);

    for (const cloud of this.clouds) cloud.update(dt);
    for (const cloud of this.clouds) {
      if (cloud.done) {
        cloud.object?.removeFromParent();
        cloud.hiss?.stop?.(0.6);
        cloud.world?.play(cloud.hissEnd, { position: cloud.position.clone(), gain: 0.6 });
      }
    }
    this.clouds = this.clouds.filter((cloud) => !cloud.done);

    for (const flash of this.flashes) {
      flash.age += dt;
      const t = Math.min(1, flash.age / flash.life);
      flash.sprite.material.opacity = (1 - t) * flash.peak;
      const s = flash.size * (0.6 + t * 1.2);
      flash.sprite.scale.set(s, s, 1);
      if (t >= 1) flash.sprite.removeFromParent();
    }
    this.flashes = this.flashes.filter((flash) => flash.age < flash.life);
  }

  explode(grenade, actors) {
    const spec = grenade.spec;
    const at = grenade.position.clone();
    if (spec.kind === 'smoke') {
      const cloud = new SmokeCloud(at, { radius: spec.smokeRadius, duration: spec.smokeDuration });
      cloud.world = this.world;
      cloud.hissEnd = spec.sounds.hissEnd;
      if (this.scene) this.buildSmoke(cloud);
      this.clouds.push(cloud);
      this.world?.play(spec.sounds.explode, { position: at.clone(), gain: 0.8 });
      this.world?.play(spec.sounds.hissStart, { position: at.clone(), gain: 0.7 });
      const panner = this.world?.audio?.pannerFor(`smoke:${this.clouds.length}`, at, { refDistance: 125, maxDistance: 1250 });
      cloud.hiss = this.world?.play(spec.sounds.hissLoop, { loop: true, gain: 0.6, cents: 0, panner }) || null;
      this.onExplode?.(grenade, []);
      return;
    }
    const hits = blastDamage(spec, at, actors, this.collision);
    this.world?.play(spec.sounds.explode, { position: at.clone(), gain: 1 });
    this.world?.play(spec.sounds.explodeLfe, { position: at.clone(), gain: 0.9 });
    this.world?.play(spec.sounds.explodeDistant, { position: at.clone(), gain: 0.7 });
    if (this.scene) this.buildFlash(at);
    this.onExplode?.(grenade, hits);
  }

  buildFlash(at) {
    const texture = this.smokeSprite();
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: 0xffb060, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flash.position.copy(at).add(new THREE.Vector3(0, 24, 0));
    flash.scale.set(120, 120, 1);
    flash.renderOrder = 60;
    this.scene.add(flash);
    this.flashes.push({ sprite: flash, age: 0, life: 0.35, size: 140, peak: 1 });
    // A dust puff that hangs for a moment after the flash.
    const dust = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: 0x6a6258, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    dust.position.copy(at).add(new THREE.Vector3(0, 40, 0));
    dust.renderOrder = 59;
    this.scene.add(dust);
    this.flashes.push({ sprite: dust, age: 0, life: 2.2, size: 190, peak: 0.75 });
  }

  buildSmoke(cloud) {
    const texture = this.smokeSprite();
    cloud.object = new THREE.Group();
    const puffs = 14;
    for (let i = 0; i < puffs; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, color: 0xc9c9c4, transparent: true, opacity: 0, depthWrite: false,
      }));
      const angle = (i / puffs) * Math.PI * 2 + Math.random() * 0.6;
      const spread = cloud.radius * (0.15 + Math.random() * 0.45);
      sprite.userData = {
        offset: new THREE.Vector3(Math.cos(angle) * spread, 20 + Math.random() * cloud.radius * 0.35, Math.sin(angle) * spread),
        size: cloud.radius * (0.9 + Math.random() * 0.5),
        opacity: 0.55 + Math.random() * 0.3,
        rise: 2 + Math.random() * 4,
        turn: (Math.random() - 0.5) * 0.3,
      };
      sprite.renderOrder = 55;
      cloud.sprites.push(sprite);
      cloud.object.add(sprite);
    }
    this.scene.add(cloud.object);
  }

  smokeSprite() {
    if (this.smokeTexture) return this.smokeTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    this.smokeTexture = new THREE.CanvasTexture(canvas);
    return this.smokeTexture;
  }

  /** True when smoke stands between two points, for the bots' line of sight. */
  smokeBlocks(a, b) {
    return this.clouds.some((cloud) => cloud.blocks(a, b));
  }

  get activeCount() {
    return this.grenades.length;
  }
}

export default GrenadeManager;
