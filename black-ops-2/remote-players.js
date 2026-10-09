// Other people in a multiplayer match. Everyone draws remote players as SoldierAvatars: the bots' own baked
// body (enemy-system.js) wearing the slot's skin, holding the rifle that player carries, with crouch and
// strafe poses and a name over the head. The host also keeps a RemoteCombatant per guest -- health, spawn
// protection and the meters on what it reports -- and a LocalHitProxy so guests can shoot the host.
import * as THREE from 'three';
import { PlayerHealth } from './player-health.js';
import { DEFAULT_LOADOUT } from './weapons.js';
import { FireBudget, MoveBudget, locomotionState } from './multiplayer-sync.js';

const MODEL_FORWARD_OFFSET = Math.PI / 2;
// Party colours in join order; the first is the HUD accent.
export const PLAYER_COLORS = ['#7fffc4', '#5aa9ff', '#ffd23f', '#ff8a5c', '#d58cff', '#ff5f8f'];
// Operator skins (skins.js) by slot, so friends can tell each other apart.
export const PLAYER_SKIN_ORDER = ['pla_assault', 'pla_desert', 'pla_arctic', 'pla_night', 'pla_jungle', 'pla_urban'];
// The bots' hit regions (enemy-system.js): the shooter's weapon file supplies the multipliers.
const HITBOXES = [
  { region: 'torso', size: [18, 16, 15], at: [0, 52, 0] },
  { region: 'head', radius: 7, at: [0, 65, 0] },
  { region: 'legs', size: [17, 29, 13], at: [0, 16, 0] },
  { region: 'torsoLower', size: [18, 18, 15], at: [0, 35, 0] },
];
// A crouch squats the hit regions to this share of standing height.
export const CROUCH_SCALE = 0.7;
const STANDING = { torso: 42, eye: 60, tag: 84 };
const CROUCHED = { torso: 30, eye: 40, tag: 62, scale: CROUCH_SCALE };
const _target = new THREE.Vector3();
const _velocity = new THREE.Vector3();

function makeHitboxes(owner) {
  return HITBOXES.map(({ region, size, radius, at }) => {
    const geometry = radius ? new THREE.SphereGeometry(radius, 8, 6) : new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
    mesh.position.set(...at);
    mesh.name = `player_hit_${region}`;
    mesh.userData.enemyHit = { enemy: owner, multiplier: 1, region };
    return mesh;
  });
}

