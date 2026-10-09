// Zombies: spawn from riser points in active zones, path to the player on the navmesh, attack, die.
import * as THREE from 'three';
import { attach, Rig } from './assets.js';

const UP = new THREE.Vector3(0, 1, 0);
// Network codes for zombie states and gaits (co-op snapshots).
const STATES = ['rising', 'chase', 'attack', 'jump', 'dead'], GAITS = ['walk', 'run', 'sprint'];
const round1 = v => Math.round(v * 10) / 10;

export class Zombies {
  constructor({scene, world, assets, game, session, onPlayerHit, onKill}) {
    Object.assign(this, {scene, world, assets, game, session, onPlayerHit, onKill});
    this.list = [];
    this.dead = [];
    this.serial = 0;
    this.nextSpawn = 0;
    this.anims = {};
    this.generation = 0;
    this.spawning = false;
    this.pending = new Set();
  }

  async load() {
    const z = this.game.zombies;
    const names = [...new Set(Object.values(z.anims).flat())];
    await Promise.all(names.map(async n => { this.anims[n] = await this.assets.anim(n); }));
    // Warm the model cache so spawning does not wait on the network.
    await Promise.all([...z.bodies, ...z.heads, ...z.helmets].map(m => this.assets.model(m)));
  }

  healthFor(round) {
    // Black Ops zombies health: 150, +100 a round through round 9, then +10% a round.
    let health = 150;
    for (let r = 2; r <= round; r++) health = r < 10 ? health + 100 : Math.floor(health * 1.1);
    return health;
  }

  /** zm::get_zombie_count_for_round and default_max_zombie_func: 24 plus a per-player share, early rounds scaled down. */
  countFor(round, players = 1) {
    let mult = Math.max(1, round / 5);
    if (round >= 10) mult *= round * .15;
    const count = 24 + Math.floor(players === 1 ? .5 * 6 * mult : (players - 1) * 6 * mult);
    const early = [.25, .3, .5, .7, .9][round - 1];
    return early ? Math.floor(count * early) : count;
  }

  /** Each zombie rolls randomintrange(S, S + 35): walk up to 35, run up to 70, sprint above. Cheese Cube sets S to
   *  10 for rounds 1 and 2 and 10 x (round - 1) after (zm_ccube.gsc). */
  speedFor(round) {
    const s = round <= 2 ? 10 : 10 * (round - 1), roll = s + Math.floor(Math.random() * 35);
    return roll <= 35 ? 'walk' : roll <= 70 ? 'run' : 'sprint';
  }
  setGait(z, gait) {
    const anims = this.game.zombies.anims, list = anims[gait].length ? anims[gait] : anims.walk;
    z.gait = gait; z.moveSpeed = {walk: 40, run: 95, sprint: 165}[gait] * (1 + (z.id % 3) * .05);
    const moving = z.rig.current === 'move';
    z.rig.actions.move?.stop();
    z.rig.add('move', this.anims[list[z.id % list.length]]);
    if (moving) { z.rig.current = null; z.rig.play('move', {fade: 0}); }
  }

  /** `remote` draws a zombie the co-op host already spawned, with the host's id and gait. */
  async spawn(spawner, {id: hostId = null, gait: hostGait = null, remote = false} = {}) {
    if (!spawner) return null;
    const generation = this.generation;
    const z = this.game.zombies, id = hostId ?? ++this.serial;
    const root = new THREE.Group();
    root.name = 'zombie_' + id;
    const body = await this.assets.model(z.bodies[id % z.bodies.length]);
    root.add(body);
    const head = await this.assets.model(z.heads[id % z.heads.length]);
    root.updateMatrixWorld(true);
    attach(body, 'j_spine4', head, 'j_spine4');
    if (z.helmets.length && id % 4 === 0) {
      const helmet = await this.assets.model(z.helmets[0]);
      const mount = head.getObjectByName('j_head') ?? body.getObjectByName('j_head');
      if (mount) mount.add(helmet);
    }
    if (generation !== this.generation) return null;
    root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    const rig = new Rig(root);
    const pick = list => list[id % list.length];
    const gait = hostGait ?? this.speedFor(this.session.round);
    const move = pick(z.anims[gait].length ? z.anims[gait] : z.anims.walk);
    rig.add('move', this.anims[move]);
    rig.add('attack', this.anims[pick(z.anims.attack)]);
    rig.add('death', this.anims[pick(z.anims.death)]);
    for (const role of ['jumpUp', 'jumpDown']) if (z.anims[role]?.length) rig.add(role, this.anims[z.anims[role][0]]);
    rig.play('move', {fade: 0});
    const start = spawner.position.clone();
    root.position.copy(start).addScaledVector(UP, -70);
    root.rotation.y = spawner.yaw;
    this.scene.add(root);
    const moveSpeed = {walk: 40, run: 95, sprint: 165}[gait] * (1 + (id % 3) * .05);
    const zombie = {
      id, root, rig, gait, moveSpeed, health: this.healthFor(this.session.round), state: 'rising', rise: 0, spawnAt: start,
      path: [], pathIndex: 0, repath: 0, attackLeft: 0, dealt: false, stuck: 0, lastPosition: start.clone(), lost: 0, remote, hitAt: -Infinity, camp: null,
    };
    this.list.push(zombie);
    if (!remote) this.session.spawned++;
    return zombie;
  }

