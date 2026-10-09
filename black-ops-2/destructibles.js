// Destructible props. Nuketown's mannequins lose their heads and arms to
// gunfire; the composer splits each one into a body and its loose parts
// (nodes dm_<n>_<part> over meshes <model>_<part>, see .tools/compose_scene.py)
// and this module turns a hit on a part into a piece tumbling off the stand.
//
// The bake instances repeated parts (EXT_mesh_gpu_instancing), so a part
// arrives either as its own Mesh or as one instance of an InstancedMesh; a
// loose instance is scaled to nothing and a plain copy takes its place.
//
// Pure Three.js with no DOM dependency so the physics can run in node tests.

import * as THREE from 'three';

export const PART_NAME = /(?:^dm_\d+_|_d0_)(body|head|arm_left|arm_right)(?:_\d+)?$/;

// Inches per second squared, matching the player controller's fall.
export const GRAVITY = 980;
// Loose parts are cleared after this long so a long match does not litter.
export const DEBRIS_LIFETIME = 60;

const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _box = new THREE.Box3();
const _matrix = new THREE.Matrix4();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

// dm_3_head_2 and dest_nt_nuked_male_01_d0_head_2 are the second primitive
// of their part; the base name ties the primitives of one part together.
function baseName(object) {
  return object.name.replace(/_\d+$/, '');
}

/**
 * Finds the mannequin parts under a loaded scene. Each is tagged so the
 * static batcher leaves it alone and shots can tell what they hit.
 */
export function collectDestructibles(root) {
  const entries = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    const match = PART_NAME.exec(object.name);
    if (!match) return;
    object.userData.keepSeparate = true;
    object.userData.destructible = { part: match[1] };
    entries.push({ object, part: match[1], instanced: Boolean(object.isInstancedMesh) });
  });
  return entries;
}

export class Destructibles {
  constructor(root, { scene = root, world = null } = {}) {
    this.scene = scene;
    this.world = world;
    this.entries = collectDestructibles(root);
    this.meshes = this.entries.map((entry) => entry.object);
    this.debris = [];
    this.detachedBoxes = [];
    this.loose = new Set();
  }

  /**
   * Mannequins in the map, counted by their bodies. A body with several
   * materials loads as several meshes sharing one base name.
   */
  get count() {
    const bodies = new Map();
    for (const entry of this.entries) {
      if (entry.part !== 'body') continue;
      const key = baseName(entry.object);
      bodies.set(key, Math.max(bodies.get(key) ?? 0, entry.instanced ? entry.object.count : 1));
    }
    return [...bodies.values()].reduce((sum, count) => sum + count, 0);
  }

  /** Every mesh of the same part: a head is its skin and hair primitives. */
  siblings(object) {
    const key = baseName(object);
    const part = this.partOf(object)?.part;
    return this.entries.filter((entry) => entry.part === part && baseName(entry.object) === key).map((entry) => entry.object);
  }

  partOf(object) {
    return object?.userData?.destructible ?? null;
  }

  /**
   * A round arrived at `object` (instance `instanceId` if it is instanced).
   * Returns null when the object is not a destructible, otherwise the
   * surface it should sound and mark like and whether a piece came off.
   */
  hit(object, point, direction, instanceId = null) {
    const info = this.partOf(object);
    if (!info) return null;
    const key = object.isInstancedMesh ? `${object.uuid}:${instanceId}` : object.uuid;
    if (info.part === 'body' || this.loose.has(key)) return { surface: 'plastic', detached: false, part: info.part };
    if (object.isInstancedMesh && (instanceId === null || instanceId === undefined)) {
      return { surface: 'plastic', detached: false, part: info.part };
    }
    const pieces = [];
    for (const mesh of this.siblings(object)) {
      if (mesh.isInstancedMesh) {
        if (instanceId >= mesh.count) continue;
        mesh.getMatrixAt(instanceId, _matrix);
        _matrix.premultiply(mesh.matrixWorld);
        mesh.setMatrixAt(instanceId, _hidden);
        mesh.instanceMatrix.needsUpdate = true;
        const piece = new THREE.Mesh(mesh.geometry, mesh.material);
        piece.castShadow = mesh.castShadow;
        piece.receiveShadow = mesh.receiveShadow;
        piece.applyMatrix4(_matrix);
        this.scene.add(piece);
        pieces.push(piece);
      } else {
        this.meshes = this.meshes.filter((entry) => entry !== mesh);
        pieces.push(mesh);
      }
    }
    this.launch(pieces, point, direction);
    this.loose.add(key);
    return { surface: 'plastic', detached: true, part: info.part };
  }

  /** True when a point lies where a part used to be, so later rounds pass. */
  isDetachedSpace(point) {
    for (const box of this.detachedBoxes) {
      if (box.containsPoint(point)) return true;
    }
    return false;
  }

  launch(meshes, point, direction) {
    if (!meshes.length) return;
    _box.makeEmpty();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      _box.expandByObject(mesh);
    }
    if (_box.isEmpty()) return;
    // The part's vertices sit above the stand's origin, which is on the
    // floor; that origin is where the piece comes to rest.
    const restY = meshes[0].getWorldPosition(new THREE.Vector3()).y;
    _box.getCenter(_center);
    _box.getSize(_size);
    this.detachedBoxes.push(_box.clone().expandByScalar(2));

    // Spin about the piece's own centre rather than around the feet.
    const pivot = new THREE.Group();
    pivot.position.copy(_center);
    this.scene.add(pivot);
    for (const mesh of meshes) {
      pivot.attach(mesh);
      mesh.matrixAutoUpdate = true;
      mesh.updateMatrix();
    }
    const mesh = meshes[0];

    const velocity = direction.clone().normalize().multiplyScalar(160 + Math.random() * 90);
    velocity.y += 110 + Math.random() * 70;
    velocity.x += (Math.random() - 0.5) * 60;
    velocity.z += (Math.random() - 0.5) * 60;
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
    this.debris.push({ pivot, mesh, velocity, spin, halfHeight: _size.y / 2, restY, age: 0, resting: false });
    this.world?.play('fly_bump_mannequin', { position: point.clone(), gain: 0.9 });
  }

  update(dt) {
    if (!this.debris.length || dt <= 0) return;
    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const piece = this.debris[i];
      piece.age += dt;
      if (piece.age > DEBRIS_LIFETIME) {
        piece.pivot.removeFromParent();
        this.debris.splice(i, 1);
        continue;
      }
      if (piece.resting) continue;
      piece.velocity.y -= GRAVITY * dt;
      piece.pivot.position.addScaledVector(piece.velocity, dt);
      piece.pivot.rotation.x += piece.spin.x * dt;
      piece.pivot.rotation.y += piece.spin.y * dt;
      piece.pivot.rotation.z += piece.spin.z * dt;
      const floor = piece.restY + piece.halfHeight * 0.6;
      if (piece.pivot.position.y <= floor && piece.velocity.y < 0) {
        piece.pivot.position.y = floor;
        // A dead bounce: most of the energy goes into the ground.
        piece.velocity.y = -piece.velocity.y * 0.25;
        piece.velocity.x *= 0.45;
        piece.velocity.z *= 0.45;
        piece.spin.multiplyScalar(0.4);
        if (piece.velocity.length() < 30) {
          piece.velocity.set(0, 0, 0);
          piece.spin.set(0, 0, 0);
          piece.resting = true;
          this.world?.play('fly_bump_mannequin', { position: piece.pivot.position.clone(), gain: 0.5 });
        }
      }
    }
  }
}
