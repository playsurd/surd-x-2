// Controller support: the engine's shared reader and menu navigator (web/engine, `vibe engine sync`) mapped onto
// Cheese Cube with Black Ops III's "Default" layout. main.js polls this once a frame and reads what to do.
//   RT fire · LT aim · A jump · B crouch (toggle) · L3 sprint · R3 melee · RB grenade · Y switch weapon
//   X reload, or hold X to buy / use / revive when there is a prompt (a tap still reloads) · Start menu
// Menus: D-pad or left stick moves focus, A selects, B goes back, Start resumes.
import { createGamepad } from '../engine/core/gamepad.js';
import { createMenuNav } from '../engine/core/menu-nav.js';

const TAP = .25;

export class PadControls {
  constructor({menu, back, onDevice}) {
    this.pad = createGamepad();
    this.pad.trackDevice(window);
    this.pad.onDevice(onDevice);
    this.nav = createMenuNav({root: menu, back});
    this.crouch = false; this.sprint = false; this.useTime = 0; this.reloaded = false;
    // Buttons still down from a menu (A on "Resume") do nothing in game until they are let go.
    this.blocked = new Set();
    this.frame = this.idle();
  }
  get device() { return this.pad.device; }
  get usingPad() { return this.pad.device === 'gamepad' && this.pad.connected; }
  /** The button label for an action on the controller in hand: 'X' / '□', 'A' / '✕'… */
  glyph(action) { return this.pad.glyph(action); }
  idle() { return {move: {x: 0, y: 0}, look: {x: 0, y: 0}, fire: false, firePressed: false, aim: false, jump: false, crouch: false, sprint: false, use: false, actions: new Set()}; }
  reset() { this.crouch = this.sprint = false; this.useTime = 0; this.reloaded = false; }

  /**
   * Read the controller. `menuOpen`: the frontend / start menu shows; `playing`: the match takes input;
   * `prompt`: a hold-to-use prompt is up; `used`: the held prompt already fired. Returns this frame's controls with
   * one-shot `actions`: pause, resume, confirm, reload, switch, melee, grenade.
   */
  poll(dt, {menuOpen, playing, prompt, used}) {
    const s = this.pad.poll(dt), f = this.frame = this.idle();
    if (!s.connected) return f;
    if (menuOpen) {
      this.nav.update(s, dt);
      if (s.pressed.pause) f.actions.add('resume');
      this.block(s); this.reset(); return f;
    }
    if (!playing) {
      if (s.pressed.jump || s.pressed.pause) f.actions.add('confirm');
      this.block(s); this.reset(); return f;
    }
    for (const a of this.blocked) if (!s.held[a]) this.blocked.delete(a);
    const held = a => s.held[a] && !this.blocked.has(a), pressed = a => s.pressed[a] && !this.blocked.has(a);
    f.move = s.move; f.look = s.look;
    f.fire = held('fire'); f.firePressed = pressed('fire'); f.aim = held('aim'); f.jump = held('jump');
    if (pressed('crouch')) this.crouch = !this.crouch;
    if (pressed('jump')) this.crouch = false;
    // Sprint is a click of the stick and lasts while running forward, as in the game.
    if (pressed('sprint')) { this.sprint = true; this.crouch = false; }
    if (s.move.y < .35 || f.aim || f.fire) this.sprint = false;
    f.crouch = this.crouch; f.sprint = this.sprint;
    // X: reload at once with nothing to use; with a prompt, holding uses it and a tap reloads.
    if (pressed('use')) { this.useTime = 0; this.reloaded = !prompt; if (!prompt) f.actions.add('reload'); }
    if (held('use')) this.useTime += dt;
    if (s.released.use && prompt && !this.reloaded && !used && this.useTime < TAP) f.actions.add('reload');
    f.use = held('use') && !this.reloaded;
    if (pressed('switchWeapon')) f.actions.add('switch');
    if (pressed('melee')) f.actions.add('melee');
    if (pressed('lethal')) f.actions.add('grenade');
    if (pressed('pause')) f.actions.add('pause');
    return f;
  }
  block(s) { for (const [a, down] of Object.entries(s.held)) if (down) this.blocked.add(a); }

  /** Rumble for this game's events, only while the controller is what the player is using. */
  rumble(kind, amount = 1) {
    if (!this.usingPad) return;
    if (kind === 'fire') this.pad.rumble(.15, .35, 60);
    else if (kind === 'hurt') this.pad.rumble(Math.min(1, .35 + amount * .6), .5, 180);
    else if (kind === 'explosion') this.pad.rumble(.9, .6, 260);
  }
}
