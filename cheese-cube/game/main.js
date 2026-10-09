import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCollisionWorld } from '../collision-world.js';
import { PlayerController } from '../player-controller.js';
import { optimizeStaticScene } from '../scene-optimizer.js';
import { Assets } from './assets.js';
import { World } from './world.js';
import { Zombies } from './zombies.js';
import { Weapons, verticalFov, spreadOnScreen } from './weapons.js';
import { AudioCues, Effects } from './effects.js';
import { Combat } from './combat.js';
import { Machines } from './machines.js';
import { CheeseQuest } from './cheese-quest.js';
import { WaterSurface } from './water.js';
import { installVibe } from './vibe-adapter.js';
import { CheeseCoop } from './coop.js';
import { RemoteArsenal, packArsenal } from './coop-arsenal.js';
import { NativeHud } from './hud.js';
import { ZombiesMenu } from './menu.js';
import { GameOver, GAME_OVER_EXIT } from './game-over.js';
import { PadControls } from './controller.js';

const map = new URLSearchParams(location.search).get('map') || document.body.dataset.map;
const agentMode = new URLSearchParams(location.search).has('agent');
const title = document.body.dataset.title || map, base = `./${map}`;
const $ = id => document.getElementById(id);
const hud = Object.fromEntries(['status','damage','center','help','help-status','debug','objective','hazard','fov','fov-value'].map(id => [id, $(id)]));
// `camera`, `player`, `weapons`, `playerState` and `session` belong to the acting survivor: the local player, or a
// co-op guest while the host runs that guest's action through the same rules (see withActor).
let camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 2, 60000);
camera.rotation.order = 'YXZ';
const localCamera = camera;
const scene = new THREE.Scene(), keys = new Set(), errors = [], sound = new AudioCues();
let renderer, data, game, world, player, zombies, weapons, assets, combat, effects, machines, quest, water, nativeHud, menu;
// Before the player first enters a match the menu is the Zombies frontend; afterwards it is the start menu.
let entered = false;
let active = false, ready = false, resetting = false, generation = 0;
// A controller plays without capturing the mouse (web/game/controller.js); `active` is true for either.
let controls = null, padPlaying = false;
// The end-of-match sequence (game-over.js): {won, round, solo, time, nextKill} while it runs.
let gameOver = null, intermission = null;
let fps = 0, mouseHeld = false, mousePressed = false, aiming = false, time = 0, useHeld = 0, useTarget = null, useConsumed = false;
let centerLeft = 0, previousGrounded = true, fallSpeed = 0, promptText = '', promptProgress = 0;
const matchSession = {round: 0, phase: 'starting', total: 0, spawned: 0, killed: 0, kills: 0, points: 0, breakLeft: 0, headshots: 0, downs: 0, revives: 0};
let session = matchSession;
let playerState = {health: 100, maxHealth: 100, regen: 0, sinceHit: 99, veryHurt: false, down: false, perks: new Set(), revives: 0, dead: false, reviveLeft: 0, invulnerable: 0, grenades: 0, purchasing: false, bleed: 0, reviveProgress: 0, penalty: 0};
// Co-op (Kino's design, web/game/coop.js). Black Ops III: 45-second bleed-out, 3-second revive, halved by Quick Revive.
let coop = null, remoteActor = null, localActor = null, localActionAt = 0, arsenalRev = -1;
const BLEEDOUT_SECONDS = 45, REVIVE_SECONDS = 3, REVIVE_RANGE = 75;
// World sounds everyone hears; purchases, perk drinks and hits stay with the survivor who caused them.
const TEAM_SOUNDS = new Set(['round', 'explosion', 'pickup', 'powerup_spawn', 'powerup_grab', 'powerup_maxammo', 'powerup_instakill', 'powerup_nuke', 'powerup_double_off',
  'power_on', 'box_open', 'box_music', 'box_close', 'pap_upgrade', 'pap_ready', 'sting_specialty_packapunch']);
const fxLog = [];
const online = () => Boolean(coop?.running);
const selfId = () => remoteActor?.id ?? coop?.localId ?? 'solo';
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const vec = v => [r1(v.x), r1(v.y), r1(v.z)];
const playSound = sound.play.bind(sound);
// Team cues reach everyone; a guest's personal cues are sent to that guest instead of the host's speakers.
sound.play = (kind, volume) => {
  if (coop?.isHost) {
    if (TEAM_SOUNDS.has(kind)) coop.event({type: 'sound', kind});
    else if (remoteActor) { coop.event({type: 'sound', kind}, remoteActor.id); return; }
  }
  playSound(kind, volume);
};

function reportError(error) { errors.push(String(error)); console.error(error); displayCenter(error.message || String(error), 4); }
function displayCenter(text, seconds = 2) { hud.center.classList.remove('ending'); hud.center.textContent = keyNames(text); hud.center.hidden = false; centerLeft = seconds; }
/** A message for the acting survivor. */
function showCenter(text, seconds = 2) {
  if (remoteActor) { coop.event({type: 'center', text, seconds}, remoteActor.id); return; }
  displayCenter(text, seconds);
}
/** A message for the whole team: rounds, objectives, power-ups. */
function notice(text, seconds = 2) {
  if (coop?.isHost) coop.event({type: 'center', text, seconds});
  displayCenter(text, seconds);
}
/** player_add_points: earnings are rounded up to 10, then doubled under Double Points, and count toward drops. */
function addPoints(n, {raw = false} = {}) {
  // Quest rewards (add_to_player_score) are not doubled.
  const amount = n > 0 ? Math.ceil(n / 10) * 10 * (raw ? 1 : combat?.multiplier ?? 1) : Math.round(n);
  session.points += amount;
  if (amount > 0) combat?.earn(amount);
  if (!remoteActor) popPoints(amount);
}
function popPoints(amount) { nativeHud?.points(amount); }
// The stock hitmarker (damagefeedback.gsc): every hit on a zombie shows it; the alert sounds except for melee and
// grenade splash, at most once every 0.05 s.
let hitAlertAt = -1;
function showHit(alert) {
  nativeHud?.hit();
  const now = performance.now() / 1000;
  if (alert && now - hitAlertAt >= .05) { hitAlertAt = now; playSound('hit_alert', .6); }
}
function hitFeedback(killed = false, {alert = true} = {}) {
  if (remoteActor) { coop.event({type: 'hit', killed, alert}, remoteActor.id); return; }
  showHit(alert);
}
/** Where a hit came from, relative to the view: 0 ahead, positive to the right. */
function hitAngle(from) {
  const feet = player.getFeetPosition(), dx = from.x - feet.x, dz = from.z - feet.z, yaw = camera.rotation.y;
  return Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw));
}
function survivorStates() { return online() ? coop.actorList().map(a => a.playerState) : [playerState]; }
function startRound(round) {
  const players = online() ? coop.actorList().length : 1;
  session.round = round; session.total = zombies.countFor(round, players); session.spawned = session.killed = 0; session.phase = 'fighting';
  // The first zombie comes about 5 s after the player gets control in round 1, and 2.5 s after the round starts later.
  zombies.nextSpawn = round === 1 ? Math.max(0, game.rules.firstSpawn - 1.5) : game.rules.preRound;
  combat.roundStart();
  // Grenades at every round start, the first included: 0 -> 2, 1 -> 3, 2 or more -> 4. Downed survivors get none.
  for (const state of survivorStates()) if (!state.down && !state.dead) state.grenades = (state.grenades ?? 0) < 1 ? 2 : state.grenades < 2 ? 3 : 4;
  // The round counter's burn-in animation announces the round (hud.js); there is no on-screen text.
  sound.play('round');
}
function updateRounds(dt) {
  if (session.phase === 'fighting' && session.spawned >= session.total && zombies.list.length === 0 && !zombies.spawning) {
    session.phase = 'break'; session.breakLeft = game.rules.betweenRounds;
    // Survivors who bled out come back as the round ends.
    if (online()) for (const actor of coop.actorList()) if (actor.playerState.dead) respawn(actor);
  }
  if (session.phase === 'break') { session.breakLeft -= dt; if (session.breakLeft <= 0) startRound(session.round + 1); }
}
function losePerks() {
  playerState.perks.clear(); weapons.perks.clear();
  playerState.maxHealth = game.rules.playerHealth; playerState.health = Math.min(playerState.health, playerState.maxHealth);
  if (weapons.slots.length > 2) { weapons.slots.length = 2; if (weapons.index > 1) { weapons.index = 0; weapons.equip().catch(reportError); } weapons.rev = (weapons.rev ?? 0) + 1; }
}
function hurtPlayer(amount, {hazard = false, kill = false, from = null} = {}) {
  if (coop?.isClient) return;  // the host decides every survivor's health
  if (playerState.god || playerState.down || playerState.dead || (!hazard && playerState.invulnerable > 0)) return;
  if (from) { if (remoteActor) coop.event({type: 'hurt', from: vec(from)}, remoteActor.id); else nativeHud?.hurt(hitAngle(from)); }
  if (!remoteActor) controls?.rumble('hurt', amount / playerState.maxHealth);
  const wound = () => {
    playerState.health = Math.max(0, playerState.health - amount); playerState.sinceHit = 0; sound.play('hurt');
    if (playerState.health <= playerState.maxHealth * .2) playerState.veryHurt = true;
  };
  if (online()) {
    if (kill) { bleedOut(); return; }
    wound();
    if (playerState.health <= 0) goDown();
    return;
  }
  wound();
  if (playerState.health > 0) return;
  // Solo Quick Revive: down for 10 s with a pistol, then back up (zm wait_and_revive). Without it the game ends.
  if (!hazard && playerState.perks.has('specialty_quickrevive')) {
    Object.assign(playerState, {down: true, reviveLeft: game.rules.soloReviveTime}); playerState.revives++; session.downs++;
    losePerks(); clearInput(); weapons.lastStand(game.start, {solo: true}); showCenter('Reviving…', game.rules.soloReviveTime); return;
  }
  endGame(false);
}
// Co-op last stand: perks are lost and teammates have 45 seconds to revive. Bleeding out returns next round.
// Co-op last stand: 5% of your points go to whoever revives you; perks are lost and you fight on with a pistol.
function goDown() {
  const penalty = Math.ceil(session.points * game.rules.downedPenalty / 10) * 10;
  session.points -= penalty; session.downs++;
  Object.assign(playerState, {down: true, health: 0, bleed: BLEEDOUT_SECONDS, reviveProgress: 0, penalty});
  losePerks(); if (!remoteActor) clearInput();
  weapons.lastStand(game.start);
  notice(`${coop.name(selfId())} is down!`, 2);
}
function bleedOut() {
  Object.assign(playerState, {down: false, dead: true, health: 0, reviveProgress: 0, bleed: 0, penalty: 0});
  losePerks();
  if (!remoteActor) { clearInput(); player.setEnabled(false); }
  notice(`${coop.name(selfId())} bled out`, 2);
}
function revive(actor, reviver = null) {
  const penalty = actor.playerState.penalty ?? 0;
  withActor(actor, () => {
    Object.assign(playerState, {down: false, health: playerState.maxHealth, reviveProgress: 0, invulnerable: 2, sinceHit: 99, veryHurt: false, penalty: 0});
    weapons.endLastStand();
  });
  if (reviver) withActor(reviver, () => { if (penalty) addPoints(penalty); session.revives++; });
}
function respawn(actor) {
  withActor(actor, () => {
    // Respawned survivors carry no grenades until the next round's award; after round 6 they have at least 1500 points.
    Object.assign(playerState, {dead: false, down: false, health: game.rules.playerHealth, maxHealth: game.rules.playerHealth, sinceHit: 99, veryHurt: false, invulnerable: 3, grenades: 0, reviveProgress: 0, purchasing: false, penalty: 0});
    if (session.round > 6 && session.points < 1500) session.points = 1500;
    playerState.perks.clear(); weapons.reset(); weapons.give(game.start).catch(reportError);
    const mate = coop.actorList().find(a => a !== actor && !a.playerState.dead && !a.playerState.down);
    const spawn = data.spawns?.[actor.slot] ?? data.spawn;
    const feet = mate ? mate.player.getFeetPosition() : new THREE.Vector3(...spawn.position).add(new THREE.Vector3(0, 4, 0));
    if (actor.local) { player.setEnabled(true); player.setPosition(feet); }
    else { placeActor(actor, feet, false); actor.teleport++; }
    showCenter('You are back — next round', 2);
  });
}
function endGame(won) {
  if (online()) {
    if (['over', 'won'].includes(session.phase)) return;
    session.phase = won ? 'won' : 'over';
    coop.event({type: 'gameover', won, round: session.round}); finish(won, session.round); return;
  }
  playerState.dead = true; session.phase = won ? 'won' : 'over'; clearInput();
  beginIntermission(won, session.round, true);
  pauseGame();
}
function finish(won, round) { clearInput(); beginIntermission(won, round, false); pauseGame(); }
/** The scoreboard rows: every survivor in co-op, or the local player. */
function scoreboard() {
  if (online()) return (coop.isHost ? coop.actorList().map(describe) : coop.snapshot?.players ?? [])
    .map(p => ({name: coop.name(p.id), slot: coop.slot(p.id), points: p.points, kills: p.kills, downs: p.downs, revives: p.revives, headshots: p.headshots, local: p.id === coop.id}));
  return [{name: $('coop-name').value.trim() || 'Survivor', slot: 0, points: session.points, kills: session.kills, downs: session.downs, revives: session.revives, headshots: session.headshots, local: true}];
}
/** end_game(): the view moves to the map's intermission point, the zombies freeze, the text and the scoreboard come up. */
function beginIntermission(won, round, solo) {
  sound.reset(); round = Math.max(1, round);
  intermission = {won, round, solo, time: 0, nextKill: 5.25};
  const point = data.entities?.find(e => e.targetname === 'intermission');
  if (point) {
    const [pitch = 0, yaw = 0] = String(point.angles ?? '').split(/\s+/).map(Number);
    camera.position.fromArray(point.position); camera.rotation.set(-THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw) - Math.PI / 2, 0);
  }
  player.setEnabled(false);
  weapons.pivot.visible = weapons.props.visible = false;
  hud.center.hidden = true; centerLeft = 0;
  gameOver.show({won, round, map: title, players: scoreboard(), footer: solo ? '' : 'Leave co-op to play again'});
}
/** The world keeps running: frozen zombies die one at a time (zombie_game_over_death), then solo play exits to the lobby. */
function stepIntermission(dt) {
  const i = intermission;
  i.time += dt; time += dt;
  gameOver.update(dt); gameOver.setPlayers(scoreboard());
  if (i.time >= i.nextKill && zombies.list.length) { zombies.kill(zombies.list[Math.floor(Math.random() * zombies.list.length)]); i.nextKill = i.time + .5 + Math.random() * 2; }
  zombies.animateDead(dt); world.update(dt); water.update(time); effects.update(dt);
  quest.update(dt, [], {visual: true});
  updateHud();
  if (i.solo && i.time >= GAME_OVER_EXIT) { intermission = null; gameOver.hide(); reset().catch(reportError); }
}
/** The use key in prompts and notices ("Hold F to …"): F, or the controller's button (X, □…). */
const useKey = () => controls?.usingPad ? controls.glyph('use') : 'F';
const keyNames = text => controls?.usingPad ? String(text).replace(/\bF\b/g, useKey()) : text;

