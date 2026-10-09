// World sound: footsteps and landings for the player and the bots, body falls,
// bullet impacts by surface, flesh hits, whiz-bys, and bot death vox. Every
// cue is one of the game's own aliases, resolved through audio/world-map.json
// (written by .tools/world_audio_manifest.mjs from the soundbank alias
// tables). A cue whose samples were not extracted stays silent, so the game
// runs the same with or without the banks.
//
// Playback shares GunAudio's context, master bus and HRTF panners, so world
// cues sit in the same mix and duck under gunfire the way the shots do.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Alias surface tokens, matched against T6 material names. Order matters: the
// first keyword hit wins, so specific words sit above generic ones.
const SURFACE_KEYWORDS = [
  ['grass', ['astroturf', 'grass', 'lawn', 'turf', 'hedge']],
  ['foliage', ['foliage', 'leaves', 'bush', 'plant', 'tree']],
  ['carpet', ['carpet', 'rug']],
  ['cloth', ['cloth', 'fabric', 'curtain', 'canvas', 'cushion', 'couch', 'bed_', 'mattress']],
  ['wood', ['wood', 'teak', 'deck', 'plank', 'bark', 'crate', 'table', 'chair', 'cabinet', 'bookshelf']],
  ['metal', ['metal', 'steel', 'chrome', 'railing', 'grate', 'vent', 'pipe', 'car_', 'bus', 'truck', 'fridge', 'stove']],
  ['glass', ['glass', 'window']],
  ['ceramic', ['ceramic', 'tile', 'porcelain', 'sink', 'toilet', 'tub']],
  ['plaster', ['plaster', 'drywall', 'wallpaper', 'interiorwall']],
  ['brick', ['brick']],
  ['asphalt', ['asphalt', 'road', 'street', 'tarmac']],
  ['concrete', ['concrete', 'cement', 'sidewalk', 'slab', 'stone', 'stucco', 'curb', 'pavement']],
  ['gravel', ['gravel', 'rubble', 'debris']],
  ['sand', ['sand', 'beach']],
  ['mud', ['mud']],
  ['water', ['water', 'pool', 'ocean']],
  ['dirt', ['dirt', 'ground', 'soil', 'earth', 'desert', 'terrain']],
  ['plastic', ['plastic', 'fiberglass', 'vinyl', 'rubber']],
  ['paper', ['paper', 'cardboard', 'poster', 'decal']],
];

export const DEFAULT_SURFACE = 'default';

/**
 * Map a T6 material or model name onto a footstep surface token. Layered
 * materials are named `*<flags>(base:decal:...)`; only the base layer says
 * what the surface is, the decals on top are damage and trim.
 */
