// Model and animation loading shared by zombies and viewmodels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export class Assets {
  constructor(base, manager) {
    this.base = base;
    this.loader = new GLTFLoader(manager);
    this.models = new Map();
    this.clips = new Map();
  }

  async model(name) {
    if (!this.models.has(name)) this.models.set(name, this.loader.loadAsync(`${this.base}/models/${name}.glb`).then(g => g.scene).catch(error => { this.models.delete(name); throw error; }));
    return clone(await this.models.get(name));
  }

  async anim(name) {
    if (!this.clips.has(name)) {
      this.clips.set(name, fetch(`${this.base}/anims/${name}.json`).then(r => {
        if (!r.ok) throw new Error(`animation ${name}: ${r.status}`);
        return r.json();
      }).catch(error => { this.clips.delete(name); throw error; }));
    }
    return this.clips.get(name);
  }
}

/** Pins `child`'s bone `anchorName` onto `parent`'s bone `mountName`; the child's other bones stay free to animate. */
export function attach(parentRoot, mountName, child, anchorName) {
  const mount = parentRoot.getObjectByName(mountName), anchor = child.getObjectByName(anchorName);
  if (!mount || !anchor) return false;
  anchor.userData.anchor = true;
  child.updateMatrixWorld(true);
  child.matrixAutoUpdate = false;
  child.matrix.copy(anchor.matrixWorld).invert();
  mount.add(child);
  return true;
}

/**
 * An AnimationClip for a decoded XAnim. Black Ops III translation tracks are offsets from each bone's bind
 * position; the bind is captured the first time a bone is animated.
 */
export function makeClip(root, data, {skipRootMotion = true} = {}) {
  const tracks = [];
  const nodes = new Map();
  root.traverse(n => { if (!nodes.has(n.name)) nodes.set(n.name, []); nodes.get(n.name).push(n); });
  for (const b of data.bones) {
    if (b.name === 'tag_origin' || b.name === 'tag_sync') continue;
    for (const node of nodes.get(b.name) ?? []) {
      if (node.userData.anchor) continue;
      const times = track => track.frames.map(f => f / data.fps);
      if (b.rot) tracks.push(new THREE.QuaternionKeyframeTrack(node.uuid + '.quaternion', times(b.rot), b.rot.values));
      if (b.pos) {
        const bind = node.userData.bindPosition ??= node.userData.animBase ? new THREE.Vector3(...node.userData.animBase) : node.position.clone();
        const values = b.pos.values.map((v, i) => v + bind.getComponent(i % 3));
        // Locomotion carries the pelvis forward; paths move zombies, so keep j_mainroot over its bind footprint.
        if (skipRootMotion && b.name === 'j_mainroot') for (let i = 0; i < values.length; i += 3) { values[i] = bind.x; values[i + 2] = bind.z; }
        tracks.push(new THREE.VectorKeyframeTrack(node.uuid + '.position', times(b.pos), values));
      }
    }
  }
  return new THREE.AnimationClip(data.name, Math.max(1 / data.fps, data.duration), tracks);
}

/** A mixer with named actions, cross-fades and notetrack callbacks. */
export class Rig {
  constructor(root, onNotify = () => {}) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.data = {};
    this.current = null;
    this.elapsed = 0;
    this.onNotify = onNotify;
  }

  add(key, data, options) {
    this.data[key] = data;
    this.actions[key] = this.mixer.clipAction(makeClip(this.root, data, options));
  }

  has(key) { return Boolean(this.actions[key]); }
  duration(key) { return this.data[key]?.duration ?? 0; }

  play(key, {loop = true, speed = 1, fade = .15, restart = false} = {}) {
    const action = this.actions[key];
    if (!action) return false;
    if (this.current === key && !restart && action.isRunning()) { action.timeScale = speed; return true; }
    const old = this.actions[this.current];
    if (old && old !== action) { if (fade) old.fadeOut(fade); else old.stop(); }
    action.stop().reset().setEffectiveWeight(1).setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    if (fade) action.fadeIn(fade);
    action.play();
    this.current = key;
    this.elapsed = 0;
    return true;
  }

  get finished() {
    const action = this.actions[this.current];
    return !action || !action.isRunning();
  }

  update(dt) {
    const action = this.actions[this.current], data = this.data[this.current];
    if (action && data) {
      const before = this.elapsed;
      this.elapsed += dt * action.timeScale;
      const duration = Math.max(data.duration, 1 / data.fps);
      const lastLoop = action.loop === THREE.LoopRepeat ? Math.floor(this.elapsed / duration) : 0;
      for (let loop = Math.floor(before / duration); loop <= lastLoop; loop++) {
        for (const n of data.notifies ?? []) {
          const at = loop * duration + n.time;
          if (at >= before && at < this.elapsed) this.onNotify(n.name, this.current, n);
        }
      }
    }
    this.mixer.update(dt);
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