  /** Risers near any survivor (one position, or every living co-op player), never on top of one. */
  spawnPoints(players) {
    const list = Array.isArray(players) ? players : [players], points = new Set();
    for (const player of list)
      for (const zone of this.world.activeZones(player))
        for (const s of zone.spawners)
          if (list.every(p => s.position.distanceTo(p) > 150) && s.position.distanceTo(player) < 1800 && s.position.y > (this.world.waterLevel ?? -Infinity)) points.add(s);
    return [...points];
  }

  /** `targets` (co-op host) lists every survivor as {id, position, alive}; solo play passes one position. */
  update(dt, player, playerAlive) {
    const s = this.session;
    const targets = (this.targets?.() ?? [{id: null, position: player, alive: playerAlive}]).filter(t => t.alive);
    this.time = (this.time ?? 0) + dt;
    if (this.autoSpawn !== false && !this.paused && targets.length && s.phase === 'fighting' && s.spawned < s.total && this.list.length < this.game.rules.maxAlive) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0 && !this.spawning) {
        const points = this.spawnPoints(targets.map(t => t.position));
        if (points.length) {
          this.spawning = true;
          const generation = this.generation;
          this.spawn(points[Math.floor(Math.random() * points.length)]).catch(error => console.error('Zombie spawn failed', error)).finally(() => { if (generation === this.generation) this.spawning = false; });
          // Round 1 spawns every 2 s; Cheese Cube's get_zombie_spawn_delay returns 0.1 s for every later round.
          this.nextSpawn = s.round <= 1 ? this.game.rules.spawnDelay : this.game.rules.laterSpawnDelay ?? .1;
        } else {
          this.nextSpawn = .5;
        }
      }
    }
    // zombie_speed_up (rounds 4-9): with four or fewer left to spawn, a lone survivor zombie sprints.
    if (s.round >= 4 && s.round <= 9 && s.total - s.spawned <= 4 && this.list.length === 1 && this.list[0].gait !== 'sprint' && !this.list[0].remote) this.setGait(this.list[0], 'sprint');
    for (const z of [...this.list]) {
      z.rig.update(dt);
      const p = z.root.position;
      if (p.y + 60 < (this.world.waterLevel ?? -Infinity)) { this.remove(z); s.spawned--; continue; }
      if (z.state === 'rising') {
        z.rise += dt;
        p.copy(z.spawnAt).addScaledVector(UP, -70 * Math.max(0, 1 - z.rise / 1.2));
        if (z.rise >= 1.2) z.state = 'chase';
        continue;
      }
      // Each zombie chases the nearest living survivor.
      const survivor = targets.reduce((best, t) => !best || t.position.distanceToSquared(p) < best.position.distanceToSquared(p) ? t : best, null);
      if (!survivor) { z.dealt = true; continue; }
      player = survivor.position; playerAlive = true;
      const eye = player.clone().add(new THREE.Vector3(0, 50, 0));
      if (z.state === 'jump') {
        z.jump.time += dt;
        const t = Math.min(1, z.jump.time / z.jump.duration);
        p.copy(z.jump.from).lerp(z.jump.to, t); p.y += Math.sin(t * Math.PI) * 48;
        if (t >= 1) { z.state = 'chase'; z.repath = 0; z.rig.play('move'); }
        continue;
      }
      const toPlayer = player.clone().sub(p);
      const flat = Math.hypot(toPlayer.x, toPlayer.z);
      // Anti-camping (zm_spawner): a zombie touching its target for 5 s while the target stays within 60 units kills a
      // survivor without Juggernog outright.
      if (flat < 40 && Math.abs(toPlayer.y) < 60) {
        z.camp ??= {time: 0, at: player.clone()};
        z.camp.time += dt;
        if (z.camp.at.distanceTo(player) > 60) z.camp = null;
        else if (z.camp.time >= 5 && !this.juggernog?.(survivor.id)) { z.camp = null; this.onPlayerHit(Infinity, z, survivor.id, {camp: true}); }
      } else z.camp = null;
      if (z.state === 'attack') {
        z.attackLeft -= dt;
        if (!z.dealt && z.attackLeft < .55) {
          z.dealt = true;
          // 60 damage; the same zombie cannot hurt again for 0.4 s (player_damage_override).
          if (flat < 70 && Math.abs(toPlayer.y) < 60 && playerAlive && this.time - z.hitAt >= (this.game.rules.zombieHitLockout ?? .4)
            && this.world.lineClear(p.clone().add(new THREE.Vector3(0, 45, 0)), eye)) { z.hitAt = this.time; this.onPlayerHit(this.game.rules.zombieDamage, z, survivor.id); }
        }
        if (z.attackLeft <= 0) { z.state = 'chase'; z.rig.play('move'); }
        continue;
      }
      // zombieShouldMelee: an enemy within 64 units and no more than 60 degrees off the zombie's facing.
      const facing = Math.atan2(-toPlayer.z, toPlayer.x), off = Math.abs(Math.atan2(Math.sin(facing - z.root.rotation.y), Math.cos(facing - z.root.rotation.y)));
      if (toPlayer.length() <= 64 && off <= Math.PI / 3 && playerAlive && this.world.lineClear(p.clone().add(new THREE.Vector3(0, 45, 0)), eye)) {
        z.state = 'attack';
        z.attackLeft = Math.min(1.1, z.rig.duration('attack') || 1.1);
        z.dealt = false;
        z.rig.play('attack', {loop: false, restart: true, fade: .1});
        z.root.rotation.y = Math.atan2(-toPlayer.z, toPlayer.x);
        continue;
      }
      z.repath -= dt;
      if (z.repath <= 0) {
        const from = this.world.closest(p), to = this.world.closest(player);
        z.path = from && to ? this.world.path(from, to) : [];
        z.pathIndex = 1;
        z.repath = .5 + (z.id % 5) * .08;
        // A path that ends far from the player means this zombie cannot reach them (the template respawns those).
        const end = z.path.at(-1);
        z.lost = end && to && end.distanceTo(to) < 60 ? 0 : z.lost + 1;
      }
      // Bridge short gaps between the tower's navmesh islands using the exported climb/drop clips.
      if (z.lost && flat < 150 && Math.abs(toPlayer.y) < 100 && (flat > 45 || Math.abs(toPlayer.y) > 20)) {
        const landing = this.world.closest(player);
        if (landing && this.canJump(p, landing)) {
          z.state = 'jump'; z.jump = {from: p.clone(), to: landing, time: 0, duration: .85};
          const role = landing.y > p.y ? 'jumpUp' : 'jumpDown';
          z.rig.play(z.rig.has(role) ? role : 'move', {loop: false, restart: true, speed: z.rig.duration(role) / .85 || 1});
          continue;
        }
      }
      const target = z.path[z.pathIndex] ?? (z.lost ? null : player);
      if (target) {
        const delta = target.clone().sub(p), horizontal = Math.hypot(delta.x, delta.z);
        if (horizontal < 8 && z.path[z.pathIndex]) z.pathIndex++;
        else if (horizontal > .01) {
          const step = Math.min(horizontal, z.moveSpeed * dt);
          const next = p.clone().addScaledVector(delta, step / Math.max(horizontal, 1e-3));
          // Keep spacing between zombies.
          for (const other of this.list) {
            if (other === z || other.state === 'rising') continue;
            const sep = next.clone().sub(other.root.position);
            sep.y = 0;
            const d = sep.length();
            if (d < 26 && d > .01) next.addScaledVector(sep, (26 - d) / d * Math.min(1, dt * 4));
          }
          const snapped = this.world.closest(next, {x: 24, y: 40, z: 24});
          const destination = snapped && snapped.distanceTo(next) < 36 ? snapped : next.setY(target.y);
          if (this.world.lineClear(p.clone().add(new THREE.Vector3(0, 32, 0)), destination.clone().add(new THREE.Vector3(0, 32, 0)))) p.copy(destination);
          const face = Math.atan2(-delta.z, delta.x);
          z.root.rotation.y += Math.atan2(Math.sin(face - z.root.rotation.y), Math.cos(face - z.root.rotation.y)) * Math.min(1, dt * 8);
        }
      }
      // Stuck or unreachable for a while: remove quietly and let the spawner send another (not counted as a kill).
      z.stuck += dt;
      if (z.stuck > 6) {
        const moved = z.lastPosition.distanceTo(p);
        z.lastPosition.copy(p);
        z.stuck = 0;
        if ((moved < 12 && flat > 120) || z.lost > 8) { this.remove(z); s.spawned--; }
      }
    }
    this.animateDead(dt);
  }

  /** Corpses play their death and sink away. */
  animateDead(dt) {
    for (const d of [...this.dead]) {
      d.life -= dt;
      d.rig.update(dt);
      if (d.life < .8) d.root.position.y -= dt * 30;
      if (d.life <= 0) { d.root.removeFromParent(); d.rig.mixer.uncacheRoot(d.root); this.dead.splice(this.dead.indexOf(d), 1); }
    }
  }

  /** A death that pays nothing and drops nothing (the game-over sequence). */
  kill(z) {
    if (!this.list.includes(z)) return;
    this.list.splice(this.list.indexOf(z), 1);
    z.state = 'dead'; z.life = 3.5;
    z.rig.play('death', {loop: false, restart: true, fade: .08});
    this.dead.push(z);
  }

  canJump(from, to) {
    let previous = from.clone().add(new THREE.Vector3(0, 24, 0));
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, point = from.clone().lerp(to, t);
      point.y += 24 + Math.sin(t * Math.PI) * 48;
      if (!this.world.lineClear(previous, point)) return false;
      previous = point;
    }
    return true;
  }

  remove(z) {
    z.root.removeFromParent();
    z.rig.mixer.uncacheRoot(z.root);
    this.list.splice(this.list.indexOf(z), 1);
  }

  headPosition(z) {
    const head = z.root.getObjectByName('j_head');
    return head ? head.getWorldPosition(new THREE.Vector3()) : z.root.position.clone().add(new THREE.Vector3(0, 62, 0));
  }

  /** The zombie a ray hits first (head sphere or body capsule), within `far`. */
  rayHit(ray, far) {
    let best = null;
    const point = new THREE.Vector3();
    for (const z of this.list) {
      if (z.state === 'rising' && z.rise < .5) continue;
      z.root.updateMatrixWorld(true);
      const head = this.headPosition(z);
      const headHit = ray.intersectSphere(new THREE.Sphere(head, 7.5), point) ? point.clone() : null;
      const base = z.root.position;
      const bodyHit = ray.intersectBox(new THREE.Box3(base.clone().add(new THREE.Vector3(-15, 0, -15)), base.clone().add(new THREE.Vector3(15, 58, 15))), point) ? point.clone() : null;
      const hit = headHit ?? bodyHit;
      if (!hit) continue;
      const distance = hit.distanceTo(ray.origin);
      if (distance > far || (best && best.distance < distance)) continue;
      // Hit location for kill points: head, neck, torso (upper body near the spine) or a limb.
      const height = hit.y - base.y, side = Math.hypot(hit.x - base.x, hit.z - base.z);
      const part = headHit ? 'head' : height > 52 ? 'neck' : height > 28 && side < 10 ? 'torso' : 'limb';
      best = {z, head: Boolean(headHit), part, point: hit, distance};
    }
    return best;
  }

  damage(z, amount, {head = false, melee = false, part = head ? 'head' : 'torso', nuke = false} = {}) {
    if (!this.list.includes(z)) return false;
    z.health -= amount;
    if (z.health > 0) return false;
    this.list.splice(this.list.indexOf(z), 1);
    z.state = 'dead';
    z.life = 3.5;
    z.rig.play('death', {loop: false, restart: true, fade: .08});
    this.dead.push(z);
    this.session.killed++;
    this.onKill(z, {head, melee, part, nuke});
    if (this.dead.length > 10) {
      const old = this.dead.shift();
      old.root.removeFromParent();
      old.rig.mixer.uncacheRoot(old.root);
    }
    return true;
  }

  clear() {
    this.generation++; this.spawning = false; this.nextSpawn = 0; this.serial = 0; this.pending.clear();
    for (const z of [...this.list, ...this.dead]) { z.root.removeFromParent(); z.rig.mixer.uncacheRoot(z.root); }
    this.list = [];
    this.dead = [];
  }

  /** Host side of a co-op snapshot: living and dying zombies. */
  pack() {
    return [...this.list, ...this.dead].map(z => [z.id, round1(z.root.position.x), round1(z.root.position.y), round1(z.root.position.z),
      Math.round(z.root.rotation.y * 100) / 100, STATES.indexOf(z.state), GAITS.indexOf(z.gait)]);
  }

  /** Guest side: draw the host's zombies. Positions are interpolated; animation follows the host's state. */
  applyRemote(states) {
    const seen = new Set();
    for (const [id, x, y, z, yaw, code, gaitCode] of states) {
      seen.add(id);
      const state = STATES[code] ?? 'chase', zombie = this.list.find(o => o.id === id) ?? this.dead.find(o => o.id === id);
      if (!zombie) {
        if (state === 'dead' || this.pending.has(id)) continue;
        this.pending.add(id);
        const generation = this.generation;
        this.spawn({position: new THREE.Vector3(x, y, z), yaw}, {id, gait: GAITS[gaitCode] ?? 'walk', remote: true}).then(spawned => {
          if (generation !== this.generation) return;
          this.pending.delete(id);
          if (!spawned) return;
          spawned.root.position.set(x, y, z); spawned.target = new THREE.Vector3(x, y, z); spawned.targetYaw = yaw;
          if (spawned.state !== state) this.remoteState(spawned, state);
        }).catch(error => { this.pending.delete(id); console.error('Zombie spawn failed', error); });
        continue;
      }
      (zombie.target ??= new THREE.Vector3()).set(x, y, z); zombie.targetYaw = yaw;
      if (zombie.state !== state) this.remoteState(zombie, state);
    }
    for (const z of [...this.list, ...this.dead]) if (!seen.has(z.id)) {
      z.root.removeFromParent(); z.rig.mixer.uncacheRoot(z.root);
      const list = this.list.includes(z) ? this.list : this.dead; list.splice(list.indexOf(z), 1);
    }
  }

  remoteState(z, state) {
    const previous = z.state; z.state = state;
    if (state === 'dead') {
      if (this.list.includes(z)) { this.list.splice(this.list.indexOf(z), 1); this.dead.push(z); }
      z.life = Infinity; z.rig.play('death', {loop: false, restart: true, fade: .08});
    } else if (state === 'attack') z.rig.play('attack', {loop: false, restart: true, fade: .1});
    else if (state === 'jump') {
      const role = (z.target?.y ?? 0) > z.root.position.y ? 'jumpUp' : 'jumpDown';
      z.rig.play(z.rig.has(role) ? role : 'move', {loop: false, restart: true, speed: z.rig.duration(role) / .85 || 1});
    } else if (previous !== 'rising' || state !== 'chase') z.rig.play('move', {fade: .1});
  }

  updateRemote(dt) {
    for (const z of [...this.list, ...this.dead]) {
      z.rig.update(dt);
      if (!z.target) continue;
      const p = z.root.position;
      if (p.distanceTo(z.target) > 200) p.copy(z.target); else p.lerp(z.target, 1 - Math.exp(-dt * 15));
      const turn = z.targetYaw - z.root.rotation.y;
      z.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 12);
    }
  }

  snapshot() {
    return this.list.map(z => ({id: z.id, state: z.state, gait: z.gait, health: z.health, position: z.root.position.toArray().map(v => Math.round(v))}));
  }
}