const ray = new THREE.Ray(), dir = new THREE.Vector3();
/** The gun's own report (the original sound from the map's bank), or the stand-in when it isn't loaded. */
function fireSound(slot) { const name = slot?.def.fireSound && `fire_${slot.def.fireSound}`; return name && sound.buffers.has(name) ? name : 'fire'; }
/** A Cheese Melter burst: every zombie in a 15° cone out to 400 units in sight burns (MOD_BURNED: 10 points at most
 *  every 0.5 s per zombie, 60 for the kill). The cone and range are reconstructed. */
function flame(slot) {
  camera.getWorldDirection(dir); camera.updateMatrixWorld();
  const origin = camera.position.clone(), cone = Math.cos(THREE.MathUtils.degToRad(15));
  if (coop?.isHost) fxLog.push(['s', selfId()]);
  if (!coop?.isClient) for (const z of [...zombies.list]) {
    const center = z.root.position.clone().add(new THREE.Vector3(0, 40, 0)), delta = center.clone().sub(origin), distance = delta.length();
    if (distance > 400 || delta.normalize().dot(dir) < cone || !world.lineClear(origin, center)) continue;
    const killed = zombies.damage(z, combat.buffs.instaKill > 0 ? z.health : slot.def.damage, {part: 'burn'});
    if (!killed && time - (z.burnPaid ?? -1) >= .5) { z.burnPaid = time; addPoints(game.rules.pointsHit); }
    hitFeedback(killed);
  }
  else { localActionAt = time; coop.action('shoot', {origin: vec(camera.position), ads: r2(weapons.ads)}); }
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  for (let i = 1; i <= 9; i++) {
    const at = origin.clone().addScaledVector(dir, 24 + i * 42).addScaledVector(right, 6 + (Math.random() - .5) * i * 7).addScaledVector(up, -7 + (Math.random() - .5) * i * 7);
    effects.burst(at, i < 3 ? 0xffe39a : i < 6 ? 0xffa23a : 0xff6a1a, 4, 3 + i * .9, 45, .3);
  }
}
function fire(slot) {
  if (slot.def.flame) { flame(slot); return; }
  if (!remoteActor) controls?.rumble('fire');
  camera.getWorldDirection(dir); camera.updateMatrixWorld();
  const isShotgun = /^shotgun_/.test(slot.def.name) && !/ksg/.test(slot.def.name);
  const pellets = isShotgun ? 8 : 1;
  const forward = dir.clone(), right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const muzzle = () => camera.position.clone().addScaledVector(right, 4).addScaledVector(up, -4).addScaledVector(forward, 15);
  if (coop?.isClient) {
    // Guests draw their own tracer at once; the host decides what the shot hits.
    ray.set(camera.position, forward);
    const wall = world.collision.rayIntersect(ray, 0, 8000), far = wall ? wall.distance : 8000, hit = zombies.rayHit(ray, far);
    effects.tracer(muzzle(), hit?.point ?? ray.at(far, new THREE.Vector3()));
    localActionAt = time; coop.action('shoot', {origin: vec(camera.position), ads: r2(weapons.ads)});
    return;
  }
  if (coop?.isHost) fxLog.push(['s', selfId()]);
  // Each bullet (or pellet) leaves inside the weapon's current spread cone, weighted toward the centre as in the game.
  const cone = Math.tan(THREE.MathUtils.degToRad(weapons.spread ?? 0));
  let questShot = false;
  for (let i = 0; i < pellets; i++) {
    const angle = Math.random() * Math.PI * 2, radius = Math.random() * cone;
    dir.copy(forward).addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius).normalize();
    ray.set(camera.position, dir);
    const wall = world.collision.rayIntersect(ray, 0, 8000), far = wall ? wall.distance : 8000;
    const hit = zombies.rayHit(ray, far);
    if (!questShot) questShot = quest.shoot(ray, hit ? hit.distance : far, slot.def);
    const end = hit?.point ?? ray.at(far, new THREE.Vector3());
    if (i === 0) effects.tracer(muzzle(), end);
    if (!hit) { if (wall) effects.burst(end, 0xf4c46a, 3, .6, 35, .2); continue; }
    let damage = weapons.damageAt(slot.def, hit.distance) / (isShotgun ? 4 : 1);
    if (hit.head) damage *= game.rules.headMultiplier;
    if (weapons.perks.has('specialty_doubletap2')) damage *= 2;
    if (combat.buffs.instaKill > 0) damage = hit.z.health;
    const killed = zombies.damage(hit.z, damage, {head: hit.head, part: hit.part});
    if (!killed) addPoints(game.rules.pointsHit); else if (hit.head) session.headshots++;
    hitFeedback(killed); effects.burst(hit.point, 0x932f22, 4, 1, 45, .25);
  }
}
/** Kill points by hit location (head 100, neck 70, torso 60, limbs 50, melee 130). Nuked zombies pay nothing but can
 *  still drop a power-up. Double Dew adds 100 for a headshot kill. */
function onKill(z, {head, melee, part = head ? 'head' : 'torso', nuke = false}) {
  if (!nuke) {
    const r = game.rules;
    session.kills++;
    addPoints(melee ? r.pointsMeleeKill : part === 'head' ? r.pointsHeadKill : part === 'neck' ? r.pointsNeckKill : part === 'torso' || part === 'burn' ? r.pointsTorsoKill : r.pointsKill);
    if (part === 'head' && !melee && playerState.perks.has('specialty_gpsjammer')) addPoints(100);
  }
  combat?.drop(z.root.position);
}

