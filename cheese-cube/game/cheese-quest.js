// Cheese Cube's own scripts (Workshop 1168113418, decompiled locally): the power switch build, cheese blocks and the
// Cheese Melter cage, the MP40 posters, the dalek targets, the trivia board that unlocks the 30,000-point ending, the
// moving steps (_zm_parkour) and the rising black cheese. Hint strings are the map's own, spelling included.
import * as THREE from 'three';
import {CHEESE_RULES} from './map-rules.js';

const words = ['one', 'two', 'three', 'four', 'five', 'six'];
// cheese_trivia.gsc: level.trivia_answer = 3, 2, 4, 3, 2.
const triviaAnswers = ['c', 'b', 'd', 'c', 'b'];
// _zm_cheese_u_ee.gsc: the three cage buys.
const MELTERS = [['cheese_reward_weapon_trigger', 'm2_flamethrower', 5000], ['cheese_reward_weapon_trigger2', 'm2_flamethrower2', 7500], ['cheese_reward_weapon_trigger3', 'm2_flamethrower3', 10000]];
// _zm_parkour.gsc: one step starts every second; each moves 200 units over 2 s, then the cycle runs back with the
// signs flipped. Game Y is three.js -Z.
const STEP_MOVES = {15: [0, 0, -1], 16: [0, 0, -1], 17: [0, 0, -1], 18: [0, 0, -1], 19: [1, 0, 0], 20: [1, 0, 0], 21: [1, 0, 0], 22: [1, 0, 0], 23: [0, 0, 1], 24: [-1, 0, 0]};
const STEP_ORDER = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const ramp = t => Math.min(1, Math.max(0, t));

