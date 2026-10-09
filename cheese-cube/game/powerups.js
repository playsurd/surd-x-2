import * as THREE from 'three';
import {Assets} from './assets.js';

// Original meshes/textures, with a browser rendition of the green power-up aura.
// Resources live for the match loader's lifetime; instances only borrow them.
export class PowerupModels {
  constructor() { this.templates = new Map(); }

  /** `extra`: further pickups as ready models keyed by kind (Free Perk's bottle, the map's Free Pack-a-Punch). */
  async load(base, manager, environment, extra = {}) {
    const response = await fetch(`${base}/powerups/source.json`);
    if (!response.ok) throw new Error(`Power-up assets: HTTP ${response.status}. Run build-powerups.mjs.`);
    this.source = await response.json();
    const assets = new Assets(`${base}/powerups`, manager);
    await Promise.all(['instaKill', 'maxAmmo', 'doublePoints', 'nuke'].map(async kind => {
      const name = this.source.models[kind];
      if (!name) throw new Error(`Missing original power-up model: ${kind}`);
      const model = await assets.model(name);
      model.name = name;
      model.traverse(o => {
        if (!o.isMesh) return;
        const tune = material => {
          const m = material.clone();
          m.envMap = environment; m.envMapIntensity = .65;
          m.emissive.setHex(0x362305); m.emissiveIntensity = .2;
          return m;
        };
        o.material = Array.isArray(o.material) ? o.material.map(tune) : tune(o.material);
      });
      // Center the authored geometry on the spin axis without changing its native dimensions.
      const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      model.position.sub(center);
      this.templates.set(kind, model);
    }));
    for (const [kind, model] of Object.entries(extra)) {
      if (!model) continue;
      model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      model.position.sub(center);
      this.templates.set(kind, model);
    }
    const size = 64, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 31.5, y - 31.5) / 31.5;
      pixels.set([125, 255, 75, Math.round(255 * Math.max(0, 1 - radius) ** 2.5)], (y * size + x) * 4);
    }
    const map = new THREE.DataTexture(pixels, size, size); map.needsUpdate = true;
    this.glow = new THREE.SpriteMaterial({map, color: 0x61ff35, transparent: true, opacity: .5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
  }

  create(kind) {
    const template = this.templates.get(kind);
    if (!template) throw new Error(`Power-up model not loaded: ${kind}`);
    const mesh = new THREE.Group(), core = new THREE.Group();
    core.add(template.clone(true)); mesh.add(core);
    const aura = new THREE.Sprite(this.glow); aura.scale.set(66, 66, 1); mesh.add(aura);
    const motes = Array.from({length: 6}, () => {
      const mote = new THREE.Sprite(this.glow); mote.scale.set(7, 7, 1); mesh.add(mote); return mote;
    });
    mesh.name = `powerup_${kind}`; mesh.userData.model = template.name;
    return {mesh, core, aura, motes};
  }

  animate(p) {
    p.aura.scale.setScalar(66 + Math.sin(p.age * 3) * 5);
    p.motes.forEach((mote, i) => {
      const angle = p.age * 1.4 + i * 2.4;
      mote.position.set(Math.cos(angle) * (12 + i % 3 * 3), (p.age * 20 + i * 9) % 50 - 25, Math.sin(angle) * (12 + i % 3 * 3));
    });
  }
}