const QUICK_REVIVE = 'specialty_quickrevive';
function interactables() {
  const out = quest.interactables(name => weapons.has(name)), coopRules = online();
  for (const d of world.doors) if (!d.open) out.push({kind: 'door', item: d, position: d.position, radius: 100, text: `Hold F to open door [Cost: ${d.cost}]`, cost: d.cost});
  for (const w of world.wallbuys) {
    const owned = weapons.owned(w.weapon), cost = owned ? owned.def.upgraded ? 4500 : w.def.ammoCost : w.def.cost;
    out.push({kind: 'wallbuy', item: w, position: w.position, radius: 80, cost, text: owned ? owned.reserve >= owned.def.reserve ? `${owned.def.displayName} — ammo full` : `Hold F for ammo [Cost: ${cost}]` : `Hold F for ${w.def.displayName} [Cost: ${cost}]`});
  }
  // Co-op Quick Revive needs power and costs 1,500, with no solo use limit.
  // Solo Quick Revive can be bought three times; then the machine is gone (zm_perk_quick_revive solo_lives_given).
  for (const p of world.perks) if (!playerState.perks.has(p.perk) && !(p.perk === QUICK_REVIVE && !coopRules && (playerState.qrBought ?? 0) >= game.rules.soloLives)) {
    const cost = p.perk === QUICK_REVIVE && coopRules ? 1500 : p.cost;
    out.push({kind: 'perk', item: p, position: p.position, radius: 80, cost,
      text: !world.power && (p.perk !== QUICK_REVIVE || coopRules) ? 'You must turn on the power first!' : `Hold F for ${p.name} [Cost: ${cost}]`});
  }
  if (world.powerSwitch && !world.power && quest.built) out.push({kind: 'power', item: world.powerSwitch, position: world.powerSwitch.position, radius: 90, cost: 0, text: 'Hold F to turn on the power'});
  for (const m of [machines.box, machines.pap]) if (m) {
    const w = weapons.current?.def, kind = m.kind, theirs = coopRules && m.state === 'offered' && m.owner && m.owner !== selfId();
    const text = theirs ? `${kind === 'box' ? 'Mystery Box' : 'Pack-a-Punch'} is in use` : m.state === 'offered' ? `Hold F to take ${game.weapons[m.offer].displayName} (${Math.ceil(m.timer)}s)` : m.state !== 'idle' ? kind === 'box' ? 'Mystery Box is rolling…' : 'Pack-a-Punch is working…'
      : kind === 'box' ? `Hold F for a random weapon [Cost: ${game.rules.boxCost}]` : !world.power ? 'You must turn on the power first!' : w?.upgraded || !w?.upgrade ? 'This weapon cannot be upgraded' : `Hold F to Pack-a-Punch [Cost: ${game.rules.papCost}]`;
    out.push({kind, item: m, position: m.source.position, radius: 100, cost: m.state === 'offered' ? 0 : kind === 'box' ? game.rules.boxCost : game.rules.papCost, text});
  }
  return out;
}
/** Stable name of an interaction, shared by the host and guests. */
function interactKey(i) { return `${i.kind}:${i.item.id ?? i.item.entity?.id ?? i.item.target ?? i.part ?? ''}:${Math.round(i.position.x)},${Math.round(i.position.z)}`; }
const MACHINE_MIDDLE = new THREE.Vector3(0, 40, 0);
function nearestInteractable() {
  let best = null, bestScore = Infinity;
  camera.getWorldDirection(dir);
  for (const i of interactables()) {
    // Machines stand on their origin: aim at the middle of the machine, and let the ray reach the machine's own body
    // (its collision is part of the map), but never pass through a wall or a closed door.
    const machine = ['perk', 'box', 'pap'].includes(i.kind), aim = machine ? i.position.clone().add(MACHINE_MIDDLE) : i.position;
    const delta = aim.clone().sub(camera.position), d = delta.length();
    if (d > i.radius || Math.abs(delta.y) > 90) continue;
    const toward = delta.clone().normalize().dot(dir);
    if (toward < .2) continue;
    const wall = world.collision.rayIntersect(new THREE.Ray(camera.position, delta.normalize()), 0, Math.max(0, d - (machine ? 45 : 20)));
    if (wall) continue;
    const score = d - toward * 45;
    if (score < bestScore) { best = i; bestScore = score; }
  }
  return best;
}
function denyFeedback() { sound.play('deny'); const prompt = $('hint'); prompt?.classList.remove('deny'); void prompt?.offsetWidth; prompt?.classList.add('deny'); return false; }
function deny() { if (remoteActor) { coop.event({type: 'deny'}, remoteActor.id); return false; } return denyFeedback(); }
/** The acting survivor, captured so a purchase that waits on a download still pays and equips the right one. */
function context() { return {id: selfId(), actor: remoteActor ?? (online() ? localActor : null), weapons, playerState, session}; }
async function use(target, who = context()) {
  const {weapons, playerState, session} = who, run = fn => withActor(who.actor, fn);
  if (!target || playerState.purchasing || resetting || playerState.dead || playerState.down) return false;
  if (coop?.isClient) { localActionAt = time; return coop.action('use', {key: interactKey(target)}); }
  if (session.points < target.cost) { if (target.kind === 'escape') run(() => showCenter('You Do Not Have Enough Money', 2)); return run(deny); }
  const epoch = generation;
  playerState.purchasing = true;
  try {
    let success = false;
    switch (target.kind) {
      case 'door':
        if (target.item.open) return false;
        world.openDoor(target.item); success = true; break;
      case 'wallbuy': {
        if (weapons.busy) return run(deny);
        const owned = weapons.owned(target.item.weapon);
        if (owned) { if (owned.reserve >= owned.def.reserve) return run(deny); weapons.refill(target.item.weapon); success = true; }
        else { await weapons.prepare(target.item.weapon); if (epoch !== generation) return false; success = await weapons.give(target.item.weapon); }
        break;
      }
      case 'perk': {
        const p = target.item.perk, coopRules = online();
        // Four perks at most (Quick Revive counts); the machine just refuses a fifth.
        if ((!world.power && (p !== QUICK_REVIVE || coopRules)) || playerState.perks.has(p) || playerState.perks.size >= game.rules.perkLimit
          || (p === QUICK_REVIVE && !coopRules && (playerState.qrBought ?? 0) >= game.rules.soloLives) || !weapons.perform('drink', 1.4, null)) return run(deny);
        grantPerk(p);
        if (p === QUICK_REVIVE && !coopRules) playerState.qrBought = (playerState.qrBought ?? 0) + 1;
        // The bottle: opened now, belched when the drink ends.
        run(() => sound.play('perk_open'));
        setTimeout(() => { if (epoch === generation) run(() => sound.play('perk_belch')); }, 1300);
        success = true; break;
      }
      case 'power': success = quest.turnOnPower(); break;
      case 'box': {
        const m = machines.box;
        if (weapons.busy) return run(deny);
        if (m.state === 'offered') { if (online() && m.owner && m.owner !== who.id) return run(deny); success = await machines.take(m, weapons); }
        else if (m.state === 'idle') {
          const name = await machines.prepareBox(game.box.filter(n => !weapons.has(n) && n !== game.start && !game.weapons[n].upgraded), weapons);
          if (epoch !== generation) return false;
          success = machines.startBox(name, who.id);
        }
        break;
      }
      case 'pap': {
        const m = machines.pap;
        if (weapons.busy || !world.power) return run(deny);
        if (m.state === 'offered') { if (online() && m.owner && m.owner !== who.id) return run(deny); success = await machines.take(m, weapons); }
        else if (m.state === 'idle') {
          const upgrade = weapons.current?.def.upgrade;
          if (!upgrade || !game.weapons[upgrade]) return run(deny);
          await weapons.prepare(upgrade); if (epoch !== generation) return false;
          success = await machines.startPap(weapons, who.id);
        }
        break;
      }
      default: success = await quest.use(target, name => weapons.give(name));
    }
    if (epoch !== generation) return false;
    if (success) run(() => { if (target.cost) addPoints(-target.cost); sound.play('buy'); });
    else run(deny);
    return success;
  } catch (error) { if (epoch === generation) reportError(error); return false; }
  finally { if (epoch === generation) playerState.purchasing = false; }
}

/** A perk for the acting survivor. Juggernog raises max health to 200 and regeneration fills it. */
function grantPerk(p) {
  playerState.perks.add(p); weapons.perks.add(p);
  if (p === 'specialty_armorvest') playerState.maxHealth = game.rules.juggHealth;
  sound.play(`sting_${p}`);
}
function clearInput() { keys.clear(); mouseHeld = mousePressed = aiming = false; useHeld = 0; useTarget = null; useConsumed = false; controls?.reset(); }
async function reset() {
  if (resetting) return;
  resetting = true; generation++; clearInput();
  try {
    zombies.clear(); world.reset(); quest.reset(); water.reset(); sound.reset(); machines.reset(); combat.reset(); effects.clear(); weapons.reset();
    intermission = null; gameOver?.hide(); nativeHud?.clearScripts();
    time = centerLeft = fallSpeed = localActionAt = promptProgress = 0; promptText = ''; previousGrounded = true; arsenalRev = -1; fxLog.length = 0; entered = false;
    Object.assign(session, {round: 0, phase: 'starting', total: 0, spawned: 0, killed: 0, kills: 0, points: game.rules.startPoints, headshots: 0, downs: 0, revives: 0, breakLeft: 1.5});
    Object.assign(playerState, {health: game.rules.playerHealth, maxHealth: game.rules.playerHealth, sinceHit: 99, veryHurt: false, down: false, dead: false, revives: 0, qrBought: 0, reviveLeft: 0, invulnerable: 0, purchasing: false, bleed: 0, reviveProgress: 0, penalty: 0});
    appliedKick.pitch = appliedKick.yaw = 0;
    playerState.perks.clear(); hud.center.hidden = true;
    for (const pop of document.querySelectorAll('.pop')) pop.remove();
    const spawn = data.spawns?.[0] ?? data.spawn;
    player.setEnabled(true); player.setPosition(new THREE.Vector3(...spawn.position).add(new THREE.Vector3(0, 4, 0)));
    camera.rotation.set(0, spawn.yaw - Math.PI / 2, 0);
    for (let i = 0; i < 60; i++) player.update(1 / 120, {});
    await weapons.give(game.start);
    session.phase = 'break'; player.setEnabled(active); updateHud();
  } finally { resetting = false; }
}

