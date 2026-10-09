/* touch-controls.js — one mobile touch layout for all pieter.com browser FPS games (q1 q2 q3 rtcw ut).
   Canonical copy: /srv/http/shared/touch-controls.js, served by every game site at /assets/touch-controls.js.

   Layout (same upright and sideways, drawn over the game):
     - bottom-left : round joystick (move + strafe, analog)
     - anywhere    : drag to look around
     - bottom-right: SHOOT (hold; drag it to aim while shooting) and JUMP (up arrow) right above it
     - top-left    : SCORES (hold = TAB) and CHAT (opens a text field -> phone keyboard -> sent into the game)

   Each game plugs in an adapter:
       PieterTouch.init({ adapter: { move(x, y), look(dx, dy), press(action, down) } })
         move : x = right +, y = forward +, both -1..1 (released = 0, 0)
         look : mouse-style deltas in pixels (already scaled by sensitivity)
         press: action = "shoot" | "jump" | "scores" (hold = TAB scoreboard), down = true/false
         tap  : (optional) a quick tap on the screen - a click, used in menus
   or use the built-in keyboard/mouse adapter for engines that read the browser keyboard + mouse:
       PieterTouch.init({ adapter: PieterTouch.keyboardAdapter({ target: canvas, fakePointerLock: true }) })
   init() returns { destroy() }. Shown on touch devices only unless { force: true }. */
