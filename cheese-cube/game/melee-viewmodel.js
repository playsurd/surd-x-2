import * as THREE from 'three';

const smooth = t => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const gripRotation = new THREE.Quaternion(.529588, -.508475, .547576, .401436).normalize();

// Camera-space wrist targets. The strike crosses the reticle at the same
// normalized time as the melee damage event; draw/stow happen below the view.
export const MELEE_IMPACT = .35;
const poses = [
  {at: .12, position: [9, -19, -15], rotation: [-.2, 0, .15]},
  {at: .23, position: [9, -6, -16], rotation: [.1, -.3, -.65]},
  {at: MELEE_IMPACT, position: [4.66, -.82, -19.5], rotation: [-.9, -.25, .45]},
  {at: .52, position: [-5, -9, -18], rotation: [-.55, .25, 1.15]},
  {at: .76, position: [8, -19, -13], rotation: [-.2, 0, .15]},
].map(p => ({...p, position: new THREE.Vector3(...p.position), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation))}));

function knifeModel() {
  const root = new THREE.Group();
  root.name = 'melee_knife';
  const steel = new THREE.MeshStandardMaterial({color: 0xcbd4d8, roughness: .35, metalness: .35});
  const grip = new THREE.MeshStandardMaterial({color: 0x252923, roughness: .85});
  const add = (geometry, material, y = 0) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = y;
    mesh.frustumCulled = false; root.add(mesh); return mesh;
  };
  const outline = new THREE.Shape();
  outline.moveTo(-.48, 1.95); outline.lineTo(-.48, 6.3);
  outline.lineTo(-.22, 7.6); outline.lineTo(.04, 8.5);
  outline.lineTo(.65, 6.1); outline.lineTo(.65, 1.95); outline.closePath();
  const blade = new THREE.ExtrudeGeometry(outline, {depth: .1, bevelEnabled: true, bevelThickness: .035, bevelSize: .035, bevelSegments: 1, steps: 1});
  blade.translate(0, 0, -.05); add(blade, steel);
  add(new THREE.CylinderGeometry(.6, .64, 3.5, 10), grip);
  for (let y = -1.3; y < 1.5; y += .4) add(new THREE.CylinderGeometry(.66, .66, .09, 10), grip, y);
  add(new THREE.BoxGeometry(1.7, .2, .9), steel, 1.85);
  add(new THREE.CylinderGeometry(.55, .55, .25, 10), steel, -1.85);
  // The CIA hand points along -X; -Z exits the fist beside the thumb.
  root.position.set(-3.35, 1.2, .25);
  root.rotation.x = -Math.PI / 2;
  root.rotateY(Math.PI / 2);
  root.visible = false;
  return root;
}