async function load() {
  renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.autoClear = false;
  document.body.prepend(renderer.domElement);
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => { if (!ready) { hud.status.textContent = `Loading ${title}…`; $('loading-fill').style.width = `${Math.round(100 * loaded / total)}%`; } };
  manager.onError = url => errors.push(`Asset failed: ${url}`);
  const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  [data, game] = await Promise.all([json(`${base}/map-data.json`), json(`${base}/game-data.json`)]);
  scene.add(new THREE.AmbientLight(0xffffff, .35)); scene.add(new THREE.HemisphereLight(0xe8eef4, 0x5a4a30, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.4); sun.position.set(-.5, .8, .3); scene.add(sun);
  const [gltf, collision, sky] = await Promise.all([
    new GLTFLoader(manager).loadAsync(`${base}/${map}.gltf`), loadCollisionWorld({metadataUrl: `${base}/collision.json`}),
    data.sky ? new THREE.TextureLoader(manager).loadAsync(`${base}/${data.sky.equirect}`) : null,
  ]);
  if (sky) { sky.mapping = THREE.EquirectangularReflectionMapping; sky.colorSpace = THREE.SRGBColorSpace; scene.background = sky; }
  const root = gltf.scene;
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const rule = m.userData.rule || {};
      if (rule.blend || rule.water) { m.transparent = true; m.depthWrite = false; }
      if (rule.decal) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; o.renderOrder = 1; }
    }
  });
  scene.add(root); world = new World({scene, root, collision, data, game});
  water = new WaterSurface();
  await Promise.all([
    water.load({world, base, config: game.water, manager, environment: scene.background}),
    game.water ? sound.load('cheese_unlimited_alarm', `${base}/${game.water.alarm.file}`) : Promise.resolve(),
  ]);
  await world.loadNavigation(`${base}/navigation.bin`);
  optimizeStaticScene(root, {cellSize: 640, verticalCellSize: 384});
  assets = new Assets(base, manager); effects = new Effects(scene);
  // The host records shots and impacts so guests see everyone's tracers and hits.
  const drawTracer = effects.tracer.bind(effects), drawBurst = effects.burst.bind(effects);
  effects.tracer = (a, b) => { drawTracer(a, b); if (coop?.isHost) fxLog.push(['t', vec(a), vec(b), selfId()]); };
  effects.burst = (p, ...rest) => { drawBurst(p, ...rest); if (coop?.isHost) fxLog.push(['b', vec(p), ...rest]); };
  player = new PlayerController(camera, world.collision, playerOptions());
  zombies = new Zombies({scene, world, assets, game, session, onPlayerHit: (amount, z, id) => withActor(coop?.actors.get(id), () => hurtPlayer(amount, {from: z?.root.position})), onKill});
  zombies.juggernog = id => (id ? coop?.actors.get(id)?.playerState : playerState)?.perks.has('specialty_armorvest') ?? false;
  weapons = new Weapons({assets, game, camera, onFire: fire, onSound: kind => sound.play(kind === 'fire' ? fireSound(weapons.current) : kind), onReload: () => { if (coop?.isClient) { localActionAt = time; coop.action('reload'); } }, onAction: action => {
    if (action === 'melee') { if (coop?.isClient) coop.action('melee', {origin: vec(camera.position)}); else combat.melee(); }
    else if (action === 'grenade') { if (coop?.isClient) coop.action('grenade', {origin: vec(camera.position)}); else combat.throwGrenade(); }
    else if (action?.error) reportError(action.error);
  }});
  await weapons.loadKnife().catch(error => console.warn('Knife unavailable', error));
  let savedFov = null; try { savedFov = localStorage.getItem('ccube.fov'); } catch {}
  setFov(Number(savedFov) >= 65 && Number(savedFov) <= 120 ? savedFov : 80);
  combat = new Combat({scene, world, camera, zombies, weapons, playerState, effects, sound, notify: notice, points: addPoints, hurt: hurtPlayer, hit: hitFeedback, rules: game.rules.powerups});
  // Free Perk: the perk is given with a drink, as a purchase is.
  combat.givePerk = (member, p) => withActor(member.actor ?? null, () => { grantPerk(p); if (!remoteActor) weapons.perform('drink', 1.4, null); });
  combat.onPowerup = kind => { nativeHud?.powerup(kind); if (coop?.isHost) coop.event({type: 'powerup', kind}); };
  machines = new Machines({world, scene, weapons, game, assets, notify: notice, sound});
  await machines.loadOriginals().catch(error => console.warn('Original machine models unavailable', error));
  quest = new CheeseQuest({world, game, notify: notice, sound, points: addPoints, reward: name => weapons.give(name), win: () => endGame(true), hurt: hurtPlayer});
  // The power switch build plays the knuckle crack; posters and daleks reward the whole team.
  quest.onCraft = () => weapons.perform('craft', 2.7, null);
  quest.rewardAll = n => { if (online()) for (const a of coop.actorList()) withActor(a, () => addPoints(n, {raw: true})); else addPoints(n, {raw: true}); };
  quest.freePerkAll = () => {
    for (const member of combat.team?.() ?? [{weapons, playerState}]) {
      const options = game.rules.powerups.freePerks.filter(p => !member.playerState.perks.has(p));
      if (options.length) combat.givePerk(member, options[Math.floor(Math.random() * options.length)]);
    }
  };
  quest.onTroll = text => nativeHud?.message(text, 8);
  nativeHud = await NativeHud.load($('hud'), base);
  menu = new ZombiesMenu({onPlay: () => enterGame(controls?.usingPad), onRestart: () => reset().catch(reportError), onVolume: v => sound.setVolume(v)});
  if (!agentMode) controls = new PadControls({menu: hud.help, back: menuBack, onDevice: () => { if (ready) updateHud(); }});
  gameOver = new GameOver();
  const pickupModel = name => name ? assets.model(name).catch(error => { console.warn('Pickup model', name, error); return null; }) : null;
  const [freePerk, freePap] = await Promise.all([pickupModel(game.pickups?.freePerk), pickupModel(game.pickups?.freePap)]);
  await Promise.all([zombies.load(), combat.load(base, manager, {freePerk, freePap})]); await reset(); ready = true;
  loadSounds(); $('loading').hidden = true; hud.help.hidden = false; exposeDebug();
  renderer.domElement.addEventListener('click', () => enterGame(false));
  let previous = performance.now(), frames = 0, frameTime = 0;
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - previous) / 1000, .1); previous = now;
    if (!agentMode) { pollPad(dt); step(dt); }
    render(); frames++; frameTime += dt;
    if (frameTime >= .5) { fps = Math.round(frames / frameTime); frames = 0; frameTime = 0; }
  });
  // A co-op host keeps the match running when its tab is in the background (guests notice a fully suspended host).
  let backgroundAt = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (document.hidden && coop?.isHost) for (let left = Math.min((now - backgroundAt) / 1000, .25); left > 0; left -= .05) step(Math.min(.05, left));
    backgroundAt = now;
  }, 50);
  if (!agentMode) { coop = new CheeseCoop(coopApi()); coop.ready(); }
}
/** The original game sounds (.tools/build-sounds.mjs), loaded in the background; synthesized cues stand in until then. */
async function loadSounds() {
  // The guns' notetrack sounds (mag out, mag in, bolts, pumps) by alias.
  fetch(`${base}/sounds/notes.json`).then(r => r.ok ? r.json() : null).then(notes => { if (notes && weapons) weapons.noteSounds = notes; }).catch(() => {});
  try {
    const response = await fetch(`${base}/sounds/sounds.json`);
    if (!response.ok) return;
    await Promise.all(Object.entries(await response.json()).map(([kind, s]) => sound.load(kind, `${base}/${s.file}`).catch(error => console.warn(`Sound ${kind}:`, error))));
  } catch (error) { console.warn('Original sounds unavailable', error); }
}
/** Start or resume: capture the mouse (a click, the menu's Start / Resume), or play on with the controller. */
function enterGame(withPad = false) {
  if (!ready || resetting || (coop?.connected && !coop.running) || (playerState.dead && !online())) return;
  sound.unlock();
  if (withPad) { if (!active) { padPlaying = true; setActive(true); } return; }
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock()?.catch(reportError);
}
/** In or out of the match: the start menu shows while out (co-op keeps running). */
function setActive(value) {
  // The map's credits show as a match begins (zm_ccube.gsc function_a9158dba).
  if (value && !entered && !online()) nativeHud?.credits();
  active = value; clearInput(); if (active) entered = true;
  player?.setEnabled((active || online()) && !playerState.dead); sound.setPaused(!active && !online()); if (ready) updateHud();
}
function pauseGame() { padPlaying = false; if (document.pointerLockElement) document.exitPointerLock(); else if (active) setActive(false); }
/** B in the menus: close a submenu or the friends panel, or resume a match. */
function menuBack() {
  if (menu.openPanel()) return menu.back();
  if (!$('coop-panel').hidden) { if (!coop?.connected) $('coop-leave').click(); return; }
  if (entered || online()) enterGame(true);
}
/** The controller, once a frame before the simulation: menus, look, and one-shot actions. */
function pollPad(dt) {
  if (!controls || !ready) return;
  const f = controls.poll(dt, {menuOpen: !hud.help.hidden, playing: active && !resetting && !playerState.dead, prompt: Boolean(promptText), used: useConsumed});
  if (f.actions.has('resume')) enterGame(true);
  if (f.actions.has('confirm') && playerState.dead && !coop?.connected && !resetting) reset().catch(reportError);
  if (!active || resetting) return;
  if (f.actions.has('pause')) { pauseGame(); return; }
  if (f.look.x || f.look.y) {
    const scale = lookScale();
    camera.rotation.y -= f.look.x * scale; camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + f.look.y * scale, -1.5, 1.5);
    weapons.look(f.look.x * scale / .002, -f.look.y * scale / .002);
  }
  if (playerState.dead) return;
  if (f.actions.has('reload')) weapons.reload();
  if (playerState.down) return;
  if (f.actions.has('melee')) weapons.perform('melee');
  if (f.actions.has('grenade') && combat.grenades > 0) weapons.perform('grenade', .75);
  if (f.actions.has('switch') && weapons.cycle()) { localActionAt = time; coop?.action('switch', {index: weapons.pendingSwitch}); }
}
// Keyboard, mouse and controller together, for the local survivor.
const NO_PAD = {move: {x: 0, y: 0}, fire: false, firePressed: false, aim: false, jump: false, crouch: false, sprint: false, use: false};
const pad = () => (active && controls?.frame) || NO_PAD;
function moveAxes() {
  const p = pad().move, forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS')) + p.y, strafe = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + p.x;
  const length = Math.hypot(forward, strafe);
  return length > 1 ? {forward: forward / length, strafe: strafe / length} : {forward, strafe};
}
const useDown = () => keys.has('KeyF') || pad().use;
const aimDown = () => aiming || pad().aim;
function playerOptions() { return {radius: 15, height: 70, eyeHeight: 60, moveSpeed: 190, sprintSpeed: 285, crouchSpeed: 90, gravity: 800, jumpHeight: 39, stepHeight: 18, groundProbeDistance: 4}; }
const killY = () => (data.spawn?.position?.[1] ?? -184) - 500;

