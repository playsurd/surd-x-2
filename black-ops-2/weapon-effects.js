import * as THREE from 'three';

import { segmentClosestPoint } from './world-audio.js';
import { BODY_PENETRATION_SCALE, MAX_PENETRATIONS, PENETRATION_BUDGET, passSurface } from './gunplay.js';
import foleyMap from './audio/foley-map.json' with { type: 'json' };

const center = new THREE.Vector2(0, 0);
const surfaceNormal = new THREE.Vector3();
const spreadForward = new THREE.Vector3();
const spreadRight = new THREE.Vector3();
const spreadUp = new THREE.Vector3();
const whizPoint = new THREE.Vector3();
const planeNormal = new THREE.Vector3(0, 0, 1);
const _listenerPosition = new THREE.Vector3();
const _listenerForward = new THREE.Vector3();
const _listenerUp = new THREE.Vector3();

// World units are Radiant inches: the capsule is 72 tall and walks at 300/s.
// Every panner distance below is tuned against that scale, not metres.
const PANNER_REFERENCE_DISTANCE = 180;
// Bus levels relative to the FX master (0.68). The alias tables put the
// ambience loops 20-30 volume points under the player's rifle and the music
// under that; see world-audio.js for the per-alias volume curve on top.
export const BUS_LEVELS = Object.freeze({ ambience: 0.4, music: 0.5, voice: 0.6 });
// Ambience duck under the player's own gunfire.
export const DUCK = Object.freeze({ depth: 0.4, attack: 0.05, hold: 0.35, release: 0.9 });
// The NPC report alias plays flat to its DistMin and hands over to the
// `_dist` alias past it; the tables author both at 900.
const NPC_REPORT_HANDOVER = 900;

let flashTexture = null;

// Generated from the nine assault-rifle notetracks and merged soundbank alias
// tables by `.tools/weapon_audio_manifest.mjs`; keep the authored cue mapping
// and explicitly silent set in sync with the extracted files.
export const FOLEY_URLS = Object.freeze(foleyMap.samples);
export const FOLEY_ALIASES = Object.freeze(foleyMap.aliases);
export const SILENT_CUES = Object.freeze(new Set(foleyMap.silentCues));

// A soft radial core crossed by two thin spikes. Shared by the viewmodel's
// first-person flash and the world flashes fired by enemies so both weapons
// read as the same muzzle.
// A soft dark red dot for blood drops.
export function createBloodDropTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(120, 10, 10, 1)');
  gradient.addColorStop(0.6, 'rgba(90, 6, 6, 0.9)');
  gradient.addColorStop(1, 'rgba(60, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMuzzleFlashTexture() {
  if (flashTexture) return flashTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const radial = Math.exp(-(nx * nx + ny * ny) * 7);
      const cross = Math.exp(-Math.abs(nx) * 18) * Math.exp(-ny * ny * 2)
        + Math.exp(-Math.abs(ny) * 18) * Math.exp(-nx * nx * 2);
      const alpha = THREE.MathUtils.clamp(radial + cross * 0.55, 0, 1);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 214;
      data[offset + 2] = 112;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  flashTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  flashTexture.colorSpace = THREE.SRGBColorSpace;
  flashTexture.needsUpdate = true;
  return flashTexture;
}

function setAudioPosition(target, x, y, z) {
  if (target.positionX) {
    target.positionX.value = x;
    target.positionY.value = y;
    target.positionZ.value = z;
  } else {
    target.setPosition(x, y, z);
  }
}

