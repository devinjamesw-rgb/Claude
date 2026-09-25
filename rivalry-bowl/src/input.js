/* Rivalry Bowl: touch / mouse gestures -> game intents.
 * Contexts: 'qb' (can throw), 'run' (steer carrier), 'def' (steer defender),
 * 'kick' (aim + power), 'none'. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const AIM_GAIN = 2.8; // pass distance per unit of drag, in world terms
  const DEAD = 9; // css px before a drag counts
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const S = {
    el: null, ctxFn: null,
    id: null, mode: null, x0: 0, y0: 0, x: 0, y: 0, t0: 0,
    intents: { throwAt: null, juke: false, dive: null, kick: null, tapAt: null },
    lastCtx: 'none',
  };

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

  function down(e) {
    if (S.id !== null) return;
    const c = S.ctxFn();
    if (c === 'none') return;
    e.preventDefault();
    S.id = e.pointerId;
    try { S.el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    const p = pos(e);
    S.x0 = S.x = p.x;
    S.y0 = S.y = p.y;
    S.t0 = performance.now();
    S.mode = null;
    S.lastCtx = c;
    if (c === 'kick') S.mode = 'kick';
    if (RB.Audio) RB.Audio.unlock();
  }

  function move(e) {
    if (e.pointerId !== S.id) return;
    e.preventDefault();
    const p = pos(e);
    S.x = p.x;
    S.y = p.y;
    if (S.mode) return;
    const dx = S.x - S.x0, dy = S.y - S.y0;
    if (Math.hypot(dx, dy) < DEAD) return;
    const c = S.lastCtx;
    if (c === 'qb') S.mode = dx > 0 && dx > Math.abs(dy) * 0.6 ? 'joy' : 'aim';
    else if (c === 'run' || c === 'def') S.mode = 'joy';
  }

  function up(e) {
    if (e.pointerId !== S.id) return;
    const p = pos(e);
    S.x = p.x;
    S.y = p.y;
    const dt = performance.now() - S.t0;
    const dx = S.x - S.x0, dy = S.y - S.y0, len = Math.hypot(dx, dy);
    const c = S.ctxFn();
    if (S.mode === 'aim' && c === 'qb' && len >= 14) {
      S.intents.throwAt = aimTarget();
    } else if (S.mode === 'kick' && c === 'kick') {
      const k = kickVals();
      if (k.power > 0.08) S.intents.kick = k;
    } else if (!S.mode && dt < 260) {
      if (c === 'pick') {
        const k = RB.Render.R.k;
        S.intents.tapAt = RB.Render.toWorld(S.x / k, S.y / k);
      } else S.intents.juke = true;
    } else if (S.mode === 'joy' && dt < 230 && len > 26 && (c === 'run')) {
      const w = RB.Render.screenDeltaToWorld(dx, dy);
      S.intents.dive = { x: w.x, y: w.y };
    }
    reset();
  }

  function cancel(e) {
    if (e.pointerId === S.id) reset();
  }
  function reset() {
    S.id = null;
    S.mode = null;
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
    const out = {
      aiming: S.id !== null && S.mode === 'aim',
      aimAt: null,
      joy: null,
      joyScreen: null,
      kick: null,
      throwAt: S.intents.throwAt,
      juke: S.intents.juke,
      dive: S.intents.dive,
      kickLaunch: S.intents.kick,
      tapAt: S.intents.tapAt,
    };
    S.intents = { throwAt: null, juke: false, dive: null, kick: null, tapAt: null };
    if (out.aiming) out.aimAt = aimTarget();
    if (S.id !== null && S.mode === 'joy') {
      const dx = S.x - S.x0, dy = S.y - S.y0, len = Math.hypot(dx, dy);
      if (len > 4) {
        const w = RB.Render.screenDeltaToWorld(dx, dy);
        const wl = Math.hypot(w.x, w.y) || 1;
        const mag = clamp(len / 26, 0.35, 1);
        out.joy = { x: (w.x / wl) * mag, y: (w.y / wl) * mag };
      }
      const k = RB.Render.R.k;
      const lim = Math.min(len, 22 * k);
      out.joyScreen = { x0: S.x0 / k, y0: S.y0 / k, x1: (S.x0 + (len ? (dx / len) * lim : 0)) / k, y1: (S.y0 + (len ? (dy / len) * lim : 0)) / k };
    }
    if (S.id !== null && S.mode === 'kick') out.kick = kickVals();
    return out;
  }

  function active() {
    return S.id !== null;
  }

  RB.Input = { attach, poll, active, reset, AIM_GAIN };
})(typeof window !== 'undefined' ? window : globalThis);
