import * as THREE from 'three';
import {label} from './effects.js';
import {CHEESE_RULES} from './map-rules.js';
import {Rig} from './assets.js';

// _zm_magicbox: while the box rolls, the weapon model changes 20 times every 0.05 s, 10 every 0.1 s, 5 every 0.2 s and
// 3 every 0.3 s (3.9 s), rising out of the chest; the offered weapon then sinks back over the 12 s it can be taken.
const CYCLE = [[20, .05], [10, .1], [5, .2], [3, .3]].flatMap(([n, wait]) => Array(n).fill(wait));
const cycleIndex = elapsed => { let t = 0; for (let i = 0; i < CYCLE.length; i++) { t += CYCLE[i]; if (elapsed < t) return i; } return CYCLE.length; };

function boxMesh(size, color, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({color, roughness: .65}));
  mesh.position.set(...position); return mesh;
}

export class Machines {
  constructor({world, scene, weapons, game, assets, notify, sound}) {
    Object.assign(this, {world, scene, weapons, game, assets, notify, sound});
    this.generation = 0;
    this.displays = new Map();
    this.box = world.box && this.build('box', world.box);
    this.pap = world.pap && this.build('pap', world.pap);
    this.cycle = [];
    this.reset();
  }

  /** The map's own chest (p7_zm_der_magic_box) and Pack-a-Punch (p7_zm_vending_packapunch, lit when the power is on)
   *  replace the stand-in housings, with the zbarrier animations their entities name. */
  async loadOriginals() {
    const parts = this.game.machines ?? {};
    await Promise.all([['box', this.box], ['pap', this.pap]].map(async ([kind, m]) => {
      const p = parts[kind];
      if (!m || !p?.model) return;
      const roles = Object.keys(p).filter(r => /^o_/.test(p[r]));
      const [model, lit, ...clips] = await Promise.all([this.assets.model(p.model), p.on ? this.assets.model(p.on) : null, ...roles.map(r => this.assets.anim(p[r]))]);
      for (const piece of m.housing) piece.removeFromParent();
      m.title.visible = false; m.lid = null;
      // Entity angles turn the model about up: game yaw is three.js yaw.
      const holder = new THREE.Group(); holder.rotation.y = m.yaw - m.root.rotation.y;
      for (const o of [model, lit]) if (o) { o.traverse(c => { if (c.isMesh) c.frustumCulled = false; }); holder.add(o); }
      m.root.add(holder);
      const rig = root => { const r = new Rig(root); roles.forEach((role, i) => r.add(role, clips[i], {skipRootMotion: false})); return r; };
      m.model = model; m.lit = lit; m.rig = rig(model); m.litRig = lit ? rig(lit) : null; m.lastPose = null;
      if (lit) lit.visible = false;
      // Collision follows the real chest / machine.
      holder.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(holder), size = bounds.getSize(new THREE.Vector3());
      this.world.collision.add('machine:' + kind, new THREE.BoxGeometry(size.x, size.y, size.z).translate(...bounds.getCenter(new THREE.Vector3()).toArray()));
    }));
    // A handful of box weapons to show while it rolls (the offered one always comes last).
    const pool = [...this.game.box].sort(() => Math.random() - .5).slice(0, 8);
    Promise.all(pool.map(n => this.prepareDisplay(n).then(d => d.clone(true)).catch(() => null))).then(list => { this.cycle = list.filter(Boolean); });
  }
  /** Plays a zbarrier animation once on the machine's model (and its lit twin). */
  pose(m, role) {
    if (!m.rig || m.lastPose === role) return;
    m.lastPose = role;
    for (const r of [m.rig, m.litRig]) if (r?.has(role)) r.play(role, {loop: role === 'loop', fade: .1, restart: true});
  }
  build(kind, source) {
    const root = new THREE.Group(); root.position.copy(source.position);
    const yaw = (Number((source.entity.angles || '0 0 0').split(' ')[1]) || 0) * Math.PI / 180;
    root.rotation.y = -yaw;
    const before = new Set(root.children);
    // Zbarriers are omitted by the original map composer, so create their missing housings here.
    let lid = null;
    if (kind === 'box') {
      root.add(boxMesh([74, 24, 30], 0x69502a, [0, 12, 0]));
      for (const x of [-32, 32]) root.add(boxMesh([4, 26, 32], 0xb9a056, [x, 13, 0]));
      lid = new THREE.Group(); lid.position.set(0, 24, -15);
      lid.add(boxMesh([76, 5, 32], 0xbfa33e, [0, 2, 15])); root.add(lid);
    } else {
      root.add(boxMesh([54, 47, 34], 0x697d79, [0, 23.5, 0]));
      root.add(boxMesh([45, 12, 10], 0x182622, [0, 32, 21]));
      root.add(boxMesh([58, 8, 40], 0xabbbb4, [0, 50, 0]));
      for (const x of [-23, 23]) root.add(boxMesh([6, 44, 6], 0xabc1b6, [x, 26, 20]));
    }
    const housing = root.children.filter(c => !before.has(c));
    const title = label(kind === 'box' ? '? MYSTERY BOX ?' : 'PACK-A-PUNCH', '#fff0a0', 90);
    title.position.y = kind === 'box' ? 34 : 70; root.add(title);
    const glow = new THREE.PointLight(kind === 'box' ? 0x82aaff : 0x71ffda, 0, 180, 1);
    glow.position.y = 50; root.add(glow);
    const display = new THREE.Group(); display.position.y = 52; root.add(display);
    this.scene.add(root);
    root.updateMatrixWorld(true);
    const collision = new THREE.BoxGeometry(kind === 'box' ? 76 : 58, kind === 'box' ? 28 : 54, kind === 'box' ? 32 : 40);
    collision.translate(0, kind === 'box' ? 14 : 27, 0).applyMatrix4(root.matrixWorld);
    this.world.collision.add('machine:' + kind, collision);
    return {kind, root, lid, glow, display, title, state: 'idle', source, yaw, housing};
  }
  reset() {
    this.generation++;
    for (const m of [this.box, this.pap]) if (m) {
      m.state = 'idle'; m.timer = 0; m.elapsed = 0; m.offer = null; m.slot = null; m.index = null; m.owner = null; m.weapons = null;
      m.display.clear(); m.glow.intensity = 0; if (m.lid) m.lid.rotation.x = 0;
      if (m.lit) { m.lit.visible = false; m.model.visible = true; }
      m.lastPose = null; m.cycleShown = undefined;
    }
  }
  async prepareDisplay(name) {
    if (this.displays.has(name)) return this.displays.get(name);
    const root = await this.assets.model(this.game.weapons[name].viewModel);
    root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
    const holder = new THREE.Group(); holder.add(root);
    root.position.sub(bounds.getCenter(new THREE.Vector3()));
    holder.scale.setScalar(45 / Math.max(size.x, size.y, size.z, 1));
    this.displays.set(name, holder);
    return holder;
  }
  // `weapons` and `owner` are the buyer's: in co-op only they can collect the offer.
  async prepareBox(pool, weapons = this.weapons) {
    if (!pool.length) throw new Error('Every Mystery Box weapon is already owned');
    const name = pool[Math.floor(Math.random() * pool.length)];
    await Promise.all([weapons.prepare(name), this.prepareDisplay(name)]);
    return name;
  }
  startBox(name, owner = null) {
    const m = this.box;
    if (!m || m.state !== 'idle') return false;
    m.state = 'rolling'; m.timer = CHEESE_RULES.boxSeconds; m.elapsed = 0; m.offer = name; m.owner = owner;
    m.display.clear(); m.display.add(this.displays.get(name));
    this.sound.play('box_open'); this.sound.play('box_music'); return true;
  }
  async startPap(weapons = this.weapons, owner = null) {
    const m = this.pap, slot = weapons.current;
    const generation = this.generation;
    if (!m || m.state !== 'idle' || !slot?.def.upgrade || !this.game.weapons[slot.def.upgrade]) return false;
    await Promise.all([weapons.prepare(slot.def.upgrade), this.prepareDisplay(slot.def.upgrade)]);
    if (generation !== this.generation || weapons.current !== slot || m.state !== 'idle') return false;
    // Caller serializes purchases; retain the exact deposited slot even if the player switches later.
    m.slot = slot; m.index = weapons.index; m.offer = slot.def.upgrade; m.owner = owner; m.weapons = weapons;
    weapons.reserved.add(m.index);
    m.state = 'working'; m.timer = CHEESE_RULES.papSeconds; m.elapsed = 0;
    m.display.clear(); m.display.add(this.displays.get(m.offer));
    weapons.slots[m.index] = null;
    const alternative = weapons.slots.findIndex(s => s);
    if (alternative >= 0) weapons.index = alternative;
    weapons.rev = (weapons.rev ?? 0) + 1;
    await weapons.equip();
    this.sound.play('pap_upgrade'); this.sound.play('sting_specialty_packapunch'); return true;
  }
  async take(m, weapons = this.weapons) {
    if (!m || m.state !== 'offered') return false;
    m.state = 'claiming';
    const generation = this.generation;
    try {
      const given = await weapons.give(m.offer, {replaceIndex: m.kind === 'pap' ? m.index : null});
      if (generation !== this.generation) return false;
      if (!given) { m.state = 'offered'; return false; }
      if (m.kind === 'pap') weapons.reserved.delete(m.index);
      this.notify(this.game.weapons[m.offer].displayName, 1.5);
      if (m.kind === 'box') this.sound.play('box_close');
      m.state = 'closing'; m.timer = .5; m.display.clear(); m.slot = null;
      return true;
    } catch (error) { if (generation === this.generation) m.state = 'offered'; throw error; }
  }
  update(dt, time) { this.advance(dt); this.animate(dt, time); }
  advance(dt) {
    for (const m of [this.box, this.pap]) if (m) {
      if (m.state !== 'idle' && m.state !== 'claiming') m.timer -= dt;
      if (['rolling', 'working'].includes(m.state) && m.timer <= 0) {
        // The box holds its weapon out for 12 s (_zm_magicbox), Pack-a-Punch for 15 s.
        m.state = 'offered'; m.timer = m.kind === 'box' ? CHEESE_RULES.boxOfferSeconds : CHEESE_RULES.offerSeconds;
        if (m.kind === 'pap') this.sound.play('pap_ready');
      } else if (m.state === 'offered' && m.timer <= 0) {
        // A timed-out upgrade returns the original gun rather than silently destroying the only weapon.
        const weapons = m.weapons ?? this.weapons;
        if (m.kind === 'pap' && m.slot && !weapons.slots[m.index]) {
          weapons.reserved.delete(m.index);
          weapons.slots[m.index] = m.slot; weapons.rev = (weapons.rev ?? 0) + 1;
          if (!weapons.current) { weapons.index = m.index; weapons.equip().catch(error => this.notify(error.message, 3)); }
          this.notify('Upgrade expired — original weapon returned', 2);
        }
        m.state = 'closing'; m.timer = .5; m.display.clear(); m.slot = null; m.weapons = null;
      } else if (m.state === 'closing' && m.timer <= 0) { m.state = 'idle'; m.owner = null; }
    }
  }
  animate(dt, time) {
    for (const m of [this.box, this.pap]) if (m) {
      m.elapsed += dt;
      const open = ['rolling', 'working', 'offered', 'claiming'].includes(m.state);
      if (m.lid) m.lid.rotation.x = THREE.MathUtils.damp(m.lid.rotation.x, open ? -1.6 : 0, 8, dt);
      if (m.rig) {
        if (m.kind === 'box') this.pose(m, open ? 'open' : 'close');
        else {
          if (m.lit && this.world.power && !m.lit.visible) { m.lit.visible = true; m.model.visible = false; m.lastPose = null; this.pose(m, 'poweron'); }
          if (m.state === 'working') this.pose(m, m.elapsed < 1 ? 'take' : 'loop');
          else if (m.state === 'offered' || m.state === 'claiming') this.pose(m, 'eject');
        }
        m.rig.update(dt); m.litRig?.update(dt);
      }
      m.glow.intensity = m.rig ? (open ? 12 + Math.sin(time * 9) * 4 : 0) : open ? 30 + Math.sin(time * 9) * 10 : (m.kind === 'pap' && this.world.power ? 8 : 0);
      if (m.kind === 'box' && m.rig) {
        // Rising while it rolls, sinking back while it waits to be taken.
        const offerLeft = m.state === 'offered' ? Math.max(0, m.timer) / CHEESE_RULES.boxOfferSeconds : 1;
        m.display.position.y = m.state === 'rolling' ? 8 + 36 * Math.min(1, m.elapsed / 3.9) : 8 + 36 * offerLeft;
        m.display.rotation.y = 0;
        if (m.state === 'rolling' && this.cycle.length) {
          const index = cycleIndex(m.elapsed);
          if (index !== m.cycleShown) {
            m.cycleShown = index;
            const show = index >= CYCLE.length ? this.displays.get(m.offer) : this.cycle[index % this.cycle.length];
            if (show) { m.display.clear(); m.display.add(show); }
          }
        } else if (m.cycleShown !== undefined && m.state !== 'rolling') { m.cycleShown = undefined; const final = this.displays.get(m.offer); if (final && open) { m.display.clear(); m.display.add(final); } }
      } else {
        m.display.rotation.y += dt * (m.state === 'rolling' ? 12 : .5);
        m.display.position.y = (m.kind === 'box' ? 44 : 62) + Math.sin(time * 2) * 3;
      }
      m.display.scale.setScalar(m.state === 'working' ? .6 + .4 * Math.sin(m.elapsed * 8) ** 2 : 1);
    }
  }

  // Co-op: the host runs both machines; guests mirror their state and displays.
  pack() { return [this.box, this.pap].map(m => m && {state: m.state, offer: m.offer, timer: Math.round(m.timer * 10) / 10, owner: m.owner}); }
  applyRemote(states = []) {
    [this.box, this.pap].forEach((m, i) => {
      const s = states[i]; if (!m || !s) return;
      const showing = ['rolling', 'working', 'offered', 'claiming'].includes(s.state);
      if (s.state !== m.state && ['rolling', 'working'].includes(s.state)) m.elapsed = 0;
      if (showing && s.offer && (s.offer !== m.offer || !m.display.children.length)) {
        const offer = s.offer;
        this.prepareDisplay(offer).then(display => { if (m.offer === offer && ['rolling', 'working', 'offered', 'claiming'].includes(m.state)) { m.display.clear(); m.display.add(display); } })
          .catch(error => this.notify(error.message, 3));
      }
      if (!showing) m.display.clear();
      Object.assign(m, {state: s.state, offer: s.offer, timer: s.timer, owner: s.owner});
    });
  }
}
