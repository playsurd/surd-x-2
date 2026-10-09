// Source rules: zombie_moon_gravity.gsc and zombie_moon_teleporter.gsc.
export function contains(bounds, position) {
  return !!bounds && position.every((v, i) => v >= bounds[0][i] && v <= bounds[1][i]);
}
// Axis-aligned overlap of a 30x70 player box (IsTouching) with entity bounds.
export function touching(bounds, feet, radius = 15, height = 70) {
  return !!bounds && feet[0]+radius >= bounds[0][0] && feet[0]-radius <= bounds[1][0] && feet[1]+height >= bounds[0][1] && feet[1] <= bounds[1][1] && feet[2]+radius >= bounds[0][2] && feet[2]-radius <= bounds[1][2];
}

// zombie_moon_update_player_gravity only changes gravity while the player touches a
// player_volume, so the last state persists between and above volumes.
export function environmentAt(data, position, power, onMoon, previous = null) {
  const zones = data.entities.filter(e => e.script_noteworthy === 'player_volume' && contains(e.bounds, position));
  // Small airlock/room volumes take priority over larger overlapping regions.
  const volume = e => e.bounds[0].reduce((n, v, i) => n * (e.bounds[1][i] - v), 1);
  const zone = zones.sort((a, b) => volume(a) - volume(b))[0];
  if (!zone && previous && previous.lunar === onMoon) return {...previous, zone: undefined};
  const lunar = zone?.targetname === 'nml_zone' ? false : onMoon;
  const lowGravity = lunar && (!power || !zone || zone.script_string === 'lowgravity');
  return {zone: zone?.targetname, lunar, lowGravity, breathable: !lowGravity, gravity: lowGravity ? data.rules.lowGravity : data.rules.normalGravity};
}

export class MoonState {
  // suit is the P.E.S. protection; overlay, when set, is the visor while a timed mask change is under way.
  constructor(rules) { this.rules = rules; this.power = false; this.hasSuit = false; this.suit = false; this.overlay = undefined; this.exposure = 0; this.teleport = null; this.cooldown = 0; }
  equipSuit() { this.hasSuit = true; this.suit = true; this.overlay = undefined; this.exposure = 0; }
  toggleSuit() { if (this.hasSuit) this.suit = !this.suit; }
  // low_gravity_watch: 15 s (17 s with Juggernog); the timer resets while the player is not valid.
  deadline(jug = false) { return this.rules.suffocationSeconds + (jug ? 2 : 0); }
  update(dt, environment, pad, {jug = false, valid = true} = {}) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.exposure = environment.breathable || this.suit || !valid ? 0 : this.exposure + dt;
    if (this.exposure > this.deadline(jug)) { this.teleport = null; this.exposure = 0; return {suffocated: true}; }
    if (!pad || this.cooldown > 0) this.teleport = null;
    else if (this.teleport?.pad !== pad) this.teleport = {pad, elapsed: 0};
    else this.teleport.elapsed += dt;
    if (this.teleport?.elapsed >= this.rules.teleportSeconds) {
      const destination = this.teleport.pad;
      // teleporter_function: five seconds of "Recharging" after a jump.
      this.teleport = null; this.cooldown = 5; this.exposure = 0;
      return {teleport: destination};
    }
    return {};
  }
}

// teleporter_to_nml_power_down and teleporter_exit_nml_think. The Moon gate closes on
// every return from No Man's Land and reopens 120 s after one (first trip) or two later
// between_round_over notifies, its four lights turning green in quarters. The bunker gate starts
// open, comes down 3 s into the game (teleporter_exit_nml_think), opens 20 s after that first
// arrival in No Man's Land and 75 s after later arrivals, and comes down again on every exit.
export class MoonGates {
  constructor() { this.reset(); }
  // The run starts in No Man's Land with the Moon gate already opened (teleporter_waiting_for_electric).
  reset() {
    this.moon = {open: true, lights: 4, rounds: 0, timer: null}; this.firstReturn = true;
    this.nml = {open: true, timer: null, closeIn: 3};
  }
  arriveMoon() {
    Object.assign(this.moon, {open: false, lights: 0, rounds: this.firstReturn ? 1 : 2, timer: null}); this.firstReturn = false;
    Object.assign(this.nml, {open: false, timer: null, closeIn: null});
  }
  arriveEarth() { Object.assign(this.nml, {open: false, timer: 75, closeIn: null}); }
  roundOver() { const g = this.moon; if (g.open || g.timer !== null || g.rounds <= 0) return; if (--g.rounds === 0) g.timer = 120; }
  update(dt) {
    const g = this.moon, events = [];
    if (g.timer !== null) {
      g.timer = Math.max(0, g.timer - dt); const lit = Math.min(4, Math.floor((120 - g.timer) / 30));
      if (lit > g.lights) g.lights = lit;
      if (!g.timer) { g.lights = 4; g.open = true; g.timer = null; events.push('moon'); }
    }
    const n = this.nml;
    if (n.closeIn !== null) { if ((n.closeIn -= dt) <= 0) { n.closeIn = null; n.open = false; n.timer = 20; } }
    else if (n.timer !== null) { n.timer = Math.max(0, n.timer - dt); if (!n.timer) { n.open = true; n.timer = null; events.push('nml'); } }
    return events;
  }
  open(pad) { return pad === 'generator_teleporter' ? this.moon.open : pad === 'nml_teleporter' ? this.nml.open : true; }
  snapshot() { return {moon: {...this.moon}, nml: {...this.nml}}; }
}