(function () {
  if (window.PieterTouch) return;

  var CSS =
    ".pt-root{position:fixed;inset:0;z-index:2147482000;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}" +
    ".pt-look{position:absolute;inset:0;touch-action:none}" +
    ".pt-stick{position:absolute;left:max(20px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));" +
    "width:144px;height:144px;border-radius:50%;border:2px solid rgba(255,255,255,.28);background:rgba(255,255,255,.07);touch-action:none}" +
    ".pt-knob{position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;" +
    "background:rgba(255,255,255,.45);box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none}" +
    ".pt-btn{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;touch-action:none}" +
    ".pt-btn svg{pointer-events:none}" +
    ".pt-shoot{right:max(20px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));width:96px;height:96px;" +
    "border:2px solid rgba(255,170,150,.55);background:rgba(239,68,68,.32)}" +
    ".pt-jump{right:max(20px,env(safe-area-inset-right));bottom:calc(max(24px,env(safe-area-inset-bottom)) + 110px);" +
    "width:64px;height:64px;border:2px solid rgba(255,255,255,.38);background:rgba(255,255,255,.12)}" +
    ".pt-btn.pt-on{filter:brightness(1.6)}" +
    ".pt-scores{left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));width:38px;height:38px;" +
    "border:1.5px solid rgba(255,255,255,.3);background:rgba(0,0,0,.35)}" +
    ".pt-chat{left:calc(max(12px,env(safe-area-inset-left)) + 46px);top:max(12px,env(safe-area-inset-top));width:38px;height:38px;" +
    "border:1.5px solid rgba(255,255,255,.3);background:rgba(0,0,0,.35)}" +
    ".pt-chatbox{position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;display:none;" +
    "gap:6px;width:min(560px,calc(100vw - 24px));padding:6px;border-radius:10px;background:rgba(0,0,0,.78);border:1px solid rgba(255,255,255,.3)}" +
    ".pt-chatbox.pt-open{display:flex}" +
    ".pt-chatbox input{flex:1;min-width:0;font:16px/1.2 system-ui,-apple-system,sans-serif;color:#fff;background:rgba(255,255,255,.1);" +
    "border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:8px 10px;outline:none;-webkit-user-select:text;user-select:text}" +
    ".pt-chatbox button{font:700 14px/1 system-ui,-apple-system,sans-serif;color:#fff;background:#2563eb;border:0;border-radius:6px;padding:0 14px}" +
    ".pt-chatbox button.pt-x{background:rgba(255,255,255,.15);padding:0 11px}";

  var ICON_SHOOT = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>';
  var ICON_SCORES = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg>';   // trophy
  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';   // speech bubble
  var ICON_JUMP = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';

  function isTouch() {
    try { return matchMedia("(pointer: coarse)").matches || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
    catch (e) { return false; }
  }

  function el(tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }

  /* One pointer drag -> look deltas; optional onDown/onUp (for buttons that also aim) and onTap (short touch that
     barely moved: a click, e.g. to pick menu items). */
  function dragLook(node, opts, onDown, onUp, onTap, hold) {
    var id = null, lx = 0, ly = 0, t0 = 0, travel = 0, holding = false, holdTimer = 0;
    function end(ev) {
      if (ev.pointerId !== id) return;
      id = null; node.classList.remove("pt-on"); clearTimeout(holdTimer);
      if (onUp) onUp();
      if (holding) { holding = false; hold.end(); return; }
      if (onTap && ev.type === "pointerup" && travel < 12 && Date.now() - t0 < 300) onTap();
    }
    node.addEventListener("pointerdown", function (ev) {
      if (id !== null) return;
      ev.preventDefault(); ev.stopPropagation();
      try { node.setPointerCapture(ev.pointerId); } catch (e) {}
      id = ev.pointerId; lx = ev.clientX; ly = ev.clientY; t0 = Date.now(); travel = 0; node.classList.add("pt-on");
      if (onDown) onDown();
      if (hold) {                                         // press and hold without dragging = keep shooting
        clearTimeout(holdTimer);
        holdTimer = setTimeout(function () { if (id !== null && travel < 10) { holding = true; hold.start(); } }, 180);
      }
    });
    node.addEventListener("pointermove", function (ev) {
      if (ev.pointerId !== id) return;
      ev.preventDefault();
      travel += Math.abs(ev.clientX - lx) + Math.abs(ev.clientY - ly);
      var dx = (ev.clientX - lx) * opts.sensitivity, dy = (ev.clientY - ly) * opts.sensitivity;
      lx = ev.clientX; ly = ev.clientY;
      dx = Math.round(dx); dy = Math.round(dy);
      if (dx || dy) opts.adapter.look(dx, dy);
    });
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
    node.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  }

  /* Analog joystick: vector from the base centre, clamped to the radius. */
  function joystick(base, knob, opts) {
    var id = null, cx = 0, cy = 0, R = 52;
    function set(x, y) { knob.style.transform = "translate(" + x + "px," + y + "px)"; }
    function release() { set(0, 0); opts.adapter.move(0, 0); }
    function update(ev) {
      var dx = ev.clientX - cx, dy = ev.clientY - cy, d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      set(dx, dy);
      var nx = dx / R, ny = -dy / R;                       // forward = finger up
      var mag = Math.sqrt(nx * nx + ny * ny);
      if (mag < 0.18) { opts.adapter.move(0, 0); return; } // small dead zone
      // auto-run: always full speed in the pushed direction. Scale so the larger component is 1 (not unit length):
      // id engines run at full speed when the biggest of forward/side is maxed (diagonals included).
      var big = Math.max(Math.abs(nx), Math.abs(ny));
      nx /= big; ny /= big;
      if (Math.abs(nx) < 0.2) nx = 0;                      // nearly straight -> exactly straight
      if (Math.abs(ny) < 0.2) ny = 0;
      opts.adapter.move(nx, ny);
    }
    base.addEventListener("pointerdown", function (ev) {
      if (id !== null) return;
      ev.preventDefault(); ev.stopPropagation();
      try { base.setPointerCapture(ev.pointerId); } catch (e) {}
      var r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      id = ev.pointerId; update(ev);
    });
    base.addEventListener("pointermove", function (ev) { if (ev.pointerId === id) { ev.preventDefault(); update(ev); } });
    function end(ev) { if (ev.pointerId !== id) return; id = null; release(); }
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
    return release;
  }

  function init(options) {
    var opts = {adapter: null, sensitivity: 2, force: false, parent: document.body, nativeLook: false, holdFire: false};
    for (var k in options || {}) opts[k] = options[k];
    if (!opts.adapter || (!opts.force && !isTouch())) return {destroy: function () {}};

    if (!document.getElementById("pt-css")) {
      var st = document.createElement("style"); st.id = "pt-css"; st.textContent = CSS; document.head.appendChild(st);
    }
    var root = el("div", "pt-root"), look = el("div", "pt-look"), base = el("div", "pt-stick"), knob = el("div", "pt-knob");
    var shoot = el("div", "pt-btn pt-shoot", ICON_SHOOT), jump = el("div", "pt-btn pt-jump", ICON_JUMP);
    var scores = el("div", "pt-btn pt-scores", ICON_SCORES);             // hold = TAB (scoreboard)
    shoot.setAttribute("aria-label", "Shoot"); jump.setAttribute("aria-label", "Jump"); scores.setAttribute("aria-label", "Scores");
    base.appendChild(knob); root.appendChild(look); root.appendChild(base); root.appendChild(shoot); root.appendChild(jump); root.appendChild(scores);
    opts.parent.appendChild(root);
    // keep the keyboard (WASD etc.) going to the game: any touch/click on the controls hands focus back to the canvas
    root.addEventListener("pointerdown", function () {
      var c = document.getElementById("canvas");
      if (c && document.activeElement !== c) { try { c.focus({preventScroll: true}); } catch (e) { try { c.focus(); } catch (e2) {} } }
    }, true);

    if (opts.nativeLook) {
      // the game handles touches on the screen itself (menu cursor, taps, look): only the stick + buttons catch touches
      root.style.pointerEvents = "none"; look.style.display = "none";
      base.style.pointerEvents = shoot.style.pointerEvents = jump.style.pointerEvents = scores.style.pointerEvents = "auto";
    } else {
      dragLook(look, opts, null, null, function () { if (opts.adapter.tap) opts.adapter.tap(); },
               opts.holdFire ? {start: function () { opts.adapter.press("shoot", true); }, end: function () { opts.adapter.press("shoot", false); }} : null);
    }
    var releaseMove = joystick(base, knob, opts);
    dragLook(shoot, opts, function () { opts.adapter.press("shoot", true); }, function () { opts.adapter.press("shoot", false); });
    dragLook(jump, opts, function () { opts.adapter.press("jump", true); }, function () { opts.adapter.press("jump", false); });
    dragLook(scores, opts, function () { opts.adapter.press("scores", true); }, function () { opts.adapter.press("scores", false); });

    // CHAT: the phone keyboard only opens for a real text field -> the button opens one, Send hands the text to the game
    // (opts.chat(text) if the page gives one, e.g. a console "say"; else the adapter types it into the game's T chat)
    var sendChat = opts.chat || opts.adapter.chat;
    if (sendChat && opts.chat !== false) {
      var chat = el("div", "pt-btn pt-chat", ICON_CHAT); chat.setAttribute("aria-label", "Chat");
      root.appendChild(chat); if (opts.nativeLook) chat.style.pointerEvents = "auto";
      var box = el("form", "pt-chatbox");
      box.innerHTML = '<input maxlength="100" autocomplete="off" autocorrect="on" enterkeyhint="send" placeholder="Say something"><button type="submit">Send</button><button type="button" class="pt-x" aria-label="Close">&#x2715;</button>';
      document.body.appendChild(box);
      var input = box.querySelector("input");
      // typing here must not reach the game (letters would move/trigger binds)
      ["keydown", "keyup", "keypress", "pointerdown", "touchstart", "mousedown"].forEach(function (t) { box.addEventListener(t, function (e) { e.stopPropagation(); }); });
      var closeChat = function () {
        box.classList.remove("pt-open"); input.blur();
        var c = document.getElementById("canvas"); if (c) { try { c.focus({preventScroll: true}); } catch (e) {} }
      };
      chat.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); });
      // open on the tap itself (iOS shows the keyboard only for a focus() inside the user's gesture)
      chat.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); releaseAll(); box.classList.add("pt-open"); input.value = ""; input.focus(); });
      box.querySelector(".pt-x").addEventListener("click", function (e) { e.preventDefault(); closeChat(); });
      box.addEventListener("submit", function (e) {
        e.preventDefault();
        var t = input.value.replace(/[\r\n]/g, " ").trim(); closeChat();
        if (t) setTimeout(function () { try { sendChat(t); } catch (x) {} }, 120);
      });
    }

    function releaseAll() { releaseMove(); opts.adapter.press("shoot", false); opts.adapter.press("jump", false); opts.adapter.press("scores", false); }
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseAll);
    return {
      show: function (on) { if (!on) releaseAll(); root.style.display = on ? "" : "none"; },
      destroy: function () {
        releaseAll();
        window.removeEventListener("blur", releaseAll);
        document.removeEventListener("visibilitychange", releaseAll);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  /* Built-in adapter for engines that read the browser keyboard + mouse (emscripten SDL: ioq3, iortcw, FTE).
     Movement -> WASD (digital, with a threshold), look -> synthetic mousemove (movementX/Y), shoot -> left mouse
     button, jump -> Space. Key codes are configurable per game. */
  function keyboardAdapter(cfg) {
    cfg = cfg || {};
    var target = cfg.target || document.getElementById("canvas") || document.body;
    // each action -> one key or a list of keys [code, key, keyCode] (all pressed together, so a game whose
    // defaults use arrows or , . for strafing still works)
    var KEYS = {
      wasd: {forward: [["KeyW", "w", 87], ["ArrowUp", "ArrowUp", 38]], back: [["KeyS", "s", 83], ["ArrowDown", "ArrowDown", 40]],
             left: ["KeyA", "a", 65], right: ["KeyD", "d", 68], jump: ["Space", " ", 32]},
      classic: {forward: [["KeyW", "w", 87], ["ArrowUp", "ArrowUp", 38]], back: [["KeyS", "s", 83], ["ArrowDown", "ArrowDown", 40]],
                left: [["KeyA", "a", 65], ["Comma", ",", 188]], right: [["KeyD", "d", 68], ["Period", ".", 190]], jump: ["Space", " ", 32],
                run: ["ShiftLeft", "Shift", 16]}       // q1/q2 walk by default: Shift = +speed while moving
    };
    var K = {};
    var base = KEYS[cfg.layout || "wasd"] || KEYS.wasd;
    for (var b in base) K[b] = base[b];
    K.scores = ["Tab", "Tab", 9];                          // TAB = scoreboard in q1 q2 q3 rtcw ut
    for (var k in cfg.keys || {}) K[k] = cfg.keys[k];
    var held = {};
    function key(name, down) {
      var d = K[name]; if (!d || !!held[name] === down) return;
      held[name] = down;
      var list = Array.isArray(d[0]) ? d : [d];
      for (var i = 0; i < list.length; i++) {
        var k = list[i];
        var ev = new KeyboardEvent(down ? "keydown" : "keyup", {code: k[0], key: k[1], keyCode: k[2], which: k[2], bubbles: true, cancelable: true});
        // the constructor ignores keyCode/which (they read 0) but FTE and emscripten SDL map keys by keyCode
        try { Object.defineProperty(ev, "keyCode", {get: (function (c) { return function () { return c; }; })(k[2])}); } catch (e) {}
        try { Object.defineProperty(ev, "which", {get: (function (c) { return function () { return c; }; })(k[2])}); } catch (e) {}
        (cfg.keyTarget || target).dispatchEvent(ev);   // on the canvas: bubbles to document + window listeners
      }
    }
    // virtual cursor: engines that read absolute positions (no pointer lock) still see the mouse move
    var vx = -1, vy = -1;
    function mouse(type, extra) {
      var r = target.getBoundingClientRect();
      if (vx < 0) { vx = r.left + r.width / 2; vy = r.top + r.height / 2; }
      var mx = (extra && extra.movementX) || 0, my = (extra && extra.movementY) || 0;
      vx = Math.min(r.right - 1, Math.max(r.left, vx + mx / 2)); vy = Math.min(r.bottom - 1, Math.max(r.top, vy + my / 2));
      var init = {bubbles: true, cancelable: true, button: 0, buttons: type === "mousedown" ? 1 : 0,
                  clientX: vx, clientY: vy, screenX: vx, screenY: vy, movementX: mx, movementY: my};
      var ev = new MouseEvent(type, init);
      // Safari's MouseEvent constructor ignores movementX/Y (they read 0) -> force them, like keyCode above
      [["movementX", mx], ["movementY", my], ["webkitMovementX", mx], ["webkitMovementY", my], ["mozMovementX", mx], ["mozMovementY", my]].forEach(function (p) {
        try { Object.defineProperty(ev, p[0], {get: (function (v) { return function () { return v; }; })(p[1])}); } catch (e) {}
      });
      target.dispatchEvent(ev);
    }
    var T = cfg.threshold || 0.35;
    // Engines (emscripten SDL2 ioq3/iortcw, FTE) only read relative mouse motion while the pointer is locked, and
    // phones have no pointer lock: report the game canvas as locked (touch devices only) so look deltas
    // (movementX/Y) are used. Re-announced on every touch in case the engine registered its handler later.
    function fakeLock() {
      try { Object.defineProperty(document, "pointerLockElement", {configurable: true, get: function () { return target; }}); } catch (e) {}
      try { document.dispatchEvent(new Event("pointerlockchange")); } catch (e) {}
    }
    if (cfg.fakePointerLock) {
      fakeLock();
      var announced = 0;
      document.addEventListener("pointerdown", function () { if (announced++ < 3) fakeLock(); }, true);
    }
    return {
      move: function (x, y) {
        var moving = Math.abs(x) > T || Math.abs(y) > T;
        if (moving) key("run", true);                      // only layouts that define "run" (q1/q2)
        key("forward", y > T); key("back", y < -T); key("right", x > T); key("left", x < -T);
        if (!moving) key("run", false);
      },
      look: function (dx, dy) { mouse("mousemove", {movementX: dx, movementY: dy}); },
      tap: function () { mouse("mousedown"); setTimeout(function () { mouse("mouseup"); }, 60); },   // click (menus)
      // chat: T opens the game's chat line (messagemode in q1 q2 q3 rtcw ut), then the text is typed in and sent with Enter
      chat: function (text) {
        var t = cfg.keyTarget || target;
        function fire(type, code, keyName, kc, cc) {
          var ev = new KeyboardEvent(type, {code: code, key: keyName, keyCode: kc, which: kc, charCode: cc, bubbles: true, cancelable: true});
          [["keyCode", type === "keypress" ? cc : kc], ["which", type === "keypress" ? cc : kc], ["charCode", type === "keypress" ? cc : 0]].forEach(function (p) {
            try { Object.defineProperty(ev, p[0], {get: (function (v) { return function () { return v; }; })(p[1])}); } catch (e) {}
          });
          t.dispatchEvent(ev);
        }
        function stroke(ch) {
          var cc = ch.charCodeAt(0), up = ch.toUpperCase(), kc = /[a-z0-9]/i.test(ch) ? up.charCodeAt(0) : ch === " " ? 32 : 0;
          var code = /[a-z]/i.test(ch) ? "Key" + up : /[0-9]/.test(ch) ? "Digit" + ch : ch === " " ? "Space" : "";
          fire("keydown", code, ch, kc, 0); fire("keypress", code, ch, cc, cc); fire("keyup", code, ch, kc, 0);
        }
        fire("keydown", "KeyT", "t", 84, 0); fire("keyup", "KeyT", "t", 84, 0);
        var chars = Array.from(text), i = 0;
        // after T the engine needs a frame to open the chat line (else the first letters are game keys)
        setTimeout(function next() {
          for (var n = 0; n < 8 && i < chars.length; n++, i++) stroke(chars[i]);
          if (i < chars.length) return setTimeout(next, 16);
          setTimeout(function () { fire("keydown", "Enter", "Enter", 13, 0); fire("keypress", "Enter", "Enter", 13, 13); fire("keyup", "Enter", "Enter", 13, 0); }, 50);
        }, 150);
      },
      press: function (action, down) {
        if (action === "jump") key("jump", down);
        else if (action === "scores") key("scores", down);
        else if (action === "shoot") {
          if (cfg.shootKey) { K.shoot = cfg.shootKey; key("shoot", down); }
          else mouse(down ? "mousedown" : "mouseup");
        }
      }
    };
  }

  /* Game running? canvas#canvas visible and no loading card (#ldcard) / start button (#begin) on screen. */
  // what is actually rendered counts, not the hidden attribute (FTE pages keep hidden=1 on a canvas their CSS shows)
  // (not offsetParent: it is null for position:fixed elements, e.g. rtcw's letterboxed canvas)
  function shown(e) {
    if (!e) return false;
    var cs = getComputedStyle(e), r = e.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
  }
  function defaultReady() {
    var c = document.getElementById("canvas");
    if (!shown(c)) return false;
    // loading card (ut/rtcw) or FTE's "Click To Begin!" button still up -> not yet
    var ids = ["ldcard", "begin"];
    for (var i = 0; i < ids.length; i++) {
      if (shown(document.getElementById(ids[i]))) return false;
    }
    return true;
  }

  /* For plain game pages: <script src="/assets/touch-controls.js"></script><script>PieterTouch.autoStart()</script>
     Shows the overlay (touch devices only) once the game is running and hides it while a loading card is up, so
     it never swallows taps on loading/start screens. Default adapter: keyboard + mouse with the pointer-lock fake. */
  function autoStart(o) {
    o = o || {};
    var touch = isTouch(), framed = inFrame();
    if (framed && !touch) {
      // desktop inside the tweet embed: no visible controls (owner's call), but no pointer lock in a frame either ->
      // invisible mouse mode: drag = look, press-and-hold = shoot, click = shoot once / menu click; WASD as usual
      var started = false, ready0 = o.ready || defaultReady;
      var iv = setInterval(function () {
        var r = false; try { r = !!ready0(); } catch (e) {}
        if (r && !started) {
          started = true; clearInterval(iv);
          embedMouse({adapter: keyboardAdapter({target: document.getElementById("canvas"), fakePointerLock: true, layout: o.layout, keys: o.keys}), force: true});
        }
      }, 500);
      return;
    }
    var desktopFrame = false;
    if (!o.force && !touch) return;
    var h = null, ready = o.ready || defaultReady;
    setInterval(function () {
      var r = false;
      try { r = !!ready(); } catch (e) {}
      if (r && !h) {
        // Default for these engines: the screen itself stays the game's own touch input (that already worked on
        // phones: menu cursor + taps in rtcw's limbo menu, looking around); the overlay only adds the joystick and
        // the shoot/jump buttons. Synthetic look (nativeLook:false + fakePointerLock) is opt-in.
        var nativeLook = desktopFrame ? false : o.nativeLook !== false;
        var adapter = o.adapter || keyboardAdapter({target: document.getElementById("canvas"),
                                                    fakePointerLock: nativeLook ? false : o.fakePointerLock !== false,
                                                    layout: o.layout, keys: o.keys, shootKey: o.shootKey});
        h = init({adapter: adapter, force: true, sensitivity: o.sensitivity || (desktopFrame ? 1.5 : 2), nativeLook: nativeLook, holdFire: desktopFrame, chat: o.chat});
      }
      if (h) h.show(r);
    }, 500);
  }

  /* No page zoom while playing: iOS ignores user-scalable=no, so block Safari's pinch gestures, double-tap zoom and
     multi-finger page zoom directly (touch devices only; all touch input goes to the game anyway). */
  function noZoom() {
    if (window.__ptNoZoom) return; window.__ptNoZoom = true;
    var stop = function (e) { e.preventDefault(); };
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) { document.addEventListener(t, stop, {passive: false}); });
    document.addEventListener("touchmove", function (e) { if (e.touches && e.touches.length > 1 && e.scale !== undefined && e.scale !== 1) e.preventDefault(); }, {passive: false});
    var lastTap = 0;
    document.addEventListener("touchend", function (e) {
      var now = Date.now(); if (now - lastTap < 350) e.preventDefault(); lastTap = now;   // double-tap zoom
    }, {passive: false});
    document.addEventListener("dblclick", stop, {passive: false});
    var st = document.createElement("style");
    st.textContent = "html,body{touch-action:none;-webkit-text-size-adjust:100%;overscroll-behavior:none}" +
      // dragging on the game must not select the page (iOS paints it light blue) or open the long-press callout
      "html,body,body *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}" +
      "input,textarea{-webkit-user-select:text;user-select:text}";
    document.head.appendChild(st);
  }
  if (isTouch()) noZoom();

  /* Desktop inside a frame (the X/Twitter tweet embed): no pointer lock there, so plain mouse movement would just
     leave the frame. A transparent layer over the game takes the mouse instead:
       hold left button + drag = look,  hold left without dragging = keep shooting (drag to aim meanwhile),
       quick click = shoot once,  hold right button = keep shooting.
     Keyboard keeps going to the game. Only active when framed and not on a touch device. */
  function inFrame() { try { return window.self !== window.top; } catch (e) { return true; } }
  // came from a tweet: framed (desktop X) or X's mobile in-app browser, which opens the card as a full page;
  // /x-play adds embed=1 to the game link for that case
  function fromTweet() { return inFrame() || /[?&]embed=1(&|$)/.test(location.search); }
  function embedMouse(o) {
    o = o || {};
    if (isTouch() || (!o.force && !inFrame()) || window.__ptEmbed) return null;
    window.__ptEmbed = true;
    var adapter = o.adapter, sens = o.sensitivity || 1.5;
    var layer = el("div", "pt-embed");
    layer.style.cssText = "position:fixed;inset:0;z-index:2147481999;cursor:grab;background:transparent";
    var hint = el("div", "pt-embed-hint", "drag or arrow keys to look &middot; WASD to move &middot; CTRL or click to shoot");
    hint.style.cssText = "position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:2147482001;pointer-events:none;" +
      "font:600 11px/1 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:6px 10px;border-radius:6px;transition:opacity .6s";
    var dragging = false, lx = 0, ly = 0, t0 = 0, travel = 0, firing = false, holdFire = false, holdTimer = 0;
    // keyboard focus must land inside the frame, or WASD goes to the host page (x.com) instead of the game:
    // focus our window and the canvas (made focusable) on every click
    function canvasFocus() {
      try { window.focus(); } catch (e) {}
      var c = document.getElementById("canvas");
      if (!c) return;
      if (!c.hasAttribute("tabindex")) c.setAttribute("tabindex", "-1");
      try { c.focus({preventScroll: true}); } catch (e) { try { c.focus(); } catch (e2) {} }
    }
    layer.addEventListener("mousedown", function (ev) {
      ev.preventDefault(); canvasFocus();
      if (ev.button === 2) { firing = true; adapter.press("shoot", true); return; }
      if (ev.button !== 0) return;
      dragging = true; lx = ev.clientX; ly = ev.clientY; t0 = Date.now(); travel = 0; layer.style.cursor = "grabbing";
      // press and hold without dragging much = keep shooting (you can still drag to aim while firing)
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () { if (dragging && travel < 10) { holdFire = true; adapter.press("shoot", true); } }, 180);
    });
    // keep getting the drag even when the mouse leaves the frame (the tweet iframe is small)
    layer.addEventListener("pointerdown", function (ev) { try { layer.setPointerCapture(ev.pointerId); } catch (e) {} });
    window.addEventListener("mousemove", function (ev) {
      // only the real mouse: our own look events (dispatched on the canvas) bubble up here too and would feed back
      if (!dragging || !ev.isTrusted) return;
      // movementX first: still right if the browser did lock the pointer after a click (clientX then stays put)
      var dx = ev.movementX, dy = ev.movementY;
      if (!dx && !dy) { dx = ev.clientX - lx; dy = ev.clientY - ly; }
      lx = ev.clientX; ly = ev.clientY; travel += Math.abs(dx) + Math.abs(dy);
      dx = Math.round(dx * sens); dy = Math.round(dy * sens);
      if (dx || dy) adapter.look(dx, dy);
    });
    window.addEventListener("mouseup", function (ev) {
      if (!ev.isTrusted) return;
      if (ev.button === 2 && firing) { firing = false; adapter.press("shoot", false); return; }
      if (ev.button !== 0 || !dragging) return;
      dragging = false; layer.style.cursor = "grab"; clearTimeout(holdTimer);
      if (holdFire) { holdFire = false; adapter.press("shoot", false); return; }
      if (travel < 6 && Date.now() - t0 < 300) {                 // a click, not a drag: shoot once (menus: click)
        if (adapter.tap) adapter.tap();
        else { adapter.press("shoot", true); setTimeout(function () { adapter.press("shoot", false); }, 90); }
      }
    });
    layer.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    // arrow keys turn the view (left/right) and look up/down - also the menu cursor (rtcw limbo menu) (same path as a mouse drag, so it works the same in every game); the game
    // doesn't see them (no double turning where it binds arrows to turn itself)
    var turn = 0, tilt = 0, turnTimer = 0;
    // the controls hint stays on screen until the player has turned both ways with the arrow keys
    var usedArrow = {}, hintLeft = true;
    function turnTick() { if (turn || tilt) adapter.look(turn * 12, tilt * 8); }
    function arrow(ev, down) {
      var h = {ArrowLeft: -1, ArrowRight: 1}[ev.key], v = {ArrowUp: -1, ArrowDown: 1}[ev.key];
      if (!h && !v) return;
      var t = ev.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (down && hintLeft && h) { usedArrow[h] = true; if (usedArrow[-1] && usedArrow[1]) { hintLeft = false; setTimeout(function () { hint.style.opacity = "0"; }, 1500); } }
      if (h) { if (down) turn = h; else if (turn === h) turn = 0; }
      else { if (down) tilt = v; else if (tilt === v) tilt = 0; }
      if ((turn || tilt) && !turnTimer) turnTimer = setInterval(turnTick, 16);
      if (!turn && !tilt && turnTimer) { clearInterval(turnTimer); turnTimer = 0; }
    }
    // CTRL = shoot in every game (some bind it to fire, ut/rtcw don't): handled here like the arrows
    var ctrlDown = false;
    function ctrl(ev, down) {
      if (ev.key !== "Control") return;
      var t = ev.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (down !== ctrlDown) { ctrlDown = down; adapter.press("shoot", down); }
    }
    window.addEventListener("keydown", function (ev) { arrow(ev, true); ctrl(ev, true); }, true);
    window.addEventListener("keyup", function (ev) { arrow(ev, false); ctrl(ev, false); }, true);
    window.addEventListener("blur", function () {
      dragging = false; clearTimeout(holdTimer); turn = tilt = 0; clearInterval(turnTimer); turnTimer = 0;
      if (ctrlDown) { ctrlDown = false; adapter.press("shoot", false); }
      if (firing || holdFire) { firing = holdFire = false; adapter.press("shoot", false); }
    });
    document.body.appendChild(layer); document.body.appendChild(hint);
    return {destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); if (hint.parentNode) hint.parentNode.removeChild(hint); window.__ptEmbed = false; }};
  }

  /* Inside a frame (the X/Twitter tweet embed): a small "Play in new tab" pill top-right -> the same game in a full
     tab (real pointer lock, full screen). A plain link (target=_blank) rather than window.open: frames that allow
     popups at all allow links. */
  function newTabButton() {
    // desktop embed only: on phones X's in-app browser can't open new tabs (owner: hide it there)
    return;
    var a = document.createElement("a");
    a.id = "pt-newtab"; a.href = location.origin + "/"; a.target = "_blank"; a.rel = "noopener";   // the game's homepage
    a.innerHTML = 'Play in new tab <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
    a.style.cssText = "position:fixed;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));z-index:2147482500;" +
      "display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;background:rgba(0,0,0,.6);" +
      "border:1px solid rgba(255,255,255,.35);color:#fff;font:700 12px/1 system-ui,-apple-system,sans-serif;text-decoration:none;" +
      "-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)";
    a.addEventListener("pointerdown", function (e) { e.stopPropagation(); });   // not a look/shoot touch
    (document.body || document.documentElement).appendChild(a);
  }
  /* Inside a frame: [ Set name ] top-left -> a small text box; the game restarts with ?name=<new name> (every game
     takes its player name from the link; the download is cached, so it's a quick reconnect). Keys typed into the box
     are kept away from the game. */
  function nameButton() {
    if (!fromTweet() || document.getElementById("pt-name")) return;
    // already picked a name (the page reloaded with named=1): no more Set name button
    try { if (new URLSearchParams(location.search).get("named")) return; } catch (e) {}
    var css = "position:fixed;top:max(10px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));z-index:2147482500;" +
      "border-radius:999px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.35);color:#fff;" +
      "font:700 12px/1 system-ui,-apple-system,sans-serif;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)";
    var btn = document.createElement("button");
    btn.id = "pt-name"; btn.type = "button"; btn.textContent = "Set name";
    btn.style.cssText = css + ";padding:6px 11px;cursor:pointer";
    // not a <form>: X's embed iframe is sandboxed without allow-forms, which silently blocks form submission
    var form = document.createElement("div");
    form.style.cssText = css + ";display:none;align-items:center;gap:6px;padding:4px 4px 4px 10px";
    var cur = ""; try { cur = new URLSearchParams(location.search).get("name") || ""; } catch (e) {}
    form.innerHTML = '<input id="pt-name-input" maxlength="15" autocomplete="off" spellcheck="false" placeholder="Your name" ' +
      'style="width:120px;background:transparent;border:0;outline:0;color:#fff;font:600 16px/1.2 system-ui,sans-serif">' +
      '<button type="button" style="border:0;border-radius:999px;padding:6px 10px;background:#e33;color:#fff;font:800 12px/1 system-ui,sans-serif;cursor:pointer">OK</button>';
    var input = form.querySelector("input"), ok = form.querySelector("button"); input.value = cur;
    function apply() {
      var n = input.value.replace(/[^A-Za-z0-9 _.\[\]-]/g, "").trim().slice(0, 15);
      if (!n) { input.focus(); return; }
      try { localStorage.setItem("surd_player_name", n); } catch (err) {}
      location.reload();
    }
    function close() { form.style.display = "none"; btn.style.display = ""; }
    // the game never sees typing; this capture listener is also the only one that sees Enter/Escape for the box
    function stopKeys(ev) {
      if (ev.target !== input) return;
      ev.stopImmediatePropagation();
      if (ev.type === "keydown" && ev.key === "Enter") { ev.preventDefault(); apply(); }
      else if (ev.type === "keydown" && ev.key === "Escape") { ev.preventDefault(); close(); }
    }
    ["keydown", "keyup", "keypress"].forEach(function (t) { window.addEventListener(t, stopKeys, true); });
    btn.addEventListener("click", function (e) {
      e.stopPropagation(); btn.style.display = "none"; form.style.display = "inline-flex";
      setTimeout(function () { input.focus(); input.select(); }, 0);
    });
    ok.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); apply(); });
    [btn, form].forEach(function (n) { n.addEventListener("pointerdown", function (e) { e.stopPropagation(); }); });
    var host = document.body || document.documentElement; host.appendChild(btn); host.appendChild(form);
    // in the embed the phone Scores button sits under this one
    var st = document.createElement("style");
    st.textContent = ".pt-scores,.pt-chat{top:calc(max(10px,env(safe-area-inset-top)) + 40px)!important}";
    (document.head || document.documentElement).appendChild(st);
  }
  /* Inside a frame the browser keeps the game muted until the first click/key *inside the frame* (X's play button is
     on x.com, outside it): show a small "click for sound" badge until then. */
  function soundBadge() {
    if (!fromTweet() || document.getElementById("pt-sound") || window.__ptInteracted) return;
    var b = document.createElement("div");
    b.id = "pt-sound";
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/></svg> click for sound';
    b.style.cssText = "position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147482400;" +
      "padding:6px 11px;border-radius:999px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.35);color:#fff;" +
      "font:700 12px/1 system-ui,-apple-system,sans-serif;pointer-events:none;white-space:nowrap;display:flex;align-items:center;gap:6px";
    (document.body || document.documentElement).appendChild(b);
    function gone() {
      window.__ptInteracted = true;
      if (b.parentNode) b.parentNode.removeChild(b);
      ["pointerdown", "keydown", "touchstart"].forEach(function (t) { window.removeEventListener(t, gone, true); });
    }
    ["pointerdown", "keydown", "touchstart"].forEach(function (t) { window.addEventListener(t, gone, true); });
  }
  if (fromTweet()) {
    if (document.body) { newTabButton(); nameButton(); soundBadge(); }
    else document.addEventListener("DOMContentLoaded", function () { newTabButton(); nameButton(); soundBadge(); });
  }
  if (inFrame()) {
    // the tweet embed box: stretch the game to fill it (no black bars), instead of the pages' letterboxing
    // (object-fit: contain). Normal tabs keep the correct aspect.
    var fill = document.createElement("style");
    fill.textContent = "#canvas,#canvas.fit{object-fit:fill!important;width:100vw!important;height:100vh!important}";
    (document.head || document.documentElement).appendChild(fill);
  }

  window.PieterTouch = {init: init, autoStart: autoStart, embedMouse: embedMouse, inFrame: inFrame, fromTweet: fromTweet, keyboardAdapter: keyboardAdapter, isTouch: isTouch, noZoom: noZoom, newTabButton: newTabButton, nameButton: nameButton};
})();
