// Inventory and first-person actions share the simulation clock, including animation events.
//
// The viewmodel works the way Black Ops III's does. The arms and gun play the current action's clip (hip or ADS fire,
// rechamber, reload, raise, sprint), and aiming down the sights is a separate layer on tag_torso: the ads_up /
// ads_down clips are scrubbed by the ADS fraction, so their first frame is the hip position and their last frame
// lines the sights up with the eye. Reload and raise clips also move tag_camera, which turns the view. Fire modes,
// fire and rechamber times, ADS times, raise and drop times, hip spread and view kick come from each weapon's
// definition (.tools/build-game.mjs); the iron-sight zoom is set by weapon class.
import * as THREE from 'three';
import { Rig, makeClip } from './assets.js';
import { MeleeViewmodel, MELEE_IMPACT } from './melee-viewmodel.js';

const {clamp, lerp, degToRad, radToDeg} = THREE.MathUtils;
const readyStates = new Set(['idle', 'fire']);
// States the sights can stay up through: firing, and cycling a bolt or pump.
const aimStates = new Set(['idle', 'fire', 'rechamber']);
const reloadStates = new Set(['reload', 'reloadStart', 'reloadLoop', 'reloadEnd']);

/** The gun is drawn with Black Ops III's 65° viewmodel field of view, whatever the world FOV setting. */
export const VIEWMODEL_FOV = 65;
/** Vertical FOV for a Call of Duty FOV (horizontal degrees at 4:3, Hor+ on wider screens). */
export function verticalFov(fov, aspect) {
  return radToDeg(2 * Math.atan(Math.tan(degToRad(fov) / 2) * Math.max(3 / 4, 1 / aspect)));
}
/** Pixels (or any screen unit) from the centre to a cone of `degrees`, on a screen `height` tall. */
export function spreadOnScreen(degrees, verticalFovDegrees, height) {
  return Math.tan(degToRad(degrees)) / Math.tan(degToRad(verticalFovDegrees) / 2) * height / 2;
}
const random = (min, max) => min + Math.random() * (max - min);
// Flamethrowers (the Cheese Melters) have no magazine: firing heats them, and an overheated one must cool right down.
// The heat rates are reconstructed; the fire rate and damage are the weapons' own.
const OVERHEAT_SECONDS = 6, COOL_SECONDS = 3;
const frameInverse = new THREE.Quaternion();

export class Weapons {
  constructor({assets, game, camera, onFire, onAction = () => {}, onSound = () => {}, onReload = () => {}}) {
    Object.assign(this, {assets, game, camera, onFire, onAction, onSound, onReload});
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a3a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(.3, 1, .6);
    this.scene.add(key);
    this.viewCamera = new THREE.PerspectiveCamera(verticalFov(VIEWMODEL_FOV, camera.aspect), camera.aspect, 1, 400);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.props = this.createActionProps();
    this.scene.add(this.props);
    this.ownedMaterials = [];
    this.camoTime = {value: 0};
    this.camoTextures = null;
    this.baseFov = 80;
    this.aim = new THREE.Vector3();
    this.sway = new THREE.Vector2();
    this.perks = new Set();
    this.prepared = new Map();
    this.token = 0;
    // View kick (radians, added to the view by the caller) and the gun's own kick, both springing back to centre.
    this.viewKick = {pitch: 0, yaw: 0, vPitch: 0, vYaw: 0};
    this.gunKick = {pitch: 0, yaw: 0, back: 0, vPitch: 0, vYaw: 0, vBack: 0};
    this.cameraShake = new THREE.Quaternion();
    this.reset();
  }

  get current() { return this.slots[this.index] ?? null; }
  get maxSlots() { return this.perks.has('specialty_additionalprimaryweapon') ? 3 : 2; }
  get busy() { return !readyStates.has(this.state); }
  get reloading() { return reloadStates.has(this.state); }
  owned(name) { return this.slots.find(s => s && (s.def.name === name || this.game.weapons[name]?.upgrade === s.def.name)); }
  has(name) { return Boolean(this.owned(name)); }