export class GunAudio {
  constructor({
    shotUrl = './audio/wpn_m27_shot_plr.wav',
    // Each rifle's own player-perspective report. Keyed by weapon id and loaded
    // under `shot:<id>`, which also gives every weapon its own voice pool, so a
    // weapon switch mid-burst cannot steal the outgoing gun's tails.
    shotUrls = {
      m27: './audio/wpn_m27_shot_plr.wav',
      an94: './audio/wpn_an94_shot_plr.wav',
      hk416: './audio/wpn_m27_shot_plr.wav',
      sa58: './audio/wpn_sa58_shot_plr.wav',
      saritch: './audio/wpn_saritch_shot_plr.wav',
      scar: './audio/wpn_scar_shot_plr.wav',
      sig556: './audio/wpn_sig556_shot_plr.wav',
      tar21: './audio/wpn_tar21_shot_plr.wav',
      type95: './audio/wpn_type95_shot_plr.wav',
      xm8: './audio/wpn_xm8_shot_plr.wav',
      // The secondary slot. Pistols share one decay pair (wpn_pistol_decay_*).
      fiveseven: './audio/wpn_fiveseven_shot_plr.wav',
      fnp45: './audio/wpn_fnp45_fire_plr.wav',
      kard: './audio/wpn_kard_shot_plr.wav',
      beretta93r: './audio/wpn_beretta_fire_plr.wav',
      // Sniper rifles: their own reports over the sniper decay pair.
      dsr50: './audio/wpn_dsr_fire_plr.wav',
      ballista: './audio/wpn_ballista_fire_plr.wav',
      svu: './audio/wpn_svt_fire_plr.wav',
      as50: './audio/wpn_as50_fire_plr.wav',
    },
    pistolExteriorDecayUrl = './audio/wpn_pistol_decay_ext.wav',
    pistolInteriorDecayUrl = './audio/wpn_pistol_decay_int.wav',
    sniperExteriorDecayUrl = './audio/wpn_sniper_decay_ext.wav',
    sniperInteriorDecayUrl = './audio/wpn_rifle_decay_int.wav',
    sniperLfeUrl = './audio/wpn_dsr_fire_lfe.wav',
    exteriorDecayUrl = './audio/wpn_assault_decay_ext.wav',
    interiorDecayUrl = './audio/wpn_assault_decay_int.wav',
    lfeUrl = './audio/wpn_mp7_fire_lfe.wav',
  } = {}) {
    this.context = null;
    this.output = null;
    this.uiOutput = null;
    this.ready = false;
    this.loading = null;
    this.buffers = Object.create(null);
    this.foleyBuffers = Object.create(null);
    this.voices = Object.create(null);
    // Set by WeaponEffects once the world cue set exists.
    this.world = null;
    this.panners = new Map();
    this.listenerPosition = new THREE.Vector3();
    this.urls = {
      // `shot` stays the unkeyed default: enemy reports and any caller that
      // does not name a weapon still resolve to the M27 the export shipped.
      shot: shotUrl,
      ...Object.fromEntries(Object.entries(shotUrls).map(([id, url]) => [`shot:${id}`, url])),
      exteriorDecay: exteriorDecayUrl,
      interiorDecay: interiorDecayUrl,
      pistolExteriorDecay: pistolExteriorDecayUrl,
      pistolInteriorDecay: pistolInteriorDecayUrl,
      sniperExteriorDecay: sniperExteriorDecayUrl,
      sniperInteriorDecay: sniperInteriorDecayUrl,
      sniperLfe: sniperLfeUrl,
      lfe: lfeUrl,
    };
    // Weapons whose report decays with the pistol or sniper tail rather than the rifle's.
    this.pistols = new Set(['fiveseven', 'fnp45', 'kard', 'beretta93r']);
    this.snipers = new Set(['dsr50', 'ballista', 'svu', 'as50']);
  }

  decayLayer(weapon, indoors) {
    const family = this.pistols.has(weapon) ? 'pistol' : this.snipers.has(weapon) ? 'sniper' : '';
    const key = family
      ? `${family}${indoors ? 'InteriorDecay' : 'ExteriorDecay'}`
      : (indoors ? 'interiorDecay' : 'exteriorDecay');
    return this.buffers[key] ? key : (indoors ? 'interiorDecay' : 'exteriorDecay');
  }

  lfeLayer(weapon) {
    return this.snipers.has(weapon) && this.buffers.sniperLfe ? 'sniperLfe' : 'lfe';
  }

  // Falls back to the shared report rather than going silent, so a weapon added
  // without its own recovered shot alias still fires audibly.
  shotLayer(weapon) {
    const keyed = `shot:${weapon}`;
    return weapon && this.buffers[keyed] ? keyed : 'shot';
  }

