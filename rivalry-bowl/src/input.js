/* Rivalry Bowl: touch / mouse gestures -> game intents.
 * Contexts: 'qb' (can throw), 'run' (steer carrier), 'def' (steer defender),
 * 'pick' (tap a defender before the snap), 'kick' (aim + power), 'none'.
 * Runners and defenders run toward a held finger; a tap jukes (runner) or
 * switches to the tapped defender (defense). */
(function (root) {
  'use strict';
  const RB = root.RB;
  const AIM_GAIN = 1.6; // the reticle moves 1.6x as far as your finger
  const DEAD = 12; // css px before a drag counts
  const MIN_THROW = 26; // shorter pulls cancel instead of throwing
  const JOY_FULL = 60; // css px of drag for full joystick deflection (QB scramble)
  const HOLD_MS = 140; // a still finger held this long starts steering
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
    // Pulling back aims; only a clearly forward drag scrambles.
    if (c === 'qb') S.mode = dx > 0 && dx > Math.abs(dy) * 1.2 ? 'joy' : 'aim';
    else if (c === 'run' || c === 'def') S.mode = 'follow';
  }

  function up(e) {
    if (e.pointerId !== S.id) return;
    const p = pos(e);
    S.x = p.x;
    S.y = p.y;
    const dt = performance.now() - S.t0;
    const dx = S.x - S.x0, dy = S.y - S.y0, len = Math.hypot(dx, dy);
    const c = S.ctxFn();
    if (S.mode === 'aim' && c === 'qb') {
      // Throw exactly where the reticle was drawn.
      if (len >= MIN_THROW) S.intents.throwAt = S.aimS || aimTarget();
    } else if (S.mode === 'kick' && c === 'kick') {
      const k = kickVals();
      if (k.power > 0.08) S.intents.kick = k;
    } else if (len < DEAD && dt < 220) {
      if (c === 'pick' || c === 'def') {
        const k = RB.Render.R.k;
        S.intents.tapAt = RB.Render.toWorld(S.x / k, S.y / k);
      } else if (c === 'run') S.intents.juke = true;
    } else if (dt < 200 && len > 48 && c === 'run') {
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
    S.aimS = null;
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
      steer: null,
    };
    S.intents = { throwAt: null, juke: false, dive: null, kick: null, tapAt: null };
    if (out.aiming) {
      // Light smoothing takes the jitter out of the reticle.
      const raw = aimTarget();
      if (raw) S.aimS = S.aimS ? { x: S.aimS.x + (raw.x - S.aimS.x) * 0.45, y: S.aimS.y + (raw.y - S.aimS.y) * 0.45 } : raw;
      out.aimAt = S.aimS;
      const dx = S.x - S.x0, dy = S.y - S.y0;
      out.aimArmed = Math.hypot(dx, dy) >= MIN_THROW;
    }
    // A still finger held a moment starts steering too.
    if (S.id !== null && !S.mode && (S.lastCtx === 'run' || S.lastCtx === 'def') && performance.now() - S.t0 > HOLD_MS) S.mode = 'follow';
    if (S.id !== null && S.mode === 'follow') {
      const k = RB.Render.R.k;
      out.steer = RB.Render.toWorld(S.x / k, S.y / k);
    }
    if (S.id !== null && S.mode === 'joy') {
      const dx = S.x - S.x0, dy = S.y - S.y0, len = Math.hypot(dx, dy);
      const mag = clamp((len - 10) / (JOY_FULL - 10), 0, 1);
      if (mag > 0.04) {
        const w = RB.Render.screenDeltaToWorld(dx, dy);
        const wl = Math.hypot(w.x, w.y) || 1;
        out.joy = { x: (w.x / wl) * mag, y: (w.y / wl) * mag };
      }
      const k = RB.Render.R.k;
      const lim = Math.min(len, JOY_FULL);
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