export function surfaceFromMaterial(name) {
  const text = String(name ?? '').toLowerCase();
  if (!text) return DEFAULT_SURFACE;
  const base = (text.match(/\(([^:)]+)/)?.[1] ?? text.split(':')[0]).replace(/^[a-z]+\//, '');
  for (const [surface, words] of SURFACE_KEYWORDS) {
    if (words.some((word) => base.includes(word))) return surface;
  }
  return DEFAULT_SURFACE;
}

// The bullet debris set has fewer surfaces than the footsteps do.
const IMPACT_SURFACE = Object.freeze({
  concrete: 'rock', asphalt: 'rock', brick: 'rock', ceramic: 'rock', glass: 'rock', rock: 'rock',
  wood: 'wood', bark: 'wood', paper: 'wood',
  metal: 'metal', paintedmetal: 'metal',
  plaster: 'plaster',
  sand: 'sand',
  mud: 'mud', water: 'mud',
  dirt: 'dirt', grass: 'dirt', foliage: 'dirt', gravel: 'dirt', carpet: 'dirt', cloth: 'dirt', plastic: 'dirt',
});

export function impactSurface(surface) {
  return IMPACT_SURFACE[surface] ?? 'dirt';
}

/**
 * Turns movement into footfalls: one step per stride of ground distance, a
 * landing when the ground comes back after time in the air. Distance based,
 * so a bot and the player use the same rule at any frame rate.
 */
export class StrideTracker {
  constructor({ walkStride = 58, sprintStride = 80, minAirTime = 0.12 } = {}) {
    this.walkStride = walkStride;
    this.sprintStride = sprintStride;
    this.minAirTime = minAirTime;
    this.last = null;
    this.travelled = 0;
    this.airTime = 0;
    this.fallFrom = null;
  }

  reset() {
    this.last = null;
    this.travelled = 0;
    this.airTime = 0;
    this.fallFrom = null;
  }

  /** `position` is the feet. Returns { step, land, drop } for this update. */
  update(position, { grounded = true, sprinting = false, dt = 0 } = {}) {
    const result = { step: false, land: false, drop: 0 };
    if (!this.last) {
      this.last = position.clone();
      return result;
    }
    if (!grounded) {
      this.airTime += Math.max(0, dt);
      if (this.fallFrom === null) this.fallFrom = position.y;
      this.fallFrom = Math.max(this.fallFrom, position.y);
      this.travelled = 0;
      this.last.copy(position);
      return result;
    }
    if (this.airTime > 0) {
      if (this.airTime >= this.minAirTime) {
        result.land = true;
        result.drop = Math.max(0, (this.fallFrom ?? position.y) - position.y);
      }
      this.airTime = 0;
      this.fallFrom = null;
    }
    const dx = position.x - this.last.x;
    const dz = position.z - this.last.z;
    this.travelled += Math.hypot(dx, dz);
    this.last.copy(position);
    const stride = sprinting ? this.sprintStride : this.walkStride;
    if (this.travelled >= stride) {
      this.travelled -= stride;
      result.step = true;
    }
    return result;
  }
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

/** Closest point on segment ab to p. Returns { point, distance, t }. */
export function segmentClosestPoint(a, b, p, out = new THREE.Vector3()) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const length = _ab.lengthSq();
  const t = length > 0 ? THREE.MathUtils.clamp(_ap.dot(_ab) / length, 0, 1) : 0;
  out.copy(a).addScaledVector(_ab, t);
  return { point: out, distance: out.distanceTo(p), t };
}

const _probeOrigin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

/**
 * Finds the surface under a point by casting into the visible world shell,
 * whose materials still carry the T6 names. The shell is one mesh of about
 * 100k triangles, so it gets a BVH once; props are skipped and fall through
 * to the floor beneath them.
 */
export class SurfaceProbe {
  constructor(root) {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.meshes = [];
    root?.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
      if (!/world_shell/i.test(object.name)) return;
      if (!object.geometry.boundsTree) object.geometry.boundsTree = new MeshBVH(object.geometry);
      this.meshes.push(object);
    });
  }

  /** Surface token at `point`, looking down from just above it. */
  surfaceAt(point, { up = 24, reach = 120 } = {}) {
    if (!this.meshes.length) return DEFAULT_SURFACE;
    _probeOrigin.copy(point);
    _probeOrigin.y += up;
    this.raycaster.set(_probeOrigin, _down);
    this.raycaster.near = 0;
    this.raycaster.far = reach;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit ? this.surfaceOf(hit) : DEFAULT_SURFACE;
  }

  /** Surface token where a ray meets the shell, or default if it misses. */
  surfaceAlong(origin, direction, far = 200) {
    return this.hitAlong(origin, direction, far).surface;
  }

  /** Surface token and material name where a ray meets the shell. */
  hitAlong(origin, direction, far = 200) {
    if (!this.meshes.length) return { surface: DEFAULT_SURFACE, material: '' };
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0;
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit) return { surface: DEFAULT_SURFACE, material: '' };
    const material = hit.object.material;
    const entry = Array.isArray(material) ? material[hit.face?.materialIndex ?? 0] : material;
    return { surface: surfaceFromMaterial(entry?.name), material: entry?.name ?? '' };
  }

  /** Surface token for a raycast hit on one of the shell meshes. */
  surfaceOf(hit) {
    const material = hit?.object?.material;
    if (!material) return DEFAULT_SURFACE;
    const entry = Array.isArray(material) ? material[hit.face?.materialIndex ?? 0] : material;
    return surfaceFromMaterial(entry?.name);
  }
}

const PANNER_POOL = 16;
// Alias volume (0-100) to linear gain exponent; see WorldAudio.volumeGain.
export const VOLUME_CURVE = 2.5;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

export class WorldAudio {
  constructor(gunAudio, { url = 'audio/world-map.json' } = {}) {
    this.audio = gunAudio;
    this.url = url;
    this.aliases = {};
    // Per-alias volume, full-level range, fade-out range and bus from the
    // game's alias tables; see .tools/world_audio_manifest.mjs MIX_COLUMNS.
    this.mix = {};
    this.buffers = Object.create(null);
    this.loaded = null;
    this.pannerCursor = 0;
    this.played = Object.create(null);
  }

  /** The alias tables' mix entry for a cue, or null when the map has none. */
  mixFor(alias) {
    return this.mix?.[alias] ?? null;
  }

