/* Rivalry Bowl: field goal / extra point minigame.
 * Coordinates: x = lateral yards (+ right), d = yards downfield from the
 * hold spot, h = height in yards. The uprights stand at d = dist. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const G = RB.C.GRAVITY;
  const THETA = (38 * Math.PI) / 180;
  const HALF_W = 3.08; // 18'6" between uprights
  const BAR = 3.33; // 10' crossbar

  // Launch speed needed to clear the bar at distance D (no wind).
  function speedFor(D) {
    const c = Math.cos(THETA), t = Math.tan(THETA);
    const den = 2 * c * c * (D * t - BAR);
    return den > 0 ? Math.sqrt((G * D * D) / den) : 99;
  }

  function create(o) {
    const mph = o.wx ? o.wx.wind : 0;
    const ang = o.wx ? o.wx.windDir : 0;
    const k = {
      type: o.type, dist: o.dist, kicker: o.kicker,
      windMph: mph, windAng: ang,
      windLat: Math.sin(ang) * mph, windAlong: Math.cos(ang) * mph,
      vmax: speedFor(o.kicker.power + 4),
      phase: 'aim', t: 0, doneT: 0,
      ball: { x: 0, d: 0, h: 0.25, vx: 0, vd: 0, vh: 0 },
      judged: false, result: null, resultText: '',
      aim: 0, power: 0,
    };
    k.need = Math.min(1.2, speedFor(o.dist) / k.vmax);
    return k;
  }

  function launch(k, aim, power, rng) {
    if (k.phase !== 'aim') return;
    aim = Math.max(-1, Math.min(1, aim || 0));
    power = Math.max(0.05, Math.min(1.08, power || 0));
    k.aim = aim;
    k.power = power;
    let yaw = (aim * 9 * Math.PI) / 180;
    const sigma = ((1 - k.kicker.acc) * 3.2 + (power > 0.98 ? 1.6 : 0)) * (Math.PI / 180);
    yaw += (rng ? rng.gauss() : 0) * sigma;
    const v = k.vmax * power;
    k.ball.vx = v * Math.cos(THETA) * Math.sin(yaw);
    k.ball.vd = v * Math.cos(THETA) * Math.cos(yaw);
    k.ball.vh = v * Math.sin(THETA);
    k.phase = 'fly';
    k.t = 0;
    if (rng && rng.chance(k.type === 'xp' ? 0.008 : 0.015)) {
      k.blocked = true;
      k.ball.vd *= 0.25;
      k.ball.vh *= 0.35;
      k.ball.vx += (rng.next() - 0.5) * 4;
    }
  }

  function judge(k, text, good) {
    k.judged = true;
    k.result = good ? 'good' : 'miss';
    k.resultText = text;
  }

  function update(k, dt) {
    if (k.phase === 'aim') return;
    if (k.phase === 'done') { k.doneT += dt; }
    const b = k.ball;
    if (b.h <= 0 && k.t > 0.1) {
      b.vx = b.vd = b.vh = 0;
      if (!k.judged) judge(k, k.blocked ? 'BLOCKED' : 'SHORT', false);
      k.phase = 'done';
      return;
    }
    k.t += dt;
    b.vx += k.windLat * 0.045 * dt;
    b.vd += k.windAlong * 0.03 * dt;
    b.vh -= G * dt;
    const pd = b.d;
    b.x += b.vx * dt;
    b.d += b.vd * dt;
    b.h += b.vh * dt;
    if (!k.judged && pd < k.dist && b.d >= k.dist) {
      if (k.blocked) judge(k, 'BLOCKED', false);
      else if (b.h < BAR) judge(k, 'SHORT', false);
      else if (b.x < -HALF_W) judge(k, 'WIDE LEFT', false);
      else if (b.x > HALF_W) judge(k, 'WIDE RIGHT', false);
      else judge(k, 'GOOD', true);
    }
    if (k.judged && k.phase === 'fly' && (k.t > 3.2 || b.d > k.dist + 12)) k.phase = 'done';
  }

  // Dotted preview of a kick for the current drag (no wind, no error).
  function preview(k, aim, power, n) {
    const pts = [];
    const yaw = (Math.max(-1, Math.min(1, aim)) * 9 * Math.PI) / 180;
    const v = k.vmax * Math.max(0.05, Math.min(1.08, power));
    const vx = v * Math.cos(THETA) * Math.sin(yaw), vd = v * Math.cos(THETA) * Math.cos(yaw), vh = v * Math.sin(THETA);
    const T = (2 * vh) / G;
    for (let i = 1; i <= (n || 14); i++) {
      const t = (T * i) / (n || 14);
      const d = vd * t;
      if (d > k.dist + 6) break;
      pts.push({ x: vx * t, d, h: vh * t - 0.5 * G * t * t });
    }
    return pts;
  }

  RB.Kick = { create, launch, update, preview, HALF_W, BAR };
})(typeof window !== 'undefined' ? window : globalThis);