function step(dt, force = false) {
  const live = online();
  if (intermission && !resetting) {
    stepIntermission(dt);
    if (live) { if (coop.isHost) coop.afterHost(dt); else coop.updateClient(dt); }
    return;
  }
  if (resetting || (!live && ((!active && !force) || playerState.dead))) { if (ready) updateHud(); return; }
  // A finished co-op match keeps its connection alive so everyone sees the result.
  if (live && ['over', 'won'].includes(session.phase)) { updateHud(); if (coop.isHost) coop.afterHost(dt); else coop.updateClient(dt); return; }
  time += dt; centerLeft -= dt;
  if (centerLeft <= 0) hud.center.hidden = true;
  if (coop?.isClient) { stepGuest(dt); return; }
  moveSurvivor(dt);
  if (!live && playerState.dead) return;
  const alive = !playerState.down && !playerState.dead, feet = player.getFeetPosition();
  if (live) {
    localActor.input = {...localActor.input, use: active && alive && useDown(), aim: aimDown()};
    for (const actor of coop.remoteActors()) updateActor(actor, dt);
  }
  zombies.update(dt, feet, alive); world.update(dt); machines.update(dt, time);
  quest.update(dt, live ? questSurvivors() : {feet, player, alive, health: playerState.health}); water.update(time);
  combat.update(dt, live ? coop.actorList().filter(a => !a.playerState.dead).map(a => ({id: a.id, feet: a.player.getFeetPosition()})) : feet, !playerState.dead);
  effects.update(dt);
  if (!live && playerState.dead) { updateHud(); return; }
  if (live) { updateRevives(dt); if (['over', 'won'].includes(session.phase)) { coop.afterHost(dt); updateHud(); return; } }
  updateRounds(dt);
  regenerate(dt);
  interact(dt, alive);
  updateHud();
  if (live) coop.afterHost(dt);
}
/** The local player's movement, fall damage and gun (shared by solo, the co-op host and guests). */
function moveSurvivor(dt) {
  playerState.invulnerable = Math.max(0, playerState.invulnerable - dt);
  if (playerState.dead) { weapons.pivot.visible = weapons.props.visible = false; mousePressed = false; return; }  // co-op: waiting to respawn
  const alive = !playerState.down, p = pad(), axes = moveAxes(), aim = aimDown(), fireHeld = mouseHeld || p.fire;
  const crouch = keys.has('KeyC') || keys.has('ControlLeft') || p.crouch;
  const moving = alive && (axes.forward !== 0 || axes.strafe !== 0);
  const sprinting = alive && (((keys.has('ShiftLeft') || keys.has('ShiftRight')) && keys.has('KeyW')) || p.sprint) && !aim && !fireHeld && !crouch;
  player.moveSpeed = playerState.perks.has('specialty_staminup') ? 220 : 190;
  player.sprintSpeed = playerState.perks.has('specialty_staminup') ? 345 : 285;
  if (aim) player.moveSpeed *= .6;
  player.setEnabled(true);
  // Downed survivors crawl slowly and cannot jump.
  player.crouchSpeed = alive ? 90 : 35;
  let input = alive ? {forward: axes.forward, strafe: axes.strafe, sprint: sprinting, jump: keys.has('Space') || p.jump, crouch} : {forward: axes.forward, strafe: axes.strafe, crouch: true};
  // Black Ops III's slide: crouching out of a sprint carries you along the ground, slowing to a crouch. It lasts through
  // a drop off a ledge (PhD Flopper detonates on landing from one).
  const crouchPressed = crouch && !slideState.crouchWas; slideState.crouchWas = crouch;
  if (alive && !slideState.slide && crouchPressed && slideState.wasSprinting && player.isGrounded) {
    const along = new THREE.Vector3(player.velocity.x, 0, player.velocity.z), speed = along.length();
    if (speed > 120) slideState.slide = {left: .8, total: .8, dir: along.normalize(), speed};
  }
  const slide = alive ? slideState.slide : null;
  if (slide) {
    slide.left -= dt;
    const t = 1 - Math.max(0, slide.left) / slide.total, forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    player.crouchSpeed = THREE.MathUtils.lerp(slide.speed * 1.1, 90, t * t);
    input = {forward: slide.dir.dot(forward), strafe: slide.dir.dot(right), crouch: true};
    if (slide.left <= 0) slideState.slide = null;
  } else if (!alive) slideState.slide = null;
  player.sliding = Boolean(slide);
  slideState.wasSprinting = sprinting;
  for (let left = dt; left > 0; left -= .025) player.update(Math.min(left, .025), input);
  const feet = player.getFeetPosition();
  if (feet.y < killY()) { hurtPlayer(1000, {hazard: true, kill: true}); if (playerState.dead) return; }
  if (alive) {
    fallSpeed = Math.min(fallSpeed, player.velocity.y);
    if (!previousGrounded && player.isGrounded) {
      if (coop?.isClient) { if (fallSpeed < -300) coop.action('land', {speed: r1(-fallSpeed), slide: Boolean(player.sliding)}); }
      // PhD Flopper: no fall damage; landing a fall faster than 300 units/s while sliding detonates (radius 300,
      // 5000 falling to 1000).
      else if (playerState.perks.has('specialty_phdflopper')) { if (fallSpeed < -300 && player.sliding) combat.explode(feet.clone().add(new THREE.Vector3(0, 8, 0)), {self: false, radius: 300, damage: 5000, edge: 1000}); }
      else if (fallSpeed < -600) hurtPlayer(Math.min(100, (-fallSpeed - 600) * .15));
      fallSpeed = 0;
    }
    previousGrounded = player.isGrounded;
  }
  // Downed survivors keep shooting their last-stand pistol.
  weapons.pivot.visible = Boolean(weapons.current);
  if (playerState.down) weapons.props.visible = false;
  const speed = Math.hypot(player.velocity.x, player.velocity.z) / 190;
  weapons.update(dt, {sprinting, aiming: aim, moving, time, grounded: player.isGrounded, verticalSpeed: player.velocity.y, crouched: Boolean(player.crouched), speed});
  applyViewKick();
  if (!sprinting) weapons.trigger(fireHeld, mousePressed || p.firePressed);
  mousePressed = false;
  if (playerState.down && !online()) {
    playerState.reviveLeft -= dt;
    if (playerState.reviveLeft <= 0) {
      Object.assign(playerState, {down: false, health: playerState.maxHealth, invulnerable: 2, sinceHit: 99, veryHurt: false});
      weapons.endLastStand(); hud.center.hidden = true;
    }
  }
}
// The gun's view kick turns the view and springs back; only the change since the last frame is applied, so the
// player's own aim is never overwritten.
const appliedKick = {pitch: 0, yaw: 0};
const slideState = {slide: null, wasSprinting: false, crouchWas: false};
function applyViewKick() {
  const k = weapons.viewKick;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + k.pitch - appliedKick.pitch, -1.5, 1.5);
  camera.rotation.y += k.yaw - appliedKick.yaw;
  appliedKick.pitch = k.pitch; appliedKick.yaw = k.yaw;
}
/** Look sensitivity while zoomed: scaled by the zoom, as the game's relative ADS sensitivity is. */
function lookScale() {
  const hip = verticalFov(weapons.baseFov, camera.aspect);
  return (menu?.sensitivity ?? 1) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(hip) / 2);
}
/** _zm_playerhealth: 2.4 s without a hit restores full health at once. Once health has fallen to 20% or less it waits
 *  5 s instead, then climbs 10% of max every 0.05 s. */
