import * as THREE from 'three';

// Original recordings where available, with synthesized cues for other actions.
export class AudioCues {
  buffers = new Map();
  voices = new Set();
  played = new Map();
  volume = 1;
  contextForLoading() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain(); this.master.gain.value = this.volume; this.master.connect(this.context.destination);
    }
    return this.context;
  }
  setVolume(volume) { this.volume = volume; if (this.master) this.master.gain.value = volume; }
  async load(name, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sound ${url}: HTTP ${response.status}`);
    const buffer = await this.contextForLoading().decodeAudioData(await response.arrayBuffer());
    this.buffers.set(name, buffer);
  }
  unlock() {
    this.unlocked = true;
    this.contextForLoading();
    return this.setPaused(false);
  }
  setPaused(paused) {
    if (!this.context || !this.unlocked) return Promise.resolve();
    return (paused ? this.context.suspend() : this.context.resume()).catch(() => {});
  }
  reset() {
    for (const voice of this.voices) { voice.stop(); voice.disconnect(); }
    this.voices.clear(); this.played.clear();
  }
  play(kind, volume = 1) {
    const c = this.context;
    if (!c) return;
    // A sound with numbered variants (knife_swing_0, _1, ...) plays one of them at random.
    if (!this.buffers.has(kind) && this.buffers.has(kind + '_0')) {
      let count = 0; while (this.buffers.has(`${kind}_${count}`)) count++;
      this.played.set(kind, (this.played.get(kind) ?? 0) + 1);
      kind = `${kind}_${Math.floor(Math.random() * count)}`;
    }
    if (this.buffers.has(kind)) {
      const source = c.createBufferSource(), gain = c.createGain();
      source.buffer = this.buffers.get(kind);
      gain.gain.value = .55 * volume;
      source.connect(gain).connect(this.master);
      this.voices.add(source);
      this.played.set(kind, (this.played.get(kind) ?? 0) + 1);
      source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source); };
      source.start();
      return;
    }
    if (c.state !== 'running') return;
    const [frequency, end, duration, loudness] = {
      fire: [130, 35, .09, .12], hit: [650, 180, .055, .04], melee: [180, 60, .16, .07],
      explosion: [65, 20, .55, .2], reload: [380, 160, .08, .04], mechanism: [550, 220, .035, .025],
      buy: [440, 880, .24, .06], deny: [170, 100, .18, .05], pickup: [660, 1320, .3, .06],
      round: [180, 420, .7, .07], hurt: [90, 45, .2, .08], flame: [95, 55, .24, .05], dry_fire: [900, 500, .03, .03],
    }[kind] ?? [440, 660, .1, .04];
    const oscillator = c.createOscillator(), gain = c.createGain();
    oscillator.type = ['fire', 'explosion', 'melee', 'flame'].includes(kind) ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, c.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(end, c.currentTime + duration);
    gain.gain.setValueAtTime(loudness * volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, c.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(); oscillator.stop(c.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}

export class Effects {
  constructor(scene) { this.scene = scene; this.items = []; }
  burst(position, color = 0xffce67, count = 10, size = 1.5, speed = 60, life = .4) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({color, transparent: true, depthWrite: false}));
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.items.push({mesh, velocity: new THREE.Vector3(Math.random() - .5, Math.random(), Math.random() - .5).multiplyScalar(speed), life, total: life});
    }
  }
  tracer(a, b) {
    const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({color: 0xffdb85, transparent: true, opacity: .6, depthWrite: false}));
    this.scene.add(mesh);
    this.items.push({mesh, life: .045, total: .045});
  }
  remove(item) { item.mesh.removeFromParent(); item.mesh.geometry.dispose(); item.mesh.material.dispose(); this.items.splice(this.items.indexOf(item), 1); }
  update(dt) {
    for (const item of [...this.items]) {
      item.life -= dt;
      if (item.life <= 0) { this.remove(item); continue; }
      item.mesh.material.opacity = item.life / item.total;
      if (item.velocity) { item.velocity.y -= dt * 130; item.mesh.position.addScaledVector(item.velocity, dt); }
    }
  }
  clear() { for (const item of [...this.items]) this.remove(item); }
}

export function label(text, color = '#fff1a6', width = 100) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12151ce8'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 28px system-ui';
  ctx.fillText(text, 256, 64, 490);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthWrite: false}));
  sprite.scale.set(width, width / 4, 1);
  return sprite;
}

export function disposeObject(root) {
  root.removeFromParent();
  root.traverse(o => { o.geometry?.dispose(); for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) { m.map?.dispose(); m.dispose(); } });
}
