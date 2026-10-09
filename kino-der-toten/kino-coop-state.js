import { roundPopulation } from './rules.js';

export const WORLD_FIELDS = ['time','round','countdown','phase','power','flags','openDoors','effects','spawned','killed','total','nextDogRound','dogRound','dogRounds','teleporter','teleportTime'];
const PLAYER_FIELDS = ['health','points','kills','headshots','shots','hits','slot','reloadLeft','reloadStage','reloadSerial','reloadDuration','reloadEmpty','reloadInterrupted','fireLeft','revives','damageTime','grenades','meleeLeft','bowie','totalScore','drinking','drinkLeft','claymoresOwned','claymores','monkeysOwned','monkeys','equipmentLeft','attachmentMode','downed','dead','bleedUntil','reviveProgress'];

export function shareWorld(session, host) {
  session.coop = true;
  for (const key of WORLD_FIELDS) Object.defineProperty(session, key, { configurable: true, enumerable: true, get: () => host[key], set: value => { host[key] = value; } });
  session.drops = host.drops;
}
export function packSession(s) {
  const state = {};
  for (const key of [...WORLD_FIELDS, ...PLAYER_FIELDS]) state[key] = s[key] instanceof Set ? [...s[key]] : s[key];
  state.inventory = structuredClone(s.inventory); state.perks = [...s.perks];
  state.pack = s.pack ? { slot: s.inventory.indexOf(s.pack.weapon), readyAt: s.pack.readyAt, expires: s.pack.expires } : null;
  return state;
}
export function unpackSession(s, state) {
  for (const key of [...WORLD_FIELDS, ...PLAYER_FIELDS]) if (state[key] !== undefined) s[key] = ['flags','openDoors'].includes(key) ? new Set(state[key]) : state[key];
  s.inventory = structuredClone(state.inventory); s.perks = new Set(state.perks);
  s.pack = state.pack ? { weapon: s.inventory[state.pack.slot], readyAt: state.pack.readyAt, expires: state.pack.expires } : null;
}
export function scaleRound(s, players) {
  s.total = s.dogRound ? (s.dogRounds < 3 ? 6 : 8) * players : roundPopulation(s.round, s.data.rules, players);
}
export function updateRevives(actors, dt, lineClear = () => true) {
  for (const target of actors) {
    const s = target.session; if (!s.downed || s.dead) continue;
    const helpers = actors.filter(a => a !== target && !a.session.downed && !a.session.dead && a.input?.use &&
      a.player.getFeetPosition().distanceTo(target.player.getFeetPosition()) < 90 && lineClear(a.camera.position, target.camera.position));
    s.reviveProgress = helpers.length ? (s.reviveProgress || 0) + dt * (helpers.some(a => a.session.perks.has('specialty_quickrevive')) ? 2 : 1) : 0;
    if (s.reviveProgress >= 3) { s.downed = false; s.health = s.maxHealth; s.damageTime = s.time; s.reviveProgress = 0; s.coopInvulnerableUntil = s.time + 2; }
    else if (s.time >= s.bleedUntil) { s.dead = true; s.downed = false; s.reviveProgress = 0; }
  }
  if (actors.length && actors.every(a => a.session.downed || a.session.dead)) actors[0].session.phase = 'gameover';
}
