import * as THREE from 'three';
import {disposeObject} from './effects.js';
import {PowerupModels} from './powerups.js';

const names = {maxAmmo: 'MAX AMMO', doublePoints: 'DOUBLE POINTS', instaKill: 'INSTA-KILL', nuke: 'NUKE', freePerk: 'FREE PERK', freePap: ''};
const round1 = v => Math.round(v * 10) / 10;
// _zm_powerups.gsc defaults, used when game data predates them.
const POWERUP_RULES = {chance: .03, increment: 2000, growth: 1.14, perRound: 4, solid: 15, life: 26.5, radius: 64, duration: 30, nukePoints: 400,
  deck: ['nuke', 'instaKill', 'doublePoints', 'maxAmmo'], freePerks: []};
const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
/** powerup_timeout: solid for 15 s, then 40 hide/show toggles (15 every 0.5 s, 10 every 0.25 s, 15 every 0.1 s). */
export function powerupVisible(age, solid = 15) {
  const t = age - solid;
  if (t < 0) return true;
  const toggle = t < 7.5 ? Math.floor(t / .5) : t < 10 ? 15 + Math.floor((t - 7.5) / .25) : 25 + Math.floor((t - 10) / .1);
  return toggle % 2 === 1;
}

export class Combat {
  constructor({scene, world, camera, zombies, weapons, playerState, effects, sound, notify, points, hurt, hit, rules = {}}) {
    Object.assign(this, {scene, world, camera, zombies, weapons, playerState, effects, sound, notify, points, hurt, hit});
    this.rules = {...POWERUP_RULES, ...rules};
    this.projectiles = []; this.pickups = []; this.buffs = {}; this.serial = 0;
    this.powerupModels = new PowerupModels();
    this.reset();
  }
  async load(base, manager, extra = {}) {
    await this.powerupModels.load(base, manager, this.scene.background, extra);
    // Only power-ups whose models loaded are dealt.
    this.rules.deck = this.rules.deck.filter(kind => this.powerupModels.templates.has(kind));
  }
  // Grenades belong to the acting survivor; power-ups, drops and buffs are shared by the team.
  get grenades() { return this.playerState.grenades ?? 0; }
  set grenades(value) { this.playerState.grenades = value; }
  reset() {
    for (const p of this.projectiles) disposeObject(p.mesh);
    for (const p of this.pickups) p.mesh.removeFromParent();
    // Survivors spawn without grenades; the round-start award gives them (zm::function_27979d6).
    this.projectiles = []; this.pickups = []; this.buffs = {}; this.grenades = 0; this.serial = 0;
    this.deck = []; this.dropsThisRound = 0; this.dropFlag = false; this.earned = 0;
    this.increment = this.rules.increment; this.threshold = this.rules.increment; this.nuke = null;
    if (this.zombies) this.zombies.paused = false;
  }
  /** Points the team earns count toward the next points-based drop (watch_for_drop). */
  earn(points) { if (points > 0) this.earned += points; }
  roundStart() { this.dropsThisRound = 0; }
  get multiplier() { return this.buffs.doublePoints > 0 ? 2 : 1; }
  melee() {
    const eye = this.camera.position, direction = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null, distance = 86;
    for (const z of this.zombies.list) {
      const center = z.root.position.clone().add(new THREE.Vector3(0, 42, 0));
      const delta = center.clone().sub(eye), d = delta.length();
      if (d < distance && delta.normalize().dot(direction) > .55 && this.world.lineClear(eye, center)) { best = z; distance = d; }
    }
    // The knife's swing sound plays with the swing; a stab on a zombie adds the hit.
    if (!best) return;
    this.sound.play('knife_hit');
    const killed = this.zombies.damage(best, this.buffs.instaKill > 0 ? best.health : 150, {melee: true});
    if (!killed) this.points(10);
    this.hit(killed, {alert: false});
    this.effects.burst(best.root.position.clone().add(new THREE.Vector3(0, 45, 0)), 0x932f22, 8);
  }
  throwGrenade() {
    if (this.grenades <= 0) return;
    this.grenades--;
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), new THREE.MeshStandardMaterial({color: 0x556331, roughness: .65}));
    // Start at the eye so a swept ray catches walls even when throwing at point-blank range.
    mesh.position.copy(this.camera.position).add(new THREE.Vector3(0, -3, 0));
    const velocity = direction.multiplyScalar(500); velocity.y += 150;
    this.scene.add(mesh); this.projectiles.push({id: ++this.serial, owner: this.owner?.() ?? null, mesh, velocity, fuse: 3, resting: false});
    this.sound.play('mechanism');
  }
  /** `edge`: damage at the rim (RadiusDamage falls linearly from `damage` to it); splash kills have no hit location. */
  explode(position, {radius = 220, damage = 1000, edge = null, self = true} = {}) {
    this.sound.play('explosion'); this.effects.burst(position, 0xff922a, 28, 4, 240, .65);
    for (const z of [...this.zombies.list]) {
      const center = z.root.position.clone().add(new THREE.Vector3(0, 32, 0)), d = center.distanceTo(position);
      if (d >= radius || !this.world.lineClear(position, center)) continue;
      const amount = edge === null ? Math.max(50, damage * (1 - d / radius)) : damage + (edge - damage) * d / radius;
      const killed = this.zombies.damage(z, this.buffs.instaKill > 0 ? z.health : amount, {part: 'none'});
      if (!killed) this.points(10);
      this.hit(killed, {alert: false});
    }
    const distance = this.camera.position.distanceTo(position);
    // Your own explosives cannot take you below 75 from above it; PhD Flopper makes you immune.
    if (self && distance < radius && !this.playerState.perks.has('specialty_phdflopper') && this.world.lineClear(position, this.camera.position)) {
      const damage = 100 * (1 - distance / radius);
      this.hurt(this.playerState.health > 75 ? Math.min(75, damage) : damage);
    }
  }
  /** powerup_drop: at most four a round; a 3% chance per kill, or the drop the team's points have earned. */
  drop(position) {
    if (this.dropsThisRound >= this.rules.perRound || !this.rules.deck.length) return;
    if (!(Math.random() < this.rules.chance) && !this.dropFlag) return;
    this.dropFlag = false; this.dropsThisRound++;
    this.spawnPickup(this.nextPowerup(), position);
    this.sound.play('powerup_spawn');
  }
  /** The shuffled power-up deck, dealt in order and reshuffled when it runs out. */
  nextPowerup() { if (!this.deck.length) this.deck = shuffle([...this.rules.deck]); return this.deck.shift(); }
  spawnPickup(kind, position, id = ++this.serial) {
    const visual = this.powerupModels.create(kind), {mesh} = visual;
    mesh.position.copy(position).add(new THREE.Vector3(0, 40, 0));
    const pickup = {id, ...visual, kind, life: this.rules.life, y: mesh.position.y, age: 0};
    this.powerupModels.animate(pickup);
    this.scene.add(mesh); this.pickups.push(pickup); return pickup;
  }
  collect(kind, position = null) {
    // `team` (co-op host) lists every survivor; power-ups reach all of them.
    const team = this.team?.() ?? [{weapons: this.weapons, playerState: this.playerState, points: n => this.points(n)}];
    const standing = team.filter(m => !m.playerState.down && !m.playerState.dead);
    if (kind === 'maxAmmo') {
      // GiveMaxAmmo fills every weapon's reserve and the grenades; the magazine is left alone. Downed survivors miss out.
      for (const member of standing) {
        for (const slot of member.weapons.slots) if (slot) slot.reserve = slot.def.reserve;
        member.playerState.grenades = 4; member.weapons.rev = (member.weapons.rev ?? 0) + 1;
      }
    } else if (kind === 'nuke') {
      // Spawning pauses; after 0.5 s the zombies die nearest-first, 0.1-0.7 s apart, paying no kill points.
      const from = position ?? this.camera.position;
      this.zombies.paused = true;
      this.nuke = {wait: .5, queue: [...this.zombies.list].sort((a, b) => a.root.position.distanceTo(from) - b.root.position.distanceTo(from)), team, resume: null};
    } else if (kind === 'freePerk') {
      // A random perk each standing survivor lacks (ignoring the perk limit), or the deny sound if none is left.
      for (const member of standing) {
        const options = this.rules.freePerks.filter(p => !member.playerState.perks.has(p));
        if (!options.length) { this.sound.play('deny'); continue; }
        this.givePerk?.(member, options[Math.floor(Math.random() * options.length)]);
      }
    } else if (kind === 'freePap') {
      // The map's Free Pack-a-Punch rejects every living player (its validity check is inverted): only a deny sound.
      this.sound.play('deny');
    } else this.buffs[kind] = this.rules.duration;
    // The original grab sound, then the power-up's own (Double Points has none of its own).
    this.sound.play('powerup_grab');
    const own = {maxAmmo: 'powerup_maxammo', instaKill: 'powerup_instakill', nuke: 'powerup_nuke'}[kind];
    if (own) this.sound.play(own);
    if (!names[kind]) return;
    if (this.onPowerup) this.onPowerup(kind); else this.notify(names[kind], 2);
  }
  updateNuke(dt) {
    const n = this.nuke;
    if (!n) return;
    if (n.resume !== null) { n.resume -= dt; if (n.resume <= 0) { this.zombies.paused = false; this.nuke = null; } return; }
    n.wait -= dt;
    while (n.wait <= 0) {
      const z = n.queue.shift();
      if (z) { if (this.zombies.list.includes(z)) this.zombies.damage(z, z.health, {nuke: true, part: 'head'}); n.wait += .1 + Math.random() * .6; continue; }
      for (const member of n.team) member.points(this.rules.nukePoints);
      n.resume = 3; break;
    }
  }
  /** `feet` is the player's position, or (co-op host) a list of survivors who can collect, as {id, feet}. Downed
   *  survivors can collect power-ups. */
  update(dt, feet, alive) {
    const collectors = Array.isArray(feet) ? feet : alive ? [{id: null, feet}] : [];
    const as = (id, fn) => this.withOwner ? this.withOwner(id, fn) : fn();
    if (this.earned > this.threshold) { this.increment *= this.rules.growth; this.threshold = this.earned + this.increment; this.dropFlag = true; }
    this.updateNuke(dt);
    for (const key of Object.keys(this.buffs)) {
      const before = this.buffs[key]; this.buffs[key] = Math.max(0, before - dt);
      if (key === 'doublePoints' && before > 0 && this.buffs[key] === 0) this.sound.play('powerup_double_off');
    }
    for (const p of [...this.projectiles]) {
      p.fuse -= dt;
      // The thrower is credited with kills and is the only survivor its blast can hurt.
      if (p.fuse <= 0) { const at = p.mesh.position.clone(); disposeObject(p.mesh); this.projectiles.splice(this.projectiles.indexOf(p), 1); as(p.owner, () => this.explode(at)); continue; }
      for (let left = dt; left > 0 && !p.resting; left -= 1 / 120) {
        const slice = Math.min(left, 1 / 120);
        p.velocity.y -= slice * 600;
        const delta = p.velocity.clone().multiplyScalar(slice), length = delta.length();
        if (!length) continue;
        const direction = delta.clone().normalize();
        const wall = this.world.collision.rayIntersect(new THREE.Ray(p.mesh.position, direction), 0, length + 3);
        if (wall) {
          const normal = wall.triangle.getNormal(new THREE.Vector3());
          if (normal.dot(direction) > 0) normal.negate();
          p.mesh.position.addScaledVector(direction, Math.max(0, wall.distance - 3.2));
          p.velocity.reflect(normal).multiplyScalar(.45);
          if (normal.y > .6 && p.velocity.length() < 35) p.resting = true;
        } else p.mesh.position.add(delta);
      }
      p.mesh.rotation.x += dt * 4; p.mesh.rotation.z += dt * 3;
    }
    for (const p of [...this.pickups]) {
      this.animatePickup(p, dt);
      const at = new THREE.Vector3(p.mesh.position.x, p.y, p.mesh.position.z);
      const collector = collectors.find(({feet}) => feet.distanceTo(at) < this.rules.radius);
      if (collector || p.life <= 0) { if (collector) as(collector.id, () => this.collect(p.kind, at)); p.mesh.removeFromParent(); this.pickups.splice(this.pickups.indexOf(p), 1); }
    }
  }
  animatePickup(p, dt) {
    p.life -= dt; p.age += dt; p.core.rotation.y += dt * 1.8;
    p.mesh.position.y = p.y + Math.sin(p.age * 3) * 4;
    p.mesh.visible = powerupVisible(p.age, this.rules.solid);
    this.powerupModels.animate(p);
  }

  // Co-op: the host sends drops and live grenades; guests only draw them.
  pack() {
    return {pickups: this.pickups.map(p => [p.id, p.kind, round1(p.mesh.position.x), round1(p.y), round1(p.mesh.position.z), round1(p.life)]),
      grenades: this.projectiles.map(p => [p.id, round1(p.mesh.position.x), round1(p.mesh.position.y), round1(p.mesh.position.z)])};
  }
  applyRemote(pickups = [], grenades = []) {
    const drops = new Set(pickups.map(p => p[0])), live = new Set(grenades.map(g => g[0]));
    for (const p of [...this.pickups]) if (!drops.has(p.id)) { p.mesh.removeFromParent(); this.pickups.splice(this.pickups.indexOf(p), 1); }
    for (const [id, kind, x, y, z, life] of pickups) {
      const p = this.pickups.find(p => p.id === id) ?? this.spawnPickup(kind, new THREE.Vector3(x, y - 40, z), id);
      p.life = life; p.age = this.rules.life - life;
    }
    for (const p of [...this.projectiles]) if (!live.has(p.id)) { disposeObject(p.mesh); this.projectiles.splice(this.projectiles.indexOf(p), 1); }
    for (const [id, x, y, z] of grenades) {
      let p = this.projectiles.find(p => p.id === id);
      if (!p) {
        p = {id, mesh: new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), new THREE.MeshStandardMaterial({color: 0x556331, roughness: .65})), target: new THREE.Vector3(x, y, z)};
        p.mesh.position.set(x, y, z); this.scene.add(p.mesh); this.projectiles.push(p);
      }
      (p.target ??= new THREE.Vector3()).set(x, y, z);
    }
  }
  animate(dt) {
    for (const p of this.pickups) this.animatePickup(p, dt);
    for (const p of this.projectiles) if (p.target) { p.mesh.position.lerp(p.target, 1 - Math.exp(-dt * 20)); p.mesh.rotation.x += dt * 4; p.mesh.rotation.z += dt * 3; }
  }
}