  /**
   * Linear gain for an alias volume on the tables' 0-100 scale. The engine's
   * curve is not published; this power law keeps the player's rifle (93) near
   * full level and puts the 60-75 ambience loops 8-12 dB under it, which is
   * the separation the shipped mix has once distance is applied as well.
   */
  static volumeGain(volume) {
    if (!Number.isFinite(volume)) return 1;
    return clamp01(volume / 100) ** VOLUME_CURVE;
  }

  /** Which bus a cue sums into, from its alias table bus or the amb_ prefix. */
  busFor(alias, { ui = false } = {}) {
    if (ui) return 'ui';
    const bus = this.mixFor(alias)?.bus;
    if (bus === 'music') return 'music';
    if (bus === 'voice') return 'voice';
    if (/^amb_/.test(alias ?? '')) return 'ambience';
    return 'fx';
  }

  /** Fetches the alias map and decodes every sample group it lists. */
  load() {
    if (this.loaded) return this.loaded;
    this.loaded = (async () => {
      const response = await fetch(this.url);
      if (!response.ok) throw new Error(`world audio HTTP ${response.status}`);
      const map = await response.json();
      this.aliases = map.aliases ?? {};
      this.mix = map.mix ?? {};
      const context = this.audio.ensureContext();
      if (!context) return false;
      const decode = async (sampleUrl) => {
        const sample = await fetch(sampleUrl);
        if (!sample.ok) throw new Error(`world sample HTTP ${sample.status}: ${sampleUrl}`);
        return context.decodeAudioData(await sample.arrayBuffer());
      };
      const results = await Promise.allSettled(Object.entries(map.samples ?? {}).map(async ([key, urls]) => {
        this.buffers[key] = await Promise.all((Array.isArray(urls) ? urls : [urls]).map(decode));
      }));
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) console.warn(`${failed.length} world sound group(s) unavailable`, failed[0].reason);
      return true;
    })();
    return this.loaded;
  }

  has(alias) {
    const key = this.aliases[alias];
    return Boolean(key && this.buffers[key]?.length);
  }

  /**
   * First alias in `names` that has samples, else the first name so the
   * attempt is still counted (and silent) when the bank is not extracted.
   */
  resolve(names) {
    for (const name of names) if (name && this.has(name)) return name;
    return names.find(Boolean) ?? null;
  }

  /**
   * Plays an alias, panned at `position` or in the head when omitted. Counts
   * attempts per alias whether or not samples exist, so tests can see cues
   * fire without any audio data present.
   */
  //
  // `gain` is the caller's balance on top of the alias table's own volume;
  // a positional cue takes the table's DistMin/DistMaxDry as its panner
  // range and lands on the table's bus (ambience, music, voice or fx).
  play(alias, { position = null, gain = 1, cents = 60, ui = false, loop = false, panner = null, bus = null } = {}) {
    if (!alias) return false;
    this.played[alias] = (this.played[alias] ?? 0) + 1;
    const buffers = this.buffers[this.aliases[alias]];
    const context = this.audio.context;
    if (!buffers?.length || !context || !this.audio.output) return false;
    if (context.state === 'suspended') void context.resume();

    const mix = this.mixFor(alias);
    const busName = bus ?? this.busFor(alias, { ui });
    const source = context.createBufferSource();
    source.buffer = buffers[Math.floor(Math.random() * buffers.length)];
    source.loop = loop;
    source.playbackRate.value = 2 ** (((Math.random() * 2 - 1) * cents) / 1200);
    const gainNode = context.createGain();
    gainNode.gain.value = gain * WorldAudio.volumeGain(mix?.volume);
    // UI cues bypass the gunfire compressor like the hitmarker tick did.
    let destination = this.audio.bus?.(busName) ?? (ui && this.audio.uiOutput ? this.audio.uiOutput : this.audio.output);
    if (panner) destination = panner;
    else if (position) {
      const pooled = this.audio.pannerFor(`world:${this.pannerCursor}`, position, {
        refDistance: mix?.distMin ?? null,
        maxDistance: mix?.distMax ?? null,
        bus: busName,
      });
      this.pannerCursor = (this.pannerCursor + 1) % PANNER_POOL;
      if (pooled) destination = pooled;
    }
    source.connect(gainNode).connect(destination);
    const handle = {
      source,
      gain: gainNode,
      stop(fade = 0) {
        try {
          if (fade > 0) {
            gainNode.gain.setValueAtTime(gainNode.gain.value, context.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.0001, context.currentTime + fade);
            source.stop(context.currentTime + fade);
          } else source.stop();
        } catch { /* already ended */ }
      },
    };
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };
    source.start();
    return loop ? handle : true;
  }

  /** Alias for a map-specific ambience cue: `<alias>@mpl_<prefix>.all`, else the plain alias. */
  ambienceAlias(alias, bank) {
    const keyed = `${alias}@${bank}`;
    return this.has(keyed) ? keyed : this.has(alias) ? alias : null;
  }

  footstep({ surface = DEFAULT_SURFACE, sprinting = false, walking = false, crouched = false, npc = false, position = null } = {}) {
    const pace = sprinting ? 'sprint' : walking ? 'walk' : 'run';
    const who = npc ? 'npc_' : '';
    const stance = crouched && !sprinting ? 'crouch_' : '';
    return this.play(this.resolve([
      `fly_lstep_${stance}${pace}_${who}${surface}`,
      `fly_lstep_${pace}_${who}${surface}`,
      `fly_lstep_${stance}${pace}_${who}default`,
      `fly_lstep_${pace}_${who}default`,
    ]), { position, gain: npc ? 0.9 : 0.55 });
  }

  land({ surface = DEFAULT_SURFACE, npc = false, position = null, drop = 0 } = {}) {
    const who = npc ? 'npc' : 'plr';
    if (drop > 140) this.play(this.resolve([`fly_land_damage_${who}`, `fly_land_${who}_damage`]), { position, gain: 0.9 });
    return this.play(this.resolve([
      `fly_land_${who}_${surface}`,
      `fly_land_${surface}`,
      `fly_land_${who}_default`,
      `fly_land_npc_default`,
    ]), { position, gain: npc ? 0.9 : 0.7 });
  }

  bodyfall({ surface = DEFAULT_SURFACE, position = null } = {}) {
    return this.play(this.resolve([
      `fly_bodyfall_large_${surface}`,
      'fly_bodyfall_generic_npc',
    ]), { position, gain: 0.9 });
  }

  bulletImpact({ surface = DEFAULT_SURFACE, position = null } = {}) {
    const debris = impactSurface(surface);
    if ((debris === 'metal' || debris === 'rock') && Math.random() < 0.2) {
      this.play(this.resolve(['prj_bullet_ap_ricochet']), { position, gain: 0.6 });
    }
    return this.play(this.resolve([
      `prj_bullet_debris_large_${debris}`,
      `prj_bullet_debris_small_${debris}`,
      'prj_bullet_debris_large_dirt',
    ]), { position, gain: 0.8 });
  }

  fleshHit({ region = 'torso', position = null } = {}) {
    if (region === 'head') this.play(this.resolve(['prj_bullet_impact_headshot']), { position, gain: 0.9 });
    return this.play(this.resolve(['prj_bolt_impact_flesh', 'phy_impact_flesh_flesh']), { position, gain: 0.8 });
  }

  /** A round passing the listener; `distance` is the miss distance in units. */
  whizby({ position = null, distance = 40 } = {}) {
    const alias = distance < 24 ? 'prj_crack' : 'prj_whizby';
    return this.play(this.resolve([alias, 'prj_whizby']), { position, gain: 0.85, cents: 120 });
  }

  death({ position = null } = {}) {
    return this.play(this.resolve(['vox_moto_death']), { position, gain: 0.8 });
  }
}