function regenerate(dt) {
  const s = playerState, r = game.rules;
  s.sinceHit = (s.sinceHit ?? 99) + dt;
  if (s.down || s.dead) return;
  if (s.health >= s.maxHealth) { s.veryHurt = false; return; }
  if (!s.veryHurt) { if (s.sinceHit >= r.regenDelay) s.health = s.maxHealth; return; }
  if (s.sinceHit >= r.veryHurtDelay) s.health = Math.min(s.maxHealth, s.health + s.maxHealth * 2 * dt);
}
/** Hold-to-use prompts; in co-op, a downed teammate in reach takes priority. */
function interact(dt, alive) {
  const mate = alive ? downedTeammate() : null;
  const target = alive && !mate && !playerState.purchasing ? nearestInteractable() : null;
  if (mate) {
    promptText = `Hold F to revive ${coop.name(mate.id)}`; promptProgress = Math.min(1, mate.revive / REVIVE_SECONDS); useHeld = 0; useTarget = null;
    return;
  }
  promptText = target?.text ?? '';
  const id = target ? interactKey(target) : null;
  if (id !== useTarget) { useHeld = 0; useTarget = id; }
  if (!useDown()) { useHeld = 0; useConsumed = false; }
  else if (target && !useConsumed) {
    useHeld += dt;
    if (useHeld >= (target.hold || .25)) { useConsumed = true; use(target); }
  }
  // Only holds longer than a tap (building the power switch, escaping) show the progress bar.
  promptProgress = target && !useConsumed && (target.hold || .25) > .5 ? Math.min(1, useHeld / target.hold) : 0;
}
function updateHud() {
  if (!weapons || !combat) return;
  nativeHud?.update(hudState(), hudClock());
  const tint = intermission ? '' : playerState.down ? 'grayscale(.8) sepia(.3) brightness(.75)' : playerState.dead && online() ? 'grayscale(1) brightness(.5)' : '';
  if (renderer.domElement.style.filter !== tint) renderer.domElement.style.filter = tint;
  // The original map shows no objective or water readout; they live on the pause panel.
  hud.damage.style.opacity = Math.max(0, Math.min(.85, 1 - playerState.health / playerState.maxHealth));
  hud.help.hidden = active || (playerState.dead && !coop?.connected) || agentMode || (intermission !== null && intermission.time < GAME_OVER_EXIT);
  menu?.update(menuState());
  if (!hud.debug.hidden) hud.debug.textContent = `${fps} FPS · ${renderer.info.render.calls} calls · zone ${world.zoneAt(player.getFeetPosition()) ?? '-'}\nzombies ${zombies.list.length} · ${session.spawned}/${session.total} · round ${session.round}${online() ? ` · ${coop.code} ${coop.isHost ? 'host' : `guest ${coop.ping ?? '?'} ms`}` : ''}`;
}
/** What the frontend / start menu shows: mode, party or scoreboard, and the objective. */
function menuState() {
  const mode = coop?.connected && !coop.running ? 'room' : entered || online() ? 'pause' : 'frontend';
  let party;
  if (mode === 'room') party = coop.players.map((p, i) => ({name: p.name, slot: i, leader: p.id === 'host', ready: p.ready}));
  else if (online()) party = (coop.isHost ? coop.actorList().map(describe) : coop.snapshot?.players ?? [])
    .map(p => ({name: coop.name(p.id), slot: coop.slot(p.id), leader: p.id === 'host', points: p.points, kills: p.kills, headshots: p.headshots, down: p.down, dead: p.dead}));
  else party = [{name: $('coop-name').value.trim() || 'Survivor', slot: 0, leader: true, points: session.points, kills: session.kills, headshots: session.headshots, down: playerState.down, dead: playerState.dead}];
  const above = quest.rising ? Math.round(player.getFeetPosition().y - (quest.waterBounds.max.y + quest.rise)) : null;
  const usingPad = controls?.usingPad, g = action => controls.glyph(action);
  const enter = usingPad ? `Press ${g('pause')} to` : 'Click the game to';
  return {
    visible: !hud.help.hidden, mode, party, leader: coop?.id === 'host', canRestart: !coop?.connected,
    title: mode === 'pause' ? title : 'Zombies',
    status: mode === 'room' ? 'Private Match' : mode === 'frontend' ? 'Offline' : `${online() ? 'Co-op' : 'Solo'} · Round ${Math.max(1, session.round)}`,
    hint: mode === 'room' ? (coop.id === 'host' ? 'Start when everyone is ready' : 'Waiting for the party leader') : mode === 'frontend' ? `${enter} play`
      : online() ? `${enter} rejoin — the match keeps running` : `${enter} resume`,
    backKey: usingPad ? g('b') : 'ESC',
    padControls: usingPad ? [['Left Stick', 'Move'], ['Right Stick', 'Look'], [g('sprint'), 'Sprint'], [g('jump'), 'Jump'], [g('crouch'), 'Crouch'],
      [g('fire'), 'Fire'], [g('aim'), 'Aim down sights'], [g('reload'), 'Reload'], [`Hold ${g('use')}`, 'Buy, use, revive'], [g('switchWeapon'), 'Switch weapons'],
      [g('melee'), 'Melee'], [g('lethal'), 'Grenade'], [g('pause'), 'Menu']] : null,
    objective: quest.objective, danger: above !== null && above < 100,
    hazard: above === null ? 'Climb before the black cheese rises' : `Black cheese ${quest.waterStopped ? 'stopped' : 'rising'} · ${Math.max(0, above)} below you`,
  };
}
let hudAt = performance.now();
function hudClock() { const now = performance.now(), dt = Math.min(.1, (now - hudAt) / 1000); hudAt = now; return dt; }
const projected = new THREE.Vector3();
/** Everything the HUD shows, read from the local survivor and (in co-op) the team. */
function hudState() {
  const s = playerState, slot = weapons.current, team = online() ? (coop.isHost ? coop.actorList().map(describe) : coop.snapshot?.players ?? []) : [];
  const mates = team.filter(p => p.id !== coop?.id);
  const waypoints = [];
  for (const p of mates) if (p.down) {
    projected.set(p.feet[0], p.feet[1] + 78, p.feet[2]).project(camera);
    if (projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1)
      waypoints.push({x: (projected.x + 1) / 2, y: (1 - projected.y) / 2, bleed: Math.max(0, p.bleed / BLEEDOUT_SECONDS), revive: Math.min(1, p.revive / REVIVE_SECONDS)});
  }
  return {
    visible: ready && !intermission, round: session.round, phase: session.phase, perks: [...s.perks], grenades: combat.grenades, buffs: combat.buffs,
    scores: [...mates.map(p => ({points: p.points, slot: coop.slot(p.id), down: p.down, dead: p.dead})), {points: session.points, slot: online() ? coop.slot(coop.id) : 0, down: s.down, dead: s.dead}],
    // A Cheese Melter shows how far it is from overheating instead of a magazine.
    weapon: slot && (slot.def.flame ? {name: slot.def.displayName, clip: Math.round((1 - (slot.heat ?? 0)) * 100), reserve: 0} : {name: slot.def.displayName, clip: slot.clip, reserve: slot.reserve}),
    health: s.health, maxHealth: s.maxHealth, down: s.down,
    // The four ticks sit on the actual bullet cone (LUI units: 720 per screen height); hidden down the sights and in sprint.
    crosshair: {visible: !s.down && !s.dead && weapons.ads < .35 && !/^sprint/.test(weapons.state) && Boolean(slot),
      spread: Math.max(3, spreadOnScreen(weapons.spread ?? 0, camera.fov, 720))},
    prompt: promptText, promptKey: useKey(), progress: promptProgress, waypoints,
  };
}
// Clip camera animation (tag_camera: reload and raise sway) turns the view only while drawing.
const viewBefore = new THREE.Euler();
function render() {
  renderer.clear();
  const shake = weapons.cameraShake, shaken = Boolean(shake) && shake.w < .999999;
  if (shaken) { viewBefore.copy(camera.rotation); camera.quaternion.multiply(shake); }
  renderer.render(scene, camera);
  if (shaken) camera.rotation.copy(viewBefore);
  renderer.clearDepth(); renderer.render(weapons.scene, weapons.viewCamera);
}