export class CheeseQuest {
  constructor({world, game, notify, sound, points, reward, win, hurt}) {
    Object.assign(this, {world, game, notify, sound, points, reward, win, hurt});
    this.entities = world.entities;
    this.find = name => this.entities.find(e => e.targetname === name);
    this.parts = [1, 2].map(n => this.find(`powcraft_pick${n}_trig`)).filter(Boolean);
    this.build = this.find('powcraft_crafting_trig');
    this.cheeses = [1, 2, 3, 4, 5, 6].map(n => this.find(`cheese_trig${n}`)).filter(Boolean);
    this.places = [1, 2, 3, 4, 5, 6].map(n => this.find(`cheese_place${n}_trig`)).filter(Boolean);
    this.melters = MELTERS.map(([trigger, weapon, cost]) => ({entity: this.find(trigger), weapon, cost})).filter(m => m.entity && this.game.weapons[m.weapon]);
    this.exit = this.find('end_game_trig');
    const water = this.find('rising_brush');
    this.waterBounds = water?.bounds ? new THREE.Box3(new THREE.Vector3(...water.bounds.min), new THREE.Vector3(...water.bounds.max)) : null;
    this.steps = this.entities.filter(e => /^step_move\d+$/.test(e.targetname) && e.bounds).map(e => {
      const n = Number(e.targetname.slice(9)), axis = STEP_MOVES[n];
      return axis ? {entity: e, axis: new THREE.Vector3(...axis), at: STEP_ORDER.indexOf(n)} : null;
    }).filter(Boolean);
    this.targets = this.entities.filter(e => /^(cheese_poster\d_trig|dalek_ee_trig\d|answer_[abcd]|trigger_troll_trig)$/.test(e.targetname)).map(e => {
      const brushName = e.targetname.replace(/_trig(\d)?$/, (_, n) => '_brush' + (n || ''));
      const bounds = this.find(brushName)?.bounds;
      return {entity: e, box: bounds ? new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max)).expandByScalar(1.5) : new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...e.position), new THREE.Vector3(10, /^answer_/.test(e.targetname) ? 2.5 : 18, 10))};
    });
    this.reset();
  }
  reset() {
    this.collectedParts = new Set(); this.collected = new Set(); this.placed = new Set();
    this.posters = new Set(); this.daleks = new Set();
    this.built = !this.parts.length; this.crafting = 0; this.elapsed = 0; this.trivia = 0; this.answerCooldown = 0;
    this.triviaLock = 0; this.triviaMessages = [];
    this.rise = 0; this.rising = false; this.waterHit = 0; this.trolled = false; this.escaped = false;
    this.powerAnim = 0; this.world.waterLevel = -Infinity; this.escapeOpen = false;
    this.world.moveTarget('rising_brush', new THREE.Vector3());
    for (let n = 1; n <= 6; n++) this.world.setVisible(`cheese_place_brush${n}`, false);
    for (let n = 1; n <= 5; n++) this.world.setVisible(`trivia${n}`, n === 1);
    if (!this.built) { this.world.setVisible('powcraft_build1', false); this.world.setVisible('auto1', false); }
    // Black cheese is a hazard, never a walkable platform.
    const water = this.world.collision.parts.get('rising_brush'); if (water) water.enabled = false;
  }
  entry(kind, item, text, extra = {}) { return {kind, item, position: new THREE.Vector3(...item.position), radius: 90, cost: 0, text, ...extra}; }
  /** `owns(weapon)`: whether the survivor looking at a Cheese Melter already carries it. */
  interactables(owns = () => false) {
    const out = [];
    this.parts.forEach((e, i) => { if (!this.collectedParts.has(i)) out.push(this.entry('powerPart', e, 'Pres & hould F too pik up pahrt', {part: i})); });
    if (this.build && !this.built && this.crafting <= 0)
      out.push(this.entry('buildPower', this.build, this.collectedParts.size === this.parts.length ? 'Pres & hould F too ad pahrts' : 'Missing parts'));
    this.cheeses.forEach((e, i) => { if (!this.collected.has(i)) out.push(this.entry('cheese', e, 'Hold F to pick up Cheese Block', {part: i})); });
    this.places.forEach((e, i) => { if (!this.placed.has(i)) out.push(this.entry('placeCheese', e, this.collected.has(i) ? 'Hold F to Place Cheese Block' : 'More Cheese is Needed', {part: i})); });
    if (this.placed.size === this.cheeses.length)
      for (const m of this.melters) if (!owns(m.weapon)) out.push(this.entry('cheeseReward', m.entity, `Hold F to Take Cheese Melter [Cost: ${m.cost}]`, {cost: m.cost, weapon: m.weapon}));
    // The ending's trigger sits behind end_game_door until the trivia is complete.
    if (this.exit && this.escapeOpen) out.push(this.entry('escape', this.exit, `Press F if thou art worthy [Tis expensive: ${CHEESE_RULES.escapeCost}]`, {cost: CHEESE_RULES.escapeCost}));
    return out;
  }
  /** `reward` gives the buying survivor their weapon (co-op passes the guest's inventory). */
  async use(target, reward = this.reward) {
    const n = target.part;
    switch (target.kind) {
      case 'powerPart':
        if (this.collectedParts.has(n)) return false;
        this.collectedParts.add(n); this.world.animateAway(`powcraft_pick${n + 1}`); break;
      case 'buildPower':
        // One use: the knuckle crack plays, and 2.7 s later the switch is there.
        if (this.built || this.crafting > 0 || this.collectedParts.size !== this.parts.length) return false;
        this.crafting = 2.7; this.onCraft?.(); break;
      case 'cheese':
        if (this.collected.has(n)) return false;
        this.collected.add(n); this.world.animateAway(`cheese_model_${words[n]}`);
        if (n === 0) this.world.animateAway('cheese_unlock_cage_trig');
        break;
      case 'placeCheese':
        if (!this.collected.has(n) || this.placed.has(n)) return false;
        this.placed.add(n); this.world.setVisible(`cheese_place_brush${n + 1}`, true);
        if (this.placed.size === this.cheeses.length) this.world.animateAway('cheese_reward_cage_model');
        break;
      case 'cheeseReward':
        // Repeatable buys of the Cheese Melters; refused while you carry that one.
        if (!target.weapon || !await reward(target.weapon)) return false;
        break;
      case 'escape':
        if (!this.escapeOpen) return false;
        this.escaped = true; this.win(); break;
      default: return false;
    }
    this.sound.play('pickup'); return true;
  }
  completeBuild() {
    this.built = true; this.world.setVisible('powcraft_build1', true); this.world.setVisible('auto1', true); this.world.setVisible('powcraft_clip_build', false);
  }
  /**
   * A bullet that reaches a shootable: `weapon` is the shooter's gun. `rewardAll(points)` pays every survivor and
   * `freePerkAll()` gives everyone a perk. Rewards are paid unscaled (add_to_player_score, not doubled).
   */
  shoot(ray, far, weapon = null) {
    const point = new THREE.Vector3();
    const candidates = this.targets.filter(t => ray.intersectBox(t.box, point) && point.distanceTo(ray.origin) <= far + 4)
      .sort((a, b) => a.box.distanceToPoint(ray.origin) - b.box.distanceToPoint(ray.origin));
    const target = candidates[0]?.entity;
    if (!target) return false;
    const name = target.targetname;
    if (/^cheese_poster/.test(name)) {
      // _zm_cheese_poster: only the MP40 (or its upgrade) counts; 2000 to the shooter, 4000 to everyone for all five.
      if (this.posters.has(name) || !/^smg_mp40_t6/.test(weapon?.name ?? '')) return true;
      this.posters.add(name); this.world.animateAway(name.replace('_trig', '_brush'));
      this.points(2000, {raw: true});
      if (this.posters.size === 5) this.rewardAll?.(4000);
    } else if (/^dalek/.test(name)) {
      // _zm_dalek_easter_egg: 250 to the shooter; all three give every survivor a free perk.
      if (this.daleks.has(name)) return true;
      this.daleks.add(name); this.world.animateAway(name.replace('_trig', '_brush'));
      this.points(250, {raw: true});
      if (this.daleks.size === 3) this.freePerkAll?.();
    } else if (/^answer_/.test(name)) {
      if (this.trivia >= 5 || this.triviaLock > 0 || this.answerCooldown > 0) return true;
      if (name.at(-1) === triviaAnswers[this.trivia]) {
        this.world.setVisible(`trivia${this.trivia + 1}`, false); this.trivia++;
        this.world.setVisible(`trivia${this.trivia + 1}`, true);
        this.answerCooldown = 1;
        if (this.trivia === 5) { this.notify('Trivia Complete! End Game Unlocked!', 3); this.openEscape(); }
        else this.notify('You are correct!', 2);
      } else {
        // A wrong answer: two minutes out, then the trivia starts again from the first question.
        this.notify('Incorrect. You are a failure.', 3); this.sound.play('deny');
        this.world.setVisible(`trivia${this.trivia + 1}`, false); this.trivia = 0; this.world.setVisible('trivia1', true);
        this.triviaLock = 120; this.triviaMessages = [[117, 'You may try again in 2 minutes.'], [0, 'Trivia game is ready.']];
        return true;
      }
    } else if (!this.trolled) {
      this.trolled = true; this.onTroll?.('This is just a poster you idiot!');
    }
    this.sound.play('pickup'); return true;
  }
  openEscape() { if (this.escapeOpen) return; this.escapeOpen = true; this.world.animateAway('end_game_door'); }
  turnOnPower() {
    if (!this.built || this.world.power) return false;
    this.world.power = true; this.powerAnim = .5;
    this.sound.play('power_on'); return true;
  }
  /**
   * `survivors` is one player or (co-op) a list of {feet, player, alive, health, hurt, carry}. Each one in the
   * rising cheese is hurt; `carry` players ride the moving steps. `visual` (co-op guests) only animates.
   */
  update(dt, survivors, {visual = false} = {}) {
    const players = Array.isArray(survivors) ? survivors : [survivors];
    this.elapsed += dt; this.answerCooldown = Math.max(0, this.answerCooldown - dt);
    if (this.crafting > 0) { this.crafting -= dt; if (this.crafting <= 0) { this.crafting = 0; this.completeBuild(); } }
    if (this.triviaLock > 0) {
      this.triviaLock = Math.max(0, this.triviaLock - dt);
      while (this.triviaMessages.length && this.triviaLock <= this.triviaMessages[0][0]) { if (!visual) this.notify(this.triviaMessages[0][1], 3); this.triviaMessages.shift(); }
    }
    if (this.powerAnim > 0) {
      this.powerAnim -= dt;
      for (const piece of this.world.byTarget.get('auto1') ?? []) {
        const original = this.world.originals.get(piece);
        if (original) { piece.quaternion.copy(original.quaternion); piece.rotateX(-Math.PI / 2 * (1 - Math.max(0, this.powerAnim) / .5)); }
      }
    }
    // The original water has no on-screen message, only its alarm.
    if (!this.rising && this.waterBounds && this.elapsed >= CHEESE_RULES.riseDelay) { this.rising = true; this.sound.play('cheese_unlimited_alarm'); }
    if (this.rising && this.waterBounds) {
      const risingSeconds = this.elapsed - CHEESE_RULES.riseDelay;
      this.rise = CHEESE_RULES.riseDistance * Math.min(1, risingSeconds / CHEESE_RULES.riseSeconds);
      this.world.waterLevel = this.waterBounds.max.y + this.rise;
      this.world.moveTarget('rising_brush', new THREE.Vector3(0, this.rise, 0));
      const check = Math.floor((risingSeconds + 1e-9) / CHEESE_RULES.waterCheckSeconds);
      if (check > this.waterHit) {
        this.waterHit = check;
        // Original black_cheese_area (?25) is one axis-aligned hull, with the
        // same bounds as rising_brush (*41), linked to follow its displacement.
        // Test contact with the browser's upright player capsule, not just feet.
        const b = this.waterBounds;
        if (!visual) for (const {player, alive, health = 100, hurt = this.hurt} of players) {
          const c = player.collider;
          const dx = Math.max(b.min.x - c.start.x, 0, c.start.x - b.max.x);
          const dz = Math.max(b.min.z - c.start.z, 0, c.start.z - b.max.z);
          const dy = Math.max(b.min.y + this.rise - Math.max(c.start.y, c.end.y), 0, Math.min(c.start.y, c.end.y) - b.max.y - this.rise);
          if (alive && dx * dx + dy * dy + dz * dz <= c.radius * c.radius) hurt(health + 666, {hazard: true});
        }
      }
    }
    // The steps run on the map clock: a 20 s cycle, out over the first ten seconds and back over the next ten.
    const cycle = this.elapsed % 20;
    for (const step of this.steps) {
      const part = this.world.collision.parts.get(step.entity.targetname);
      const old = part?.offset.clone() ?? new THREE.Vector3();
      const out = c => ramp((c - step.at) / 2) - ramp((c - 10 - step.at) / 2);
      const offset = step.axis.clone().multiplyScalar(200 * (cycle >= step.at ? out(cycle) : out(cycle + 20)));
      const b = step.entity.bounds;
      for (const {feet, player, alive, carry = true} of players) {
        if (carry && alive && player.isGrounded && Math.abs(feet.y - (b.max[1] + old.y)) < 4 && feet.x >= b.min[0] + old.x - 2 && feet.x <= b.max[0] + old.x + 2
          && feet.z >= b.min[2] + old.z - 2 && feet.z <= b.max[2] + old.z + 2) {
          player.collider.translate(offset.clone().sub(old)); player.update(0);
        }
      }
      this.world.moveTarget(step.entity.targetname, offset);
    }
  }
  // Co-op: the host's quest progress, applied by guests with the same scene changes as playing it.
  pack() {
    return {parts: [...this.collectedParts], built: this.built, crafting: Math.round(this.crafting * 10) / 10, cheese: [...this.collected], placed: [...this.placed],
      posters: [...this.posters], daleks: [...this.daleks], trivia: this.trivia, lock: Math.round(this.triviaLock), elapsed: Math.round(this.elapsed * 100) / 100,
      escape: this.escapeOpen, escaped: this.escaped};
  }
  applyRemote(s, power) {
    for (const n of s.parts) if (!this.collectedParts.has(n)) { this.collectedParts.add(n); this.world.animateAway(`powcraft_pick${n + 1}`); }
    this.crafting = s.crafting ?? 0;
    if (s.built && !this.built) this.completeBuild();
    if (power && !this.world.power) { this.world.power = true; this.powerAnim = .5; }
    for (const n of s.cheese) if (!this.collected.has(n)) {
      this.collected.add(n); this.world.animateAway(`cheese_model_${words[n]}`);
      if (n === 0) this.world.animateAway('cheese_unlock_cage_trig');
    }
    for (const n of s.placed) if (!this.placed.has(n)) {
      this.placed.add(n); this.world.setVisible(`cheese_place_brush${n + 1}`, true);
      if (this.placed.size === this.cheeses.length) this.world.animateAway('cheese_reward_cage_model');
    }
    for (const name of s.posters) if (!this.posters.has(name)) { this.posters.add(name); this.world.animateAway(name.replace('_trig', '_brush')); }
    for (const name of s.daleks) if (!this.daleks.has(name)) { this.daleks.add(name); this.world.animateAway(name.replace('_trig', '_brush')); }
    if (s.trivia !== this.trivia) { for (let n = 1; n <= 5; n++) this.world.setVisible(`trivia${n}`, n === s.trivia + 1); this.trivia = s.trivia; }
    this.triviaLock = s.lock ?? 0;
    if (s.escape) this.openEscape();
    // The local clock keeps the water and steps smooth between snapshots.
    if (Math.abs(this.elapsed - s.elapsed) > .25) this.elapsed = s.elapsed;
    this.escaped = s.escaped;
  }
  get waterStopped() { return this.rising && this.rise >= CHEESE_RULES.riseDistance; }
  get objective() {
    if (!this.built) return `Build power · parts ${this.collectedParts.size}/${this.parts.length}`;
    if (!this.world.power) return 'Turn on the power switch';
    return `Cheese ${this.collected.size}/6 · placed ${this.placed.size}/6 · trivia ${this.trivia}/5${this.escapeOpen ? ' · ending open' : ''}`;
  }
}