// Loops run only within their own authored range (the alias table's
// DistMaxDry, a few dozen to a few hundred units for a vent or a hum), so a
// map with a hundred emitters costs a handful of voices and a loop authored to
// die at 50 units is never heard across the street. The range constants are
// the ceiling for cues the map carries no table entry for.
export const AMBIENCE_LOOP_RANGE = 600;
export const AMBIENCE_RANDOM_RANGE = 500;
const AMBIENCE_CULL_INTERVAL = 0.5;
export const AMBIENCE_MAX_LOOPS = 10;
// The 2D bed is authored as a left and a right half; each is hard-panned.
const BED_PAIRS = [
  ['amb_main_bg_l', 'amb_main_bg_r'],
  ['amb_ocean_l', 'amb_ocean_r'],
  ['amb_wind_left', 'amb_wind_right'],
];

/**
 * The map's ambient package: `script_struct` emitters from the entity list
 * (exported into the nav hints), each a loop or a random one-shot at a
 * position, plus the map's 2D wind bed.
 */
export class AmbienceManager {
  constructor(world, emitters = [], { bank = '', bed = ['amb_wind_extreior_2d', 'amb_main_bg_l'] } = {}) {
    this.world = world;
    this.bank = bank;
    this.bedAliases = bed;
    this.bedHandles = [];
    this.emitters = emitters.map((emitter, index) => ({
      index,
      alias: emitter.alias,
      mode: emitter.mode,
      position: new THREE.Vector3(...emitter.position),
      handle: null,
      nextAt: 0,
    }));
    this.running = false;
    this.bedHandle = null;
    this.cullTimer = 0;
    this.time = 0;
  }