// ---- Co-op (host): every survivor runs through the same rules by swapping who is acting ----
function withActor(actor, fn) {
  if (!actor || actor === (remoteActor ?? localActor)) return fn();
  const saved = {camera, player, weapons, playerState, session, remoteActor};
  ({camera, player, weapons, playerState, session} = actor); remoteActor = actor.local ? null : actor;
  Object.assign(combat, {camera, weapons, playerState}); machines.weapons = weapons;
  try { return fn(); } finally {
    ({camera, player, weapons, playerState, session, remoteActor} = saved);
    Object.assign(combat, {camera, weapons, playerState}); machines.weapons = weapons;
  }
}
/** Points, kills and inventory are the guest's own; round and zombie counts are the match's. */
function personalSession() {
  const own = {kills: 0, points: game.rules.startPoints, headshots: 0, downs: 0, revives: 0};
  for (const key of ['round', 'phase', 'total', 'spawned', 'killed', 'breakLeft']) Object.defineProperty(own, key, {enumerable: true, get: () => matchSession[key], set: value => { matchSession[key] = value; }});
  return own;
}
function createActor(id, slot) {
  const c = new THREE.PerspectiveCamera(75, 1, 2, 60000); c.rotation.order = 'YXZ';
  const p = new PlayerController(c, world.collision, playerOptions());
  const spawn = data.spawns?.[slot] ?? data.spawns?.[0] ?? data.spawn;
  p.setPosition(new THREE.Vector3(...spawn.position).add(new THREE.Vector3(0, 4, 0))); c.rotation.set(0, spawn.yaw - Math.PI / 2, 0);
  // Guests move themselves (this map is a platforming climb); the host's capsule follows their reports.
  p.setEnabled(false);
  const w = new RemoteArsenal(game); w.give(game.start);
  const state = {health: game.rules.playerHealth, maxHealth: game.rules.playerHealth, regen: 0, down: false, perks: new Set(), revives: 0, dead: false, reviveLeft: 0,
    invulnerable: 0, grenades: 4, purchasing: false, bleed: 0, reviveProgress: 0};
  return {id, slot, camera: c, player: p, weapons: w, playerState: state, session: personalSession(), input: {}, inputAt: 0, teleport: 1, heights: [], local: false};
}
function placeActor(actor, feet, crouched) {
  const p = actor.player; p.crouched = crouched;
  p.collider.start.set(feet.x, feet.y + p.radius, feet.z);
  p.collider.end.set(feet.x, feet.y + p._segmentLength(crouched ? p.crouchHeight : p.height) + p.radius, feet.z);
  p._syncCamera();
}
function applyInput(actor, input) {
  actor.input = input; actor.inputAt = performance.now();
  actor.camera.rotation.set(input.pitch, input.yaw, 0);
  const s = actor.playerState;
  if (!input.pos || s.down || s.dead || input.tp !== actor.teleport) return;
  const feet = new THREE.Vector3(...input.pos), current = actor.player.getFeetPosition(), elapsed = Math.max(.05, time - (actor.movedAt ?? time));
  // Reject only movement no player could make (falls are fast; climbing and running are not).
  const horizontal = Math.hypot(feet.x - current.x, feet.z - current.z), rise = feet.y - current.y;
  if (horizontal > 450 * elapsed + 120 || rise > 400 * elapsed + 120) { actor.teleport++; return; }
  placeActor(actor, feet, Boolean(input.crouch)); actor.movedAt = time;
  actor.heights.push([time, feet.y]); while (actor.heights.length && time - actor.heights[0][0] > 3) actor.heights.shift();
}
function aimActor(actor, input, origin) {
  actor.camera.rotation.set(input.pitch, input.yaw, 0);
  const eye = actor.camera.position.clone();
  if (Array.isArray(origin) && origin.length === 3 && origin.every(Number.isFinite) && eye.distanceTo(new THREE.Vector3(...origin)) < 64) actor.camera.position.fromArray(origin);
  actor.camera.updateMatrixWorld();
}
function coopAction(actor, name, value, input) {
  if (resetting || ['over', 'won'].includes(session.phase)) return;
  withActor(actor, () => {
    if (playerState.dead || (playerState.down && !['shoot', 'reload'].includes(name))) return;
    switch (name) {
      case 'shoot': {
        aimActor(actor, input, value.origin);
        const slot = weapons.fire(time);
        if (!slot) return;
        weapons.ads = THREE.MathUtils.clamp(Number(value.ads) || 0, 0, 1);
        fire(slot); coop.shot(actor.id); playSound('fire', .35);
        return;
      }
      case 'reload': weapons.reload(); return;
      case 'switch': if (Number.isInteger(value.index) && value.index >= 0 && value.index < weapons.slots.length) weapons.switchTo(value.index); return;
      case 'melee':
        if (time - (actor.meleeAt ?? -1) < .3) return;
        actor.meleeAt = time; aimActor(actor, input, value.origin); combat.melee(); return;
      case 'grenade':
        if (time - (actor.grenadeAt ?? -1) < .5 || combat.grenades <= 0) return;
        actor.grenadeAt = time; aimActor(actor, input, value.origin); combat.throwGrenade(); return;
      case 'land': {
        // Accept the reported landing only if the host saw a matching drop.
        const speed = Number(value.speed) || 0, peak = Math.max(...actor.heights.map(h => h[1]), -Infinity), feet = player.getFeetPosition();
        if (speed < 300 || peak - feet.y < speed * speed / (2 * player.gravity) * .7) return;
        if (playerState.perks.has('specialty_phdflopper')) { if (value.slide) combat.explode(feet.clone().add(new THREE.Vector3(0, 8, 0)), {self: false, radius: 300, damage: 5000, edge: 1000}); }
        else if (speed > 600) hurtPlayer(Math.min(100, (speed - 600) * .15));
        return;
      }
      case 'use': {
        actor.camera.rotation.set(input.pitch, input.yaw, 0);
        const target = interactables().find(i => interactKey(i) === value.key);
        if (!target || target.position.distanceTo(camera.position) > target.radius + 40) { deny(); return; }
        use(target, context());
      }
    }
  });
}
function updateActor(actor, dt) {
  withActor(actor, () => {
    playerState.invulnerable = Math.max(0, playerState.invulnerable - dt);
    weapons.update(dt);
    if (performance.now() - actor.inputAt > 1000) actor.input = {...actor.input, use: false, aim: false};
    if (!playerState.dead && player.getFeetPosition().y < killY()) hurtPlayer(1000, {hazard: true, kill: true});
    regenerate(dt);
  });
}
function questSurvivors() {
  return coop.actorList().map(a => ({feet: a.player.getFeetPosition(), player: a.player, alive: !a.playerState.down && !a.playerState.dead,
    health: a.playerState.health, carry: Boolean(a.local), hurt: (n, options) => withActor(a, () => hurtPlayer(n, options))}));
}
function updateRevives(dt) {
  const actors = coop.actorList();
  for (const target of actors) {
    const s = target.playerState; if (!s.down || s.dead) continue;
    const feet = target.player.getFeetPosition(), body = feet.clone().add(new THREE.Vector3(0, 20, 0));
    const helpers = actors.filter(a => a !== target && !a.playerState.down && !a.playerState.dead && a.input?.use &&
      a.player.getFeetPosition().distanceTo(feet) < REVIVE_RANGE && world.lineClear(a.camera.position, body));
    // The bleed-out keeps counting during a revive but cannot run out in the middle of one. Quick Revive halves it.
    s.bleed = Math.max(0, s.bleed - dt);
    if (helpers.length) {
      s.reviveProgress += dt * (helpers.some(a => a.playerState.perks.has(QUICK_REVIVE)) ? 2 : 1);
      if (s.reviveProgress >= REVIVE_SECONDS) { revive(target, helpers[0]); notice(`${coop.name(helpers[0].id)} revived ${coop.name(target.id)}`, 2); }
    } else {
      s.reviveProgress = 0;
      if (s.bleed <= 0) withActor(target, bleedOut);
    }
  }
  if (actors.length && actors.every(a => a.playerState.down || a.playerState.dead)) endGame(false);
}
function downedTeammate() {
  if (!online()) return null;
  const feet = player.getFeetPosition();
  const mates = coop.isHost ? coop.remoteActors().map(a => ({id: a.id, feet: a.player.getFeetPosition(), down: a.playerState.down, revive: a.playerState.reviveProgress}))
    : (coop.snapshot?.players ?? []).filter(p => p.id !== coop.id).map(p => ({id: p.id, feet: new THREE.Vector3(...p.feet), down: p.down, revive: p.revive}));
  return mates.find(m => m.down && m.feet.distanceTo(feet) < REVIVE_RANGE) ?? null;
}
function describe(a) {
  const s = a.playerState, feet = a.player.getFeetPosition();
  return {id: a.id, feet: vec(feet), yaw: r2(a.camera.rotation.y), pitch: r2(a.camera.rotation.x), crouch: Boolean(a.player.crouched), aim: Boolean(a.input?.aim),
    hp: Math.ceil(s.health), max: s.maxHealth, down: s.down, dead: s.dead, bleed: r1(s.bleed), revive: r2(s.reviveProgress), perks: [...s.perks], g: s.grenades,
    points: a.session.points, kills: a.session.kills, headshots: a.session.headshots, downs: a.session.downs, revives: a.session.revives, inv: r1(s.invulnerable), tp: a.teleport, weapon: a.weapons.current?.def.name ?? null};
}
/** The snapshot every guest draws: the shared world plus each survivor. */
function capture() {
  const fx = fxLog.splice(0);
  return {round: session.round, phase: session.phase, total: session.total, spawned: session.spawned, killed: session.killed, breakLeft: r1(session.breakLeft),
    power: world.power, doors: [...new Set(world.doors.filter(d => d.open).map(d => d.target))],
    buffs: Object.fromEntries(Object.entries(combat.buffs).map(([k, v]) => [k, r1(v)])),
    quest: quest.pack(), machines: machines.pack(), zombies: zombies.pack(), ...combat.pack(),
    players: coop.actorList().map(a => ({...describe(a), arsenal: a.local ? undefined : packArsenal(a.weapons)})), fx: fx.slice(-200)};
}

// ---- Co-op (guest): draw the host's world, predict only our own movement and gun ----
function stepGuest(dt) {
  moveSurvivor(dt);
  const feet = player.getFeetPosition(), alive = !playerState.down && !playerState.dead;
  world.update(dt); machines.animate(dt, time);
  quest.update(dt, {feet, player, alive, health: playerState.health}, {visual: true}); water.update(time);
  combat.animate(dt); zombies.updateRemote(dt); effects.update(dt);
  interact(dt, alive);
  updateHud();
  coop.updateClient(dt);
}
function readInput() {
  const feet = player.getFeetPosition();
  const axes = moveAxes();
  return {forward: r2(axes.forward), strafe: r2(axes.strafe),
    yaw: Math.round(camera.rotation.y * 1000) / 1000, pitch: THREE.MathUtils.clamp(camera.rotation.x, -1.5, 1.5), pos: vec(feet), crouch: Boolean(player.crouched),
    aim: aimDown() && active, use: useDown() && active, tp: coop.tp};
}
function applyState(state) {
  if (resetting) return;
  for (const key of ['round', 'phase', 'total', 'spawned', 'killed', 'breakLeft']) session[key] = state[key];
  const open = new Set(state.doors);
  for (const door of world.doors) if (!door.open && open.has(door.target)) world.openDoor(door);
  combat.buffs = {...state.buffs};
  quest.applyRemote(state.quest, state.power); machines.applyRemote(state.machines); zombies.applyRemote(state.zombies); combat.applyRemote(state.pickups, state.grenades);
  const me = state.players.find(p => p.id === coop.id);
  if (me) applySelf(me);
  for (const fx of state.fx ?? []) playFx(fx);
}
function applySelf(me) {
  const s = playerState, wasDead = s.dead, wasDown = s.down;
  Object.assign(s, {health: me.hp, maxHealth: me.max, down: me.down, dead: me.dead, bleed: me.bleed, reviveProgress: me.revive, grenades: me.g, invulnerable: me.inv});
  if (me.perks.join() !== [...s.perks].join()) {
    const fresh = me.perks.some(p => !s.perks.has(p));
    s.perks.clear(); weapons.perks.clear(); for (const p of me.perks) { s.perks.add(p); weapons.perks.add(p); }
    if (fresh && !me.down) weapons.perform('drink', 1.4, null);
  }
  if (me.points !== session.points) { const delta = me.points - session.points; session.points = me.points; popPoints(delta); }
  session.kills = me.kills; session.headshots = me.headshots; session.downs = me.downs ?? 0; session.revives = me.revives ?? 0;
  if (me.tp !== coop.tp) { coop.tp = me.tp; player.setEnabled(true); player.setPosition(new THREE.Vector3(...me.feet)); fallSpeed = 0; previousGrounded = true; }
  if ((me.dead && !wasDead) || (me.down && !wasDown)) clearInput();
  if (me.dead) player.setEnabled(false);
  if (me.arsenal) reconcileArsenal(me.arsenal);
}
/** Adopt the host's inventory: at once when it changed there, otherwise once our own gun has settled. */
function reconcileArsenal(a) {
  const w = weapons, forced = a.rev !== arsenalRev; arsenalRev = a.rev;
  const names = a.slots.map(s => s?.[0] ?? null);
  const changed = names.length !== w.slots.length || names.some((n, i) => n !== (w.slots[i]?.def.name ?? null)) || a.index !== w.index && w.pendingSwitch !== a.index;
  const settled = !w.busy && w.pendingSwitch === null && time - localActionAt > .6;
  if (!forced && !changed && !settled) return;
  if (!forced && !changed && a.slots.every((s, i) => !s || (w.slots[i]?.clip === s[1] && w.slots[i]?.reserve === s[2]))) return;
  const before = w.current?.def.name ?? null;
  // Keep slot objects for the same gun so a reload in progress still completes.
  w.slots = a.slots.map((s, i) => {
    if (!s || !game.weapons[s[0]]) return null;
    const slot = w.slots[i]?.def.name === s[0] ? w.slots[i] : {def: game.weapons[s[0]]};
    slot.clip = s[1]; slot.reserve = s[2]; return slot;
  });
  w.reserved = new Set(a.reserved);
  const moved = w.index !== a.index; w.index = a.index;
  if (moved || (w.current?.def.name ?? null) !== before) w.equip().catch(reportError);
}
function playFx([kind, ...a]) {
  const v = p => new THREE.Vector3(...p);
  if (kind === 't') { if (a[2] !== coop.id) effects.tracer(v(a[0]), v(a[1])); }
  else if (kind === 'b') effects.burst(v(a[0]), ...a.slice(1));
  else if (kind === 's' && a[0] !== coop.id) { coop.shot(a[0]); playSound('fire', .35); }
}
function onEvent(e) {
  if (e.type === 'center') displayCenter(String(e.text), Number(e.seconds) || 2);
  else if (e.type === 'hit') showHit(e.alert !== false);
  else if (e.type === 'hurt' && Array.isArray(e.from)) { nativeHud?.hurt(hitAngle(new THREE.Vector3(...e.from))); controls?.rumble('hurt', .3); }
  else if (e.type === 'powerup') nativeHud?.powerup(String(e.kind));
  else if (e.type === 'deny') denyFeedback();
  else if (e.type === 'sound') playSound(String(e.kind));
  else if (e.type === 'gameover') { session.phase = e.won ? 'won' : 'over'; finish(Boolean(e.won), Number(e.round) || session.round); }
}
function coopApi() {
  return {
    ready: () => ready && !resetting, scene: () => ({scene, assets, game}), reset, notice, readInput, applyState, event: onEvent,
    gameOver: () => ['over', 'won'].includes(session.phase),
    lobby: pauseGame,
    localActor: id => (localActor = {id, slot: 0, local: true, camera, player, weapons, playerState, session, input: {}, teleport: 0}),
    // A leaver's Mystery Box or Pack-a-Punch offer can be taken by anyone.
    createActor, removeActor: actor => { for (const m of [machines.box, machines.pap]) if (m?.owner === actor.id) m.owner = null; },
    applyInput, action: coopAction, describe, capture,
    begin() {
      if (coop.isHost) {
        zombies.targets = () => coop.actorList().map(a => ({id: a.id, position: a.player.getFeetPosition(), alive: !a.playerState.down && !a.playerState.dead}));
        combat.team = () => coop.actorList().map(a => ({actor: a, weapons: a.weapons, playerState: a.playerState, points: n => withActor(a, () => addPoints(n))}));
        combat.owner = () => selfId();
        combat.withOwner = (id, fn) => withActor(coop.actors.get(id) ?? null, fn);
      }
      displayCenter(`${coop.isHost ? 'Co-op match started' : 'Joined the match'} — ${controls?.usingPad ? `press ${controls.glyph('pause')}` : 'click'} to enter`, 3);
    },
    end(hadGame) {
      delete zombies.targets; delete combat.team; delete combat.owner; delete combat.withOwner;
      localActor = remoteActor = null;
      pauseGame();
      if (hadGame) reset().catch(reportError);
    },
  };
}