function setWorldPose(bone, position, rotation) {
  bone.position.copy(bone.parent.worldToLocal(position.clone()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}

/** Procedural fallback for exports without a knife XAnim, applied after the gun rig. */
export class MeleeViewmodel {
  constructor(root, gun) {
    this.root = root; this.gun = gun; this.saved = [];
    this.mount = root.getObjectByName('tag_weapon_right');
    this.arms = ['ri', 'le'].map(side => ({
      shoulder: root.getObjectByName(`j_shoulder_${side}`),
      elbow: root.getObjectByName(`j_elbow_${side}`),
      wrist: root.getObjectByName(`j_wrist_${side}`),
      side,
    }));
    this.ready = this.arms.every(a => a.shoulder && a.elbow && a.wrist) && Boolean(this.mount);
    this.knife = knifeModel();
    this.arms[0].wrist?.add(this.knife);
    this.index = [1, 2, 3].map(i => root.getObjectByName(`j_index_ri_${i}`));
    this.indexGrip = [
      new THREE.Quaternion(-.695759, .39939, -.27806, .528289).normalize(),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .65),
    ];
  }

  save(bone) {
    this.saved.push({bone, position: bone.position.clone(), quaternion: bone.quaternion.clone()});
  }

  restore() {
    for (const {bone, position, quaternion} of this.saved) { bone.position.copy(position); bone.quaternion.copy(quaternion); }
    this.saved.length = 0;
    this.gun.visible = true;
    this.knife.visible = false;
  }

  poseArm(arm, target, rotation, weight) {
    const {shoulder, elbow, wrist, side} = arm;
    for (const bone of [shoulder, elbow, wrist]) this.save(bone);
    const s = shoulder.getWorldPosition(new THREE.Vector3()), e = elbow.getWorldPosition(new THREE.Vector3()), w = wrist.getWorldPosition(new THREE.Vector3());
    const sq = shoulder.getWorldQuaternion(new THREE.Quaternion()), eq = elbow.getWorldQuaternion(new THREE.Quaternion());
    const upper = s.distanceTo(e), lower = e.distanceTo(w);
    const oldShoulder = s.clone();
    s.lerp(new THREE.Vector3(side === 'ri' ? 13 : -9, -13, -7), weight);
    const axis = target.clone().sub(s);
    const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(upper - lower) + .01, upper + lower - .01);
    axis.normalize();
    const end = s.clone().addScaledVector(axis, distance);
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
    const pole = new THREE.Vector3(side === 'ri' ? 14 : -12, -18, -9).sub(s);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    // Keep the idle elbow at the endpoints so the overlay introduces no snap.
    const oldPole = e.clone().sub(oldShoulder); oldPole.addScaledVector(axis, -oldPole.dot(axis)).normalize();
    pole.copy(oldPole.lerp(pole, weight).normalize());
    const joint = s.clone().addScaledVector(axis, along).addScaledVector(pole, bend);
    const turn = new THREE.Quaternion().setFromUnitVectors(e.clone().sub(oldShoulder).normalize(), joint.clone().sub(s).normalize());
    setWorldPose(shoulder, s, turn.multiply(sq));
    turn.setFromUnitVectors(w.clone().sub(e).normalize(), end.clone().sub(joint).normalize());
    setWorldPose(elbow, joint, turn.multiply(eq));
    setWorldPose(wrist, end, rotation);
  }

  apply(progress) {
    if (!this.ready) return;
    const t = THREE.MathUtils.clamp(progress, 0, 1);
    this.root.updateWorldMatrix(true, true);
    const right = this.arms[0], left = this.arms[1];
    const wrist = right.wrist.getWorldPosition(new THREE.Vector3());
    const rotation = right.wrist.getWorldQuaternion(new THREE.Quaternion());
    const before = right.wrist.matrixWorld.clone();
    const keys = [{at: 0, position: wrist, rotation: new THREE.Quaternion()}, ...poses,
      {at: 1, position: wrist, rotation: new THREE.Quaternion()}];
    const i = Math.min(keys.length - 2, Math.max(0, keys.findIndex((p, n) => n < keys.length - 1 && t <= keys[n + 1].at)));
    const a = keys[i], b = keys[i + 1], blend = smooth((t - a.at) / (b.at - a.at));
    const target = a.position.clone().lerp(b.position, blend);
    const turn = a.rotation.clone().slerp(b.rotation, blend);
    const weight = smooth(t / .12) * (1 - smooth((t - .76) / .24));
    const leftWrist = left.wrist.getWorldPosition(new THREE.Vector3());
    const leftRotation = left.wrist.getWorldQuaternion(new THREE.Quaternion());
    const lower = new THREE.Vector3(1, -12, 2).multiplyScalar(weight);
    this.poseArm(left, leftWrist.add(lower), leftRotation, weight);
    this.poseArm(right, target, turn.multiply(rotation.slerp(gripRotation, weight)), weight);

    // Keep the gun in the moving hand while it lowers/raises. During the
    // slash the hand holds only the knife; neither object floats separately.
    const gunMatrix = right.wrist.matrixWorld.clone().multiply(before.invert()).multiply(this.mount.matrixWorld);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    gunMatrix.decompose(position, quaternion, new THREE.Vector3());
    this.save(this.mount); setWorldPose(this.mount, position, quaternion);
    const holdingKnife = t >= .12 && t < .76;
    this.gun.visible = !holdingKnife;
    this.knife.visible = holdingKnife;
    if (holdingKnife) this.index.forEach((bone, n) => {
      if (bone) { this.save(bone); bone.quaternion.copy(this.indexGrip[n]); }
    });
    this.root.updateWorldMatrix(true, true);
  }

  dispose() {
    this.restore();
    const materials = new Set();
    this.knife.traverse(o => { if (o.isMesh) { o.geometry.dispose(); materials.add(o.material); } });
    materials.forEach(m => m.dispose());
    this.knife.removeFromParent();
  }
}
