// Cheese Cube's controller layout and input feel, adapted to Moon's equipment and hold-to-use actions.
// gamepad.js and menu-nav.js are copied unchanged from vibe-engine core via Cheese Cube.
import { createGamepad } from './gamepad.js';
import { createMenuNav } from './menu-nav.js';

export class MoonController {
  constructor({menu, back}) {
    this.pad = createGamepad();
    this.pad.trackDevice(window);
    this.nav = createMenuNav({root: menu, back});
    this.blocked = new Set();
    this.reset();
  }
  get usingPad() { return this.pad.device === 'gamepad' && this.pad.connected; }
  glyph(action) { return this.pad.glyph(action); }
  idle() { return {move:{x:0,y:0}, look:{x:0,y:0}, fire:false, firePressed:false, aim:false, jump:false, crouch:false, sprint:false, use:false, actions:new Set()}; }
  block() { for (const [action, down] of Object.entries(this.pad.state.held)) if (down) this.blocked.add(action); }
  reset() {
    this.block();
    this.crouch = this.sprint = this.used = this.reloaded = false;
    this.useTime = 0;
    this.frame = this.idle();
    this.lastFeedback = null;
  }
  poll(dt, {menuOpen, playing, prompt, focused = true}) {
    const wasPad = this.usingPad, s = this.pad.poll(dt), f = this.frame = this.idle();
    if (!s.connected) {
      this.reset();
      if (wasPad && playing) f.actions.add('pause');
      return f;
    }
    if (!focused) { this.reset(); return f; }
    // Update even when closed so menu button edges cannot leak across pause/resume.
    this.nav.update(s, dt);
    if (menuOpen) {
      if (s.pressed.pause) f.actions.add('resume');
      this.reset(); return f;
    }
    if (!playing) { this.reset(); return f; }
    for (const action of this.blocked) if (!s.held[action]) this.blocked.delete(action);
    const held = a => s.held[a] && !this.blocked.has(a), pressed = a => s.pressed[a] && !this.blocked.has(a);
    f.move = s.move; f.look = s.look;
    f.fire = held('fire'); f.firePressed = pressed('fire'); f.aim = held('aim'); f.jump = held('jump');
    if (pressed('crouch')) this.crouch = !this.crouch;
    if (pressed('jump')) this.crouch = false;
    if (pressed('sprint')) { this.sprint = true; this.crouch = false; }
    if (s.move.y < .35 || f.aim || f.fire) this.sprint = false;
    f.crouch = this.crouch; f.sprint = this.sprint;
    // Tap X/□ reloads; hold for a quarter second to buy/use, then keep holding to repair/hack.
    if (pressed('use')) {
      this.useTime = 0; this.used = false; this.reloaded = !prompt;
      if (!prompt) f.actions.add('reload');
    }
    if (held('use')) {
      this.useTime += dt;
      if (!this.reloaded && this.useTime >= .25) {
        if (!this.used) f.actions.add('use');
        this.used = true; f.use = true;
      }
    }
    if (s.released.use && !this.reloaded && !this.used && this.useTime > 0) f.actions.add('reload');
    for (const [button, action] of Object.entries({switchWeapon:'weapon', melee:'melee', lethal:'grenade', tactical:'equipment', up:'suit', right:'attachment', down:'claymore', scoreboard:'journal', pause:'pause'})) {
      if (pressed(button)) f.actions.add(action);
    }
    if (s.released.lethal) f.actions.add('grenadeRelease');
    return f;
  }
  feedback(session) {
    const now = {id:session.def.id, mag:session.weapon.mag, left:session.weapon.leftMag, health:session.health}, old = this.lastFeedback;
    if (this.usingPad && old) {
      if (now.health < old.health) this.pad.rumble(.8, .5, 180);
      else if (now.id === old.id && (now.mag < old.mag || now.left < old.left)) this.pad.rumble(.15, .35, 60);
    }
    this.lastFeedback = now;
  }
}
