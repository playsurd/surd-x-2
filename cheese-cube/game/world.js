// Map entities as gameplay: zones, doors, wall-buys, perk machines, power, the Mystery Box, Pack-a-Punch, zombie
// spawn points and navigation. Entity conventions are the Black Ops III Mod Tools zombies template's.
import * as THREE from 'three';
import { init as initRecast, importNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { CollisionWorld } from '../collision-world.js';
import { dynamicTargets } from './map-rules.js';

const box3 = b => new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
const v3 = a => new THREE.Vector3(...a);

/** Static collision plus removable pieces (doors): queries return the deepest / nearest hit. */
export class CompositeCollision {
  constructor(base) {
    this.base = base;
    this.parts = new Map();
    this.metadata = base.metadata;
  }

  add(key, geometry) { this.parts.set(key, {world: new CollisionWorld(geometry), offset: new THREE.Vector3(), enabled: true}); }
  remove(key) { this.parts.delete(key); }

  capsuleIntersect(capsule, options) {
    let best = this.base.capsuleIntersect(capsule, options);
    for (const part of this.parts.values()) {
      if (!part.enabled) continue;
      const local = capsule.clone();
      local.translate(part.offset.clone().negate());
      const hit = part.world.capsuleIntersect(local, options);
      if (hit && (!best || hit.depth > best.depth)) best = hit;
    }
    return best;
  }

  rayIntersect(ray, near = 0, far = Infinity) {
    let best = this.base.rayIntersect(ray, near, far);
    for (const part of this.parts.values()) {
      if (!part.enabled) continue;
      const local = ray.clone(); local.origin.sub(part.offset);
      const hit = part.world.rayIntersect(local, near, far);
      if (hit) {
        hit.position?.add(part.offset);
        hit.point?.add(part.offset);
        hit.triangle = hit.triangle.clone();
        hit.triangle.a.add(part.offset); hit.triangle.b.add(part.offset); hit.triangle.c.add(part.offset);
      }
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }
}

function geometryOf(object) {
  // World-space triangles of every mesh under `object`, for a removable collision part.
  const positions = [];
  const p = new THREE.Vector3();
  object.updateMatrixWorld(true);
  object.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position, index = g.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
      positions.push(p.x, p.y, p.z);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class World {
  constructor({scene, root, collision, data, game}) {
    Object.assign(this, {scene, root, data, game});
    game.rules.perks.specialty_gpsjammer ??= {name: 'Double Dew', cost: 4000};
    this.collision = new CompositeCollision(collision);
    this.entities = data.entities;
    this.power = false;
    this.flags = new Set();
    this.visited = new Set();
    this.byTarget = new Map();
    this.dynamic = dynamicTargets(data.entities);
    this.originals = new Map();
    root.traverse(o => {
      const name = o.userData.targetname;
      if (!name) return;
      if (this.dynamic.has(name) || o.userData.script_noteworthy === 'elec_switch') {
        o.traverse(child => { child.userData.gameplayDynamic = true; });
        this.originals.set(o, {position: o.position.clone(), quaternion: o.quaternion.clone(), visible: o.visible});
      }
      if (!this.byTarget.has(name)) this.byTarget.set(name, []);
      this.byTarget.get(name).push(o);
    });

    this.zones = this.entities.filter(e => e.classname === 'info_volume' && e.script_noteworthy === 'player_volume' && e.bounds)
      .map(e => ({name: e.targetname, box: box3(e.bounds), spawners: []}));
    for (const s of this.entities.filter(e => e.script_noteworthy === 'riser_location' && e.position)) {
      const zone = this.zones.find(z => s.targetname === z.name + '_spawners');
      zone?.spawners.push({position: v3(s.position), yaw: (Number((s.angles || '0 0 0').split(' ')[1]) || 0) * Math.PI / 180});
    }

    this.doors = this.entities.filter(e => ['zombie_door', 'zombie_debris'].includes(e.targetname) && e.target).map(e => ({
      id: e.id, kind: e.targetname, cost: Number(e.zombie_cost || 1000), target: e.target, flag: e.script_flag || null,
      position: v3(e.position), open: false, pieces: this.byTarget.get(e.target) ?? [],
    }));
    // Doors sharing a target open together; each target's brushes become one removable collision part.
    for (const target of this.dynamic) {
      const pieces = this.byTarget.get(target) ?? [];
      if (pieces.length) {
        const group = new THREE.Group();
        pieces.forEach(p => group.add(p.clone()));
        pieces[0].parent?.add(group);
        const geometry = geometryOf(group);
        if (geometry.attributes.position.count) this.collision.add(target, geometry);
        group.removeFromParent();
      }
    }

    this.wallbuys = game.wallbuys.filter(w => game.weapons[w.weapon]).map(w => ({...w, position: v3(w.position), def: game.weapons[w.weapon]}));
    this.perks = this.entities.filter(e => e.targetname === 'zm_perk_machine' && e.script_noteworthy && game.rules.perks[e.script_noteworthy])
      .map(e => ({id: e.id, perk: e.script_noteworthy, ...game.rules.perks[e.script_noteworthy], position: v3(e.position)}));
    const power = this.entities.find(e => e.targetname === 'use_elec_switch');
    this.powerSwitch = power ? {position: v3(power.position), target: power.target} : null;
    const chest = this.entities.find(e => e.classname === 'zbarrier_zmcore_MagicBox' && e.script_noteworthy === 'start_chest_zbarrier')
      ?? this.entities.find(e => e.classname === 'zbarrier_zmcore_MagicBox');
    this.box = chest ? {position: v3(chest.position), entity: chest} : null;
    const pap = this.entities.find(e => e.targetname === 'zm_pack_a_punch');
    this.pap = pap ? {position: v3(pap.position), entity: pap} : null;
  }

  async loadNavigation(url) {
    await initRecast();
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    this.navMesh = importNavMesh(bytes).navMesh;
    this.query = new NavMeshQuery(this.navMesh, {maxNodes: 8192});
  }

  closest(p, extents = {x: 48, y: 90, z: 48}) {
    const r = this.query.findClosestPoint({x: p.x, y: p.y, z: p.z}, {halfExtents: extents});
    return r.success ? new THREE.Vector3(r.point.x, r.point.y, r.point.z) : null;
  }

  path(a, b) {
    const r = this.query.computePath({x: a.x, y: a.y, z: a.z}, {x: b.x, y: b.y, z: b.z}, {maxPathPolys: 512});
    return r.success ? r.path.map(p => new THREE.Vector3(p.x, p.y, p.z)) : [];
  }

  lineClear(a, b) {
    const d = b.clone().sub(a), length = d.length();
    if (length < 1) return true;
    const hit = this.collision.rayIntersect(new THREE.Ray(a, d.normalize()), 0, length);
    return !hit;
  }

  zoneAt(p) {
    return this.zones.find(z => z.box.containsPoint(p))?.name ?? null;
  }

  /** Zones zombies may spawn in: the player's zone, zones the player has reached, and zones opened by door flags. */
  activeZones(player) {
    const here = this.zoneAt(player);
    if (here) this.visited.add(here);
    const index = this.zones.findIndex(z => z.name === here);
    const near = new Set([here]);
    // Neighbouring floors of the tower count once the player has reached them.
    for (const i of [index - 1, index + 1]) if (this.zones[i] && this.visited.has(this.zones[i].name)) near.add(this.zones[i].name);
    for (const flag of this.flags) {
      const zone = flag.replace(/^enter_/, '');
      if (this.zones.some(z => z.name === zone) && Math.abs(this.zones.findIndex(z => z.name === zone) - index) <= 1) near.add(zone);
    }
    return this.zones.filter(z => near.has(z.name));
  }

  openDoor(door) {
    for (const d of this.doors.filter(d => d.target === door.target)) {
      d.open = true;
      if (d.flag) this.flags.add(d.flag);
    }
    this.animateAway(door.target);
  }

  setVisible(target, visible) {
    for (const piece of this.byTarget.get(target) ?? []) piece.visible = visible;
    const part = this.collision.parts.get(target);
    if (part) part.enabled = visible;
  }

  moveTarget(target, offset) {
    for (const piece of this.byTarget.get(target) ?? []) {
      const original = this.originals.get(piece);
      if (original) piece.position.copy(original.position).add(offset);
    }
    this.collision.parts.get(target)?.offset.copy(offset);
  }

  animateAway(target) {
    for (const piece of this.byTarget.get(target) ?? []) piece.userData.opening = {from: piece.position.y, t: 0};
    const part = this.collision.parts.get(target);
    if (part) part.enabled = false;
  }

  reset() {
    this.power = false;
    this.flags.clear(); this.visited.clear();
    for (const door of this.doors) door.open = false;
    for (const [piece, original] of this.originals) {
      piece.position.copy(original.position); piece.quaternion.copy(original.quaternion); piece.visible = original.visible;
      delete piece.userData.opening;
    }
    for (const part of this.collision.parts.values()) { part.enabled = true; part.offset.set(0, 0, 0); }
  }

  update(dt) {
    for (const pieces of this.byTarget.values()) {
      for (const piece of pieces) {
        const o = piece.userData.opening;
        if (!o) continue;
        o.t += dt;
        piece.position.y = o.from + Math.min(1, o.t / .6) * 120;
        piece.matrixAutoUpdate = true;
        if (o.t >= .6) { piece.visible = false; delete piece.userData.opening; }
      }
    }
  }
}
