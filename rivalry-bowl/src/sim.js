/* Rivalry Bowl: single-play simulation.
 * World units are yards. The offense always drives toward +x.
 * x: 0 = back of the offense's end zone, 10 = its goal line, 110 = the
 * opponent's goal line. y: 0 = far sideline, FIELD_W = near sideline.
 * No DOM in here: tools/simtest.js runs this under node. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const C = RB.C;
  const W = C.FIELD_W;

  // Fixed slot indices. The renderer and the network snapshot rely on them.
  const QB = 0, RBK = 1, OC = 2, LG = 3, RG = 4, LT = 5, RT = 6, TE = 7, WR1 = 8, WR2 = 9, WR3 = 10;
  const DE1 = 11, DT1 = 12, DT2 = 13, DE2 = 14, LB1 = 15, LB2 = 16, LB3 = 17, CB1 = 18, CB2 = 19, S1 = 20, S2 = 21;
  const OL = [OC, LG, RG, LT, RT];
  const ELIGIBLE = [WR1, WR2, WR3, TE, RBK];

  const DIFF = [
    { name: 'EASY', spd: 0.97, react: 1.3, tackle: -0.07, hold: 1.25, ints: 0.7 },
    { name: 'NORMAL', spd: 1.0, react: 1.0, tackle: 0, hold: 1.0, ints: 1.0 },
    { name: 'HARD', spd: 1.04, react: 0.8, tackle: 0.05, hold: 0.85, ints: 1.25 },
  ];
  const DEF_CALLS = ['man', 'zone', 'blitz', 'prevent'];

  // Route templates: [dx forward, d-in toward the middle of the field].
  const ROUTES = {
    go: { pts: [[36, 0]], cont: true },
    fade: { pts: [[4, -1], [36, -3.5]], cont: true },
    slant: { pts: [[2.5, 0], [15, 9]], cont: true },
    out: { pts: [[7, 0], [7.8, -13]], cont: false },
    in: { pts: [[9, 0], [9.6, 16]], cont: true },
    post: { pts: [[10, 0], [34, 10]], cont: true },
    corner: { pts: [[10, 0], [26, -11]], cont: true },
    curl: { pts: [[10, 0], [8.6, 1.2]], cont: false },
    comeback: { pts: [[14, 0], [11.5, -2.5]], cont: false },
    hitch: { pts: [[5.5, 0], [4.8, 0.2]], cont: false },
    drag: { pts: [[2, 1.5], [5, 22]], cont: true },
    seam: { pts: [[36, 0.8]], cont: true },
    flat: { pts: [[2, -3], [5.5, -12]], cont: true },
    wheel: { pts: [[2, -6], [6, -10], [32, -11]], cont: true },
    check: { pts: [[4, 2.5], [6.5, 3]], cont: false },
    angle: { pts: [[3, -3], [8, 4]], cont: true },
  };
  const POOLS = {
    WR: ['go', 'fade', 'slant', 'out', 'in', 'post', 'corner', 'curl', 'comeback', 'hitch', 'drag'],
    SLOT: ['slant', 'out', 'in', 'post', 'seam', 'drag', 'curl', 'corner', 'hitch'],
    TE: ['seam', 'out', 'in', 'curl', 'drag', 'flat', 'corner', 'block'],
    RB: ['flat', 'wheel', 'check', 'angle', 'block', 'check'],
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const hyp = Math.hypot;
  const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);

  // --- Construction -----------------------------------------------------------
  function mkPlayer(i, side, attrs) {
    return Object.assign(
      {
        i, side, x: 0, y: 0, vx: 0, vy: 0, dvx: 0, dvy: 0,
        face: side === 0 ? 1 : -1,
        role: 'idle', eng: -1, stun: 0, shedCd: 0, down: 0, tackleCd: 0,
        juke: 0, jukeCd: 0, dive: 0, divX: 0, divY: 0, slow: 0, readAt: 0,
        route: null, wp: 0, track: null, zone: null, man: -1,
        hands: 0.5, block: 0.4, rush: 0.4, cover: 0.3, tackle: 0.6, str: 0.5, elus: 0.4, arm: 0.8, acc: 0.8,
      },
      attrs,
    );
  }

  function createPlay(o) {
    const rng = o.rng;
    const diff = DIFF[o.diff == null ? 1 : o.diff];
    const los = C.GOAL_L + o.ballOn;
    const play = {
      rng, diff, los,
      fdX: o.fdX != null ? o.fdX : los + 10,
      ballY: o.ballY,
      kind: null, // 'pass' | 'run', set at the snap
      defCall: o.defCall || 'man',
      wx: o.wx || { type: 'clear' },
      humanDefIdx: o.humanDefIdx == null ? -1 : o.humanDefIdx,
      t: 0, phase: 'pre', deadT: 0,
      players: [], hist: [],
      ball: { x: los, y: o.ballY, z: 0.4, vx: 0, vy: 0, vz: 0, st: 'snap', holder: -1, bt: 0, T: 0, fx: 0, fy: 0, tx: 0, ty: 0, z0: 0, vz0: 0, target: -1, resolved: false, shown: true },
      carrier: -1, // index of the ball carrier (after handoff, catch or scramble)
      ctrl: QB, // offense player the user steers
      thrown: false, scramble: false, handedOff: false, turnover: false, manual: false,
      events: [], result: null,
      stats: { passAtt: 0, comp: 0, passYds: 0, rushAtt: 0, rushYds: 0, sack: 0, int: 0, fum: 0, receiver: -1, rusher: -1 },
      aimTarget: null,
      landing: null,
    };
    for (let k = 0; k < 11; k++) play.players.push(mkPlayer(k, 0, o.offRoster.off[k]));
    for (let k = 0; k < 11; k++) play.players.push(mkPlayer(11 + k, 1, o.defRoster.def[k]));
    for (let k = 0; k < 22; k++) play.hist.push([]);
    lineupOffense(play, rng);
    lineupDefense(play, rng);
    play.ball.x = play.players[OC].x + 0.3;
    play.ball.y = play.players[OC].y;
    play.ball.fx = play.ball.x;
    play.ball.fy = play.ball.y;
    if (o.kind) snap(play, o.kind);
    return play;
  }

  // Re-aligns the defense for a new call before the snap (online defense picks).
  function setDefense(play, call) {
    if (play.phase !== 'pre' || !DEF_CALLS.includes(call)) return;
    play.defCall = call;
    for (let k = 11; k < 22; k++) {
      const p = play.players[k];
      p.role = 'idle'; p.man = -1; p.zone = null; p.delay = 0;
    }
    lineupDefense(play, play.rng);
  }

  function snap(play, kind) {
    if (play.phase !== 'pre') return;
    play.kind = kind;
    if (kind === 'run') setupRun(play, play.rng);
    else setupPass(play, play.rng);
    for (const p of play.players) { p.x0 = p.x; p.y0 = p.y; }
    play.phase = 'live';
    play.t = 0;
  }

  function place(p, x, y) {
    p.x = x;
    p.y = clamp(y, 1, W - 1);
  }

  function lineupOffense(play, rng) {
    const P = play.players, L = play.los, by = play.ballY;
    const s = rng.chance(0.5) ? 1 : -1; // strong side: +1 = near sideline
    const olY = [0, -1.3, 1.3, -2.6, 2.6];
    OL.forEach((idx, k) => place(P[idx], L - 0.7, by + olY[k]));
    place(P[QB], L - 4.5, by);
    place(P[WR1], L - 0.5, rng.range(6.5, 10));
    place(P[WR2], L - 0.5, W - rng.range(6.5, 10));
    const wrY = (side) => (side < 0 ? P[WR1].y : P[WR2].y);
    const slotY = (side) => (wrY(side) + by + 2.6 * side) / 2;
    const form = rng.pick(['spread', 'trips', 'pro', 'empty']);
    play.formation = form;
    if (form === 'spread') {
      place(P[WR3], L - 1.2, slotY(s));
      place(P[TE], L - 0.9, by - 3.9 * s);
      place(P[RBK], L - 4.7, by - 1.5 * s);
    } else if (form === 'trips') {
      place(P[WR3], L - 1.2, slotY(s));
      place(P[TE], L - 0.9, by + 3.9 * s);
      place(P[RBK], L - 4.7, by - 1.5 * s);
    } else if (form === 'pro') {
      place(P[WR3], L - 1.2, slotY(-s));
      place(P[TE], L - 0.9, by + 3.9 * s);
      place(P[RBK], L - 6.8, by);
    } else {
      place(P[WR3], L - 1.2, slotY(s));
      place(P[TE], L - 1.2, by - 6.5 * s);
      place(P[RBK], L - 1.2, (wrY(-s) + by - 2.6 * s) / 2);
    }
    for (const p of P.slice(0, 11)) p.face = 1;
  }

  function lineupDefense(play, rng) {
    const P = play.players, L = play.los, by = play.ballY;
    const call = play.defCall;
    [DE1, DT1, DT2, DE2].forEach((idx, k) => {
      place(P[idx], L + 0.9, by + [-3.7, -1.0, 1.0, 3.7][k]);
      P[idx].role = 'rush';
    });
    [LB1, LB2, LB3].forEach((idx, k) => place(P[idx], L + 4.5, by + [-4.5, 0, 4.5][k]));
    const deep = call === 'prevent' ? 20 : 12;
    place(P[S1], L + deep, Math.min(by - 9, C.MID_Y - 7));
    place(P[S2], L + deep, Math.max(by + 9, C.MID_Y + 7));
    const press = call === 'blitz' ? 1.6 : call === 'man' ? 5 : call === 'prevent' ? 9 : 7;
    place(P[CB1], L + press, P[WR1].y + (call === 'zone' || call === 'prevent' ? 1.5 : 0.6));
    place(P[CB2], L + press, P[WR2].y - (call === 'zone' || call === 'prevent' ? 1.5 : 0.6));
    for (const p of P.slice(11)) p.face = -1;

    const slotSide = P[WR3].y < C.MID_Y ? -1 : 1;
    const nearS = slotSide < 0 ? S1 : S2, farS = slotSide < 0 ? S2 : S1;
    const teSide = P[TE].y < by ? -1 : 1;
    const teLB = teSide < 0 ? LB1 : LB3, otherLB = teSide < 0 ? LB3 : LB1;
    const zoneX = (dx) => Math.min(L + dx, 118.5);
    const Z = (idx, dx, y, r, deepZone) => {
      P[idx].role = 'zone';
      P[idx].zone = { dx, y, r, deep: !!deepZone };
      place(P[idx], Math.min(P[idx].x, zoneX(dx)), P[idx].y);
    };
    const M = (idx, tgt, cushion) => {
      const p = P[idx];
      p.role = 'man';
      p.man = tgt;
      p.cush0 = cushion;
      if (idx !== CB1 && idx !== CB2) place(p, Math.max(L + 1.6, P[tgt].x + cushion), P[tgt].y + (P[tgt].y < C.MID_Y ? 0.6 : -0.6));
    };

    if (call === 'man') {
      M(CB1, WR1, 5); M(CB2, WR2, 5); M(nearS, WR3, 4); M(teLB, TE, 3); M(LB2, RBK, 4);
      Z(farS, 17, C.MID_Y, 16, true);
      P[otherLB].role = 'spy';
    } else if (call === 'blitz') {
      // Five-man pressure: the tight end is the hot read, one safety stays deep.
      M(CB1, WR1, 1.6); M(CB2, WR2, 1.6); M(nearS, WR3, 3); M(LB2, RBK, 4);
      Z(farS, 18, C.MID_Y, 16, true);
      P[LB1].role = 'rush';
      P[LB3].role = 'rush';
      place(P[LB1], L + 3.2, by - 5.5);
      place(P[LB3], L + 3.2, by + 5.5);
      P[LB1].delay = 0.15;
      P[LB3].delay = 0.15;
    } else if (call === 'prevent') {
      Z(CB1, 17, 9, 9, true); Z(CB2, 17, W - 9, 9, true);
      Z(S1, 24, 19, 11, true); Z(S2, 24, W - 19, 11, true);
      Z(LB1, 10, 14, 8); Z(LB2, 12, C.MID_Y, 8); Z(LB3, 10, W - 14, 8);
    } else if (rng.chance(0.5)) {
      // Cover 2
      Z(CB1, 5, 8, 7); Z(CB2, 5, W - 8, 7);
      Z(LB1, 8, 17, 7); Z(LB2, 9, by, 7); Z(LB3, 8, W - 17, 7);
      Z(S1, 17, 13, 13, true); Z(S2, 17, W - 13, 13, true);
      play.coverage = 'cover2';
    } else {
      // Cover 3
      Z(CB1, 15, 8, 10, true); Z(CB2, 15, W - 8, 10, true);
      Z(farS, 18, C.MID_Y, 12, true);
      Z(nearS, 8, slotSide < 0 ? 19 : W - 19, 7);
      Z(LB1, 7, 11, 7); Z(LB2, 8, C.MID_Y, 7); Z(LB3, 7, W - 11, 7);
      play.coverage = 'cover3';
    }
    for (const idx of [DE1, DT1, DT2, DE2, LB1, LB2, LB3, CB1, CB2, S1, S2]) {
      const p = P[idx];
      p.react = (0.42 - p.cover * 0.26) * play.diff.react + rng.range(0, 0.08);
    }
  }

  function inSignFor(p, play) {
    if (p.i === RBK) return p.y < play.ballY - 0.5 ? 1 : p.y > play.ballY + 0.5 ? -1 : play.rng.chance(0.5) ? 1 : -1;
    return p.y < C.MID_Y ? 1 : -1;
  }

  function assignRoute(play, p, name) {
    const R = ROUTES[name];
    const sgn = inSignFor(p, play);
    const sc = play.rng.range(0.9, 1.12);
    p.route = R.pts.map(([dx, din]) => ({ x: p.x + dx * sc, y: clamp(p.y + din * sgn * (p.i === RBK ? 1 : sc), 2.2, W - 2.2) }));
    if (R.cont) {
      const a = p.route.length > 1 ? p.route[p.route.length - 2] : { x: p.x, y: p.y };
      const b = p.route[p.route.length - 1];
      const d = hyp(b.x - a.x, b.y - a.y) || 1;
      p.route.push({ x: b.x + ((b.x - a.x) / d) * 40, y: clamp(b.y + ((b.y - a.y) / d) * 40, 1.5, W - 1.5) });
    }
    p.routeName = name;
    p.wp = 0;
    p.role = 'route';
  }

  function setupPass(play, rng) {
    const P = play.players;
    for (const i of OL) P[i].role = 'pass_pro';
    P[QB].role = 'qb';
    P[QB].drop = { x: play.los - 6.6, y: play.ballY };
    assignRoute(play, P[WR1], rng.pick(POOLS.WR));
    assignRoute(play, P[WR2], rng.pick(POOLS.WR));
    assignRoute(play, P[WR3], rng.pick(play.formation === 'empty' ? POOLS.SLOT : POOLS.SLOT));
    const te = rng.pick(POOLS.TE);
    if (te === 'block') P[TE].role = 'pass_pro';
    else assignRoute(play, P[TE], te);
    if (play.formation === 'empty') assignRoute(play, P[RBK], rng.pick(POOLS.SLOT));
    else {
      const r = rng.pick(POOLS.RB);
      if (r === 'block') P[RBK].role = 'pass_pro';
      else assignRoute(play, P[RBK], r);
    }
  }

  function setupRun(play, rng) {
    const P = play.players, L = play.los, by = play.ballY;
    for (const i of OL) P[i].role = 'run_block';
    P[TE].role = 'run_block';
    for (const i of [WR1, WR2, WR3]) P[i].role = 'stalk';
    const gap = rng.pick([-5.5, -2.6, -1.3, 1.3, 2.6, 5.5]);
    play.gapY = by + gap;
    const rb = P[RBK];
    rb.role = 'runpath';
    rb.path = [
      // From an empty set the back motions in (jet sweep look).
      ...(play.formation === 'empty' ? [{ x: L - 3.6, y: by + (rb.y > by ? 2 : -2) }] : []),
      { x: L - 4.3, y: by + gap * 0.25 },
      { x: L + 0.6, y: clamp(by + gap, 2, W - 2) },
      { x: L + 14, y: clamp(by + gap * 1.25, 2, W - 2) },
    ];
    rb.wp = 0;
    P[QB].role = 'handoff';
  }

  // --- Helpers -----------------------------------------------------------------
  function steerTo(p, tx, ty, speed, arrive) {
    const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy);
    if (d < 0.02) { p.dvx = 0; p.dvy = 0; return d; }
    const s = arrive ? Math.min(speed, d * 3.2) : speed;
    p.dvx = (dx / d) * s;
    p.dvy = (dy / d) * s;
    return d;
  }
  function steerDir(p, dx, dy, speed) {
    const d = hyp(dx, dy) || 1;
    p.dvx = (dx / d) * speed;
    p.dvy = (dy / d) * speed;
  }
  function effSpeed(play, p) {
    let s = p.spd;
    if (p.side === 1) s *= play.diff.spd;
    if (play.wx.type === 'snow') s *= 0.95;
    if (play.wx.type === 'rain') s *= 0.98;
    if (p.slow > 0) s *= 0.62;
    if (play.carrier === p.i) s *= 0.95;
    return s;
  }
  // Where a receiver was `lag` seconds ago, projected forward by lead seconds.
  function lagged(play, idx, lag, lead) {
    const h = play.hist[idx];
    const k = Math.min(h.length - 1, Math.round(lag / C.DT));
    const e = k >= 0 ? h[k] : null;
    const p = play.players[idx];
    if (!e) return { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    return { x: e.x + e.vx * (lag + lead), y: e.y + e.vy * (lag + lead), vx: e.vx, vy: e.vy };
  }
  function carrierP(play) {
    return play.carrier >= 0 ? play.players[play.carrier] : null;
  }
  function event(play, type, text, extra) {
    play.events.push(Object.assign({ type, text, t: play.t }, extra || {}));
  }
  function nearestOpp(play, p, maxD, filter) {
    let best = null, bd = maxD;
    for (const q of play.players) {
      if (q.side === p.side || q.down > 0) continue;
      if (filter && !filter(q)) continue;
      const d = dist(p, q);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  // Intercept course: the point where a runner at speed s meets the carrier
  // if the carrier holds his current velocity. Falls back to a short lead.
  function pursuitPoint(p, c, s) {
    s = s || p.spd;
    const rx = c.x - p.x, ry = c.y - p.y;
    const a = c.vx * c.vx + c.vy * c.vy - s * s;
    const b = 2 * (rx * c.vx + ry * c.vy);
    const k = rx * rx + ry * ry;
    let t = -1;
    if (Math.abs(a) < 1e-3) t = b < 0 ? -k / b : -1;
    else {
      const disc = b * b - 4 * a * k;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
        t = Math.min(t1 > 0 ? t1 : 1e9, t2 > 0 ? t2 : 1e9);
        if (t === 1e9) t = -1;
      }
    }
    if (t < 0) t = Math.min(0.6, Math.sqrt(k) / Math.max(4, s));
    t = Math.min(t, 2.5);
    return { x: c.x + c.vx * t, y: c.y + c.vy * t };
  }
  // Once per play event: flip everyone who has to react to a new ball state.
  function setRead(play, sides) {
    for (const p of play.players) {
      if (!sides.includes(p.side)) continue;
      p.readAt = play.t + (p.react != null ? p.react : 0.25) + play.rng.range(0, 0.1);
    }
  }

  // --- AI: offense ---------------------------------------------------------------
  function aiOffense(play, p) {
    const P = play.players, spd = effSpeed(play, p), b = play.ball;
    const car = carrierP(play);
    if (p.eng >= 0) return; // engaged pairs are moved together
    if (p.stun > 0) { p.dvx *= 0.8; p.dvy *= 0.8; return; }

    if (play.turnover) {
      // After an interception or fumble return: chase the returner.
      if (car) { const t = pursuitPoint(p, car, spd); steerTo(p, t.x, t.y, spd); }
      return;
    }
    switch (p.role) {
      case 'qb': {
        const d = p.drop;
        steerTo(p, d.x, d.y, 4.2, true);
        break;
      }
      case 'handoff': {
        const rb = P[RBK];
        if (play.handedOff) { steerTo(p, p.x - 1.5, p.y, 2, true); break; }
        steerTo(p, (rb.x + p.x) / 2 + 0.2, (rb.y + p.y) / 2, 3.5, true);
        break;
      }
      case 'pass_pro': {
        // Get between the assigned rusher and the QB; spare blockers double-team.
        const q = P[QB];
        const best = p.pp >= 0 ? P[p.pp] : null;
        if (best) {
          const dx = q.x - best.x, dy = q.y - best.y, dq = hyp(dx, dy) || 1;
          steerTo(p, best.x + (dx / dq) * 0.9, best.y + (dy / dq) * 0.9, spd * 0.95, true);
          break;
        }
        let pair = null, bd = 3.5;
        for (const d of P) {
          if (d.side !== 1 || d.eng < 0) continue;
          const dd = dist(d, p);
          if (dd < bd) { bd = dd; pair = d; }
        }
        if (pair) steerTo(p, pair.x - 0.9, pair.y + (p.y < pair.y ? -0.7 : 0.7), spd * 0.8, true);
        else steerTo(p, p.x0 - 1.6, p.y0, 2.5, true);
        break;
      }
      case 'run_block': {
        const t = nearestOpp(play, p, 5, (d) => d.eng < 0 && d.x > p.x - 1);
        if (t) steerTo(p, t.x - 0.3, t.y, spd * 0.9);
        else steerTo(p, p.x + 3, p.y, spd * 0.6);
        break;
      }
      case 'stalk': {
        const t = nearestOpp(play, p, 9, (d) => d.eng < 0);
        if (t) steerTo(p, t.x - 0.5, t.y, spd * 0.85);
        else steerTo(p, p.x + 3, p.y, spd * 0.5);
        break;
      }
      case 'runpath': {
        const wp = p.path[Math.min(p.wp, p.path.length - 1)];
        if (steerTo(p, wp.x, wp.y, spd) < 0.8 && p.wp < p.path.length - 1) p.wp++;
        break;
      }
      case 'route': {
        if (p.track) { trackBall(play, p, spd); break; }
        const wp = p.route[Math.min(p.wp, p.route.length - 1)];
        const d = steerTo(p, wp.x, wp.y, spd, p.wp === p.route.length - 1);
        if (d < 0.7 && p.wp < p.route.length - 1) p.wp++;
        break;
      }
      case 'escort': {
        if (!car) break;
        let best = null, bd = 10;
        for (const d of P) {
          if (d.side !== 1 || d.eng >= 0 || d.down > 0 || d.shedCd > 0) continue;
          const dc = dist(d, car);
          if (dc < bd && d.x > car.x - 3) { bd = dc; best = d; }
        }
        if (best) {
          const dx = car.x - best.x, dy = car.y - best.y, dd = hyp(dx, dy) || 1;
          steerTo(p, best.x + (dx / dd) * 0.7, best.y + (dy / dd) * 0.7, spd * 0.95);
        } else steerTo(p, car.x + 4, car.y + (p.y > car.y ? 3 : -3), spd * 0.8);
        break;
      }
      default:
        p.dvx *= 0.9;
        p.dvy *= 0.9;
    }
  }

  // Receiver running under a thrown ball: pace to arrive with it, never braking
  // on the last step (a trailing defender would run past him).
  function trackBall(play, p, spd) {
    const b = play.ball;
    const tRem = Math.max(0.05, b.T - b.bt);
    const dx = b.tx - p.x, dy = b.ty - p.y, d = hyp(dx, dy);
    if (d < 0.3) {
      if (tRem > 0.12) { p.dvx = dx * 2; p.dvy = dy * 2; }
      else { p.dvx = p.vx; p.dvy = p.vy; }
      return;
    }
    const s = clamp(d / tRem, spd * 0.6, spd);
    p.dvx = (dx / d) * s;
    p.dvy = (dy / d) * s;
  }

  // --- AI: defense ---------------------------------------------------------------
  function aiDefense(play, p) {
    const P = play.players, b = play.ball, spd = effSpeed(play, p);
    const car = carrierP(play);
    if (p.eng >= 0) return;
    if (p.down > 0 || p.stun > 0) { p.dvx *= 0.85; p.dvy *= 0.85; return; }

    if (play.turnover) {
      if (p.i === play.carrier) { returnerAI(play, p, spd); return; }
      const t = nearestOpp(play, p, 12, (o) => o.eng < 0);
      if (t && car && dist(t, car) < 10) {
        const dx = car.x - t.x, dy = car.y - t.y, dd = hyp(dx, dy) || 1;
        steerTo(p, t.x + (dx / dd) * 0.6, t.y + (dy / dd) * 0.6, spd * 0.9);
      } else if (car) steerTo(p, car.x - 4, car.y, spd * 0.8);
      return;
    }

    const reading = play.t < p.readAt;
    let role = p.role;
    let sMul = 1;
    // Ball carrier past the line (or anyone but the QB holding it): everyone pursues.
    if (car && car.i !== QB) {
      if (!reading) role = 'pursue';
      else if (play.thrown) { role = 'pursue'; sMul = 0.75; }
    } else if (car && car.i === QB && play.scramble && !reading) role = 'pursue';
    else if (b.st === 'air' && !reading && role !== 'rush') role = 'ball';
    else if (b.st === 'air' && role === 'rush') role = 'drift';

    switch (role) {
      case 'rush': {
        if (p.delay && play.t < p.delay) { p.dvx = 0; p.dvy = 0; break; }
        const tgt = car || P[QB];
        steerTo(p, tgt.x, tgt.y, spd);
        break;
      }
      case 'drift': {
        steerTo(p, p.x - 0.5, p.y, 2.5, true);
        break;
      }
      case 'pursue': {
        if (!car) break;
        const t = pursuitPoint(p, car, spd);
        steerTo(p, t.x, t.y, spd * sMul);
        break;
      }
      case 'ball': {
        // Play the ball if you can get there; otherwise take an angle on the
        // receiver so you are in front of him when he catches it.
        const tRem = Math.max(0.05, b.T - b.bt);
        const d = dist(p, { x: b.tx, y: b.ty });
        const r = b.target >= 0 ? P[b.target] : null;
        if (d < spd * tRem + 1.2 || !r) steerTo(p, b.tx, b.ty, spd, true);
        else {
          const ghost = { x: b.tx, y: b.ty, vx: r.vx, vy: r.vy };
          const t = pursuitPoint(p, ghost, spd);
          steerTo(p, t.x, t.y, spd);
        }
        break;
      }
      case 'man': {
        const r = P[p.man];
        const e = lagged(play, r.i, p.react, 0.15);
        const run = Math.max(0, r.x - r.x0);
        const cush = Math.max(0.7, p.cush0 - run * 0.62);
        const inside = r.y < C.MID_Y ? 0.5 : -0.5;
        let tx = e.x + cush, ty = e.y + inside;
        if (r.role === 'pass_pro') { tx = play.los + 3; ty = r.y; }
        if (!play.thrown) tx = Math.max(tx, play.los + 1);
        steerTo(p, tx, ty, spd, true);
        break;
      }
      case 'zone': {
        const z = p.zone;
        const zx = Math.min(play.los + z.dx, 118.5), zy = z.y;
        let best = null, bs = 1e9;
        let deepest = -1e9;
        for (const i of ELIGIBLE) {
          const r = P[i];
          if (r.role !== 'route') continue;
          if (r.x > deepest && Math.abs(r.y - zy) < z.r + 6) deepest = r.x;
          const dz = hyp(r.x - zx, r.y - zy);
          if (dz < z.r + 1.5) {
            const sc = dz - (z.deep ? (r.x - play.los) * 0.35 : 0);
            if (sc < bs) { bs = sc; best = r; }
          }
        }
        let tx = zx, ty = zy;
        if (best) {
          const e = lagged(play, best.i, p.react, 0.2);
          tx = e.x + (z.deep ? 2.6 : 1.0);
          ty = e.y;
          const dx = tx - zx, dy = ty - zy, dd = hyp(dx, dy), leash = z.r + 2.5;
          if (dd > leash) { tx = zx + (dx / dd) * leash; ty = zy + (dy / dd) * leash; }
        }
        if (z.deep) tx = Math.max(tx, Math.min(deepest + 3, 118.5), zx - 3);
        steerTo(p, tx, ty, spd, true);
        break;
      }
      case 'spy': {
        const q = P[QB];
        steerTo(p, Math.max(play.los + 4.5, q.x + 5), q.y, spd * 0.8, true);
        break;
      }
      default:
        p.dvx *= 0.9;
        p.dvy *= 0.9;
    }
  }

  function returnerAI(play, p, spd) {
    // Run for the offense's end zone (-x), bending away from the closest chasers.
    let ax = -1, ay = 0;
    for (const q of play.players) {
      if (q.side !== 0 || q.down > 0) continue;
      const dx = p.x - q.x, dy = p.y - q.y, d = hyp(dx, dy);
      if (d < 7 && q.x < p.x + 2) {
        const w = (7 - d) / 7;
        ay += (dy >= 0 ? 1 : -1) * w * 1.3;
      }
    }
    if (p.y < 4) ay += 0.6;
    if (p.y > W - 4) ay -= 0.6;
    steerDir(p, ax, ay, spd);
  }

  // --- Blocking ----------------------------------------------------------------
  // Greedy one-to-one matching of free pass blockers to free rushers.
  function assignProtection(play) {
    const P = play.players;
    const blockers = [], rushers = [];
    for (const p of P) {
      if (p.side === 0 && p.role === 'pass_pro') { p.pp = -1; if (p.eng < 0 && p.stun <= 0) blockers.push(p); }
      if (p.side === 1 && p.role === 'rush' && p.eng < 0 && p.down <= 0) rushers.push(p);
    }
    if (!blockers.length || !rushers.length) return;
    const q = P[QB];
    const pairs = [];
    for (const b of blockers) {
      for (const d of rushers) {
        const behind = d.x < b.x - 0.5 ? 3 : 0; // already beaten this blocker
        pairs.push({ b, d, c: Math.abs(d.y - b.y) + dist(d, b) * 0.4 + dist(d, q) * 0.15 + behind });
      }
    }
    pairs.sort((u, v) => u.c - v.c);
    const takenD = new Set();
    for (const { b, d } of pairs) {
      if (b.pp >= 0 || takenD.has(d.i)) continue;
      b.pp = d.i;
      takenD.add(d.i);
    }
  }

  function tryEngage(play) {
    const P = play.players;
    for (let i = 0; i < 11; i++) {
      const a = P[i];
      if (a.eng >= 0 || a.stun > 0 || a.i === play.carrier) continue;
      if (!['pass_pro', 'run_block', 'stalk', 'escort'].includes(a.role) || play.turnover) continue;
      for (let j = 11; j < 22; j++) {
        const d = P[j];
        if (d.eng >= 0 || d.shedCd > 0 || d.down > 0 || d.i === play.carrier) continue;
        if (dist(a, d) > 0.95) continue;
        if (a.role === 'pass_pro' && play.ball.st === 'air') continue;
        engage(play, a, d);
        break;
      }
    }
  }

  function engage(play, a, d) {
    const rng = play.rng;
    let hold;
    if (a.role === 'pass_pro') {
      const edge = (a.block - d.rush) * 5;
      hold = (1.5 + edge * 0.35 + -Math.log(1 - rng.next()) * clamp(3.1 + edge, 1.2, 6)) * play.diff.hold;
    } else if (a.role === 'run_block') {
      const edge = (a.block - (d.rush + d.tackle) / 2) * 4;
      hold = 0.5 + -Math.log(1 - rng.next()) * clamp(1.3 + edge, 0.5, 3.2);
    } else {
      hold = 0.25 + -Math.log(1 - rng.next()) * (0.45 + a.block * 0.6);
    }
    a.eng = d.i;
    d.eng = a.i;
    a.engT = 0;
    a.hold = Math.max(0.25, hold);
    a.engKind = a.role;
  }

  function updatePairs(play, dt) {
    const P = play.players;
    const car = carrierP(play);
    const q = P[QB];
    for (let i = 0; i < 11; i++) {
      const a = P[i];
      if (a.eng < 0) continue;
      const d = P[a.eng];
      // A free OL next to the pair makes it a double team.
      let help = false;
      for (const k of OL) {
        const h = P[k];
        if (h !== a && h.eng < 0 && dist(h, d) < 1.6) { help = true; break; }
      }
      a.engT += dt * (help ? 0.5 : 1);
      const goal = car && car.side === 0 ? car : q;
      let ux = goal.x - d.x, uy = goal.y - d.y;
      const ul = hyp(ux, uy) || 1;
      ux /= ul; uy /= ul;
      let rate;
      if (a.engKind === 'pass_pro') rate = clamp(0.55 + (d.rush - a.block) * 3, 0.05, 1.8) * (help ? 0.4 : 1);
      else if (a.engKind === 'run_block') rate = clamp(-0.4 + ((d.rush + d.tackle) / 2 - a.block) * 3, -1.4, 1.2);
      else rate = 0.3;
      d.vx = ux * rate; d.vy = uy * rate;
      d.x += d.vx * dt; d.y += d.vy * dt;
      a.x = d.x - ux * 0.78; a.y = d.y - uy * 0.78;
      a.vx = d.vx; a.vy = d.vy;
      a.face = ux > 0 ? -1 : 1;
      d.face = -a.face;
      if (a.engT >= a.hold || (play.ball.st === 'air' && a.engKind === 'pass_pro' && a.engT > 0.4)) {
        a.eng = -1; d.eng = -1;
        d.shedCd = 1.0;
        a.stun = 0.35;
      }
    }
  }

  // --- Ball --------------------------------------------------------------------
  function maxRange(qb) {
    return 38 + qb.arm * 28;
  }

  // Aim target clamped to the QB's arm, used by both the preview and the throw.
  function clampAim(play, tx, ty) {
    const q = play.players[QB];
    const dx = tx - q.x, dy = ty - q.y, d = hyp(dx, dy), m = maxRange(q);
    if (d <= m) return { x: tx, y: ty, d, max: false };
    return { x: q.x + (dx / d) * m, y: q.y + (dy / d) * m, d: m, max: true };
  }
  function flightTime(qb, d) {
    return (0.22 + d * 0.034) * (1.18 - qb.arm * 0.3);
  }

  function canThrow(play) {
    const b = play.ball;
    return play.kind === 'pass' && !play.thrown && b.st === 'held' && b.holder === QB && !play.scramble && play.phase === 'live';
  }

  function throwBall(play, tx, ty) {
    if (!canThrow(play)) return false;
    const P = play.players, q = P[QB], b = play.ball, rng = play.rng;
    const aim = clampAim(play, tx, ty);
    const d = aim.d;
    const rusher = nearestOpp(play, q, 2.6, (o) => o.eng < 0);
    const moving = hyp(q.vx, q.vy) > 2.2;
    let sigma = (0.2 + d * (0.011 + (1 - q.acc) * 0.05)) * (1 + (rusher ? 1.1 : 0) + (moving ? 0.5 : 0));
    if (play.wx.type === 'rain') sigma *= 1.15;
    const lx = aim.x + rng.gauss() * sigma;
    const ly = aim.y + rng.gauss() * sigma * 0.8;
    const T = flightTime(q, d);
    b.st = 'air';
    b.holder = -1;
    b.fx = q.x + 0.3; b.fy = q.y; b.z0 = 2.0;
    b.tx = lx; b.ty = ly; b.T = T; b.bt = 0;
    b.vz0 = (1.5 - b.z0 + 0.5 * C.GRAVITY * T * T) / T;
    b.resolved = false;
    play.thrown = true;
    play.carrier = -1;
    play.stats.passAtt = 1;
    play.landing = { x: lx, y: ly };
    q.role = 'idle';
    // The receiver who can get there adjusts to the throw.
    let best = null, bn = 1e9;
    for (const i of ELIGIBLE) {
      const r = P[i];
      if (r.role !== 'route') continue;
      const pr = predictRoute(play, r, T);
      const need = hyp(pr.x - lx, pr.y - ly);
      const direct = hyp(r.x - lx, r.y - ly) / effSpeed(play, r);
      const reach = 1.4 + 2.4 * T;
      if ((need <= reach || direct <= T + 0.05) && need < bn) { bn = need; best = r; }
    }
    if (best) { best.track = { x: lx, y: ly }; b.target = best.i; }
    else b.target = -1;
    b.batted = false;
    for (const d of P) {
      if (d.side !== 1 || d.role !== 'rush' || d.down > 0) continue;
      if (d.x > q.x - 0.3 && dist(d, q) < 1.5 && rng.chance(0.05)) { b.batted = true; break; }
    }
    setRead(play, [1]);
    event(play, 'throw', '');
    return true;
  }

  // Forward-simulates a receiver's route to guess where he'll be in T seconds.
  function predictRoute(play, r, T) {
    const g = { x: r.x, y: r.y, vx: r.vx, vy: r.vy, dvx: 0, dvy: 0, wp: r.wp, route: r.route, spd: r.spd };
    const spd = effSpeed(play, r);
    for (let t = 0; t < T; t += C.DT * 2) {
      const wp = g.route[Math.min(g.wp, g.route.length - 1)];
      const d = steerTo(g, wp.x, wp.y, spd, g.wp === g.route.length - 1);
      if (d < 0.7 && g.wp < g.route.length - 1) g.wp++;
      integrate(g, 11, C.DT * 2);
    }
    return g;
  }

  function updateBall(play, dt) {
    const P = play.players, b = play.ball;
    if (b.st === 'snap') {
      b.bt += dt;
      const q = P[QB], u = Math.min(1, b.bt / 0.24);
      b.x = b.fx + (q.x + 0.3 - b.fx) * u;
      b.y = b.fy + (q.y - b.fy) * u;
      b.z = 0.4 + Math.sin(u * Math.PI) * 0.5 + u * 0.8;
      if (u >= 1) { b.st = 'held'; b.holder = QB; play.carrier = QB; }
      return;
    }
    if (b.st === 'held') {
      const h = P[b.holder];
      b.x = h.x + 0.25 * h.face; b.y = h.y + 0.05; b.z = 1.2;
      return;
    }
    if (b.st === 'air') {
      b.bt += dt;
      const u = b.bt / b.T;
      b.x = b.fx + (b.tx - b.fx) * u;
      b.y = b.fy + (b.ty - b.fy) * u;
      b.z = b.z0 + b.vz0 * b.bt - 0.5 * C.GRAVITY * b.bt * b.bt;
      if (!b.resolved) resolveCatch(play);
      if (b.st === 'air' && b.z <= 0) {
        b.z = 0;
        incomplete(play, 'INCOMPLETE');
      }
      return;
    }
    if (b.st === 'dead') {
      // Loose incompletion bounces to a stop.
      b.vz -= C.GRAVITY * dt;
      b.z = Math.max(0, b.z + b.vz * dt);
      if (b.z === 0) b.vz = Math.abs(b.vz) * 0.35;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= 0.96; b.vy *= 0.96;
    }
  }

  function resolveCatch(play) {
    const P = play.players, b = play.ball, rng = play.rng;
    if (b.batted) {
      if (b.bt > 0.12) incomplete(play, 'BATTED DOWN');
      return;
    }
    if (b.z > 2.9) return;
    const early = b.bt < b.T - 0.1;
    if (early) {
      // A low throw can be jumped by a defender sitting in the lane.
      if (b.bt < 0.18 || b.z > 2.3) return;
      for (const p of P) {
        if (p.side !== 1 || p.down > 0 || p.eng >= 0 || p.tipTry) continue;
        if (hyp(p.x - b.x, p.y - b.y) > 0.5) continue;
        p.tipTry = true;
        if (rng.chance((0.1 + p.hands * 0.3) * play.diff.ints * 0.6)) return intercept(play, p);
        if (rng.chance(0.5)) return incomplete(play, 'BROKEN UP');
      }
      return;
    }
    // Contest the ball where it comes down; after that, wherever it is now.
    const bx = b.bt < b.T ? b.tx : b.x, by = b.bt < b.T ? b.ty : b.y;
    const cands = [];
    for (const p of P) {
      if (p.i === QB || p.down > 0 || p.eng >= 0) continue;
      if (p.side === 0 && (OL.includes(p.i) || p.role === 'pass_pro')) continue;
      const reach = p.side === 0 ? 1.15 : 1.0;
      const d = hyp(p.x - bx, p.y - by);
      if (d <= reach) cands.push({ p, d: d - (p.side === 0 && p.track ? 0.35 : 0), raw: d, reach });
    }
    if (!cands.length) return;
    cands.sort((a, c) => a.d - c.d);
    const first = cands[0].p;
    b.resolved = true;
    const contest = cands.filter((c) => c.p.side === 1);
    const rec = cands.find((c) => c.p.side === 0);
    const oob = (p) => p.y <= 0 || p.y >= W || p.x >= C.FIELD_LEN;
    const catchChance = (c) => {
      let pc = c.p.hands + 0.05 - 0.1 * (c.raw / c.reach);
      for (const k of contest) pc -= 0.15 + k.p.cover * 0.2;
      if (play.wx.type === 'rain') pc -= 0.06;
      if (play.wx.type === 'snow') pc -= 0.03;
      return clamp(pc, 0.1, 0.97);
    };
    if (first.side === 0) {
      if (oob(first)) return incomplete(play, 'OUT OF BOUNDS');
      if (rng.chance(catchChance(cands[0]))) return catchBall(play, first);
      if (contest.length && rng.chance(0.14 * play.diff.ints)) return intercept(play, contest[0].p);
      return incomplete(play, contest.length ? 'BROKEN UP' : 'DROPPED');
    }
    let pi = (0.1 + first.hands * 0.3) * play.diff.ints;
    if (rec) pi *= 0.6;
    if (oob(first)) return incomplete(play, 'INCOMPLETE');
    if (rng.chance(pi)) return intercept(play, first);
    if (rec && !oob(rec.p) && rng.chance(catchChance(rec) * 0.5)) return catchBall(play, rec.p);
    return incomplete(play, 'BROKEN UP');
  }

  function catchBall(play, p) {
    const b = play.ball;
    b.st = 'held'; b.holder = p.i;
    play.carrier = p.i;
    play.ctrl = p.i;
    play.manual = false;
    play.stats.comp = 1;
    play.stats.receiver = p.i;
    p.track = null;
    p.role = 'carrier';
    p.slow = 0.25;
    for (const q of play.players) if (q.side === 0 && q.i !== p.i) { q.role = 'escort'; q.track = null; }
    // Defenders read the catch faster the closer they are to it.
    for (const q of play.players) {
      if (q.side !== 1) continue;
      q.readAt = play.t + (q.react || 0.25) * Math.min(1, dist(q, p) / 8);
    }
    event(play, 'catch', 'CATCH', { who: p.i });
    if (p.x >= C.GOAL_R) return touchdown(play);
    // A defender arriving with the ball gets a shot at him as he secures it.
    for (const d of play.players) {
      if (d.side !== 1 || d.eng >= 0 || d.down > 0 || dist(d, p) > 1.5) continue;
      d.tackleCd = 0.6;
      if (play.rng.chance(clamp(tackleOdds(play, d, p) - 0.12, 0.2, 0.9))) {
        event(play, 'hit', '');
        return tackled(play, p, d);
      }
      d.down = 0.5;
    }
  }

  function intercept(play, d) {
    const b = play.ball;
    b.st = 'held'; b.holder = d.i;
    play.carrier = d.i;
    play.turnover = true;
    play.stats.int = 1;
    d.role = 'returner';
    d.eng = -1;
    for (const q of play.players) {
      q.track = null;
      if (q.eng >= 0) { play.players[q.eng].eng = -1; q.eng = -1; }
    }
    setRead(play, [0]);
    event(play, 'int', 'INTERCEPTED!', { who: d.i });
  }

  function incomplete(play, text) {
    const b = play.ball;
    b.st = 'dead';
    b.resolved = true;
    b.vx = (b.tx - b.fx) / b.T * 0.3;
    b.vy = (b.ty - b.fy) / b.T * 0.3;
    b.vz = 2.2;
    for (const p of play.players) p.track = null;
    endPlay(play, { kind: 'inc', x: play.los, y: play.ballY, text, stop: true });
  }

  // --- Tackles & dead ball -------------------------------------------------------
  function checkTackles(play, dt) {
    const car = carrierP(play);
    if (!car || play.phase !== 'live') return;
    if (car.dive > 0) return;
    const rng = play.rng;
    for (const d of play.players) {
      if (d.side === car.side || d.down > 0 || d.tackleCd > 0) continue;
      const dd = dist(d, car);
      const r = d.eng >= 0 ? 0.62 : 0.88;
      if (dd <= r) {
        if (car.juke > 0 && d.eng < 0) {
          d.down = 0.9;
          d.tackleCd = 0.9;
          event(play, 'juke', '');
          continue;
        }
        let p = tackleOdds(play, d, car);
        if (d.eng >= 0) p *= 0.4;
        if (car.i === QB && !play.scramble && play.ball.holder === QB) p += 0.12;
        if (rng.chance(clamp(p, 0.3, 0.97))) { tackled(play, car, d); return; }
        d.tackleCd = 0.7;
        if (d.eng < 0) d.down = 0.55;
        car.slow = 0.3;
        event(play, 'broken', '');
        continue;
      }
      // Diving tackle from just out of reach, mostly on chases from behind.
      if (dd <= 2.3 && d.eng < 0 && d.i !== play.humanDefIdx && rng.chance(dt * 2.4)) {
        d.tackleCd = 1.2;
        d.lunge = 0.3;
        const ux = (car.x - d.x) / dd, uy = (car.y - d.y) / dd;
        d.vx = ux * 8; d.vy = uy * 8;
        const p = car.juke > 0 ? 0 : tackleOdds(play, d, car) - 0.2 - (dd - 0.9) * 0.25;
        if (rng.chance(clamp(p, 0, 0.8))) {
          d.x = car.x - ux * 0.7; d.y = car.y - uy * 0.7;
          tackled(play, car, d);
          return;
        }
        d.down = 1.0;
        event(play, 'broken', '');
      }
    }
  }

  function tackleOdds(play, d, car) {
    if (d.side === 1) return 0.7 + (d.tackle - car.elus) * 0.9 + play.diff.tackle;
    return 0.64 + (d.str || 0.5) * 0.18 - car.elus * 0.2;
  }

  function tackled(play, car, d) {
    car.down = 99;
    d.down = 99;
    d.vx = car.vx * 0.5; d.vy = car.vy * 0.5;
    const fwd = car.side === 0 ? (car.vx > 1 ? 0.5 : 0.1) : (car.vx < -1 ? -0.5 : -0.1);
    const x = car.x + fwd;
    // Fumbles are rare, a little more likely for weak or tired carriers.
    let pf = 0.009 * (1.4 - (car.str || 0.5));
    if (car.i === QB && !play.scramble) pf = 0.05;
    if (play.wx.type === 'rain') pf *= 1.6;
    if (play.rng.chance(pf) && !play.turnover) {
      const defRecovers = play.rng.chance(0.55);
      event(play, 'fumble', 'FUMBLE!');
      if (defRecovers) {
        play.stats.fum = 1;
        endPlay(play, { kind: 'fumble', x, y: car.y, text: 'FUMBLE! LOST', stop: true, turnover: true });
        return;
      }
      event(play, 'fumble', 'RECOVERED');
    }
    deadAt(play, car, x, 'tackle');
  }

  function deadAt(play, car, x, how) {
    const y = car.y;
    if (play.turnover) {
      if (x >= C.GOAL_R) return endPlay(play, { kind: 'int_tb', x, y, text: 'TOUCHBACK', stop: true, turnover: true });
      return endPlay(play, { kind: 'int', x, y, text: play.events.some((e) => e.type === 'int') ? 'INTERCEPTED!' : 'TURNOVER', stop: true, turnover: true });
    }
    if (x <= C.GOAL_L) return endPlay(play, { kind: 'safety', x, y, text: 'SAFETY!', stop: true });
    const sack = car.i === QB && !play.scramble && !play.thrown && play.kind === 'pass' && x < play.los;
    if (sack) play.stats.sack = 1;
    endPlay(play, { kind: how === 'oob' ? 'oob' : sack ? 'sack' : 'tackle', x, y, text: sack ? 'SACKED!' : how === 'oob' ? 'OUT OF BOUNDS' : '', stop: how === 'oob' });
  }

  function touchdown(play) {
    const car = carrierP(play);
    endPlay(play, { kind: 'td', x: C.GOAL_R, y: car ? car.y : play.ballY, text: 'TOUCHDOWN!', stop: true });
  }

  function endPlay(play, res) {
    if (play.phase !== 'live') return;
    play.phase = 'dead';
    play.deadT = 0;
    const st = play.stats;
    const yds = Math.round(clamp(res.x, C.GOAL_L, C.GOAL_R) - play.los);
    if (!play.turnover && res.kind !== 'inc') {
      if (st.comp) st.passYds = yds;
      else if (play.carrier >= 0) {
        st.rushAtt = st.sack ? 0 : 1;
        st.rushYds = st.sack ? 0 : yds;
        st.rusher = play.carrier;
      }
    }
    if (st.sack) st.sackYds = yds;
    if (res.kind === 'fumble' && st.comp) st.passYds = yds;
    res.yds = yds;
    res.stats = st;
    res.carrier = play.carrier;
    play.result = res;
    event(play, 'dead', res.text || '');
    if (play.ball.st === 'held') play.ball.st = 'down';
  }

  function checkBounds(play) {
    const car = carrierP(play);
    if (!car || play.phase !== 'live') return;
    if (car.side === 0 && !play.turnover) {
      if (car.x >= C.GOAL_R && play.ball.holder === car.i) return touchdown(play);
      if (car.i === QB && !play.scramble && car.x > play.los + 0.3) {
        play.scramble = true;
        setRead(play, [1]);
      }
    }
    if (play.turnover && car.x <= C.GOAL_L) {
      return endPlay(play, { kind: 'int_td', x: C.GOAL_L, y: car.y, text: 'PICK SIX!', stop: true, turnover: true });
    }
    if (car.y <= 0.05 || car.y >= W - 0.05 || car.x < 0.2 || car.x > C.FIELD_LEN - 0.2) {
      car.y = clamp(car.y, 0, W);
      deadAt(play, car, car.x, 'oob');
    }
  }

  // --- Physics -----------------------------------------------------------------
  function integrate(p, accel, dt) {
    let ax = p.dvx - p.vx, ay = p.dvy - p.vy;
    const a = hyp(ax, ay), m = accel * dt;
    if (a > m) { ax *= m / a; ay *= m / a; }
    p.vx += ax; p.vy += ay;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }

  function separate(play) {
    const P = play.players;
    for (let i = 0; i < 22; i++) {
      const a = P[i];
      for (let j = i + 1; j < 22; j++) {
        const b = P[j];
        if (a.eng === j || a.down > 5 || b.down > 5) continue;
        if ((a.i === play.carrier || b.i === play.carrier) && a.side !== b.side) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy);
        if (d > 0.78 || d < 1e-4) continue;
        const push = (0.78 - d) / 2;
        const ux = dx / d, uy = dy / d;
        const wa = a.eng >= 0 || a.track ? 0.2 : 1, wb = b.eng >= 0 || b.track ? 0.2 : 1;
        a.x -= ux * push * wa; a.y -= uy * push * wa;
        b.x += ux * push * wb; b.y += uy * push * wb;
      }
    }
  }

  // --- Input for the controlled player -----------------------------------------
  function applyUserInput(play, input, dt) {
    const P = play.players;
    const b = play.ball;
    if (play.phase !== 'live') return;
    if (input.throwAt && canThrow(play)) throwBall(play, input.throwAt.x, input.throwAt.y);

    const car = carrierP(play);
    const ctrl = car && car.side === 0 && !play.turnover ? car : null;
    if (!ctrl) return false;
    if (ctrl.i === RBK && ctrl.role === 'runpath' && !play.handedOff) return false;
    const spd = effSpeed(play, ctrl);

    if (ctrl.dive > 0) {
      ctrl.dive -= dt;
      steerDir(ctrl, ctrl.divX, ctrl.divY, spd * 1.25);
      if (ctrl.dive <= 0) {
        ctrl.down = 99;
        if (ctrl.x >= C.GOAL_R && !play.turnover) touchdown(play);
        else deadAt(play, ctrl, ctrl.x, 'tackle');
      }
      return true;
    }
    if (input.dive && (ctrl.i !== QB || play.scramble)) {
      ctrl.dive = 0.36;
      const d = hyp(input.dive.x, input.dive.y) || 1;
      ctrl.divX = input.dive.x / d; ctrl.divY = input.dive.y / d;
      event(play, 'dive', '');
      return true;
    }
    if (input.juke && ctrl.jukeCd <= 0) {
      const threat = nearestOpp(play, ctrl, 6);
      let px = -ctrl.vy, py = ctrl.vx;
      const pl = hyp(px, py);
      if (pl < 0.5) { px = 0; py = 1; } else { px /= pl; py /= pl; }
      if (threat && (threat.x - ctrl.x) * px + (threat.y - ctrl.y) * py > 0) { px = -px; py = -py; }
      ctrl.vx += px * 4.5; ctrl.vy += py * 4.5;
      ctrl.juke = 0.42;
      ctrl.jukeCd = 1.15;
      event(play, 'jukeMove', '');
    }
    if (input.aiming && ctrl.i === QB && canThrow(play)) {
      ctrl.dvx = 0; ctrl.dvy = 0;
      return true;
    }
    if (input.joy) {
      play.manual = true;
      steerDir(ctrl, input.joy.x, input.joy.y, spd * Math.min(1, hyp(input.joy.x, input.joy.y)));
      if (ctrl.i === QB) ctrl.drop = { x: ctrl.x, y: ctrl.y };
      return true;
    }
    if (ctrl.i === QB && !play.scramble) return false; // QB holds his spot in the pocket
    if (ctrl.i === RBK && ctrl.role === 'runpath' && !play.manual && ctrl.wp < ctrl.path.length - 1) return false;
    // No input: keep running upfield, straightening out.
    const lat = clamp(ctrl.vy / Math.max(1, spd), -0.6, 0.6) * 0.55;
    steerDir(ctrl, 1, lat, spd);
    return true;
  }

  function applyDefenderInput(play, input) {
    const i = play.humanDefIdx;
    if (i < 11 || !input.defJoy || play.phase !== 'live') return false;
    const p = play.players[i];
    if (p.eng >= 0 || p.down > 0) return false;
    if (play.turnover && play.carrier === i) {
      steerDir(p, input.defJoy.x, input.defJoy.y, effSpeed(play, p));
      return true;
    }
    steerDir(p, input.defJoy.x, input.defJoy.y, effSpeed(play, p) * Math.min(1, hyp(input.defJoy.x, input.defJoy.y)));
    return true;
  }

  // --- Main step -----------------------------------------------------------------
  function step(play, dt, input) {
    input = input || {};
    const P = play.players;
    if (play.phase === 'pre') return;
    play.t += dt;
    for (const p of P) {
      p.stun = Math.max(0, p.stun - dt);
      p.shedCd = Math.max(0, p.shedCd - dt);
      p.tackleCd = Math.max(0, p.tackleCd - dt);
      p.juke = Math.max(0, p.juke - dt);
      p.jukeCd = Math.max(0, p.jukeCd - dt);
      p.slow = Math.max(0, p.slow - dt);
      if (p.lunge) p.lunge = Math.max(0, p.lunge - dt);
      if (p.down > 0 && p.down < 50) p.down = Math.max(0, p.down - dt);
    }

    if (play.phase === 'dead') {
      play.deadT += dt;
      for (const p of P) {
        const f = p.down > 5 ? 0.86 : 0.93;
        p.vx *= f; p.vy *= f;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      updateBall(play, dt);
      return;
    }

    // Handoff on run plays.
    if (play.kind === 'run' && !play.handedOff && play.ball.st === 'held') {
      const q = P[QB], rb = P[RBK];
      if ((play.t > 0.3 && dist(q, rb) < 1.5) || play.t > 1.1) {
        play.handedOff = true;
        play.ball.holder = RBK;
        play.carrier = RBK;
        play.ctrl = RBK;
        setRead(play, [1]);
        event(play, 'handoff', '');
      }
    }

    if (play.kind === 'pass' && !play.thrown) assignProtection(play);
    const userMoved = applyUserInput(play, input, dt);
    const defMoved = applyDefenderInput(play, input);
    if (play.phase !== 'live') return;
    const car = carrierP(play);
    for (const p of P) {
      if (p.down > 0) { p.dvx = 0; p.dvy = 0; continue; }
      if (userMoved && car && p === car && !play.turnover) continue;
      if (defMoved && p.i === play.humanDefIdx) continue;
      if (p.side === 0) {
        if (p === car && !play.turnover && p.role !== 'runpath' && p.role !== 'qb' && p.role !== 'handoff') {
          const spd = effSpeed(play, p);
          steerDir(p, 1, clamp(p.vy / Math.max(1, spd), -0.6, 0.6) * 0.55, spd);
        } else aiOffense(play, p);
      } else aiDefense(play, p);
    }
    tryEngage(play);
    for (const p of P) {
      if (p.eng >= 0) continue;
      const acc = p.i === play.carrier ? 14 : p.side === 0 ? 11 : 10.5;
      integrate(p, acc, dt);
      if (Math.abs(p.vx) > 0.3) p.face = p.vx > 0 ? 1 : -1;
      if (p.i !== play.carrier) p.y = clamp(p.y, -1.5, W + 1.5);
    }
    updatePairs(play, dt);
    separate(play);
    updateBall(play, dt);
    if (play.phase === 'live') checkTackles(play, dt);
    if (play.phase === 'live') checkBounds(play);

    for (const p of P) {
      const h = play.hist[p.i];
      h.unshift({ x: p.x, y: p.y, vx: p.vx, vy: p.vy });
      if (h.length > 40) h.pop();
    }
  }

  // --- AI play calling (defense and the auto QB used by tests) ------------------
  function aiDefCall(rng, ctx) {
    const { down, toGo, ballOn, lead, secsLeft, q } = ctx;
    const w = { man: 3, zone: 4, blitz: 1.5, prevent: 0.3 };
    if (down === 3 && toGo >= 7) { w.blitz += 1.5; w.zone += 1; }
    if (toGo <= 2) { w.man += 2; w.blitz += 1; }
    if (ballOn > 85) { w.man += 1.5; w.prevent = 0; }
    if (q >= 4 && lead > 0 && lead <= 16 && secsLeft < 120) w.prevent += 4;
    if (q === 2 && secsLeft < 40) w.prevent += 2;
    const tot = w.man + w.zone + w.blitz + w.prevent;
    let r = rng.next() * tot;
    for (const k of DEF_CALLS) { r -= w[k]; if (r <= 0) return k; }
    return 'zone';
  }

  RB.Sim = {
    IDX: { QB, RBK, OC, LG, RG, LT, RT, TE, WR1, WR2, WR3, DE1, DT1, DT2, DE2, LB1, LB2, LB3, CB1, CB2, S1, S2 },
    OL, ELIGIBLE, DIFF, DEF_CALLS, ROUTES,
    createPlay, setDefense, snap, step, canThrow, throwBall, clampAim, flightTime, maxRange, aiDefCall, predictRoute,
  };
})(typeof window !== 'undefined' ? window : globalThis);