function nameTag(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.font = '600 30px Bahnschrift, "DIN Alternate", Oswald, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 6;
  context.strokeStyle = 'rgba(0, 0, 0, .85)';
  context.strokeText(text, 128, 24);
  context.fillStyle = color;
  context.fillText(text, 128, 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Depth-tested: a name never shows a player through a wall.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(48, 9, 1);
  sprite.renderOrder = 20;
  sprite.name = 'player_name';
  return sprite;
}

export class SoldierAvatar {
  constructor(manager, { name = 'Player', slot = 0, weaponId = DEFAULT_LOADOUT.primary, camo = null, skin = null, owner = null } = {}) {
    this.manager = manager;
    this.name = name;
    this.slot = slot;
    this.color = PLAYER_COLORS[slot % PLAYER_COLORS.length];
    this.root = new THREE.Group();
    this.root.name = `remote_player_${slot}`;
    this.modelRoot = new THREE.Group();
    this.modelRoot.rotation.y = MODEL_FORWARD_OFFSET;
    this.hitGroup = new THREE.Group();
    this.root.add(this.modelRoot, this.hitGroup);
    this.hitboxes = makeHitboxes(owner ?? this);
    this.hitGroup.add(...this.hitboxes);
    this.style = { weaponId, camo, skin: skin ?? PLAYER_SKIN_ORDER[slot % PLAYER_SKIN_ORDER.length] };
    this.visualFrames = manager.buildVisualFrames(this.modelRoot, this.style);
    this.visualState = null;
    this.visualFrameIndex = -1;
    this.visualTime = 0;
    this.visualTimeScale = 1;
    this.walkTime = 0;
    this.muzzle = null;
    this.showVisualFrame('idle', 0);
    this.tag = nameTag(name, this.color);
    this.tag.position.y = STANDING.tag;
    this.root.add(this.tag);
    this.previous = null;
    this.velocity = new THREE.Vector3();
    this.movementSpeed = 0;
    this.dead = false;
    this.crouch = false;
    this.placed = false;
    manager.scene.add(this.root);
  }

  get torsoHeight() {
    return this.crouch ? CROUCHED.torso : STANDING.torso;
  }

  setOwner(owner) {
    for (const box of this.hitboxes) box.userData.enemyHit.enemy = owner;
  }

  /** Change rifle, camo or skin once their assets have loaded. */
  async setStyle(style) {
    const next = { ...this.style, ...style };
    if (next.weaponId === this.style.weaponId && next.camo === this.style.camo && next.skin === this.style.skin) return false;
    this.pendingStyle = next;
    const loaded = await this.manager.ensureStyle(next);
    if (this.disposed || this.pendingStyle !== next) return false;
    // A pistol has no exported world model: the soldier keeps showing its rifle.
    const resolved = { weaponId: loaded.weaponId ?? this.style.weaponId, camo: next.camo, skin: next.skin };
    if (resolved.weaponId === this.style.weaponId && resolved.camo === this.style.camo && resolved.skin === this.style.skin) return false;
    const state = this.visualState ?? 'idle';
    const frame = Math.max(0, this.visualFrameIndex);
    if (this.visualState) this.modelRoot.remove(this.visualFrames[this.visualState][this.visualFrameIndex].body);
    this.style = resolved;
    this.visualFrames = this.manager.buildVisualFrames(this.modelRoot, resolved);
    this.visualState = null;
    this.visualFrameIndex = -1;
    this.showVisualFrame(state, frame);
    return true;
  }

  showVisualFrame(state, index) {
    const frames = this.visualFrames[state] ?? this.visualFrames.idle;
    const resolved = this.visualFrames[state] ? state : 'idle';
    const nextIndex = THREE.MathUtils.clamp(index, 0, frames.length - 1);
    if (this.visualState === resolved && this.visualFrameIndex === nextIndex) return;
    if (this.visualState) this.modelRoot.remove(this.visualFrames[this.visualState][this.visualFrameIndex].body);
    const frame = frames[nextIndex];
    this.modelRoot.add(frame.body);
    this.visualState = resolved;
    this.visualFrameIndex = nextIndex;
    this.muzzle = frame.muzzle ?? null;
  }

  play(state) {
    // Without the multiplayer poses a crouch stands and a strafe runs forward.
    const resolved = this.visualFrames[state] ? state : state === 'crouch' ? 'idle' : 'run';
    if (resolved === this.visualState) return;
    this.visualTime = 0;
    this.visualTimeScale = 1;
    this.showVisualFrame(resolved, 0);
  }

  advanceVisual(dt) {
    const frames = this.visualFrames[this.visualState] ?? this.visualFrames.idle;
    if (frames.length <= 1) return;
    this.visualTime += dt * this.visualTimeScale;
    const rate = this.manager.poseFrameRates[this.visualState] ?? 1;
    const raw = Math.floor(this.visualTime * rate);
    this.showVisualFrame(this.visualState, this.visualState === 'death' ? Math.min(frames.length - 1, raw) : raw % frames.length);
  }

  /**
   * `pose`: { x, y, z (feet), yaw, crouch, dead }. `smooth` eases toward it
   * (the host following a guest's 20 Hz reports); 0 places it exactly (a
   * guest drawing an interpolated snapshot).
   */
  update(dt, pose, { smooth = 0 } = {}) {
    _target.set(pose.x, pose.y, pose.z);
    const jump = !this.placed || this.root.position.distanceToSquared(_target) > 150 * 150;
    if (smooth > 0 && !jump) this.root.position.lerp(_target, 1 - Math.exp(-dt * smooth));
    else this.root.position.copy(_target);
    this.placed = true;
    if (this.previous && !jump && dt > 0) _velocity.subVectors(this.root.position, this.previous).divideScalar(dt);
    else _velocity.set(0, 0, 0);
    (this.previous ??= new THREE.Vector3()).copy(this.root.position);
    this.velocity.lerp(_velocity, 1 - Math.exp(-dt * 10));
    this.movementSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const yaw = smooth > 0 && !jump
      ? this.root.rotation.y + Math.atan2(Math.sin(pose.yaw - this.root.rotation.y), Math.cos(pose.yaw - this.root.rotation.y)) * Math.min(1, dt * 18)
      : pose.yaw;
    this.root.rotation.y = yaw;
    this.dead = Boolean(pose.dead);
    this.crouch = Boolean(pose.crouch) && !this.dead;
    this.hitGroup.scale.y = this.crouch ? CROUCHED.scale : 1;
    this.tag.position.y = this.crouch ? CROUCHED.tag : STANDING.tag;
    this.tag.visible = !this.dead;

    const state = locomotionState({ vx: this.velocity.x, vz: this.velocity.z, yaw, crouch: this.crouch, dead: this.dead });
    this.play(state);
    if (this.visualState === 'death') {
      const lift = this.manager.deathFloorLift?.[this.visualFrameIndex] ?? 0;
      this.modelRoot.position.y += (lift - this.modelRoot.position.y) * Math.min(1, dt * 8);
    } else if (this.visualState !== 'idle' && this.visualState !== 'crouch') {
      // The loops were authored for a run; scale them to the speed so feet do not slide.
      this.visualTimeScale = THREE.MathUtils.clamp(this.movementSpeed / (this.crouch ? 130 : 210), 0.6, 1.4);
      this.walkTime += dt * THREE.MathUtils.clamp(this.movementSpeed / 28, 5, 10);
      this.modelRoot.position.y = Math.sin(this.walkTime) * 0.8;
    } else {
      this.modelRoot.position.y = THREE.MathUtils.damp(this.modelRoot.position.y, 0, 12, dt);
    }
    this.advanceVisual(dt);
    this.root.updateMatrixWorld(true);
  }

  eyePosition(target = new THREE.Vector3()) {
    return target.copy(this.root.position).setY(this.root.position.y + (this.crouch ? CROUCHED.eye : STANDING.eye));
  }

  muzzlePosition(target = new THREE.Vector3()) {
    if (this.muzzle) return this.muzzle.getWorldPosition(target);
    return this.eyePosition(target);
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    this.tag.material.map.dispose();
    this.tag.material.dispose();
    for (const box of this.hitboxes) box.geometry.dispose();
  }
}

/**
 * A guest as the host keeps it: its health (the same PlayerHealth rules as
 * the host's own), where it last reported standing, its class, and the meters
 * on its trigger, knife and grenades. Its avatar's hitboxes and root are what
 * the bots and every shot in the match see.
 */
export class RemoteCombatant {
  constructor({ id, name, slot, avatar, onDamage = null, onDeath = null, onRespawn = null }) {
    this.remoteId = id;
    this.name = name;
    this.slot = slot;
    this.avatar = avatar;
    avatar.setOwner(this);
    this.health = new PlayerHealth({
      maxHealth: 100,
      respawnDelay: 1.5,
      spawnProtection: 3,
      regenDelay: 4,
      regenPerSecond: 25,
      onDamage: (event) => onDamage?.(this, event),
      onDeath: (event) => onDeath?.(this, event),
      onRespawn: () => onRespawn?.(this),
    });
    // The guest moves itself; `tp` counts the times the host put it somewhere
    // (spawns, refused moves). Reports made before the guest caught up are ignored.
    this.tp = 1;
    this.feet = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.crouch = false;
    this.ads = false;
    this.sprint = false;
    this.input = {};
    this.inputAt = 0;
    this.legs = new MoveBudget();
    this.weapon = DEFAULT_LOADOUT.primary;
    this.loadout = { ...DEFAULT_LOADOUT };
    this.equipment = {};
    this.trigger = new FireBudget();
    this.meleeAt = -Infinity;
    this.killer = null;
  }

  get root() { return this.avatar.root; }
  get hitboxes() { return this.avatar.hitboxes; }
  get dead() { return this.health.dead; }
  get movementSpeed() { return this.avatar.movementSpeed; }
  get torsoHeight() { return this.avatar.torsoHeight; }

  takeDamage(amount, hit = null, source = null) {
    return this.health.takeDamage(amount, source);
  }

  /** Where its view sits on the host: the reported feet plus the stance's eye height. */
  eyePosition(target = new THREE.Vector3()) {
    return target.set(this.feet[0], this.feet[1] + (this.crouch ? CROUCHED.eye : STANDING.eye), this.feet[2]);
  }
}

/** The host's own body as a target for its guests' rounds and knives. */
export class LocalHitProxy {
  constructor({ player, playerHealth, camera }) {
    Object.assign(this, { player, playerHealth, camera });
    this.root = new THREE.Group();
    this.root.name = 'host_hit_proxy';
    this.hitGroup = new THREE.Group();
    this.root.add(this.hitGroup);
    this.hitboxes = makeHitboxes(this);
    this.hitGroup.add(...this.hitboxes);
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  get dead() { return Boolean(this.playerHealth.dead); }
  get torsoHeight() { return this.player.crouched ? CROUCHED.torso : STANDING.torso; }
  get movementSpeed() { return Math.hypot(this.player.velocity.x, this.player.velocity.z); }

  takeDamage(amount, hit = null, source = null) {
    return this.playerHealth.takeDamage(amount, source);
  }

  /** Follow the player; `pose` overrides it to rewind the host to an earlier moment. */
  sync(pose = null) {
    if (pose) {
      this.root.position.set(pose.x, pose.y, pose.z);
      this.root.rotation.y = pose.yaw;
      this.hitGroup.scale.y = pose.crouch ? CROUCHED.scale : 1;
    } else {
      this.root.position.copy(this.player.feetPosition);
      this.root.rotation.y = this.euler.setFromQuaternion(this.camera.quaternion).y;
      this.hitGroup.scale.y = this.player.crouched ? CROUCHED.scale : 1;
    }
    this.root.updateMatrixWorld(true);
  }
}
