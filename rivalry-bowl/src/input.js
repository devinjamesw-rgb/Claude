/* Rivalry Bowl: touch / mouse gestures -> game intents.
 * Contexts: 'qb' (can throw), 'run' (steer carrier), 'def' (steer defender),
 * 'pick' (tap a defender before the snap), 'kick' (aim + power), 'none'.
 * Players move with a joystick fixed in the bottom-left corner. It follows
 * its own finger, so the other hand can aim a throw, tap a defender or press
 * the JUKE / DIVE / SWITCH buttons at the same time. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const AIM_GAIN = 1.6; // the reticle moves 1.6x as far as your finger
  const DEAD = 12; // css px before a drag counts
  const MIN_THROW = 26; // shorter pulls cancel instead of throwing
  // Joystick, css px: radius JOY_R, JOY_M in from the corner. It responds
  // from JOY_DEAD px off center and is at full speed from JOY_FULL px.
  const JOY_R = 50, JOY_M = 22, JOY_DEAD = 6, JOY_FULL = 32;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const S = {
    el: null, ctxFn: null,
    id: null, mode: null, x0: 0, y0: 0, x: 0, y: 0, t0: 0,
    intents: { throwAt: null, kick: null, tapAt: null },
    lastCtx: 'none',
  };
  const J = { id: null, x: 0, y: 0 }; // the joystick finger

  function attach(el, ctxFn) {
    S.el = el;
    S.ctxFn = ctxFn;
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function pos(e) {
    const r = S.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const moves = (c) => c === 'qb' || c === 'run' || c === 'def';
  function joyCenter() {
    const h = S.el ? S.el.getBoundingClientRect().height : 390;
    return { x: JOY_M + JOY_R, y: h - JOY_M - JOY_R };
  }
  // Runners and defenders grab the stick anywhere near it; the QB only on the
  // stick itself, so pulling back to aim never moves him by accident.
  function onJoy(p, c) {
    const o = joyCenter();
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    return c === 'qb' ? d <= JOY_R + 14 : d <= JOY_R * 2.1;
  }

  function down(e) {
    const c = S.ctxFn();
    if (c === 'none') return;
    const p = pos(e);
    if (J.id === null && moves(c) && onJoy(p, c)) {
      e.preventDefault();
      J.id = e.pointerId;
      J.x = p.x;
      J.y = p.y;
      try { S.el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
      if (RB.Audio) RB.Audio.unlock();
      return;
    }
    if (S.id !== null) return;
    e.preventDefault();
    S.id = e.pointerId;
    try { S.el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    S.x0 = S.x = p.x;
    S.y0 = S.y = p.y;
    S.t0 = performance.now();
    S.mode = c === 'kick' ? 'kick' : null;
    S.lastCtx = c;
    if (RB.Audio) RB.Audio.unlock();
  }

  function move(e) {
    const p = pos(e);
    if (e.pointerId === J.id) {
      e.preventDefault();
      J.x = p.x;
      J.y = p.y;
      return;
    }
    if (e.pointerId !== S.id) return;
    e.preventDefault();
    S.x = p.x;
    S.y = p.y;
    if (S.mode) return;
    if (S.lastCtx === 'qb' && Math.hypot(S.x - S.x0, S.y - S.y0) >= DEAD) S.mode = 'aim';
  }

  function up(e) {
    if (e.pointerId === J.id) { J.id = null; return; }
    if (e.pointerId !== S.id) return;
    const p = pos(e);
    S.x = p.x;
    S.y = p.y;
    const dt = performance.now() - S.t0;
    const len = Math.hypot(S.x - S.x0, S.y - S.y0);
    const c = S.ctxFn();
    if (S.mode === 'aim' && c === 'qb') {
      // Throw exactly where the reticle was drawn.
      if (len >= MIN_THROW) S.intents.throwAt = S.aimS || aimTarget();
    } else if (S.mode === 'kick' && c === 'kick') {
      const k = kickVals();
      if (k.power > 0.08) S.intents.kick = k;
    } else if (len < 12 && dt < 300 && (c === 'pick' || c === 'def')) {
      const k = RB.Render.R.k;
      S.intents.tapAt = RB.Render.toWorld(S.x / k, S.y / k);
    }
    resetGesture();
  }

  function cancel(e) {
    if (e.pointerId === J.id) J.id = null;
    if (e.pointerId === S.id) resetGesture();
  }
  function resetGesture() {
    S.id = null;
    S.mode = null;
    S.aimS = null;
  }
  function reset() {
    resetGesture();
    J.id = null;
  }

  // World-space throw target for the current drag (pull back to aim).
  function aimTarget() {
    const q = S.qb;
    if (!q) return null;
    const w = RB.Render.screenDeltaToWorld(S.x0 - S.x, S.y0 - S.y);
    return { x: q.x + w.x * AIM_GAIN, y: q.y + w.y * AIM_GAIN };
  }

  function kickVals() {
    const r = S.el.getBoundingClientRect();
    const m = Math.min(r.width, r.height);
    return {
      power: clamp((S.y - S.y0) / (m * 0.42), 0, 1.08),
      aim: clamp(-(S.x - S.x0) / (m * 0.3), -1, 1),
    };
  }

  // Called once per frame by main: live aim, joystick and one-shot intents.
  function poll(qbWorld) {
    S.qb = qbWorld;
    const c = S.ctxFn ? S.ctxFn() : 'none';
    const out = {
      aiming: S.id !== null && S.mode === 'aim' && c === 'qb',
      aimAt: null,
      joy: null,
      joyScreen: null,
      kick: null,
      throwAt: S.intents.throwAt,
      kickLaunch: S.intents.kick,
      tapAt: S.intents.tapAt,
    };
    S.intents = { throwAt: null, kick: null, tapAt: null };
    if (out.aiming) {
      // Light smoothing takes the jitter out of the reticle.
      const raw = aimTarget();
      if (raw) S.aimS = S.aimS ? { x: S.aimS.x + (raw.x - S.aimS.x) * 0.45, y: S.aimS.y + (raw.y - S.aimS.y) * 0.45 } : raw;
      out.aimAt = S.aimS;
      out.aimArmed = Math.hypot(S.x - S.x0, S.y - S.y0) >= MIN_THROW;
    }
    if (moves(c)) {
      // The stick is always drawn while someone can be moved, so it is easy to find.
      const o = joyCenter(), k = RB.Render.R.k;
      let dx = 0, dy = 0;
      if (J.id !== null) { dx = J.x - o.x; dy = J.y - o.y; }
      const len = Math.hypot(dx, dy);
      const mag = clamp((len - JOY_DEAD) / (JOY_FULL - JOY_DEAD), 0, 1);
      if (mag > 0) {
        const w = RB.Render.screenDeltaToWorld(dx, dy);
        const wl = Math.hypot(w.x, w.y) || 1;
        out.joy = { x: (w.x / wl) * mag, y: (w.y / wl) * mag };
      }
      const lim = Math.min(len, JOY_R);
      out.joyScreen = {
        x0: o.x / k, y0: o.y / k, r: JOY_R / k,
        x1: (o.x + (len ? (dx / len) * lim : 0)) / k, y1: (o.y + (len ? (dy / len) * lim : 0)) / k,
        on: mag > 0, held: J.id !== null,
      };
    }
    if (S.id !== null && S.mode === 'kick') out.kick = kickVals();
    return out;
  }

  function active() {
    return S.id !== null || J.id !== null;
  }

  RB.Input = { attach, poll, active, reset, AIM_GAIN, JOY_R, JOY_M };
})(typeof window !== 'undefined' ? window : globalThis);
