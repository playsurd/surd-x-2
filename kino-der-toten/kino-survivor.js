import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Rig, loadModel, loadAnimation } from './animation.js';
import { disposeSkeletons } from './runtime-assets.js';
import { SURVIVORS, SURVIVOR_ANIMATIONS } from './kino-survivor-data.js';

let loading;
export function loadSurvivors() {
  return loading ||= Promise.all([
    Promise.all(SURVIVORS.map(async s => ({ ...s, models: await Promise.all([s.body, s.head, s.hat].map(n => n ? loadModel('models/' + n + '.glb') : null)) }))),
    Promise.all(Object.entries(SURVIVOR_ANIMATIONS).map(async ([key, name]) => [key, await loadAnimation('animations/' + name + '.json')])),
  ]).then(([characters, animations]) => ({ characters, animations: Object.fromEntries(animations) })).catch(error => { loading = null; throw error; });
}

function attach(model, parent, anchorName) {
  model.updateMatrixWorld(true);
  const anchor = model.getObjectByName(anchorName);
  if (!anchor) throw new Error('Missing survivor attachment ' + anchorName);
  model.matrixAutoUpdate = false; model.matrix.copy(anchor.matrixWorld).invert();
  anchor.userData.animationAnchor = true; parent.add(model);
}

function playerClip(root, clip) {
  // Player xanim translations are offsets from each joint's bind position,
  // including the wrist/weapon tags and facial joints. Treating them as
  // absolute positions moves guns above the hands and collapses facial bones.
  return { ...clip, bones: clip.bones.map(bone => {
    const node = root.getObjectByName(bone.name);
    if (!node || !bone.pos) return bone;
    const bind = node.position.toArray();
    return { ...bone, pos: { ...bone.pos, values: bone.pos.values.map((v, i) => v + bind[i % 3]) } };
  }) };
}

export class SurvivorAvatar {
  constructor(assets, index, name, color, data) {
    this.data = data; this.character = assets.characters[index % assets.characters.length];
    this.root = new THREE.Group(); this.root.name = 'survivor-' + this.character.name;
    this.pose = new THREE.Group(); this.root.add(this.pose);
    const [body, head, hat] = this.character.models.map(m => m ? clone(m) : null);
    this.pose.add(body); this.body = body;
    if (head) attach(head, body.getObjectByName('j_spine4'), 'j_spine4');
    if (hat) { hat.rotation.x = Math.PI / 2; (head || body).getObjectByName('j_head').add(hat); }
    this.rig = new Rig(this.pose);
    for (const [key, clip] of Object.entries(assets.animations)) if (!key.endsWith(':reload')) this.rig.add(key, playerClip(this.pose, clip));
    this.reloadTracks = {};
    for (const style of ['rifle', 'pistol']) {
      const clip = playerClip(this.pose, assets.animations[style + ':reload']), tracks = [];
      this.pose.traverse(node => {
        if (node.userData.animationAnchor) return;
        const bone = clip.bones.find(b => b.name === node.name); if (!bone) return;
        if (bone.rot) tracks.push({ node, property: 'quaternion', sample: new THREE.QuaternionKeyframeTrack('', bone.rot.frames.map(f => f / clip.fps), bone.rot.values).createInterpolant() });
        if (bone.pos) tracks.push({ node, property: 'position', sample: new THREE.VectorKeyframeTrack('', bone.pos.frames.map(f => f / clip.fps), bone.pos.values).createInterpolant() });
      });
      this.reloadTracks[style] = { duration: clip.duration, tracks };
    }
    // Native world characters face +X; browser cameras face -Z.
    this.pose.rotation.y = Math.PI / 2;
    this.pose.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 48;
    const c = canvas.getContext('2d'); c.fillStyle = '#' + color.toString(16); c.font = 'bold 24px sans-serif'; c.textAlign = 'center'; c.fillText(name, 192, 32, 375);
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    this.label.scale.set(100, 12.5, 1); this.label.position.y = 85; this.root.add(this.label);
    this.rig.play('pistol:idle', true, 1, 0); this.rig.update(0);
  }
  async equip(url) {
    if (url === this.weaponUrl) return;
    this.weaponUrl = url; const token = this.weaponToken = (this.weaponToken || 0) + 1;
    if (this.weapon) { this.weapon.removeFromParent(); disposeSkeletons(this.weapon); this.weapon = null; }
    if (!url) return;
    const model = await loadModel(url);
    if (this.disposed || token !== this.weaponToken) { disposeSkeletons(model); return; }
    attach(model, this.body.getObjectByName('tag_weapon_right'), 'tag_weapon');
    model.traverse(o => { if (o.isMesh) o.frustumCulled = false; }); this.weapon = model;
  }
  update(dt, player) {
    const s = player.session, item = s.inventory[s.slot], base = this.data.weapons[item.id];
    const def = item.upgraded ? { ...base, ...base.upgrade } : base;
    const style = /^(m1911|python|cz75|ray_gun|knife_ballistic)/.test(item.id) ? 'pistol' : 'rifle';
    this.equip(def.worldModel).catch(error => console.error('Teammate weapon:', error));
    const [vx, vz] = player.velocity || [0, 0], speed = Math.hypot(vx, vz), yaw = player.rotation[1];
    const forward = -Math.sin(yaw) * vx - Math.cos(yaw) * vz, right = Math.cos(yaw) * vx - Math.sin(yaw) * vz;
    const direction = Math.abs(forward) >= Math.abs(right) ? (forward >= 0 ? 'forward' : 'back') : (right >= 0 ? 'right' : 'left');
    const moving = speed > 12, crouch = player.crouched;
    const key = s.downed ? 'down' : style + ':' + (crouch ? (moving ? 'crouch-' + direction : 'crouch') : speed > 240 && forward > 0 ? 'sprint' : moving ? direction : player.ads ? 'ads' : 'idle');
    this.rig.play(key);
    this.rig.actions[key].timeScale = moving && !s.downed ? Math.max(.65, Math.min(2, speed / (crouch ? 95 : key.endsWith('sprint') ? 285 : style === 'pistol' ? 125 : 190))) : 1;
    this.rig.update(dt);
    if (s.reloadLeft > 0 && !s.downed && !crouch) {
      const reload = this.reloadTracks[style], time = reload.duration * (1 - s.reloadLeft / Math.max(.01, s.reloadDuration));
      for (const t of reload.tracks) t.node[t.property].fromArray(t.sample.evaluate(Math.max(0, time)));
    }
    this.root.rotation.y = yaw; this.root.visible = !s.dead;
    this.label.position.y = s.downed ? 38 : crouch ? 62 : 85;
  }
  dispose() {
    this.disposed = true; this.root.removeFromParent(); this.rig.mixer.uncacheRoot(this.pose); disposeSkeletons(this.pose);
    // Model geometry/textures belong to loadModel's shared cache.
    this.label.material.map.dispose(); this.label.material.dispose();
  }
  debug() {
    let skinnedMeshes = 0; this.pose.traverse(o => { if (o.isSkinnedMesh) skinnedMeshes++; });
    this.root.updateMatrixWorld(true);
    const head = this.body.getObjectByName('j_head').getWorldPosition(new THREE.Vector3());
    return { character: this.character.name, model: this.character.body, animation: this.rig.current, skinnedMeshes, headHeight: head.y - this.root.position.y, weapon: this.weapon ? this.weaponUrl : null, position: this.root.position.toArray() };
  }
}