  /** Range a loop or random emitter plays within: its own DistMaxDry, else the default. */
  rangeFor(alias, fallback) {
    const max = this.world.mixFor?.(alias)?.distMax;
    return Number.isFinite(max) && max > 0 ? Math.min(max, fallback) : fallback;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // A stereo pair when the bank has one, hard-panned left and right, else the
    // single 2D bed the map names.
    const pair = BED_PAIRS
      .map(([left, right]) => [this.world.ambienceAlias(left, this.bank), this.world.ambienceAlias(right, this.bank)])
      .find(([left, right]) => left && right);
    if (pair) {
      this.bedHandles = pair.map((alias, index) => this.world.play(alias, {
        loop: true, gain: 0.5, cents: 0, panner: this.world.audio.stereoPanner?.(index === 0 ? -0.8 : 0.8, 'ambience') ?? null,
      }) || null).filter(Boolean);
    } else {
      const bed = this.bedAliases.map((alias) => this.world.ambienceAlias(alias, this.bank)).find(Boolean);
      if (bed) this.bedHandles = [this.world.play(bed, { loop: true, gain: 0.5, cents: 0 })].filter((handle) => handle?.stop);
    }
    this.bedHandle = this.bedHandles[0] ?? null;
    this.cullTimer = AMBIENCE_CULL_INTERVAL;
  }

  stop() {
    this.running = false;
    for (const handle of this.bedHandles) handle?.stop?.(0.5);
    this.bedHandles = [];
    this.bedHandle = null;
    for (const emitter of this.emitters) {
      emitter.handle?.stop?.(0.3);
      emitter.handle = null;
    }
  }

  /** Cull loops by distance and fire due random emitters. */
  update(dt, listener) {
    if (!this.running || !listener) return;
    this.time += dt;
    this.cullTimer -= dt;
    if (this.cullTimer > 0) return;
    this.cullTimer = AMBIENCE_CULL_INTERVAL;
    // Nearest first, so the loop cap keeps the emitters that matter rather
    // than whichever came first in the entity list.
    const ordered = this.emitters
      .map((emitter) => ({ emitter, distance: emitter.position.distanceTo(listener) }))
      .sort((a, b) => a.distance - b.distance);
    let loops = this.emitters.filter((emitter) => emitter.handle).length;
    for (const { emitter, distance } of ordered) {
      const alias = this.world.ambienceAlias(emitter.alias, this.bank);
      if (!alias) continue;
      const mix = this.world.mixFor?.(alias);
      if (emitter.mode === 'loop') {
        const range = this.rangeFor(alias, AMBIENCE_LOOP_RANGE);
        if (distance <= range && !emitter.handle && loops < AMBIENCE_MAX_LOOPS) {
          const panner = this.world.audio.pannerFor(`amb:${emitter.index}`, emitter.position, {
            refDistance: mix?.distMin ?? Math.min(60, range * 0.4),
            maxDistance: range,
            bus: 'ambience',
          });
          const handle = this.world.play(alias, { loop: true, gain: 0.8, cents: 0, panner });
          if (handle && handle.stop) {
            emitter.handle = handle;
            loops += 1;
          }
        } else if (distance > range * 1.15 && emitter.handle) {
          emitter.handle.stop(0.4);
          emitter.handle = null;
          loops -= 1;
        }
      } else if (distance <= this.rangeFor(alias, AMBIENCE_RANDOM_RANGE) && this.time >= emitter.nextAt) {
        this.world.play(alias, { position: emitter.position, gain: 0.7 });
        emitter.nextAt = this.time + 6 + Math.random() * 14;
      }
    }
  }
}

/** One music cue at a time: spawn, timer, and the result stings. */
export class MusicPlayer {
  constructor(world) {
    this.world = world;
    this.current = null;
    this.currentAlias = null;
  }

  play(alias, { loop = false, gain = 0.5 } = {}) {
    if (!this.world.has(alias)) return false;
    this.stop(0.4);
    const handle = this.world.play(alias, { loop: true, gain, cents: 0, bus: 'music' });
    if (!handle || !handle.stop) return false;
    handle.source.loop = loop;
    this.current = handle;
    this.currentAlias = alias;
    return true;
  }

  stop(fade = 0.4) {
    this.current?.stop?.(fade);
    this.current = null;
    this.currentAlias = null;
  }
}