  reset() {
    this.token++;
    this.meleePose?.dispose(); this.meleePose = null;
    this.rig?.dispose();
    this.rig = null;
    this.torso = this.cameraBone = this.adsLayer = null;
    this.flash?.geometry.dispose(); this.flash?.material.dispose(); this.flash = null;
    this.root = null;
    this.pivot.clear();
    if (this.knifeView) { this.knifeView.root.visible = false; this.pivot.add(this.knifeView.root); }
    this.pivot.visible = true;
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.length = 0;
    this.props.visible = false;
    this.slots = [];
    this.reserved = new Set();
    this.index = 0;
    this.saved = null;
    this.cooldown = this.timer = this.ads = this.recoil = this.flashLeft = this.burstLeft = this.spreadScale = this.landing = 0;
    this.state = 'idle';
    this.next = null;
    this.pendingSwitch = null;
    this.action = null;
    this.reloadSlot = null;
    this.reloadAdded = false;
    this.stopReload = false;
    this.adsDirection = 1;
    this.perks.clear();
    Object.assign(this.viewKick, {pitch: 0, yaw: 0, vPitch: 0, vYaw: 0});
    Object.assign(this.gunKick, {pitch: 0, yaw: 0, back: 0, vPitch: 0, vYaw: 0, vBack: 0});
    this.cameraShake.identity();
    this.spread = 0;
    this.zoom = 0;
    this.camera.fov = verticalFov(this.baseFov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  // Prepare before charging for a purchase; failed downloads leave the old inventory intact.
  async prepare(name) {
    if (this.prepared.has(name)) return this.prepared.get(name);
    const def = this.game.weapons[name];
    if (!def) throw new Error('Unknown weapon ' + name);
    const pending = Promise.all([
      this.assets.model(this.game.hands), this.assets.model(def.viewModel), ...(def.attachments ?? []).map(a => this.assets.model(a.model)),
      Promise.all(Object.entries(def.anims).map(async ([role, anim]) => [role, await this.assets.anim(anim)])),
    ]).then(loaded => ({def, clips: loaded.at(-1)}));
    this.prepared.set(name, pending);
    try { return await pending; } catch (error) { this.prepared.delete(name); throw error; }
  }

  async give(name, {replaceIndex = null, first = true} = {}) {
    const generation = this.token;
    const {def} = await this.prepare(name);
    if (generation !== this.token) return false;
    const slot = {def, clip: def.clip, reserve: def.reserve};
    const existing = this.slots.findIndex(s => s?.def.name === name);
    let index = replaceIndex ?? (existing >= 0 ? existing : this.slots.findIndex((s, i) => !s && !this.reserved.has(i)));
    if (index < 0) index = this.slots.length < this.maxSlots ? this.slots.length : this.index;
    if (replaceIndex === null && this.reserved.has(index)) return false;
    this.slots[index] = slot;
    this.index = index;
    return this.equip(first);
  }

  refill(name) { const slot = this.owned(name); if (slot) slot.reserve = slot.def.reserve; }

  /** Last stand: the best pistol carried (upgraded, then burst or automatic), or the map's start pistol; at most two
   *  magazines of stock (zm_laststand last_stand_best_pistol). In solo a plain pistol is swapped for the start pistol. */
  lastStand(fallback, {solo = false} = {}) {
    if (this.saved) return;
    this.saved = {slots: this.slots, index: this.index, reserved: this.reserved};
    const rank = s => (s.def.upgraded ? 2 : 0) + (s.def.fireType !== 'single' ? 1 : 0);
    const best = this.slots.filter(s => s?.def.hold === 'pistol').sort((a, b) => rank(b) - rank(a))[0];
    const own = best && !(solo && !best.def.upgraded) ? best : null, def = own?.def ?? this.game.weapons[fallback];
    if (!def) return;
    const slot = own ? {def, clip: own.clip, reserve: Math.min(own.reserve, def.clip * 2), source: own} : {def, clip: def.clip, reserve: def.clip * 2};
    slot.start = slot.clip + slot.reserve;
    this.cancelReload(); this.burstLeft = 0;
    this.slots = [slot]; this.index = 0; this.reserved = new Set(); this.rev = (this.rev ?? 0) + 1;
    this.equip(false).catch(error => this.onAction({error}));
  }
  /** Back on your feet: the inventory returns, less the rounds the last-stand pistol used. */
  endLastStand() {
    if (!this.saved) return;
    const slot = this.slots[0], used = slot ? slot.start - slot.clip - slot.reserve : 0;
    ({slots: this.slots, index: this.index, reserved: this.reserved} = this.saved);
    this.saved = null; this.rev = (this.rev ?? 0) + 1;
    if (slot?.source && used > 0) {
      const fromReserve = Math.min(used, slot.source.reserve);
      slot.source.reserve -= fromReserve; slot.source.clip = Math.max(0, slot.source.clip - (used - fromReserve));
    }
    this.cancelReload();
    this.equip(false).catch(error => this.onAction({error}));
  }

  /** Cheese Cube's Pack-a-Punch camo (mc/cheese_pap): the map's glowing cheese layer with its holes, scrolling slowly. */
  camoMaps() {
    if (this.camoTextures) return this.camoTextures;
    const base = this.game.camo;
    if (!base) return null;
    const load = file => { const t = new THREE.TextureLoader().load(`${this.assets.base}/${file}`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
    return this.camoTextures = {glow: load(base.glow)};
  }

  async equip(first = false) {
    const slot = this.current;
    const token = ++this.token;
    this.state = 'loading';
    if (!slot) { this.pivot.visible = false; this.state = 'idle'; return true; }
    const attachments = slot.def.attachments ?? [];
    const [{clips}, hands, gun, ...parts] = await Promise.all([
      this.prepare(slot.def.name), this.assets.model(this.game.hands), this.assets.model(slot.def.viewModel), ...attachments.map(a => this.assets.model(a.model)),
    ]);
    if (token !== this.token) return false;
    const mount = hands.getObjectByName('tag_weapon_right');
    if (!mount) throw new Error('Viewmodel is missing tag_weapon_right');
    mount.add(gun);
    // The magazine (and the SVU's scope) are separate models at a tag; the reload clips move their tag_clip.
    attachments.forEach((a, i) => { parts[i].userData.attachment = a.model; (gun.getObjectByName(a.tag) ?? gun).add(parts[i]); });
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.length = 0;
    if (slot.def.upgraded) this.applyCamo(gun);
    const root = new THREE.Group();
    root.add(hands);
    root.rotation.y = Math.PI / 2;
    root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    this.meleePose?.dispose();
    this.rig?.dispose();
    this.flash?.geometry.dispose(); this.flash?.material.dispose();
    this.pivot.clear();
    this.pivot.add(root);
    if (this.knifeView) { this.knifeView.root.visible = false; this.pivot.add(this.knifeView.root); }
    this.pivot.visible = true;
    this.root = root;
    this.meleePose = new MeleeViewmodel(root, gun);
    this.rig = new Rig(root, (name, role, note) => this.noteSound(name, role, note));
    const data = Object.fromEntries(clips);
    for (const [role, clip] of clips) if (role !== 'adsUp' && role !== 'adsDown') this.rig.add(role, clip, {skipRootMotion: false});
    this.torso = hands.getObjectByName('tag_torso');
    this.cameraBone = hands.getObjectByName('tag_camera');
    this.cameraRest = this.cameraBone?.quaternion.clone() ?? null;
    // tag_camera turns in its parent's frame; the view needs the same turn in camera space.
    this.cameraFrame = new THREE.Quaternion();
    const chain = [];
    for (let o = this.cameraBone?.parent; o && o !== this.pivot; o = o.parent) chain.unshift(o);
    for (const o of chain) this.cameraFrame.multiply(o.quaternion);
    this.adsLayer = this.torso && data.adsUp ? this.adsClips(root, data.adsUp, data.adsDown ?? null) : null;
    this.rig.play('idle', {fade: 0});
    this.rig.update(0);
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    if (this.adsLayer) this.poseTorso(0, 1);
    // Guns without ADS clips line their sight bone up with the eye instead (measured in the idle pose).
    root.updateWorldMatrix(true, true);
    const sights = gun.getObjectByName('tag_iron_sights') ?? gun.getObjectByName('tag_sights') ?? gun.getObjectByName('tag_sights_on') ?? gun.getObjectByName('tag_flash');
    const sight = sights?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(3, -1, -20);
    this.aim.set(-sight.x, -sight.y, Math.min(0, -16 - sight.z));
    this.muzzle = gun.getObjectByName('tag_flash');
    this.flash = new THREE.Mesh(new THREE.ConeGeometry(.8, 3, 6), new THREE.MeshBasicMaterial({color: 0xffe9a0, transparent: true, opacity: .9, depthWrite: false}));
    this.flash.rotation.z = -Math.PI / 2;
    this.flash.position.x = 1.3;
    this.flash.visible = false;
    this.muzzle?.add(this.flash);
    this.flashLeft = 0;
    this.action = null;
    this.next = null;
    this.pendingSwitch = null;
    this.burstLeft = 0;
    this.ads = this.recoil = this.cooldown = 0;
    const def = slot.def, firstRaise = first && this.rig.has('firstRaise');
    this.playState('raise', firstRaise ? 'firstRaise' : 'raise', (firstRaise ? def.firstRaiseTime : def.raiseTime) || this.rig.duration(firstRaise ? 'firstRaise' : 'raise') || .35);
    this.update(0);
    return true;
  }

  applyCamo(gun) {
    const maps = this.camoMaps(), copies = new Map();
    const camo = original => {
      if (copies.has(original)) return copies.get(original);
      const material = original.clone();
      material.onBeforeCompile = shader => {
        shader.uniforms.camoTime = this.camoTime;
        if (maps) shader.uniforms.camoGlow = {value: maps.glow};
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 camoPosition;\nvarying vec3 camoNormal;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ncamoPosition = position;\ncamoNormal = objectNormal;');
        const sample = maps
          // The cheese layer glows; its holes are dark rind. Triplanar so every part of the gun is covered.
          ? `vec3 w = pow(abs(normalize(camoNormal)), vec3(4.)) + .001; w /= w.x + w.y + w.z;
             vec2 drift = vec2(camoTime * .015, 0.);
             float glow = texture2D(camoGlow, camoPosition.yz * .14 + drift).a * w.x + texture2D(camoGlow, camoPosition.xz * .14 + drift).a * w.y + texture2D(camoGlow, camoPosition.xy * .14 + drift).a * w.z;
             // The glowing layer's holes are transparent.
             float hole = 1. - smoothstep(.2, .6, glow);
             vec3 cheese = mix(vec3(1., .86, .08), vec3(.2, .12, .02), hole);
             diffuseColor.rgb = cheese;
             camoEmissive = cheese * (1. - hole) * .85;`
          : `float camo = smoothstep(0.4, 0.7, sin(camoPosition.x * 1.8 + camoPosition.y * 2.5 + camoTime * 2.0));
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.6, 0.85), camo * 0.55);`;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 camoPosition;\nvarying vec3 camoNormal;\nuniform float camoTime;\n${maps ? 'uniform sampler2D camoGlow;' : ''}\nvec3 camoEmissive = vec3(0.);`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${sample}`)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += camoEmissive;');
      };
      copies.set(original, material); this.ownedMaterials.push(material); return material;
    };
    gun.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(camo) : camo(o.material); });
  }

  /** Samplers for the tag_torso tracks of the ADS clips (ads_down falls back to ads_up played backwards). */
  adsClips(root, up, down) {
    const sampler = data => {
      const clip = makeClip(root, data, {skipRootMotion: false});
      const of = suffix => clip.tracks.find(t => t.name === `${this.torso.uuid}.${suffix}`)?.createInterpolant() ?? null;
      return {duration: Math.max(1e-3, data.duration), position: of('position'), quaternion: of('quaternion')};
    };
    return {up: sampler(up), down: down ? sampler(down) : null, from: null, blend: 0,
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion()};
  }
  /** Places tag_torso for an ADS fraction moving in `direction` (1 raising the sights, -1 lowering them). */
  poseTorso(fraction, direction) {
    const layer = this.adsLayer, clip = direction < 0 && layer.down ? layer.down : layer.up;
    const t = (direction < 0 && layer.down ? 1 - fraction : fraction) * clip.duration;
    if (clip.position) layer.position.fromArray(clip.position.evaluate(t)); else layer.position.set(0, 0, 0);
    if (clip.quaternion) layer.quaternion.fromArray(clip.quaternion.evaluate(t)).normalize(); else layer.quaternion.identity();
    // Changing direction part-way blends from where the gun was instead of jumping between the two clips.
    if (layer.from && layer.blend > 0) {
      const k = 1 - layer.blend;
      layer.position.lerpVectors(layer.from.position, layer.position, k);
      layer.quaternion.slerpQuaternions(layer.from.quaternion, layer.quaternion, k);
    }
    this.torso.position.copy(layer.position);
    this.torso.quaternion.copy(layer.quaternion);
  }

  playState(state, clip, duration, event = null, at = .5) {
    this.state = state;
    this.timer = Math.max(.05, duration);
    this.action = {duration: this.timer, event, at, fired: false};
    if (clip && this.rig?.has(clip)) this.rig.play(clip, {loop: false, fade: .06, restart: true, speed: this.rig.duration(clip) / this.timer});
    else this.rig?.play('idle', {fade: .08});
  }
  clipFor(...keys) { return keys.find(k => this.rig?.has(k)) ?? null; }

  switchTo(index) {
    if (index === this.index || !this.slots[index] || !['idle', 'fire', 'rechamber', 'sprint', 'sprintIn', 'sprintOut', ...reloadStates].includes(this.state)) return false;
    this.cancelReload();
    this.pendingSwitch = index;
    this.burstLeft = 0;
    this.playState('switching', 'drop', this.current?.def.dropTime || Math.min(.5, this.rig?.duration('drop') || .25));
    return true;
  }

  cycle() {
    for (let i = 1; i <= this.slots.length; i++) {
      const index = (this.index + i) % this.slots.length;
      if (this.slots[index]) return this.switchTo(index);
    }
  }

  reloadScale() { return this.perks.has('specialty_fastreload') ? .5 : 1; }
  reload() {
    const slot = this.current;
    if (!slot || !this.rig || !['idle', 'fire', 'sprint', 'sprintIn', 'sprintOut'].includes(this.state) || slot.clip >= slot.def.clip || slot.reserve <= 0) return false;
    this.burstLeft = 0;
    this.reloadSlot = slot; this.reloadAdded = false; this.stopReload = false;
    const def = slot.def, scale = this.reloadScale();
    // Shotguns and revolvers load a round at a time: start, one loop per round, end.
    if (def.reloadStartTime > 0 && this.rig.has('reloadStart') && this.rig.has('reloadEnd')) {
      this.playState('reloadStart', 'reloadStart', def.reloadStartTime * scale);
    } else {
      const empty = slot.clip === 0, key = empty && this.rig.has('reloadEmpty') ? 'reloadEmpty' : 'reload';
      this.playState('reload', key, ((empty ? def.reloadEmptyTime : def.reloadTime) || this.rig.duration(key) || 2) * scale);
    }
    if (!this.noteSounds) this.onSound('reload');
    this.onReload();
    return true;
  }
  /** The magazine goes in at the reload's add time; cancelling after that keeps the rounds. */
  addReloadAmmo() {
    const slot = this.reloadSlot;
    if (!slot || this.reloadAdded || slot !== this.current) return;
    const take = Math.min(slot.def.clip - slot.clip, slot.reserve);
    slot.clip += take; slot.reserve -= take; this.reloadAdded = true;
  }
  cancelReload() {
    if (!reloadStates.has(this.state)) return;
    this.reloadSlot = null; this.action = null;
  }

  perform(kind, duration = .65, event = kind) {
    if (!this.current || !this.rig || !['idle', 'fire', 'rechamber', 'sprint', 'sprintIn', 'sprintOut', ...reloadStates].includes(this.state)) return false;
    this.cancelReload();
    this.burstLeft = 0;
    if (kind === 'melee' && this.knifeView) return this.swingKnife(event);
    this.playState(kind, kind === 'melee' ? 'melee' : null, duration, event, kind === 'melee' ? MELEE_IMPACT : .6);
    return true;
  }

  /** The clips' sound notetracks (sounds/notes.json maps their aliases to the original files). A "2d sound" note
   *  wins over a "self notify" note naming a sound at the same moment, so a moment is heard once. */
  noteSound(name, role, note) {
    const kind = note?.param && this.noteSounds?.[note.param];
    if (!kind) return;
    if (name !== '2d sound' && this.rig?.data[role]?.notifies?.some(n => n !== note && n.name === '2d sound' && Math.abs(n.time - note.time) < .02 && this.noteSounds[n.param])) return;
    this.onSound(kind);
  }

  /** Zombies' melee weapon (knife_zm): the combat knife in bare hands, shown only while it swings. */
  async loadKnife() {
    const k = this.game.knife;
    if (!k || this.knifeView) return;
    const [hands, blade, ...clips] = await Promise.all([this.assets.model(this.game.hands), this.assets.model(k.model), ...k.swings.map(s => this.assets.anim(s.anim))]);
    hands.getObjectByName('tag_weapon_right')?.add(blade);
    const root = new THREE.Group(); root.add(hands); root.rotation.y = Math.PI / 2; root.visible = false;
    root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const rig = new Rig(root);
    k.swings.forEach((swing, i) => rig.add('swing' + i, clips[i], {skipRootMotion: false}));
    const camera = hands.getObjectByName('tag_camera');
    this.knifeView = {root, rig, swings: k.swings, next: 0, torso: hands.getObjectByName('tag_torso'), camera, cameraRest: camera?.quaternion.clone() ?? null};
    this.pivot.add(root);
  }
  /** Quick melee: the gun gives way to the knife, the swings alternate, and the hit lands on the clip's rumble. */
  swingKnife(event) {
    const view = this.knifeView, index = view.next, swing = view.swings[index];
    view.next = (index + 1) % view.swings.length;
    this.playState('melee', null, swing.duration, event, swing.impact / swing.duration);
    // The hands sit at the hip offset the ADS clips start from.
    const hip = this.adsLayer?.up.position?.evaluate(0);
    if (view.torso) hip ? view.torso.position.fromArray(hip) : view.torso.position.set(-4.63, -1.38, 0);
    view.root.visible = true; if (this.root) this.root.visible = false;
    view.rig.play('swing' + index, {loop: false, fade: 0, restart: true});
    view.rig.update(0);
    this.onSound('knife_swing');
    return true;
  }
  endKnife() {
    const view = this.knifeView;
    if (!view?.root.visible) return;
    view.root.visible = false; if (this.root) this.root.visible = true;
  }

  trigger(held, pressed) {
    const slot = this.current;
    if (!slot || !this.rig) return false;
    const def = slot.def;
    if (def.flame) return this.flameTrigger(slot, held);
    // Pulling the trigger during a shell-by-shell reload finishes it after the round in hand.
    if (pressed && this.state === 'reloadLoop' && slot.clip > 0) { this.stopReload = true; return false; }
    if (this.cooldown > 0 || !readyStates.has(this.state)) return false;
    const fireType = def.fireType ?? (def.auto ? 'auto' : 'single');
    if (!(this.burstLeft > 0 || (fireType === 'auto' ? held : pressed))) return false;
    if (slot.clip <= 0) { this.burstLeft = 0; if (pressed && !this.reload()) this.onSound('dry_fire'); return false; }
    slot.clip--;
    const doubleTap = this.perks.has('specialty_doubletap2') ? .75 : 1;
    let wait = Math.max(.03, def.fireTime || .1) * doubleTap;
    if (fireType === 'burst') {
      if (this.burstLeft <= 0) this.burstLeft = def.burst || 3;
      this.burstLeft--;
      // A burst runs to its end once started; then the trigger has to be pulled again.
      if (this.burstLeft === 0 || slot.clip === 0) { this.burstLeft = 0; wait = Math.max(wait * 2.5, .2); }
    }
    this.cooldown = wait;
    const ads = this.ads > .5, last = slot.clip === 0;
    const key = ads ? this.clipFor(...(last ? ['adsLastShot', 'adsFire', 'lastShot'] : ['adsFire']), 'fire') : this.clipFor(...(last ? ['lastShot'] : []), 'fire');
    const length = this.rig.duration(key) || .2;
    // Automatic fire plays each shot's clip within the fire time; single shots play theirs in full unless the next
    // pull interrupts.
    const speed = fireType === 'single' ? 1 : clamp(length / wait, 1, 2.5);
    this.state = 'fire';
    this.timer = Math.max(wait, length / speed);
    this.action = null;
    this.next = def.rechamberTime > 0 && !last ? 'rechamber' : null;
    if (this.next) this.timer = wait;
    this.rig.play(key, {loop: false, fade: 0, restart: true, speed});
    this.kick(def);
    this.flashLeft = .045;
    this.onSound('fire');
    this.onFire(slot);
    return true;
  }

  flameTrigger(slot, held) {
    if (!held || slot.overheated || this.cooldown > 0 || !readyStates.has(this.state)) return false;
    const def = slot.def, wait = Math.max(.05, def.fireTime || .2);
    slot.heat = Math.min(1, (slot.heat ?? 0) + wait / OVERHEAT_SECONDS);
    if (slot.heat >= 1) { slot.overheated = true; this.onSound('deny'); }
    this.cooldown = wait; this.lastFlame = 0;
    const key = this.clipFor(this.ads > .5 ? 'adsFire' : 'fire', 'fire');
    this.state = 'fire'; this.timer = wait; this.action = null; this.next = null;
    if (this.rig.current !== key || this.rig.finished) this.rig.play(key, {loop: false, fade: .05, restart: true});
    this.kick(def);
    this.flashLeft = wait;
    this.onSound('flame');
    this.onFire(slot);
    return true;
  }

  /** Per-shot view and gun kick from the weapon's hip or ADS ranges, and the hip spread it adds. */
  kick(def) {
    const ads = this.ads > .5;
    const [pMin, pMax, yMin, yMax] = (ads ? def.adsViewKick : def.hipViewKick) ?? [20, 40, -20, 20];
    // The definitions' kick numbers become angular impulses; the view springs back to centre.
    const scale = degToRad(.012) * 40;
    this.viewKick.vPitch += random(pMin, pMax) * scale;
    this.viewKick.vYaw += random(Math.min(yMin, yMax), Math.max(yMin, yMax)) * scale * .6;
    const [gpMin, gpMax, gyMin, gyMax] = (ads ? def.adsGunKick : def.hipGunKick) ?? [5, 15, -5, 5];
    const gun = degToRad(.05) * 40 * (ads ? .35 : 1);
    this.gunKick.vPitch += Math.max(4, random(gpMin, gpMax)) * gun;
    this.gunKick.vYaw += random(Math.min(gyMin, gyMax), Math.max(gyMin, gyMax)) * gun * .5;
    this.gunKick.vBack += (ads ? 6 : 14);
    this.spreadScale = Math.min(1, this.spreadScale + (def.auto || def.fireType === 'burst' ? .12 : .3));
    this.recoil = Math.min(1.6, this.recoil + .8);
  }

  /** Current bullet cone half-angle in degrees (Deadshot halves hip spread). */
  updateSpread(dt, {moving, grounded, crouched, sprinting, speed = 0}) {
    const def = this.current?.def;
    if (!def) { this.spread = 0; return; }
    const [standMin, crouchMin, max] = def.hipSpread ?? [3, 2.5, 5];
    const target = !grounded || sprinting ? 1 : moving ? clamp(speed, 0, 1) * .6 : 0;
    this.spreadScale += (target > this.spreadScale ? Math.min(target - this.spreadScale, dt * 4) : Math.max(target - this.spreadScale, -dt * 2.2));
    const hip = lerp(crouched ? crouchMin : standMin, Math.max(max, standMin), clamp(this.spreadScale, 0, 1)) * (this.perks.has('specialty_deadshot') ? .5 : 1);
    // Shotguns keep a pellet cone when aiming; everything else is near-perfect down the sights.
    const shotgun = /^shotgun_/.test(def.name);
    this.spread = lerp(hip, shotgun ? hip * .6 : .05, this.ads);
  }

  damageAt(def, distance) {
    if (distance <= def.maxDamageRange) return def.damage;
    const t = clamp((distance - def.maxDamageRange) / Math.max(1, def.minDamageRange - def.maxDamageRange), 0, 1);
    return Math.round(lerp(def.damage, def.minDamage || def.damage, t));
  }

  look(dx, dy) { this.sway.x = clamp(this.sway.x + dx * .002, -.35, .35); this.sway.y = clamp(this.sway.y + dy * .002, -.25, .25); }

  createActionProps() {
    const root = new THREE.Group();
    const mesh = (geometry, color) => new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color, roughness: .45, metalness: .25}));
    const bottle = new THREE.Group(); bottle.name = 'drink';
    const body = mesh(new THREE.CylinderGeometry(.65, .75, 3.4, 12), 0x377e51);
    const neck = mesh(new THREE.CylinderGeometry(.28, .35, 1.4, 12), 0x6daa67); neck.position.y = 2.3;
    const label = mesh(new THREE.CylinderGeometry(.67, .72, 1.4, 12), 0xefe3b6);
    bottle.add(body, neck, label); root.add(bottle);
    const grenade = mesh(new THREE.SphereGeometry(.8, 10, 8), 0x5e6b36); grenade.name = 'grenade'; root.add(grenade);
    root.visible = false; return root;
  }

  /** Ends the current timed state: reload steps, rechamber, switching, actions. */
  finishState(sprinting) {
    const state = this.state, slot = this.current, def = slot?.def, scale = this.reloadScale();
    this.action = null;
    if (state === 'melee') this.endKnife();
    if (state === 'reload') { this.addReloadAmmo(); this.reloadSlot = null; }
    if (state === 'reloadStart' || state === 'reloadLoop') {
      // The start clip ends by inserting its first round(s); each loop inserts reloadAmmoAdd more.
      const add = state === 'reloadStart' ? def.reloadStartAdd ?? 0 : def.reloadAmmoAdd || 1;
      if (this.reloadSlot === slot && add > 0) { const take = Math.min(add, slot.reserve, def.clip - slot.clip); slot.clip += take; slot.reserve -= take; }
      const more = this.reloadSlot === slot && slot.reserve > 0 && slot.clip < def.clip && !this.stopReload;
      if (more) { this.playState('reloadLoop', 'reload', (def.reloadTime || .6) * scale); if (!this.noteSounds) this.onSound('mechanism'); return; }
      this.playState('reloadEnd', 'reloadEnd', (def.reloadEndTime || .5) * scale); return;
    }
    if (state === 'reloadEnd') { this.reloadSlot = null; this.stopReload = false; }
    if (state === 'fire' && this.next === 'rechamber') {
      this.next = null;
      const ads = this.ads > .5, key = ads ? this.clipFor('adsRechamber', 'rechamber') : this.clipFor('rechamber');
      this.playState('rechamber', key, def.rechamberTime);
      if (!this.noteSounds) this.onSound('mechanism');
      return;
    }
    this.state = state === 'sprintIn' && sprinting ? 'sprint' : 'idle';
    if (state === 'switching' && this.pendingSwitch !== null) {
      this.index = this.pendingSwitch; this.pendingSwitch = null;
      this.equip().catch(error => { this.state = 'idle'; this.onAction({error}); });
    }
  }

  update(dt, {sprinting = false, aiming = false, moving = false, time = 0, grounded = true, verticalSpeed = 0, crouched = false, speed = 0} = {}) {
    this.meleePose?.restore();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    // Flamethrowers cool whenever they are not firing.
    this.lastFlame = (this.lastFlame ?? 99) + dt;
    for (const slot of this.slots) if (slot?.def.flame && slot.heat > 0 && (slot !== this.current || this.lastFlame > .25)) {
      slot.heat = Math.max(0, slot.heat - dt / COOL_SECONDS);
      if (slot.heat === 0) slot.overheated = false;
    }
    if (this.flash) { this.flash.visible = this.flashLeft > 0; this.flash.rotation.x += dt * 70; }
    this.timer -= dt;
    const action = this.action;
    if (action?.event && !action.fired && this.timer <= action.duration * (1 - action.at)) { action.fired = true; this.onAction(action.event); }
    if (this.state === 'reload' && action && !this.reloadAdded && this.timer <= action.duration * (1 - (this.current?.def.reloadAddTime ?? 1))) this.addReloadAmmo();
    // Sprinting cancels a reload; rounds already added stay in the gun.
    if (sprinting && reloadStates.has(this.state)) { this.cancelReload(); this.state = 'idle'; this.timer = 0; }
    // Time left over when a state ends carries into the next one, so long steps still add up.
    for (let guard = 0; guard < 8 && this.timer <= 0 && !['idle', 'sprint', 'loading'].includes(this.state); guard++) {
      const over = -this.timer;
      this.finishState(sprinting);
      if (!['idle', 'sprint', 'loading'].includes(this.state)) this.timer -= over;
    }
    if (this.rig && this.current) {
      if (sprinting && this.state === 'idle') { this.burstLeft = 0; this.playState('sprintIn', 'sprintIn', this.rig.duration('sprintIn') || .2); }
      if (!sprinting && ['sprint', 'sprintIn'].includes(this.state)) this.playState('sprintOut', 'sprintOut', this.rig.duration('sprintOut') || .2);
      if (this.state === 'sprint') this.rig.play(this.rig.has('sprintLoop') ? 'sprintLoop' : 'idle');
      if (this.state === 'idle') {
        this.rig.play(this.current.clip === 0 && this.rig.has('idleEmpty') ? 'idleEmpty' : 'idle', {fade: .1});
        if (this.current.clip === 0 && this.current.reserve > 0 && !sprinting) this.reload();
      }
      if (this.state === 'fire' && this.rig.finished && this.timer > 0) this.rig.play('idle', {fade: .08});
      this.rig.update(dt);
    }
    const def = this.current?.def;
    // ADS moves linearly over the weapon's ADS in / out time.
    const wantAim = aiming && !sprinting && aimStates.has(this.state) && Boolean(def);
    const direction = wantAim ? 1 : -1;
    const rate = 1 / Math.max(.05, (wantAim ? def?.adsInTime : def?.adsOutTime) || .25);
    if (this.adsLayer && direction !== this.adsDirection && this.ads > 0 && this.ads < 1) {
      this.adsLayer.from = {position: this.adsLayer.position.clone(), quaternion: this.adsLayer.quaternion.clone()}; this.adsLayer.blend = 1;
    }
    this.adsDirection = direction;
    this.ads = clamp(this.ads + direction * dt * rate, 0, 1);
    if (this.adsLayer) {
      this.adsLayer.blend = Math.max(0, this.adsLayer.blend - dt * 12);
      this.poseTorso(this.ads, direction);
    }
    // The view zooms over the last part of ADS in and the first part of ADS out (adsZoomInFrac / OutFrac).
    const zoomShare = wantAim ? def?.adsZoomIn ?? .7 : def?.adsZoomOut ?? .4;
    this.zoom = clamp((this.ads - (1 - zoomShare)) / Math.max(.01, zoomShare), 0, 1);
    const ads = this.ads;
    // Camera animation from the clip (tag_camera), applied to both views by the renderer.
    // Halfway through the swing the knife hand has left the view; the gun comes back up for the rest of the melee.
    if (this.knifeView?.root.visible && this.state === 'melee' && action && this.timer <= action.duration * .5) {
      this.endKnife();
      if (this.rig?.has('raise')) this.rig.play('raise', {loop: false, fade: 0, restart: true, speed: this.rig.duration('raise') / Math.max(.05, this.timer)});
    }
    const knifing = this.knifeView?.root.visible;
    if (knifing) this.knifeView.rig.update(dt);
    const cameraBone = knifing ? this.knifeView.camera : this.cameraBone, cameraRest = knifing ? this.knifeView.cameraRest : this.cameraRest;
    if (cameraBone && cameraRest) {
      this.cameraShake.copy(cameraRest).invert().multiply(cameraBone.quaternion);
      this.cameraShake.premultiply(this.cameraFrame).multiply(frameInverse.copy(this.cameraFrame).invert());
    } else this.cameraShake.identity();
    this.springKick(dt, ads);
    this.updateSpread(dt, {moving, grounded, crouched, sprinting, speed});
    // Procedural motion: walk bob, turn sway, idle breathing and landing dip, mostly gone down the sights.
    this.recoil *= Math.exp(-dt * 13);
    this.sway.multiplyScalar(Math.exp(-dt * 10));
    if (!grounded) this.landing = Math.min(this.landing, verticalSpeed);
    const landed = grounded && this.landing < -150 ? Math.min(1, -this.landing / 600) : 0;
    if (grounded) this.landing = landed ? this.landing * Math.exp(-dt * 9) : 0;
    const hip = 1 - ads, bob = moving && grounded ? (sprinting ? 0 : hip * .9 + .1) * clamp(speed, 0, 1.2) : 0;
    const phase = time * 2 * Math.PI * 1.1;
    const breathe = Math.sin(time * 1.3) * .25 * (hip + .15);
    if (!this.adsLayer) this.pivot.position.set(0, 0, 0).lerp(this.aim, ads);
    else this.pivot.position.set(0, 0, 0);
    this.pivot.position.x += Math.sin(phase) * bob * .35 - this.sway.x * hip * 1.2;
    this.pivot.position.y += -Math.abs(Math.cos(phase)) * bob * .3 + this.sway.y * hip + breathe * .12 - landed * 1.2 * hip;
    this.pivot.position.y -= clamp(verticalSpeed * .0015, -.5, .5) * hip;
    this.pivot.position.z += this.gunKick.back * .02;
    this.pivot.rotation.set(this.gunKick.pitch + this.sway.y * .05 * hip + breathe * .004, this.gunKick.yaw - this.sway.x * .06 * (hip + .2), -Math.sin(phase) * bob * .02);
    const progress = action ? clamp(1 - this.timer / action.duration, 0, 1) : 0;
    const swing = Math.sin(progress * Math.PI);
    if (['grenade', 'drink', 'craft'].includes(this.state)) { this.pivot.position.y -= swing * 12; this.pivot.rotation.x -= swing * .5; }
    this.props.visible = ['drink', 'grenade'].includes(this.state);
    for (const prop of this.props.children) prop.visible = prop.name === this.state;
    this.props.position.set(3 - swing, -7 + swing * 4, -13);
    this.props.rotation.set(this.state === 'drink' ? -swing * 1.1 : 0, swing * .4, -swing * .4);
    this.camoTime.value = time;
    // Both views zoom by the gun's ADS field of view; the gun itself always uses the 65° viewmodel FOV.
    const aspect = this.camera.aspect, zoom = def ? lerp(1, (def.adsFov ?? 55) / VIEWMODEL_FOV, this.zoom) : 1;
    this.viewCamera.fov = verticalFov(VIEWMODEL_FOV * zoom, aspect);
    this.viewCamera.aspect = aspect;
    this.viewCamera.quaternion.copy(this.cameraShake);
    this.viewCamera.updateProjectionMatrix();
    this.camera.fov = verticalFov(this.baseFov * zoom, aspect);
    this.camera.updateProjectionMatrix();
    if (this.state === 'melee' && !knifing && !this.rig?.has('melee')) this.meleePose?.apply(progress);
  }

  /** View kick integrates its impulse and returns to centre; the gun's kick is a stiffer spring of its own. */
  springKick(dt, ads) {
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120), k = this.viewKick, g = this.gunKick;
      k.pitch += k.vPitch * h; k.yaw += k.vYaw * h;
      k.vPitch += (-k.pitch * 260 - k.vPitch * 26) * h; k.vYaw += (-k.yaw * 260 - k.vYaw * 26) * h;
      g.pitch += g.vPitch * h; g.yaw += g.vYaw * h; g.back += g.vBack * h;
      g.vPitch += (-g.pitch * 500 - g.vPitch * 34) * h; g.vYaw += (-g.yaw * 500 - g.vYaw * 34) * h; g.vBack += (-g.back * 700 - g.vBack * 40) * h;
    }
  }
}