  ensureContext() {
    const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContext) return null;
    if (!this.context) {
      this.context = new AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -5;
      compressor.knee.value = 6;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.08;
      const master = this.context.createGain();
      master.gain.value = 0.68;
      master.connect(compressor).connect(this.context.destination);
      // `output` is the FX bus: gunfire, impacts, foley, whiz-bys. It carries
      // the compressor so the shots stay glued together.
      this.output = master;

      // Hitmarkers bypass the gunfire compressor. Routed through it, every
      // confirmation tick would be ducked by the shot that caused it.
      const ui = this.context.createGain();
      ui.gain.value = 0.5;
      ui.connect(this.context.destination);
      this.uiOutput = ui;

      // The game mixes on buses: ambience, music and voice never share the
      // weapon compressor, so a steady bed cannot eat the shots' headroom and
      // a burst cannot pump the wind. Levels are the shipped bus balance
      // approximated: ambience sits well under FX, music under that.
      const busGain = (value) => {
        const node = this.context.createGain();
        node.gain.value = value;
        node.connect(this.context.destination);
        return node;
      };
      this.buses = {
        fx: master,
        ambience: busGain(BUS_LEVELS.ambience),
        music: busGain(BUS_LEVELS.music),
        voice: busGain(BUS_LEVELS.voice),
        ui,
      };
      this.duckedUntil = 0;
    }
    return this.context;
  }

  /** Output node for a named bus; unknown names land on the FX bus. */
  bus(name) {
    return this.buses?.[name] ?? this.output;
  }

  /** A fixed left/right pan into a bus, for the halves of a stereo bed. */
  stereoPanner(pan, bus = 'ambience') {
    const context = this.ensureContext();
    if (!context?.createStereoPanner) return null;
    const node = context.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(this.bus(bus));
    return node;
  }

  /**
   * Gunfire ducks the ambience bus, the way the game's wpn_cmn_shot_plr duck
   * snapshot pulls snp_ambience down: quick in, a hold, a slow release.
   */
  duckAmbience({ depth = DUCK.depth, attack = DUCK.attack, hold = DUCK.hold, release = DUCK.release } = {}) {
    const bus = this.buses?.ambience;
    const context = this.context;
    if (!bus || !context) return;
    const now = context.currentTime;
    const gain = bus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(BUS_LEVELS.ambience * depth, now + attack);
    gain.setValueAtTime(BUS_LEVELS.ambience * depth, now + attack + hold);
    gain.linearRampToValueAtTime(BUS_LEVELS.ambience, now + attack + hold + release);
    this.duckedUntil = now + attack + hold + release;
  }

  async load() {
    if (this.ready) return true;
    if (this.loading) return this.loading;
    const context = this.ensureContext();
    if (!context) return false;
    const decode = async (url) => {
      const response = await fetch(String(url));
      if (!response.ok) throw new Error(`weapon audio HTTP ${response.status}: ${url}`);
      return context.decodeAudioData(await response.arrayBuffer());
    };

    // Reload foley is loaded tolerantly: a missing or undecodable cue should
    // cost that one layer, not the gunfire the weapon depends on.
    const foley = Promise.allSettled(
      Object.entries(FOLEY_URLS).map(async ([name, url]) => {
        const urls = Array.isArray(url) ? url : [url];
        this.foleyBuffers[name] = await Promise.all(urls.map(decode));
      }),
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) console.warn(`${failed.length} reload foley cue(s) unavailable`, failed[0].reason);
    });

    this.loading = Promise.all([
      ...Object.entries(this.urls).map(async ([name, url]) => {
        this.buffers[name] = await decode(url);
      }),
      foley,
    ]).then(() => {
      this.ready = true;
      return true;
    });
    return this.loading;
  }

  // Weapon handling foley is the player's own gun: dry and centered, never
  // panned, so it sits in the head the way the viewmodel does on screen.
  playFoley(name, { gain = 0.85 } = {}) {
    const context = this.ensureContext();
    // Cues hold a variant list; T6 picks one per play rather than always
    // firing the first, so a repeated reload does not sound looped.
    const variants = this.foleyBuffers[FOLEY_ALIASES[name] ?? name];
    const buffer = variants?.[Math.floor(Math.random() * variants.length)];
    if (!context || !buffer || !this.output) return false;
    if (context.state === 'suspended') void context.resume();

    const source = context.createBufferSource();
    const gainNode = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** (((Math.random() * 30) - 15) / 1200);
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(this.output);
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };
    source.start();
    return true;
  }

  // Keeps the Web Audio listener on the camera so panned shots stay locked to
  // the world while the player turns.
  setListener(camera) {
    const context = this.context;
    if (!context || !camera) return;
    const listener = context.listener;
    camera.getWorldPosition(_listenerPosition);
    camera.getWorldDirection(_listenerForward);
    _listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.listenerPosition.copy(_listenerPosition);

    if (listener.positionX) {
      setAudioPosition(listener, _listenerPosition.x, _listenerPosition.y, _listenerPosition.z);
      listener.forwardX.value = _listenerForward.x;
      listener.forwardY.value = _listenerForward.y;
      listener.forwardZ.value = _listenerForward.z;
      listener.upX.value = _listenerUp.x;
      listener.upY.value = _listenerUp.y;
      listener.upZ.value = _listenerUp.z;
    } else {
      listener.setPosition(_listenerPosition.x, _listenerPosition.y, _listenerPosition.z);
      listener.setOrientation(
        _listenerForward.x, _listenerForward.y, _listenerForward.z,
        _listenerUp.x, _listenerUp.y, _listenerUp.z,
      );
    }
  }

  // One persistent panner per source key (an enemy index). Reusing them avoids
  // allocating and tearing down an HRTF node on every shot of a burst.
  //
  // `refDistance` and `maxDistance` follow the alias tables' DistMin and
  // DistMaxDry when a cue supplies them: full level to the first, gone by the
  // second, on a linear curve. Without them the old inverse curve applies.
  // `bus` picks which bus the panner sums into.
  pannerFor(key, position, { refDistance = null, maxDistance = null, bus = 'fx' } = {}) {
    const context = this.ensureContext();
    if (!context) return null;
    let panner = this.panners.get(key);
    if (!panner) {
      panner = context.createPanner();
      panner.panningModel = 'HRTF';
      this.panners.set(key, panner);
    }
    if (refDistance !== null && maxDistance !== null && maxDistance > refDistance) {
      panner.distanceModel = 'linear';
      panner.refDistance = Math.max(1, refDistance);
      panner.maxDistance = maxDistance;
      panner.rolloffFactor = 1;
    } else {
      panner.distanceModel = 'inverse';
      panner.refDistance = refDistance !== null ? Math.max(1, refDistance) : PANNER_REFERENCE_DISTANCE;
      panner.maxDistance = maxDistance ?? 9000;
      panner.rolloffFactor = 0.9;
    }
    const destination = this.bus(bus);
    if (panner._destination !== destination) {
      try { panner.disconnect(); } catch { /* fresh node */ }
      panner.connect(destination);
      panner._destination = destination;
    }
    setAudioPosition(panner, position.x, position.y, position.z);
    return panner;
  }

  playLayer(name, gainValue, voiceLimit, { destination = null, lowpassHz = 0 } = {}) {
    const context = this.context;
    const buffer = this.buffers[name];
    if (!context || !buffer) return;

    const voices = this.voices[name] ?? (this.voices[name] = []);
    if (voices.length >= voiceLimit) {
      const oldest = voices.shift();
      try { oldest.stop(); } catch { /* already ended */ }
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    // The original alias varies each layer by up to 25 cents per shot.
    source.playbackRate.value = 2 ** (((Math.random() * 50) - 25) / 1200);
    gain.gain.value = gainValue;

    const chain = [source];
    if (lowpassHz > 0) {
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = lowpassHz;
      chain.push(lowpass);
    }
    chain.push(gain);
    for (let i = 0; i < chain.length - 1; i += 1) chain[i].connect(chain[i + 1]);
    gain.connect(destination ?? this.output);

    voices.push(source);
    source.onended = () => {
      const index = voices.indexOf(source);
      if (index >= 0) voices.splice(index, 1);
      for (const node of chain) node.disconnect();
    };
    source.start();
  }

  play({ indoors = false, weapon = null } = {}) {
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume();
    if (!this.ready) {
      void this.load();
      return;
    }

    this.playLayer(this.shotLayer(weapon), 1, 3);
    this.playLayer(this.lfeLayer(weapon), this.pistols.has(weapon) ? 0.3 : this.snipers.has(weapon) ? 0.6 : 0.45, 8);
    this.playLayer(this.decayLayer(weapon, indoors), this.snipers.has(weapon) ? 0.4 : 0.32, 3);
    this.duckAmbience();
  }

  // Bots fire the M27. With the world cue set extracted, the report is the
  // game's own NPC alias, near or distant by range, with its decay layer.
  // Without it the player-perspective report is derived: panned to the
  // shooter and rolled off with distance the way air absorption removes
  // the crack before the body of the shot.
  playShotAt(position, { key = 0, indoors = false, weapon = 'hk416' } = {}) {
    const context = this.ensureContext();
    if (!context || !position) return;
    if (context.state === 'suspended') void context.resume();
    if (!this.ready) {
      void this.load();
      return;
    }
    const distance = this.listenerPosition.distanceTo(position);
    // The near report is authored flat out to 900 units and the distant one
    // takes over from there, so the near panner keeps a long plateau rather
    // than rolling off from 180 like a footstep would.
    const near = `wpn_${weapon}_fire_npc`;
    const far = `wpn_${weapon}_fire_npc_dist`;
    const handover = this.world?.mixFor?.(near)?.distMin ?? NPC_REPORT_HANDOVER;
    if (this.world?.has(near) || this.world?.has(far)) {
      const alias = distance > handover && this.world.has(far) ? far : near;
      const mix = this.world.mixFor?.(alias);
      const panner = this.pannerFor(key, position, {
        refDistance: mix?.distMin ?? handover,
        maxDistance: mix?.distMax && mix.distMax > (mix?.distMin ?? 0) ? mix.distMax : (alias === far ? 6000 : handover * 4),
      });
      if (!panner) return;
      this.world.play(alias, { panner, gain: 1.2, cents: 30 });
      // The decay tail rides the report's panner: one node per shooter, reused.
      const decay = `wpn_${weapon}_fire_npc_decay`;
      if (this.world.has(decay)) this.world.play(decay, { panner, gain: 0.5, cents: 20 });
      return;
    }
    const panner = this.pannerFor(key, position);
    if (!panner) return;
    const lowpassHz = 1200 + 18000 / (1 + distance / 600);
    this.playLayer(this.shotLayer(weapon), 1.5, 6, { destination: panner, lowpassHz });
    this.playLayer(this.decayLayer(weapon, indoors), 0.5, 6, {
      destination: panner,
      lowpassHz: lowpassHz * 0.75,
    });
  }

  // Synthesized rather than sampled: the extracted banks carry no UI alias,
  // and a short swept tick is what the confirmation needs to cut through
  // gunfire without competing with it.
  playTick({ frequency = 1650, duration = 0.05, gainValue = 0.55, delay = 0 } = {}) {
    const context = this.ensureContext();
    if (!context || !this.uiOutput) return;
    if (context.state === 'suspended') void context.resume();

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.55, start + duration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain).connect(this.uiOutput);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  playHitmarker({ region = 'torso', killed = false } = {}) {
    // The game's own hit alert when the world set carries it.
    if (this.world?.has('mpl_hit_alert')) {
      this.world.play('mpl_hit_alert', { ui: true, gain: killed ? 1 : 0.8, cents: killed ? -80 : 0 });
      if (killed) this.world.play('mpl_hit_alert', { ui: true, gain: 0.8, cents: -200 });
      return;
    }
    if (killed) {
      this.playTick({ frequency: 1500, duration: 0.06, gainValue: 0.6 });
      this.playTick({ frequency: 1000, duration: 0.11, gainValue: 0.6, delay: 0.055 });
      return;
    }
    if (region === 'head') {
      this.playTick({ frequency: 2350, duration: 0.055, gainValue: 0.6 });
      return;
    }
    this.playTick({ frequency: 1650, duration: 0.045, gainValue: 0.45 });
  }
}

