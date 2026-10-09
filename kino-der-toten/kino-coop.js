import * as THREE from 'three';
import { COOP_URL } from './coop-config.js';
import { PROTOCOL, CODE_PATTERN, playerName } from './coop-protocol.js';
import { packSession, unpackSession, scaleRound, updateRevives } from './kino-coop-state.js';
import { disposeSkeletons } from './runtime-assets.js';
import { loadSurvivors, SurvivorAvatar } from './kino-survivor.js';

const $ = id => document.getElementById(id);
const colors = [0x78b8de, 0xe7be61, 0x8ec78e, 0xcd91cb];
const emptyInput = () => ({ forward: 0, strafe: 0, yaw: 0, pitch: 0 });

export class KinoCoop {
  constructor(api) {
    this.api = api; this.actors = new Map(); this.avatars = new Map(); this.props = new Map(); this.effects = new Map();
    this.players = []; this.running = false; this.connected = false; this.input = emptyInput(); this.accumulator = 0; this.seq = 0;
    $('start').insertAdjacentHTML('afterend', `<button id="coop-open" class="secondary" disabled>PLAY WITH FRIENDS</button>
      <section id="coop-panel" hidden aria-label="Friends lobby">
        <h2>Survive together</h2><p class="coop-help">Invite up to three friends with a room code.</p>
        <div id="coop-connect"><label for="coop-name">Your name</label><input id="coop-name" maxlength="20" autocomplete="nickname" placeholder="Survivor">
        <button id="coop-host">CREATE ROOM</button><div class="coop-join"><input id="coop-code" aria-label="Room code" maxlength="6" placeholder="ROOM CODE" autocomplete="off" autocapitalize="characters"><button id="coop-join">JOIN</button></div></div>
        <div id="coop-room" hidden><div class="coop-room-code">ROOM <strong id="coop-room-code"></strong><button id="coop-copy">COPY INVITE</button></div>
        <ul id="coop-roster"></ul><button id="coop-ready">READY</button><button id="coop-start" hidden>START CO-OP</button></div>
        <p id="coop-status" role="status" aria-live="polite"></p><button id="coop-leave" class="secondary">BACK TO SOLO</button>
      </section><button id="coop-exit" class="secondary" hidden>LEAVE CO-OP</button>`);
    document.body.insertAdjacentHTML('beforeend', '<div id="coop-team" hidden></div><div id="coop-notice" hidden role="status"></div>');
    $('coop-code').value = new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 6) || '';
    try { $('coop-name').value = localStorage.getItem('kino.coop.name') || ''; } catch {}
    $('coop-open').onclick = () => { $('coop-panel').hidden = false; $('coop-open').hidden = true; $('start').hidden = true; };
    $('coop-host').onclick = () => this.connect(true);
    $('coop-join').onclick = () => this.connect(false);
    $('coop-code').onkeydown = e => { if (e.key === 'Enter') this.connect(false); };
    $('coop-ready').onclick = () => this.send({ type: 'ready', ready: !this.players.find(p => p.id === this.id)?.ready });
    $('coop-start').onclick = () => this.send({ type: 'start' });
    $('coop-leave').onclick = () => this.leave();
    $('coop-exit').onclick = () => this.leave();
    $('coop-copy').onclick = async () => {
      const url = new URL(location.href); url.search = ''; url.searchParams.set('room', this.code);
      try { await navigator.clipboard.writeText(url.href); this.status('Invite link copied.'); }
      catch { this.status('Share room code ' + this.code + ' with your friends.'); }
    };
    addEventListener('pagehide', () => { this.socket?.close(1000, 'Page closed'); });
    this.heartbeat = setInterval(() => {
      if (!this.connected) return;
      if (performance.now() - this.lastMessage > 15000) { this.leave('Connection lost. Create or join a new room.'); return; }
      this.send({ type: 'ping', at: performance.now() });
    }, 3000);
  }
  get isHost() { return this.connected && this.id === 'host'; }
  get isClient() { return this.connected && this.id !== 'host'; }
  status(text) { $('coop-status').textContent = text; }
  ready() { $('coop-open').disabled = false; if ($('coop-code').value) $('coop-open').click(); }
  async connect(host) {
    if (this.socket || this.connecting || !this.api.get().ready) return;
    const code = $('coop-code').value.trim().toUpperCase();
    if (!host && !CODE_PATTERN.test(code)) { this.status('Enter the six-character room code.'); return; }
    if (!COOP_URL && !['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.protocol === 'https:') {
      this.status('Online rooms are not configured for this build yet.'); return;
    }
    const url = new URL(COOP_URL || location.origin);
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'; url.pathname = '/coop/connect'; url.search = '';
    const name = playerName($('coop-name').value);
    url.searchParams.set('name', name); url.searchParams.set('v', PROTOCOL); url.searchParams.set(host ? 'host' : 'room', host ? '1' : code);
    try { localStorage.setItem('kino.coop.name', name); } catch {}
    const attempt = {}; this.connecting = attempt;
    this.status('Loading survivors…'); $('coop-host').disabled = $('coop-join').disabled = true;
    try { this.survivors = await loadSurvivors(); }
    catch (error) { if (this.connecting === attempt) this.leave('Could not load the survivors. Please try again.'); console.error(error); return; }
    if (this.connecting !== attempt) return;
    this.connecting = null;
    this.status(host ? 'Creating room…' : 'Joining room…'); $('coop-host').disabled = $('coop-join').disabled = true;
    const socket = this.socket = new WebSocket(url); this.failure = '';
    const timeout = setTimeout(() => { if (!this.connected && this.socket === socket) this.leave('Could not reach the room service. Please try again.'); }, 12000);
    socket.onmessage = e => {
      if (this.socket !== socket) return;
      this.lastMessage = performance.now();
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'welcome') {
        clearTimeout(timeout); this.id = m.id; this.code = m.code; this.connected = true;
        $('coop-connect').hidden = true; $('coop-room').hidden = false; $('coop-room-code').textContent = this.code; this.status('Everyone must be ready before the host starts.');
      } else if (m.type === 'roster') {
        this.players = m.players; this.renderLobby();
        if (this.running && this.isHost) for (const [id, actor] of this.actors) if (!this.players.some(p => p.id === id)) { this.api.removeActor(actor); this.actors.delete(id); }
      } else if (m.type === 'start') this.begin();
      else if (m.type === 'input' || m.type === 'action') {
        if (!this.isHost || !this.running) return;
        const actor = this.actors.get(m.from); if (!actor) return;
        actor.input = m.input; actor.inputAt = performance.now(); actor.seq = m.seq;
        actor.camera.rotation.set(m.input.pitch, m.input.yaw, 0);
        if (m.type === 'action' && !actor.session.downed && !actor.session.dead) this.api.action(actor, m.action, m.value);
      } else if (m.type === 'state' && this.isClient && this.running) this.receiveState(m.state);
      else if (m.type === 'event' && this.isClient) this.api.event(m.event);
      else if (m.type === 'pong') this.ping = Math.round(performance.now() - m.at);
      else if (m.type === 'error') { this.failure = m.message; this.status(m.message); }
      else if (m.type === 'ended') this.leave(m.message);
    };
    socket.onclose = e => { clearTimeout(timeout); if (this.socket === socket) this.leave(this.failure || (e.reason==='Host left'?'The host left. Create or join a new room.':'Disconnected. Create or join a new room.')); };
    socket.onerror = () => { this.failure ||= 'Could not reach the room service. Please try again.'; };
  }
  send(message) { if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 256 * 1024) this.socket.send(JSON.stringify(message)); }
  renderLobby() {
    $('coop-roster').replaceChildren(...this.players.map((p, i) => { const row = document.createElement('li'); row.textContent = `${p.name}${p.id === 'host' ? ' · HOST' : ''}${p.id === this.id ? ' · YOU' : ''} — ${p.ready ? 'READY' : 'NOT READY'}`; row.style.borderLeftColor = '#' + colors[i].toString(16); return row; }));
    $('coop-ready').textContent = this.players.find(p => p.id === this.id)?.ready ? 'NOT READY' : 'READY';
    $('coop-start').hidden = !this.isHost; $('coop-start').disabled = this.players.length < 2 || !this.players.every(p => p.ready);
  }
  begin() {
    this.api.reset(); this.running = true; this.accumulator = 0; this.lastRound = 1; this.snapshotAt = performance.now();
    this.characters = new Map(this.players.map((p, i) => [p.id, i]));
    const local = this.api.get(); local.session.coop = true;
    this.local = { id: this.id, session: local.session, player: local.player, camera: local.camera, features: local.features, input: this.input };
    if (this.isHost) {
      this.actors.set('host', this.local);
      this.players.forEach((p, i) => { if (p.id !== this.id) this.actors.set(p.id, this.api.createActor(p.id, i)); });
      scaleRound(local.session, this.players.length);
    }
    $('coop-panel').hidden = true; $('coop-open').hidden = true; $('start').hidden = false; $('coop-team').hidden = false; $('coop-exit').hidden = false;
    this.api.begin();
  }
  leave(message = '') {
    this.connecting = null;
    const socket = this.socket; this.socket = null; socket?.close(1000, 'Left room');
    const hadGame = this.running; this.running = false; this.connected = false; this.id = null;
    for (const a of this.actors.values()) if (a !== this.local) this.api.removeActor(a);
    this.actors.clear(); this.clearModels();
    if (hadGame) { this.api.get().session.coop = false; this.api.reset(); this.api.end(); }
    $('coop-connect').hidden = false; $('coop-room').hidden = true; $('coop-team').hidden = true; $('coop-notice').hidden = true; $('coop-exit').hidden = true;
    $('coop-host').disabled = $('coop-join').disabled = false; $('start').hidden = !!message; $('coop-open').hidden = !!message; $('coop-panel').hidden = !message;
    this.status(message); this.players = []; this.snapshot = null;
  }
  setInput(input) { this.input = { ...input }; if (this.local) this.local.input = this.input; }
  action(name, value) {
    if (!this.running || !this.isClient) return false;
    const { camera } = this.api.get();
    this.send({ type: 'action', action: name, value, seq: ++this.seq, input: { ...this.input, yaw: camera.rotation.y, pitch: camera.rotation.x } }); return true;
  }
  event(event, to) { if (this.isHost) this.send({ type: 'event', event, to }); }
  targets() { return [...this.actors.values()].filter(a => !a.session.downed && !a.session.dead).map(a => ({ id: a.id, position: a.player.getFeetPosition() })); }
  beforeHost(dt) {
    for (const actor of this.actors.values()) if (actor !== this.local) {
      if (performance.now() - (actor.inputAt || 0) > 500) actor.input = emptyInput();
      this.api.updateActor(actor, dt);
    }
  }
  afterHost(dt) {
    const { session, world, powerups } = this.api.get();
    const actors = [...this.actors.values()];
    updateRevives(actors, dt, (a,b) => world.lineClear(a,b));
    for (const p of [...powerups.items]) if (actors.some(a => !a.session.downed && !a.session.dead && a.player.getFeetPosition().distanceTo(p.root.position) < 64 && world.lineClear(a.camera.position, p.root.position))) {
      powerups.remove(p); powerups.burst(p.root.position); this.api.collect(p.type);
    }
    if (session.round !== this.lastRound) {
      this.lastRound = session.round; scaleRound(session, actors.length);
      for (const actor of actors) {
        if (actor !== this.local) { actor.session.grenades = Math.min(4, actor.session.grenades + 2); if (actor.session.claymoresOwned) actor.session.claymores = 2; }
        if (actor.session.dead) this.api.respawnActor(actor);
      }
    }
    this.accumulator += dt;
    if (this.accumulator >= .05) { this.accumulator %= .05; this.send({ type: 'state', state: this.capture() }); }
    this.drawPlayers(dt, actors.map(a => this.playerState(a))); this.team(actors.map(a => this.playerState(a)));
  }
  playerState(a) {
    return { id: a.id, name: this.players.find(p => p.id === a.id)?.name || 'Survivor', character: this.characters.get(a.id), feet: a.player.getFeetPosition().toArray(), velocity: [a.player.velocity.x, a.player.velocity.z], crouched: a.player.crouched, ads: !!a.input?.ads, rotation: [a.camera.rotation.x, a.camera.rotation.y], session: packSession(a.session), teleport: a.teleport || 0, events: a.features.events.snapshot() };
  }
  capture() {
    const g = this.api.get();
    return { players: [...this.actors.values()].map(a => this.playerState(a)), enemies: [...g.enemies.list, ...g.enemies.dead].map(z => ({ id: z.id, kind: z.kind, health: z.health, state: z.state, position: z.root.position.toArray(), yaw: z.root.rotation.y, animation: z.rig.current })),
      boards: g.world.barriers.map(b => [b.id, b.count]), pickups: g.powerups.items.map(p => ({ id: p.netId, type: p.type, position: p.root.position.toArray(), age: p.age })),
      boxes: g.mysteryBox.snapshot(), activeBox: g.world.activeBox.id, boxMoves: g.mysteryBox.moves, extras: this.api.captureExtras(),
      props: [...this.actors.values()].flatMap(a => [...a.features.projectiles, ...a.features.mines].map(p => ({ id: p.netId ||= `prop-${this.propSerial=(this.propSerial||0)+1}`, url: p.def.projectileModel, position: p.mesh.position.toArray(), rotation: p.mesh.quaternion.toArray() }))) };
  }
  receiveState(state) {
    const me = state?.players?.find(p => p.id === this.id); if (!me) return;
    const g = this.api.get(), oldWeapon = g.session.weapon.id + ':' + g.session.weapon.upgraded + ':' + g.session.attachmentMode, oldDrink = g.session.drinking;
    unpackSession(g.session, me.session);
    if (oldWeapon !== g.session.weapon.id + ':' + g.session.weapon.upgraded + ':' + g.session.attachmentMode) this.api.equip();
    if (g.session.drinking && g.session.drinking !== oldDrink) this.api.drink();
    const target = new THREE.Vector3(...me.feet);
    if (this.teleport !== me.teleport || target.distanceTo(g.player.getFeetPosition()) > 85) {
      g.player.setPosition(target);
      if(this.teleport!==me.teleport){g.camera.rotation.set(me.rotation[0],me.rotation[1],0);this.input.yaw=me.rotation[1];this.input.pitch=me.rotation[0];}
      this.teleport = me.teleport;
    }
    // Correct small drift once stopped; larger errors and teleports snap above.
    if(!this.input.forward&&!this.input.strafe&&!this.input.jump&&target.distanceTo(g.player.getFeetPosition())>4)g.player.setPosition(g.player.getFeetPosition().lerp(target,.35));
    this.snapshot = state; this.snapshotAt = performance.now();
    const doorState=JSON.stringify([g.session.power,[...g.session.openDoors]]);
    if(this.doorState!==doorState){this.doorState=doorState;g.world.setDoors(g.session);}
    this.api.applyExtras(state.extras, me.events);
    this.syncExtras(state.extras);
    const packOwner=state.players.find(p=>p.session.pack),pack=packOwner?.session.pack;
    g.features.remotePack=pack?{weapon:packOwner.session.inventory[pack.slot],readyAt:pack.readyAt,expires:pack.expires}:null;
    for (const [id, count] of state.boards) { const b = g.world.barriers.find(b => b.id === id); if (b && b.count !== count) g.world.setBoards(b, count); }
    const ids = new Set(state.enemies.map(z => z.id));
    for (const z of [...g.enemies.list]) if (!ids.has(z.id)) g.enemies.remove(z);
    for (const z of [...g.enemies.dead]) if (!ids.has(z.id)) {z.root.removeFromParent();z.rig.mixer.uncacheRoot(z.root);disposeSkeletons(z.root);g.enemies.dead.splice(g.enemies.dead.indexOf(z),1);}
    for (const p of state.enemies) {
      let z = [...g.enemies.list,...g.enemies.dead].find(z => z.id === p.id);
      if (!z) { z = g.enemies.spawn(new THREE.Vector3(...p.position), null, p.kind); z.id = p.id; g.session.spawned--; }
      if(p.state==='dead'&&g.enemies.list.includes(z)){g.enemies.list.splice(g.enemies.list.indexOf(z),1);g.enemies.dead.push(z);}
      z.health = p.health; z.state = p.state; z.targetPosition = new THREE.Vector3(...p.position); z.root.rotation.y = p.yaw;
      z.rig.play(p.animation || 'walk', p.state !== 'dead');
    }
    for (const p of [...g.powerups.items]) if (!state.pickups.some(i => i.id === p.netId)) g.powerups.remove(p);
    for (const p of state.pickups) { let item = g.powerups.items.find(i => i.netId === p.id); if (!item) { item = g.powerups.spawn(p.type, new THREE.Vector3(...p.position).add(new THREE.Vector3(0,-40,0))); item.netId = p.id; } item.age = p.age; }
    g.world.activeBox = g.world.boxLocations.find(e => e.id === state.activeBox) || g.world.activeBox; g.world.fireSale = g.session.effects.fire_sale > g.session.time; g.mysteryBox.moves = state.boxMoves;
    g.world.openBoxes.clear();
    for (const p of state.boxes) {
      const b = g.mysteryBox.boxes.get(p.id); if (!b) continue;
      b.roll = p.roll; b.opening = p.open * .5; if (p.open > 0) g.world.openBoxes.add(p.id);
      if (p.shown) g.mysteryBox.show(b, p.shown); else if (b.shown) { b.wrapper?.removeFromParent(); disposeSkeletons(b.model); b.wrapper = b.model = b.shown = null; }
      if (b.wrapper) b.wrapper.position.y = 40;
      const t = p.open; b.lid.quaternion.copy(b.closed).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), t*t*(3-2*t)*105*Math.PI/180)); b.glow.material.opacity = t*.2;
    }
    g.world.updateBox();
    for (const [id, mesh] of this.props) if (!state.props.some(p => p.id === id)) { mesh.removeFromParent(); disposeSkeletons(mesh); this.props.delete(id); }
    for (const p of state.props) { let mesh = this.props.get(p.id); if (!mesh) { mesh = g.features.model(p.url); g.scene.add(mesh); this.props.set(p.id, mesh); } mesh.position.fromArray(p.position); mesh.quaternion.fromArray(p.rotation); }
  }
  updateClient(dt) {
    const g = this.api.get();
    this.accumulator += dt;
    if (this.accumulator >= .05) { this.accumulator %= .05; this.send({ type: 'input', seq: ++this.seq, input: this.input }); }
    if (!this.snapshot) return;
    const waiting=performance.now() - this.snapshotAt > 2000;
    if (performance.now() - this.snapshotAt > 12000) { this.leave('The host stopped responding. Create or join a new room.'); return; }
    for (const z of [...g.enemies.list,...g.enemies.dead]) { if (z.targetPosition) z.root.position.lerp(z.targetPosition, 1-Math.exp(-dt*18)); z.rig.update(dt); }
    g.powerups.update(dt, g.player.getFeetPosition(), false); g.features.present(dt); this.drawPlayers(dt, this.snapshot.players); this.team(this.snapshot.players);
    if(waiting){$('coop-notice').hidden=false;$('coop-notice').textContent='Waiting for the host…';}
  }
  syncExtras(extras){
    const g=this.api.get(),desired=[];
    for(const t of extras.traps)if(t.end>g.session.time)desired.push({id:'trap-'+t.name,kind:'trap',position:t.position});
    for(const [i,t]of extras.gas.entries())desired.push({id:'gas-'+i,kind:'gas',position:[t.position[0],t.position[1]+28,t.position[2]],life:t.life});
    for(const t of extras.grenades)desired.push({id:'grenade-'+t.id,kind:'grenade',position:t.position});
    for(const [id,mesh]of this.effects)if(!desired.some(t=>t.id===id)){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();this.effects.delete(id);}
    for(const t of desired){
      let mesh=this.effects.get(t.id);
      if(!mesh){
        const geometry=t.kind==='trap'?new THREE.CylinderGeometry(60,60,100,12,1,true):t.kind==='gas'?new THREE.SphereGeometry(75,12,8):new THREE.SphereGeometry(3.5,8,6);
        const material=new THREE.MeshBasicMaterial({color:t.kind==='trap'?0x8cbbff:t.kind==='gas'?0x8ca345:0x4a5039,transparent:t.kind!=='grenade',opacity:t.kind==='trap'?.24:t.kind==='gas'?.14:1,wireframe:t.kind==='trap'});
        mesh=new THREE.Mesh(geometry,material);if(t.kind==='gas')mesh.scale.set(1.65,.6,1.65);g.scene.add(mesh);this.effects.set(t.id,mesh);
      }
      mesh.position.fromArray(t.position);if(t.kind==='gas')mesh.material.opacity=.14*Math.min(1,t.life/2);
    }
    for(const t of extras.turrets){const e=g.data?.entities.find(e=>e.id===t.id),gun=e&&g.data.entities.find(n=>n.targetname===e.target&&n.classname==='misc_turret'),mesh=g.world.entities.get(gun?.id);if(mesh&&Number.isFinite(t.yaw))mesh.rotation.y=t.yaw;}
  }
  avatar(p) {
    const index = p.character ?? this.characters.get(p.id) ?? 0;
    const avatar = new SurvivorAvatar(this.survivors, index, p.name, colors[index % colors.length], this.api.get().data);
    avatar.root.position.fromArray(p.feet);
    this.api.get().scene.add(avatar.root); this.avatars.set(p.id, avatar); return avatar;
  }
  drawPlayers(dt, players) {
    for (const [id, mesh] of this.avatars) if (!players.some(p=>p.id===id)) { this.disposeAvatar(mesh); this.avatars.delete(id); }
    for (const p of players) if (p.id !== this.id) {
      const avatar = this.avatars.get(p.id) || this.avatar(p), mesh = avatar.root, target = new THREE.Vector3(...p.feet);
      if (mesh.position.distanceTo(target)>150) mesh.position.copy(target); else mesh.position.lerp(target,1-Math.exp(-dt*20));
      avatar.update(dt, p);
    }
  }
  team(players) {
    $('coop-team').replaceChildren(...players.map((p,i)=>{const row=document.createElement('div');row.style.color='#'+colors[(p.character??i)%4].toString(16);row.textContent=`${p.name}${p.id===this.id?' (you)':''} · ${p.session.dead?'OUT':p.session.downed?'DOWN — '+Math.max(0,Math.ceil(p.session.bleedUntil-p.session.time))+'s':Math.ceil(p.session.health)+' HP'} · ${p.session.points}`;return row;}));
    const s=this.api.get().session;
    const text=s.phase==='gameover'?'Everyone is down. Leave the room to start a new game.':s.dead?'You bled out. You return next round.':s.downed?'You are down! '+(s.reviveProgress>0?'Being revived… '+Math.round(s.reviveProgress/3*100)+'%':'A teammate can hold USE to revive you.'):'';
    $('coop-notice').hidden=!text;$('coop-notice').textContent=text;
    $('coop-team').dataset.room=this.code;
    if(s.phase==='gameover')this.api.gameover();
  }
  disposeAvatar(avatar) { avatar.dispose(); }
  clearModels() { for(const mesh of this.avatars.values())this.disposeAvatar(mesh);this.avatars.clear();for(const mesh of this.props.values()){mesh.removeFromParent();disposeSkeletons(mesh);}this.props.clear();for(const mesh of this.effects.values()){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}this.effects.clear(); }
  debug() {return {connected:this.connected,running:this.running,host:this.isHost,id:this.id,code:this.code,players:this.players,ping:this.ping,avatars:[...this.avatars].map(([id,a])=>({id,...a.debug()})),actors:this.isHost?[...this.actors.values()].map(a=>this.playerState(a)):this.snapshot?.players??[]};}
}
