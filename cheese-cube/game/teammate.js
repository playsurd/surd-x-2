// How co-op teammates appear: the map's own survivor (game.survivors: cia_fb, the CIA character whose arms are the
// first-person hands) with Black Ops III's third-person player animations, holding the third-person model of their
// current gun on tag_weapon_right as the game mounts it. Locomotion picks the walk, run, crouch or sprint clip for
// the direction they move relative to where they look, scaled to their speed; aiming bends the spine; last stand
// plays the laststand drop, idle and crawls. Model and animations come from .tools/build-game.mjs.
import * as THREE from 'three';
import { Rig, attach } from './assets.js';
import { label } from './effects.js';

// Black Ops III's player colours, in join order.
export const PLAYER_COLORS = ['#ffffff', '#5aa9ff', '#ffd23f', '#5fd068'];
// The speeds (units/second) the in-place loops were authored for, to keep feet from sliding.
const PACE = {walk: 110, run: 190, crouchMove: 90, sprint: 285, crawl: 30};
const SPINE = ['j_spinelower', 'j_spineupper', 'j_spine4'];
const _velocity = new THREE.Vector3(), _axis = new THREE.Vector3(), _q = new THREE.Quaternion(), _parent = new THREE.Quaternion();

export class Teammate {
  constructor({scene, assets, game, name, slot}) {
    Object.assign(this, {scene, assets, game, name, slot});
    this.root = new THREE.Group(); this.root.name = 'teammate_' + slot;
    // The survivor faces +X; the root turns with the player's view (camera yaw + 90°).
    this.body = new THREE.Group(); this.root.add(this.body);
    this.flash = new THREE.PointLight(0xffd38a, 0, 160, 1.5); this.root.add(this.flash);
    this.tag = null; this.status = null; this.setStatus('');
    this.target = new THREE.Vector3(); this.previous = null; this.velocity = new THREE.Vector3(); this.flashLeft = 0;
    this.state = ''; this.wasDown = false; this.transition = 0;
    this.spine = []; // Updates run as soon as the model arrives, before its animation downloads finish.
    scene.add(this.root);
    this.loading = this.load().catch(error => console.warn('Teammate model:', error));
  }

  async load() {
    const s = this.game.survivors;
    if (!s) return;
    const model = await this.assets.model(s.model);
    if (this.disposed) return;
    model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    this.body.add(model); this.model = model;
    this.rig = new Rig(model);
    const names = new Set();
    const collect = v => typeof v === 'string' ? names.add(v) : Object.values(v).forEach(collect);
    collect(s.anims);
    await Promise.all([...names].map(async n => { const data = await this.assets.anim(n); if (!this.disposed) this.rig.add(n, data); }));
    if (this.disposed) return;
    this.spine = SPINE.map(n => model.getObjectByName(n)).filter(Boolean);
    this.neck = model.getObjectByName('j_neck');
    this.hand = model.getObjectByName('tag_weapon_right');
    this.state = ''; if (this.weapon) { const w = this.weapon; this.weapon = null; this.setWeapon(w); }
  }

  async setWeapon(name) {
    if (name === this.weapon) return;
    this.weapon = name;
    this.gun?.removeFromParent(); this.gun = null; this.muzzle = null;
    const def = this.game.weapons[name];
    if (!def || !this.model) return;
    // The world gun with its attached magazine (a separate model, as on the viewmodel).
    const extras = def.worldModel ? def.worldAttachments ?? [] : [];
    const [gun, ...parts] = await Promise.all([this.assets.model(def.worldModel ?? def.viewModel), ...extras.map(a => this.assets.model(a.model))]);
    if (this.weapon !== name || this.disposed) return;
    extras.forEach((a, i) => (gun.getObjectByName(a.tag) ?? gun).add(parts[i]));
    gun.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    // The game mounts a weapon's tag_weapon on the body's tag_weapon_right.
    this.model.updateMatrixWorld(true);
    if (!attach(this.model, 'tag_weapon_right', gun, 'tag_weapon')) this.hand?.add(gun);
    this.gun = gun; this.muzzle = gun.getObjectByName('tag_flash');
    this.state = '';  // pistols and rifles have their own animation sets
  }

  shot() { this.flashLeft = .05; }