const locked = () => Boolean(renderer) && document.pointerLockElement === renderer.domElement;
document.addEventListener('pointerlockchange', () => { if (locked()) padPlaying = false; setActive(locked() || padPlaying); });
document.addEventListener('mousemove', e => {
  if (!locked() || resetting || (playerState.dead && !online())) return;
  const sensitivity = .002 * lookScale();
  camera.rotation.y -= e.movementX * sensitivity; camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * sensitivity, -1.5, 1.5);
  weapons.look(e.movementX, e.movementY);
});
function switchWeapon(index) { if (weapons.switchTo(index)) { localActionAt = time; coop?.action('switch', {index}); } }
addEventListener('mousedown', e => { if (!locked() || playerState.dead) return; if (e.button === 0) { mouseHeld = true; mousePressed = true; } if (e.button === 2) aiming = true; if (e.button === 1 && !playerState.down) weapons.perform('melee'); });
addEventListener('mouseup', e => { if (e.button === 0) mouseHeld = false; if (e.button === 2) aiming = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', () => { if (active && !playerState.down && !playerState.dead && weapons.cycle()) { localActionAt = time; coop?.action('switch', {index: weapons.pendingSwitch}); } });
addEventListener('keydown', e => {
  if (e.target.matches?.('input, textarea')) return;
  if (e.code === 'Escape' && (document.pointerLockElement || (padPlaying && active))) { pauseGame(); return; }
  if (e.code === 'KeyR' && playerState.dead && !coop?.connected && !e.repeat) { reset().catch(reportError); return; }
  if (!active || resetting || playerState.dead) return;
  if (['Space','F3','Tab'].includes(e.code)) e.preventDefault();
  keys.add(e.code); if (e.repeat) return;
  if (e.code === 'KeyR') weapons.reload();
  if (playerState.down) return;
  if (e.code === 'KeyV') weapons.perform('melee');
  if (e.code === 'KeyG' && combat.grenades > 0) weapons.perform('grenade', .75);
  if (/^Digit[123]$/.test(e.code)) switchWeapon(Number(e.code.at(-1)) - 1);
  if (e.code === 'F3') hud.debug.hidden = !hud.debug.hidden;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { clearInput(); pauseGame(); });
// Browsers start audio only after a click or key press; a controller press doesn't count, so the next one resumes it.
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => { if (sound.unlocked && (active || online())) sound.setPaused(false); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer?.setSize(innerWidth, innerHeight); weapons?.update(0); });
// Field of view as Black Ops III measures it (horizontal at 4:3, 65–120, default 80), remembered between visits.
function setFov(value) {
  hud.fov.value = value; hud['fov-value'].textContent = hud.fov.value + '°';
  try { localStorage.setItem('ccube.fov', hud.fov.value); } catch {}
  if (weapons) { weapons.baseFov = Number(hud.fov.value); weapons.update(0); }
}
hud.fov?.addEventListener('input', () => setFov(hud.fov.value));

function exposeDebug() {
  window.bo3 = {ready: true, scene, camera, world, zombies, weapons, session, playerState, game, data, player, combat, machines, quest, effects, water, sound,
    get coop() { return coop; }, get hud() { return nativeHud; },
    debug: {
      teleport(game3, yaw = 0, pitch = 0) {
        player.setEnabled(true); player.setPosition(new THREE.Vector3(game3[0], game3[2], -game3[1])); camera.rotation.set(pitch, yaw, 0);
        for (let i = 0; i < 30; i++) player.update(1 / 120, {}); fallSpeed = 0; previousGrounded = true;
      },
      lookAt(game3) { camera.lookAt(game3[0], game3[2], -game3[1]); camera.rotation.z = 0; },
      step(seconds, input = {}) {
        const {fire = false, aim = false, keys: held = []} = input;
        aiming = aim; keys.clear(); held.forEach(k => keys.add(k));
        for (let t = 0; t < seconds; t += 1 / 60) { mouseHeld = fire; mousePressed = fire && (input.press !== false); step(Math.min(1 / 60, seconds - t), true); }
        clearInput(); render();
      },
      points(n) { session.points = n; }, give: name => weapons.give(name),
      use: kind => use(interactables().filter(i => i.kind === kind).sort((a, b) => a.position.distanceTo(camera.position) - b.position.distanceTo(camera.position))[0]),
      interactables, nearest: nearestInteractable, reset, hurt: hurtPlayer,
      power() { quest.built = true; quest.turnOnPower(); }, godMode(on = true) { playerState.god = on; },
      aimAtZombie() { const z = zombies.list.find(z => z.state !== 'rising'); if (!z) return false; camera.lookAt(zombies.headPosition(z)); return true; },
      spawnNear(distance = 300) {
        const zone = world.zones.find(z => z.name === world.zoneAt(player.getFeetPosition())) ?? world.zones[0];
        const s = [...zone.spawners].sort((a, b) => Math.abs(a.position.distanceTo(player.getFeetPosition()) - distance) - Math.abs(b.position.distanceTo(player.getFeetPosition()) - distance))[0];
        return zombies.spawn(s).then(z => z?.id);
      },
      // Co-op test arrangement (host only): the assertions still use real input and the real network path.
      coopState: () => coop?.debug() ?? null,
      coopHurt(id, n) { const actor = coop?.isHost && coop.actors.get(id); if (actor) withActor(actor, () => hurtPlayer(n)); return Boolean(actor); },
      coopPoints(id, n) { const actor = coop?.isHost && coop.actors.get(id); if (actor) actor.session.points = n; return Boolean(actor); },
      coopTeleport(id, feet) {
        const actor = coop?.isHost && coop.actors.get(id); if (!actor) return false;
        if (actor.local) player.setPosition(new THREE.Vector3(...feet)); else { placeActor(actor, new THREE.Vector3(...feet), false); actor.teleport++; }
        return true;
      },
      coopGod(id, on = true) { const actor = coop?.isHost && coop.actors.get(id); if (actor) actor.playerState.god = on; return Boolean(actor); },
      autoSpawn(on) { zombies.autoSpawn = on; },
      snapshot: () => ({ready, round: session.round, phase: session.phase, points: session.points, kills: session.kills, spawned: session.spawned, total: session.total,
        health: playerState.health, dead: playerState.dead, down: playerState.down, perks: [...playerState.perks], power: world.power,
        weapon: weapons.current && {name: weapons.current.def.name, clip: weapons.current.clip, reserve: weapons.current.reserve, state: weapons.state},
        feet: player.getFeetPosition().toArray().map(v => Math.round(v)), zone: world.zoneAt(player.getFeetPosition()),
        zombies: zombies.snapshot(), openDoors: world.doors.filter(d => d.open).length, grenades: combat.grenades, buffs: {...combat.buffs},
        quest: {parts: quest.collectedParts.size, built: quest.built, cheese: quest.collected.size, placed: quest.placed.size, posters: quest.posters.size, trivia: quest.trivia, rise: quest.rise},
        machines: {box: machines.box?.state, pap: machines.pap?.state}, active, fps, errors: [...errors],
        coop: coop?.connected ? {id: coop.id, code: coop.code, running: coop.running, host: coop.isHost} : null})
    }
  };
  installVibe(window.bo3);
}
load().catch(error => { errors.push(String(error)); $('loading').hidden = false; hud.status.hidden = false; hud.status.textContent = `${title} could not load.\n${error.message}`; console.error(error); });