export class WeaponEffects {
  constructor(scene, { maxDistance = 10000, maxImpacts = 96, maxFlashes = 12 } = {}) {
    this.scene = scene;
    this.maxDistance = maxDistance;
    this.maxImpacts = maxImpacts;
    this.raycaster = new THREE.Raycaster();
    this.ceilingRaycaster = new THREE.Raycaster();
    this.splatterRaycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.ceilingRaycaster.firstHitOnly = true;
    this.splatterRaycaster.firstHitOnly = true;
    // Optional world cue player and surface probe; see world-audio.js.
    this.surfaceProbe = null;
    // Optional mannequin parts that come off when hit; see destructibles.js.
    this.destructibles = null;
    this.impactMaterials = null;
    this._world = null;
    // Built now so the textures are fetched during boot; a lazily created
    // material would draw its first burst before its texture had arrived.
    this.bloodMaterials = null;
    this.bloodMaterial('burst');
    this.impactMaterial('concrete');
    this.audio = new GunAudio();
    this.impacts = [];
    this.transients = [];
    this.shotCount = 0;
    this.lastHit = null;
    this.lastIndoors = false;

    // World muzzle flashes are pooled and created up front so they take part
    // in the load-time shader precompile. They are deliberately unlit sprites:
    // adding a PointLight per shot would recompile every material it touches.
    this.flashCursor = 0;
    this.flashes = Array.from({ length: maxFlashes }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: createMuzzleFlashTexture(),
        color: 0xffd27a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      sprite.scale.setScalar(16);
      sprite.renderOrder = 35;
      sprite.visible = false;
      sprite.frustumCulled = false;
      scene.add(sprite);
      return { sprite, life: 0, maxLife: 0.05 };
    });
  }

  loadAudio() {
    return this.audio.load();
  }

  // Optional world cue player; see world-audio.js. Shared with the gun audio
  // so bot reports and the hitmarker can use the same cue set.
  get world() {
    return this._world;
  }

  set world(value) {
    this._world = value;
    this.audio.world = value;
  }

  updateListener(camera) {
    this.audio.setListener(camera);
  }

  isIndoors(camera, collisionRoot) {
    if (!collisionRoot) return false;
    this.ceilingRaycaster.set(camera.getWorldPosition(surfaceNormal), new THREE.Vector3(0, 1, 0));
    this.ceilingRaycaster.near = 4;
    this.ceilingRaycaster.far = 240;
    return this.ceilingRaycaster.intersectObject(collisionRoot, true).length > 0;
  }

  // `spread` is [yaw, pitch] in radians, the round's offset from the sight
  // line. `penetration` is the weapon file's penetrateType.
  //
  // The round is traced as a chain of segments. A body does not stop it: the
  // next segment starts just past the hit with the damage scaled down, which
  // is what makes collaterals possible. Glass and open fences are passed for
  // free, thin materials spend the penetration budget, anything else stops
  // the round. Returns the first hit (the tracer's end) and every hit in
  // order with the damage scale that applies to it.
  fire(camera, collisionRoot, muzzleCameraPosition = null, {
    targets = [], weapon = null, spread = null, penetration = 'none',
  } = {}) {
    this.lastIndoors = this.isIndoors(camera, collisionRoot);
    this.audio.play({ indoors: this.lastIndoors, weapon });
    this.shotCount += 1;
    this.raycaster.setFromCamera(center, camera);
    if (spread && (spread[0] || spread[1])) {
      camera.getWorldDirection(spreadForward);
      spreadRight.crossVectors(spreadForward, camera.up).normalize();
      spreadUp.crossVectors(spreadRight, spreadForward).normalize();
      this.raycaster.ray.direction
        .copy(spreadForward)
        .addScaledVector(spreadRight, Math.tan(spread[0]))
        .addScaledVector(spreadUp, Math.tan(spread[1]))
        .normalize();
    }
    const origin = this.raycaster.ray.origin.clone();
    const direction = this.raycaster.ray.direction.clone();
    const { first, end } = this.trace(origin, direction, collisionRoot, { targets, penetration });
    const start = muzzleCameraPosition
      ? camera.localToWorld(muzzleCameraPosition.clone())
      : origin.clone().addScaledVector(direction, 12);
    this.addTracer(start, end);
    return first;
  }

  // One round's path from `origin` along the unit `direction`, with its
  // impacts, blood and destructible parts but no report or tracer: fire()
  // adds those for the player, and a multiplayer host resolves its guests'
  // rounds through here. Returns the first hit, where the round ended, and
  // every hit in order with the damage scale that applies to it.
  trace(origin, direction, collisionRoot, { targets = [], penetration = 'none' } = {}) {
    const parts = this.destructibles?.meshes ?? [];
    const roots = [collisionRoot, ...targets].filter(Boolean);

    const hits = [];
    let remaining = PENETRATION_BUDGET[penetration] ?? 0;
    let scale = 1;
    let travelled = 0;
    let stopped = null;
    let segment = 0;
    for (let steps = 0; segment < MAX_PENETRATIONS + 1 && steps < MAX_PENETRATIONS * 3 && roots.length; steps += 1) {
      this.raycaster.ray.origin.copy(origin).addScaledVector(direction, travelled);
      this.raycaster.ray.direction.copy(direction);
      this.raycaster.near = steps === 0 ? 0 : 0.5;
      this.raycaster.far = this.maxDistance - travelled;
      let hit = this.raycaster.intersectObjects(roots, true)[0] ?? null;
      // A mannequin part shares its surface with the collision mesh, so a
      // part within a unit of the nearest hit is what the round reached.
      if (parts.length) {
        const part = this.raycaster.intersectObjects(parts, false)[0] ?? null;
        if (part && (!hit || part.distance <= hit.distance + 1)) hit = part;
      }
      if (!hit) break;
      // Distances are reported from the shot's origin, not the segment's.
      hit.distance += travelled;
      travelled = hit.distance;
      // A piece that was already shot off leaves its collision behind.
      if (this.destructibles?.isDetachedSpace(hit.point)) continue;
      segment += 1;
      const enemyHit = hit.object.userData?.enemyHit;
      if (enemyHit) {
        hits.push({ hit, scale, region: enemyHit.region, enemy: true });
        this.addFleshImpact(hit, collisionRoot);
        this.world?.fleshHit({ region: enemyHit.region, position: hit.point });
        scale *= BODY_PENETRATION_SCALE;
        continue;
      }
      // A mannequin part comes off and the round carries on as through any
      // thin plastic. The collision mesh itself carries no materials, so
      // other surfaces are read off the visible shell along the same ray.
      const destructible = this.destructibles?.hit(hit.object, hit.point, direction, hit.instanceId ?? null);
      const probe = destructible
        ? { surface: destructible.surface, material: hit.object.name }
        : this.surfaceProbe?.hitAlong(this.raycaster.ray.origin, direction, hit.distance - travelled + 8 + (this.raycaster.far - (this.maxDistance - travelled)))
          ?? { surface: 'default', material: '' };
      hits.push({ hit, scale, region: null, enemy: false, surface: probe.surface, destructible: destructible?.part ?? null });
      if (!destructible?.detached) this.addImpact(hit, probe.surface);
      this.world?.bulletImpact({ surface: probe.surface, position: hit.point });
      const passed = passSurface(probe.surface, probe.material, remaining);
      if (!passed) {
        stopped = hit;
        break;
      }
      remaining = passed.remaining;
      scale *= passed.scale;
    }
    const first = hits[0]?.hit ?? null;
    const end = (stopped ?? hits[hits.length - 1]?.hit)?.point.clone()
      ?? origin.clone().addScaledVector(direction, this.maxDistance);
    this.lastHit = first;
    this.lastShot = { hits, stopped, origin: origin.clone(), direction: direction.clone(), end };
    return { first, end, hits, stopped };
  }

  // A round from a bot passing the listener. Closest approach under 90 units
  // gets a whiz-by, under 24 the supersonic crack, placed where it passed.
  playWhizby(origin, end) {
    if (!this.world) return false;
    const { point, distance, t } = segmentClosestPoint(origin, end, this.audio.listenerPosition, whizPoint);
    if (t <= 0 || t >= 1 || distance > 90 || distance < 4) return false;
    return this.world.whizby({ position: point.clone(), distance });
  }

  // Enemy report. The player's own indoor test is reused rather than casting
  // again: every shooter is aboard the same yacht as the listener.
  playEnemyShot(position, key = 0, weapon = 'hk416') {
    this.audio.playShotAt(position, { key, indoors: this.lastIndoors, weapon });
  }

  playHitmarker(info) {
    this.audio.playHitmarker(info);
  }

  playFoley(name) {
    return this.audio.playFoley(name);
  }

  addMuzzleFlash(position, direction = null) {
    const flash = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    flash.sprite.position.copy(position);
    if (direction) flash.sprite.position.addScaledVector(direction, 3);
    flash.sprite.material.rotation = Math.random() * Math.PI;
    flash.sprite.material.opacity = 1;
    // Sized so the flash still reads as a point of origin at the far end of
    // the enemy attack range, where it is the only cue to a shooter's bearing.
    flash.sprite.scale.setScalar(19 + Math.random() * 6);
    flash.sprite.visible = true;
    flash.life = flash.maxLife;
  }

  addTracer(start, end) {
    const material = new THREE.LineBasicMaterial({
      color: 0xffe6a0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 25;
    this.scene.add(line);
    this.transients.push({ object: line, life: 0.055, maxLife: 0.055 });
  }

  // Bullet hole using the game's impact decal for the surface class; the
  // decals are authored around 8 to 12 inches across.
  addImpact(hit, surface = 'default') {
    surfaceNormal.copy(hit.face?.normal ?? planeNormal).transformDirection(hit.object.matrixWorld).normalize();

    const mark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.impactMaterial(surface).clone());
    mark.position.copy(hit.point).addScaledVector(surfaceNormal, 0.1);
    mark.quaternion.setFromUnitVectors(planeNormal, surfaceNormal);
    mark.rotateZ(Math.random() * Math.PI * 2);
    mark.scale.setScalar(6 + Math.random() * 4);
    mark.renderOrder = 20;
    this.scene.add(mark);
    this.impacts.push(mark);

    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 5, 3),
      new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    );
    spark.position.copy(hit.point).addScaledVector(surfaceNormal, 0.5);
    spark.renderOrder = 30;
    this.scene.add(spark);
    this.transients.push({ object: spark, life: 0.065, maxLife: 0.065 });

    while (this.impacts.length > this.maxImpacts) this.disposeObject(this.impacts.shift());
  }

  // A round in a body: a burst sprite at the wound, a few drops that fall
  // away from it, and a splatter on whatever wall the round would have hit
  // next. The head takes a larger burst. Textures are the game's own fx and
  // decal art from textures/fx/.
  addFleshImpact(hit, collisionRoot = null) {
    const region = hit.object?.userData?.enemyHit?.region ?? 'torso';
    const head = region === 'head';
    const burst = new THREE.Sprite(this.bloodMaterial('burst').clone());
    burst.material.rotation = Math.random() * Math.PI * 2;
    burst.position.copy(hit.point).addScaledVector(this.raycaster.ray.direction, -3);
    burst.scale.setScalar((head ? 30 : 20) * (0.85 + Math.random() * 0.3));
    burst.renderOrder = 30;
    burst.frustumCulled = false;
    this.scene.add(burst);
    this.transients.push({ object: burst, life: 0.32, maxLife: 0.32, grow: head ? 40 : 26 });
    // A short red mist behind the wound, additive so it reads against dark cover.
    const mist = new THREE.Sprite(this.bloodMaterial('mist').clone());
    mist.material.rotation = Math.random() * Math.PI * 2;
    mist.position.copy(hit.point).addScaledVector(this.raycaster.ray.direction, 6);
    mist.scale.setScalar(head ? 40 : 28);
    mist.renderOrder = 30;
    mist.frustumCulled = false;
    this.scene.add(mist);
    this.transients.push({ object: mist, life: 0.4, maxLife: 0.4, grow: 60 });

    const drops = head ? 6 : 4;
    for (let i = 0; i < drops; i += 1) {
      const drop = new THREE.Sprite(this.bloodMaterial('drop').clone());
      drop.position.copy(hit.point);
      drop.scale.setScalar(4 + Math.random() * 4);
      drop.renderOrder = 30;
      drop.frustumCulled = false;
      // Exit side of the wound, so drops carry on past the body.
      const velocity = this.raycaster.ray.direction.clone().multiplyScalar(90 + Math.random() * 120);
      velocity.x += (Math.random() - 0.5) * 120;
      velocity.y += 40 + Math.random() * 80;
      velocity.z += (Math.random() - 0.5) * 120;
      this.scene.add(drop);
      this.transients.push({ object: drop, life: 0.45, maxLife: 0.45, velocity, gravity: 900 });
    }

    if (!collisionRoot) return;
    // Splatter on the surface behind: continue the round past the body.
    this.splatterRaycaster.set(hit.point, this.raycaster.ray.direction);
    this.splatterRaycaster.near = 4;
    this.splatterRaycaster.far = 420;
    const wall = this.splatterRaycaster.intersectObject(collisionRoot, true)[0];
    if (!wall) return;
    surfaceNormal.copy(wall.face?.normal ?? planeNormal).transformDirection(wall.object.matrixWorld).normalize();
    const splatter = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.bloodMaterial('splatter').clone());
    splatter.position.copy(wall.point).addScaledVector(surfaceNormal, 0.12);
    splatter.quaternion.setFromUnitVectors(planeNormal, surfaceNormal);
    splatter.rotateZ(Math.random() * Math.PI * 2);
    // Thins with distance, as the spray spreads out on the way to the wall.
    const reach = 1 - Math.min(1, wall.distance / 420) * 0.6;
    splatter.scale.setScalar((head ? 34 : 26) * reach * (0.8 + Math.random() * 0.4));
    splatter.renderOrder = 21;
    this.scene.add(splatter);
    this.impacts.push(splatter);
    while (this.impacts.length > this.maxImpacts) this.disposeObject(this.impacts.shift());
  }

  // Impact decals by surface, from the game's own impact art. Created on
  // first use so the textures load once and are shared by every hole.
  impactMaterial(surface) {
    if (!this.impactMaterials) {
      const loader = new THREE.TextureLoader();
      const decal = (name) => {
        const map = loader.load(`textures/fx/impact_${name}.png`);
        map.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({
          map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 1,
        });
      };
      this.impactMaterials = {
        concrete: decal('concrete'), metal: decal('metal'), plaster: decal('plaster'), glass: decal('glass'), fabric: decal('fabric'),
      };
    }
    const byClass = {
      concrete: 'concrete', asphalt: 'concrete', brick: 'concrete', rock: 'concrete', ceramic: 'concrete', gravel: 'concrete', dirt: 'concrete', sand: 'concrete', mud: 'concrete',
      metal: 'metal', paintedmetal: 'metal',
      plaster: 'plaster', wood: 'plaster', paper: 'plaster', plastic: 'plaster',
      glass: 'glass',
      cloth: 'fabric', carpet: 'fabric', foliage: 'fabric', grass: 'fabric',
    };
    return this.impactMaterials[byClass[surface] ?? 'concrete'];
  }

  // Blood materials are created on first use and shared; each effect clones
  // one so it can fade on its own. The game's burst textures are white alpha
  // masks for additive FX with almost no opaque pixels, so the burst and the
  // wall splatter use the opaque character blood decal, the mist uses the
  // gush mask additively, and the drops are drawn here.
  bloodMaterial(kind) {
    if (!this.bloodMaterials) {
      const loader = new THREE.TextureLoader();
      const texture = (name) => {
        const map = loader.load(`textures/fx/${name}.png`);
        map.colorSpace = THREE.SRGBColorSpace;
        return map;
      };
      const sprite = (map, color, blending = THREE.NormalBlending) => new THREE.SpriteMaterial({
        map, color, transparent: true, depthWrite: false, opacity: 1, blending,
      });
      this.bloodMaterials = {
        burst: sprite(texture('fx_decal_character_blood_c'), 0xffffff),
        mist: sprite(texture('fxt_bio_bloodgush'), 0x7a0a0a, THREE.AdditiveBlending),
        drop: sprite(createBloodDropTexture(), 0xffffff),
        splatter: new THREE.MeshBasicMaterial({
          map: texture('fx_decal_character_blood_c'), color: 0x8a1010, transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.95,
        }),
      };
    }
    return this.bloodMaterials[kind];
  }

  update(dt) {
    for (let i = this.transients.length - 1; i >= 0; i -= 1) {
      const transient = this.transients[i];
      transient.life -= dt;
      const material = transient.object.material;
      if (material && 'opacity' in material) material.opacity = Math.max(0, transient.life / transient.maxLife);
      if (transient.grow) transient.object.scale.addScalar(transient.grow * dt);
      if (transient.velocity) {
        transient.velocity.y -= (transient.gravity ?? 0) * dt;
        transient.object.position.addScaledVector(transient.velocity, dt);
      }
      if (transient.life <= 0) {
        this.disposeObject(transient.object);
        this.transients.splice(i, 1);
      }
    }
    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;
      flash.life = Math.max(0, flash.life - dt);
      const remaining = flash.life / flash.maxLife;
      flash.sprite.material.opacity = remaining;
      flash.sprite.visible = remaining > 0;
    }
  }

  disposeObject(object) {
    object.removeFromParent();
    object.geometry?.dispose();
    object.material?.dispose();
  }
}