  setStatus(text, color) {
    if (text === this.status) return;
    this.status = text;
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); this.tag.removeFromParent(); }
    this.tag = label(text ? `${this.name} — ${text}` : this.name, color ?? PLAYER_COLORS[this.slot % PLAYER_COLORS.length], text ? 76 : 56);
    this.tag.material.depthTest = false; this.tag.renderOrder = 10; this.tag.position.y = 92; this.root.add(this.tag);
  }

  /** `p`: {feet, yaw, pitch, crouch, aim, down, dead, weapon}. */
  update(dt, p) {
    this.target.fromArray(p.feet);
    if (this.root.position.distanceTo(this.target) > 150) this.root.position.copy(this.target);
    else this.root.position.lerp(this.target, 1 - Math.exp(-dt * 18));
    if (this.previous) _velocity.subVectors(this.root.position, this.previous).divideScalar(Math.max(dt, 1e-3));
    else _velocity.set(0, 0, 0);
    this.previous = (this.previous ?? new THREE.Vector3()).copy(this.root.position);
    this.velocity.lerp(_velocity, 1 - Math.exp(-dt * 10));
    const facing = p.yaw + Math.PI / 2, turn = facing - this.root.rotation.y;
    this.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 14);
    if (p.weapon) this.setWeapon(p.weapon);
    this.setStatus(p.dead ? 'BLED OUT' : p.down ? 'DOWN' : '', p.down ? '#ff6b5a' : p.dead ? '#9a9a9a' : undefined);
    this.body.visible = !p.dead;
    this.tag.position.y = p.down ? 40 : 92;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.flash.intensity = this.flashLeft > 0 && !p.down ? 40 : 0;
    if (this.flash.intensity && this.muzzle) this.root.worldToLocal(this.muzzle.getWorldPosition(this.flash.position));
    if (!this.rig) return;
    this.animate(dt, p);
    this.rig.update(dt);
    this.aim(p);
  }

  /** Picks the clip for what the survivor is doing and how they move relative to where they face. */
  animate(dt, p) {
    const s = this.game.survivors.anims, set = s[this.game.weapons[this.weapon]?.hold === 'pistol' ? 'pistol' : 'rifle'];
    const ground = Math.hypot(this.velocity.x, this.velocity.z), yaw = this.root.rotation.y;
    // Forward is the model's +X turned by the root's yaw; right is forward × up.
    const forward = this.velocity.x * Math.cos(yaw) - this.velocity.z * Math.sin(yaw), right = this.velocity.x * Math.sin(yaw) + this.velocity.z * Math.cos(yaw);
    const direction = Math.abs(forward) >= Math.abs(right) ? (forward >= 0 ? 'f' : 'b') : (right >= 0 ? 'r' : 'l');
    const moving = ground > 25;
    let clip, pace = 0, loop = true;
    if (p.down) {
      if (!this.wasDown) { this.wasDown = true; this.transition = this.rig.duration(s.down.enter); }
      this.transition -= dt;
      if (this.transition > 0 && s.down.enter) { clip = s.down.enter; loop = false; }
      else if (moving && s.down.crawl?.[direction]) { clip = s.down.crawl[direction]; pace = PACE.crawl; }
      else clip = s.down.idle;
    } else {
      if (this.wasDown) { this.wasDown = false; this.transition = -this.rig.duration(s.down.up); }
      if (this.transition < 0) { this.transition += dt; if (this.transition < 0 && s.down.up) { clip = s.down.up; loop = false; } }
      if (!clip) {
        if (Math.abs(this.velocity.y) > 260 && set.fall) clip = set.fall;
        else if (!moving) clip = p.crouch ? (p.aim ? set.crouchAds : set.crouch) : p.aim ? set.ads : set.idle;
        else if (p.crouch) { clip = set.crouchMove?.[direction]; pace = PACE.crouchMove; }
        else if (ground > 250 && direction === 'f' && !p.aim && set.sprint) { clip = set.sprint; pace = PACE.sprint; }
        else if (ground > 140) { clip = set.run?.[direction]; pace = PACE.run; }
        else { clip = set.walk?.[direction]; pace = PACE.walk; }
        clip ??= set.idle;
      }
    }
    const speed = pace ? THREE.MathUtils.clamp(ground / pace, .5, 1.6) : 1;
    if (clip !== this.state) { this.rig.play(clip, {loop, speed, fade: .2}); this.state = clip; }
    else if (this.rig.actions[clip]) this.rig.actions[clip].timeScale = speed;
  }

  /** Looking up or down bends the spine (the game layers aim animations; this spreads the pitch over the spine). */
  aim(p) {
    if (p.down || !this.spine.length) return;
    const pitch = THREE.MathUtils.clamp(p.pitch ?? 0, -1.2, 1.2);
    this.model.updateMatrixWorld(true);
    // Pitch turns about the survivor's right-hand axis (+Z in the model's facing frame), in world space.
    _axis.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    const bones = this.neck ? [...this.spine, this.neck] : this.spine;
    for (const bone of bones) {
      // A bone the current clip doesn't animate still holds last frame's bend: start from its animated pose.
      if (bone.userData.aimed?.equals(bone.quaternion)) bone.quaternion.copy(bone.userData.animated);
      (bone.userData.animated ??= new THREE.Quaternion()).copy(bone.quaternion);
      bone.parent.getWorldQuaternion(_parent);
      _q.setFromAxisAngle(_axis.clone().applyQuaternion(_parent.invert()), pitch / bones.length);
      bone.quaternion.premultiply(_q);
      (bone.userData.aimed ??= new THREE.Quaternion()).copy(bone.quaternion);
      bone.updateMatrixWorld(true);
    }
  }

  // Models and clips are shared through the asset cache; only the name tag is this teammate's own.
  dispose() { this.disposed = true; this.rig?.dispose(); this.tag.material.map.dispose(); this.tag.material.dispose(); this.root.removeFromParent(); }
}
