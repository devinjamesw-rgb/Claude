/* Rivalry Bowl: canvas renderer. Draws from a view model `V` so the same
 * code renders the local simulation and snapshots from the other phone. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const C = RB.C;
  const F = RB.Font;
  const FW = C.FIELD_W;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const PAL = {
    turfA: '#3f8f3b', turfB: '#398437', apron: '#2e6e2d', chalk: '#f2efe6',
    wall: '#1b2340', stands: '#121829', night: '#0b0f1c',
    amber: '#ffb000', amberDim: '#5a3f00', ink: '#0d0f14',
    good: '#ffd23f', bad: '#ff5a4e', los: '#5aa9ff', fd: '#ffd23f',
    ball: '#8a4b22', shadow: 'rgba(0,0,0,0.28)',
  };

  const SPR0 = 1.6; // players are drawn this many times their pixel-art size
  let SPR = SPR0;
  const R = {
    canvas: null, ctx: null, W: 480, H: 270, k: 1, S: 1,
    SX: 9, SY: 6, SZ: 7, portrait: false, hudH: 26, bottom: 0,
    cam: { x: 40, y: FW / 2 }, camV: { x: 0, y: 0 }, lead: 9, camInit: false, t: 0,
    z: 1, reserve: 0, // zoom (below 1 before the snap) and space kept clear for the play-call buttons
    crowd: null, crowdKey: '', sprites: new Map(), rain: [],
    ps: [], dust: [], flash: 0,
  };

  function init(canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
  }

  // The canvas backs onto real device pixels; drawing happens in "logical"
  // pixels (about 232 per screen height) scaled by R.S. Positions are snapped
  // to device pixels, not logical ones, so motion stays smooth.
  function resize(cssW, cssH) {
    const k = Math.min(cssW, cssH) / 232;
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    R.k = k;
    R.W = Math.max(200, Math.round(cssW / k));
    R.H = Math.max(200, Math.round(cssH / k));
    R.canvas.width = Math.round(cssW * dpr);
    R.canvas.height = Math.round(cssH * dpr);
    R.S = R.canvas.width / R.W;
    R.portrait = cssH > cssW * 1.1;
    R.SX0 = R.portrait ? 6.2 : clamp(R.W / 44, 8.5, 12);
    R.SY0 = R.SX0 * 0.56;
    R.SZ0 = R.SX0 * 0.7;
    applyZoom();
    R.hudH = R.portrait ? 62 : 26;
    R.bottom = R.portrait ? Math.round(R.H * 0.3) : 0;
    R.ctx.imageSmoothingEnabled = false;
    R.crowdKey = '';
  }

  // --- Projection ---------------------------------------------------------------
  function applyZoom() {
    R.SX = R.SX0 * R.z;
    R.SY = R.SY0 * R.z;
    R.SZ = R.SZ0 * R.z;
    SPR = SPR0 * Math.max(0.7, R.z);
  }
  // Before the snap the camera pulls back so the whole formation and every
  // route fit above the play-call buttons; at the snap it eases back in.
  function updateZoom(V, dt) {
    const pre = V.mode === 'field' && V.players && V.phase === 'presnap';
    const reserve = pre && !R.portrait ? 64 : 0;
    const avail = R.H - R.hudH - R.bottom - reserve - 6;
    const zt = pre ? clamp(avail / ((FW + 4) * R.SY0), 0.5, 1) : 1;
    const f = R.camInit ? 1 - Math.exp(-dt * 3.2) : 1;
    R.z += (zt - R.z) * f;
    R.reserve += (reserve - R.reserve) * f;
    applyZoom();
  }
  function fieldMidY() {
    return R.hudH + (R.H - R.hudH - R.bottom - R.reserve) / 2;
  }
  const snap = (v) => Math.round(v * R.S) / R.S;
  function sx(x) {
    return snap((x - R.cam.x) * R.SX + R.W / 2);
  }
  function sy(y) {
    return snap((y - R.cam.y) * R.SY + fieldMidY());
  }
  // Screen -> world, used by input.
  function toWorld(px, py) {
    return { x: (px - R.W / 2) / R.SX + R.cam.x, y: (py - fieldMidY()) / R.SY + R.cam.y };
  }
  function screenDeltaToWorld(dx, dy) {
    return { x: dx / R.k / R.SX, y: dy / R.k / R.SY };
  }

  function updateCamera(V, dt) {
    let fx = R.cam.x, fy = R.cam.y, lead = 0;
    R.chase = false;
    const baseLead = R.portrait ? 6 : 9;
    if (V.mode === 'field') {
      const car = V.players && V.carrier >= 0 ? V.players[V.carrier] : null;
      const b = V.ball;
      if (!V.players) { fx = V.los; fy = V.ballY; lead = baseLead; }
      else if (V.phase === 'presnap') { fx = V.los; fy = FW / 2; lead = (R.W / 2 / R.SX) * 0.45; }
      else if (b && b.st === 'air') {
        const L = V.landing || b;
        fx = b.x + (L.x - b.x) * 0.35; fy = b.y + (L.y - b.y) * 0.35; lead = 2;
      } else if (car && V.live) {
        const qbHolding = car.i === 0 && !V.turnover && car.x < V.los + 0.5;
        if (qbHolding) { fx = Math.max(car.x, V.los - 4); fy = (car.y + V.ballY) / 2; lead = baseLead + 1; }
        else { fx = car.x; fy = car.y; lead = car.side === 0 && !V.turnover ? 5 : -5; R.chase = true; }
      } else if (car) { fx = car.x; fy = car.y; }
      else if (b) { fx = b.x; fy = b.y; }
    }
    if (!R.camInit) { R.lead = lead; }
    R.lead += (lead - R.lead) * (1 - Math.exp(-dt * 2.5));
    let tx = fx + R.lead, ty = fy;
    const halfH = (R.H - R.hudH - R.bottom - R.reserve) / 2 / R.SY;
    const minY = -6 + halfH, maxY = FW + 5 - halfH;
    ty = minY > maxY ? FW / 2 : clamp(ty, minY, maxY);
    const halfW = R.W / 2 / R.SX;
    tx = clamp(tx, halfW - 4, 124 - halfW);
    if (!R.camInit) {
      R.cam.x = tx; R.cam.y = ty; R.camV.x = R.camV.y = 0; R.camInit = true;
      return;
    }
    // Critically damped springs: no sudden starts or stops when the focus switches.
    const spring = (key, target, w) => {
      const a = w * w * (target - R.cam[key]) - 2 * w * R.camV[key];
      R.camV[key] += a * dt;
      R.cam[key] += R.camV[key] * dt;
    };
    // Follow a ball carrier tightly so he never drifts toward the edge.
    spring('x', tx, R.chase ? 6 : 3.4);
    spring('y', ty, R.chase ? 4 : 2.6);
  }

  // --- Stadium ------------------------------------------------------------------
  function buildCrowd(uniforms) {
    const key = R.SX0 + '|' + uniforms.map((u) => u.jersey).join();
    if (key === R.crowdKey) return;
    R.crowdKey = key;
    const w = Math.ceil(140 * R.SX0), h = 60;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = PAL.stands;
    x.fillRect(0, 0, w, h);
    const rng = RB.makeRng(7);
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
    for (let row = 0; row < 12; row++) {
      x.fillStyle = row % 2 ? '#161d33' : '#131a2e';
      x.fillRect(0, row * 5, w, 5);
      for (let col = 0; col < w; col += 3) {
        if (rng.chance(0.12)) continue;
        const r = rng.next();
        const shirt = r < 0.5 ? uniforms[0].jersey : r < 0.82 ? uniforms[1].jersey : rng.pick(['#e8e8e8', '#6b7a8f', '#d9c27a', '#3a4a6b']);
        x.fillStyle = rng.pick(skins);
        x.fillRect(col, row * 5 + 1, 2, 1);
        x.fillStyle = shirt;
        x.fillRect(col, row * 5 + 2, 2, 2);
      }
    }
    R.crowd = c;
  }

  function drawStadium(ctx, V) {
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, R.W, R.H);
    // Stands above the far sideline.
    const top = sy(-4);
    if (top > 0 && R.crowd) {
      const bounce = V.cheer > 0 ? Math.round(Math.sin(R.t * 30) * 1) : 0;
      const cx = sx(-10);
      for (let yy = top - R.crowd.height; yy > -R.crowd.height; yy -= R.crowd.height) {
        ctx.drawImage(R.crowd, cx, yy + bounce);
      }
      ctx.fillStyle = PAL.wall;
      ctx.fillRect(0, top - 4, R.W, 4);
      ctx.fillStyle = V.uni ? V.uni[0].jersey : '#333';
      ctx.fillRect(0, top - 4, R.W, 1);
    }
    // Apron around the field.
    ctx.fillStyle = PAL.apron;
    const ax0 = sx(-4), ax1 = sx(124), ay0 = sy(-4), ay1 = sy(FW + 4);
    ctx.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
    // Near-side wall and the lower bowl behind it.
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(0, ay1, R.W, 4);
    if (R.crowd && ay1 + 4 < R.H) {
      const cx = sx(-10);
      for (let yy = ay1 + 4; yy < R.H; yy += R.crowd.height) ctx.drawImage(R.crowd, cx, yy);
      ctx.fillStyle = 'rgba(11,15,28,0.7)';
      ctx.fillRect(0, ay1 + 4, R.W, R.H - ay1 - 4);
    }
  }

  function drawField(ctx, V) {
    const y0 = sy(0), y1 = sy(FW);
    const xMin = Math.max(0, Math.floor(R.cam.x - R.W / 2 / R.SX) - 1);
    const xMax = Math.min(120, Math.ceil(R.cam.x + R.W / 2 / R.SX) + 1);
    // Turf stripes every 5 yards.
    for (let x = 10; x < 110; x += 5) {
      if (x + 5 < xMin || x > xMax) continue;
      ctx.fillStyle = (x / 5) % 2 ? PAL.turfA : PAL.turfB;
      ctx.fillRect(sx(x), y0, sx(x + 5) - sx(x), y1 - y0);
    }
    // End zones in each defending team's colors.
    const ez = [
      { x: 0, seat: V.offSeat, rot: -1 },
      { x: 110, seat: V.defSeat, rot: 1 },
    ];
    for (const e of ez) {
      if (e.x + 10 < xMin || e.x > xMax) continue;
      const u = V.uni[e.seat];
      ctx.fillStyle = shade(u.jersey === '#f4f4f4' ? u.trim : u.jersey, -0.15);
      ctx.fillRect(sx(e.x), y0, sx(e.x + 10) - sx(e.x), y1 - y0);
      const name = V.teams[e.seat].name;
      const scale = R.portrait ? 2 : 3;
      ctx.save();
      ctx.translate(sx(e.x + 5), (y0 + y1) / 2);
      ctx.rotate((e.rot * Math.PI) / 2);
      F.draw(ctx, name, 0, -3.5 * scale, scale, u.jersey === '#f4f4f4' ? '#ffffff' : lighten(u.trim), 'center', 'rgba(0,0,0,0.35)');
      ctx.restore();
    }
    // Yard lines, goal lines, sidelines.
    ctx.fillStyle = PAL.chalk;
    for (let x = 10; x <= 110; x += 5) {
      if (x < xMin || x > xMax) continue;
      ctx.fillRect(sx(x), y0, x === 10 || x === 110 ? 2 : 1, y1 - y0);
    }
    ctx.fillRect(sx(0), y0 - 1, sx(120) - sx(0), 2);
    ctx.fillRect(sx(0), y1 - 1, sx(120) - sx(0), 2);
    ctx.fillRect(sx(0) - 1, y0, 2, y1 - y0);
    ctx.fillRect(sx(120) - 1, y0, 2, y1 - y0);
    // Hash marks every yard.
    const hy = [0.6, C.HASH_TOP, C.HASH_BOT, FW - 0.6];
    for (let x = Math.max(11, xMin); x < Math.min(110, xMax); x++) {
      if (x % 5 === 0) continue;
      const px = sx(x);
      for (const h of hy) ctx.fillRect(px, sy(h) - 1, 1, 2);
    }
    // Yard numbers.
    const ns = R.portrait ? 1 : 2;
    ctx.globalAlpha = 0.85;
    for (let x = 20; x <= 100; x += 10) {
      if (x < xMin - 3 || x > xMax + 3) continue;
      const n = String(x <= 60 ? x - 10 : 110 - x);
      F.draw(ctx, n, sx(x), sy(8) - 3 * ns, ns, PAL.chalk, 'center');
      F.draw(ctx, n, sx(x), sy(FW - 8) - 4 * ns, ns, PAL.chalk, 'center');
    }
    ctx.globalAlpha = 1;
    // Midfield logo.
    if (60 > xMin - 6 && 60 < xMax + 6) {
      const u = V.uni[0];
      const cx = sx(60), cy = sy(FW / 2), rx = Math.round(4.5 * R.SX), ry = Math.round(4.5 * R.SX * 0.62);
      ctx.fillStyle = u.jersey === '#f4f4f4' ? u.trim : u.jersey;
      ellipse(ctx, cx, cy, rx, ry);
      ctx.fillStyle = PAL.chalk;
      F.draw(ctx, V.teams[0].id, cx, cy - (R.portrait ? 3 : 7), R.portrait ? 1 : 2, u.helmet === u.jersey ? '#ffffff' : u.helmet, 'center');
    }
  }

  function drawLines(ctx, V) {
    const y0 = sy(0), y1 = sy(FW);
    if (V.los != null) {
      ctx.fillStyle = PAL.los;
      ctx.fillRect(sx(V.los), y0, 2, y1 - y0);
    }
    if (V.fdX != null && V.fdX < 110 && V.fdX > V.los) {
      ctx.fillStyle = PAL.fd;
      ctx.fillRect(sx(V.fdX), y0, 2, y1 - y0);
    }
  }

  // --- Sprites --------------------------------------------------------------------
  const BODY = [
    '...HHH...',
    '..HHHHH..',
    '..HHHSM..',
    '.JJJJJJJ.',
    '.TJJJJJT.',
    '.SJJJJJS.',
    '..JJJJJ..',
    '..PPPPP..',
  ];
  // Run cycle, facing right. Upper case = near leg, lower case = far leg.
  const LEGS = [
    ['.pp..PP..', '.kk...KK.', 'kk.....KK', 'b.......B'],
    ['..ppPP...', '..kkKK...', '...kKK...', '...bBB...'],
    ['.PP..pp..', '.KK...kk.', 'KK.....kk', 'B.......b'],
    ['..PPpp...', '..KKkk...', '...KkK...', '...BBb...'],
    ['..PP.PP..', '..KK.KK..', '..KK.KK..', '..BB.BB..'],
  ];
  const DOWN = [
    '.....JJJ.HH.',
    'BKKPPJJJJHHM',
    'BKKPPJJJJHH.',
    '.....SS.....',
  ];

  function sprite(uni, skin, pose, frame, face, carry, seat) {
    const key = `${seat}|${uni.jersey}|${skin}|${pose}|${frame}|${face}|${carry}`;
    let c = R.sprites.get(key);
    if (c) return c;
    const colors = {
      H: uni.helmet, M: '#9aa0a6', S: skin, J: uni.jersey, T: uni.trim === uni.jersey ? shade(uni.jersey, -0.3) : uni.trim,
      P: uni.pants, K: '#eeeeee', B: '#1a1a1a', L: PAL.ball,
      p: shade(uni.pants, -0.28), k: '#b9b9b9', b: '#3a3a3a',
    };
    let rows;
    if (pose === 'down' || pose === 'dive') rows = DOWN.slice();
    else {
      rows = BODY.concat(LEGS[pose === 'stand' || pose === 'block' ? 4 : frame % 4]);
      if (pose === 'block') {
        rows = rows.map((r, i) => (i >= 3 && i <= 5 ? '.' + r.slice(0, 8) : r));
        rows[4] = rows[4].slice(0, 7) + 'SS';
      }
      if (carry) rows[5] = rows[5].slice(0, 6) + 'LL' + rows[5][8];
    }
    const w = rows[0].length, h = rows.length;
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    for (let r = 0; r < h; r++) {
      for (let q = 0; q < w; q++) {
        const ch = rows[r][face > 0 ? q : w - 1 - q];
        if (ch === '.') continue;
        x.fillStyle = colors[ch];
        x.fillRect(q, r, 1, 1);
      }
    }
    R.sprites.set(key, c);
    if (R.sprites.size > 900) R.sprites.clear();
    return c;
  }

  const ease = (u) => 1 - (1 - u) * (1 - u);

  // Per-player display state: smoothed speed, facing with hysteresis, stride
  // phase from distance run, and the fall / get-up timers.
  function playerState(p, dt) {
    let st = R.ps[p.i];
    if (!st || Math.hypot(p.x - st.x, p.y - st.y) > 5) {
      st = R.ps[p.i] = { x: p.x, y: p.y, spd: 0, face: p.face >= 0 ? 1 : -1, phase: p.i * 0.37, moving: false, down: !!p.down, downT: p.down ? 9 : 0, upT: 9, fallDir: 1 };
    }
    const sp = Math.hypot(p.vx || 0, p.vy || 0);
    st.spd += (sp - st.spd) * Math.min(1, dt * 10);
    if (st.spd > 1.3) st.moving = true;
    else if (st.spd < 0.6) st.moving = false;
    if (p.eng || p.down) { if (!st.down) st.face = p.face >= 0 ? 1 : -1; }
    else if ((p.vx || 0) > 1.2) st.face = 1;
    else if ((p.vx || 0) < -1.2) st.face = -1;
    if (p.down && !st.down) {
      st.down = true;
      st.downT = 0;
      st.fallDir = Math.abs(p.vx || 0) > 0.6 ? Math.sign(p.vx) : st.face;
      dustAt(p.x + st.fallDir * 0.9, p.y, 7);
    } else if (!p.down && st.down) {
      st.down = false;
      st.upT = 0;
    }
    st.downT += dt;
    st.upT += dt;
    st.phase += st.spd * dt * 1.35;
    st.x = p.x; st.y = p.y;
    return st;
  }

  // Lean angle (radians, before the fall direction): tip over with a small
  // settle, stay down, and spring back up after a stumble.
  function fallAngle(st, p) {
    const full = Math.PI * 0.49;
    if (st.down) {
      const u = st.downT / 0.26;
      if (u < 1) return full * ease(u);
      const b = (st.downT - 0.26) / 0.14;
      return b < 1 ? full - Math.sin(b * Math.PI) * 0.1 : full;
    }
    if (p.lunge) return Math.PI * 0.38;
    if (st.upT < 0.2) return full * (1 - ease(st.upT / 0.2));
    return 0;
  }

  function dustAt(x, y, n) {
    for (let i = 0; i < n; i++) {
      R.dust.push({ x, y, z: 0.1, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 1.6, vz: 1 + Math.random() * 1.5, life: 0.4 + Math.random() * 0.2, t: 0, s: 1 + Math.random() * 1.2 });
    }
    if (R.dust.length > 120) R.dust.splice(0, R.dust.length - 120);
  }

  function drawDust(ctx, dt) {
    for (const d of R.dust) {
      d.t += dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vz -= 6 * dt; d.z = Math.max(0, d.z + d.vz * dt);
      d.vx *= 0.94; d.vy *= 0.94;
      const a = 1 - d.t / d.life;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(222,212,170,${(a * 0.8).toFixed(2)})`;
      ctx.fillRect(sx(d.x) - d.s / 2, sy(d.y) - d.z * R.SZ - d.s / 2, d.s, d.s);
    }
    R.dust = R.dust.filter((d) => d.t < d.life);
  }

  function drawPlayers(ctx, V, dt) {
    const list = V.players.slice().sort((a, b) => a.y - b.y);
    const vis = (px, py) => px > -30 && px < R.W + 30 && py > -20 && py < R.H + 30;
    const states = list.map((p) => playerState(p, dt));
    ctx.fillStyle = PAL.shadow;
    list.forEach((p, k) => {
      const px = sx(p.x), py = sy(p.y);
      if (!vis(px, py)) return;
      // A falling player's shadow stretches out along his body.
      const st = states[k], a = fallAngle(st, p), len = Math.sin(a) * 11 * SPR;
      ellipse(ctx, px + st.fallDir * len * 0.5, py, 4 * SPR + len * 0.5, 1.5 * SPR);
    });
    list.forEach((p, k) => {
      const st = states[k];
      const px = sx(p.x), py = sy(p.y);
      if (!vis(px, py)) return;
      const seat = p.side === 0 ? V.offSeat : V.defSeat;
      const uni = V.uni[seat];
      const angle = fallAngle(st, p);
      const pose = angle > 0 ? 'stand' : p.eng ? 'block' : st.moving ? 'run' : 'stand';
      const frame = pose === 'run' ? Math.floor(st.phase) % 4 : 0;
      const carry = V.carrier === p.i && V.ball && V.ball.st !== 'air';
      const spr = sprite(uni, p.skin, pose, frame, st.face, carry, seat);
      if (p.i === V.ctrl && V.live && !p.down) {
        ctx.fillStyle = 'rgba(255,210,63,0.95)';
        ring(ctx, px, py, 6 * SPR, 2.5 * SPR);
      }
      if (p.i === V.defCtrl && !p.down) {
        ctx.fillStyle = 'rgba(90,230,255,0.95)';
        ring(ctx, px, py, 6 * SPR, 2.5 * SPR);
      }
      if (V.routeColors && V.routeColors[p.i] && !V.live) {
        ctx.fillStyle = V.routeColors[p.i];
        ring(ctx, px, py, 5 * SPR, 2 * SPR);
      }
      if (V.lock === p.i) {
        ctx.fillStyle = '#5fd35f';
        ring(ctx, px, py, 7 * SPR, 3 * SPR);
      }
      const w = spr.width * SPR, h = spr.height * SPR;
      if (angle > 0) {
        // Tip over from the feet, the way he was moving; a diving tackler is airborne.
        const lift = p.lunge && !st.down ? 3 * SPR : 0;
        ctx.save();
        ctx.translate(px, py - lift);
        ctx.rotate(angle * st.fallDir);
        ctx.drawImage(spr, -w / 2, -h + SPR, w, h);
        ctx.restore();
        return;
      }
      const lift = (pose === 'run' && frame % 2 ? 1 : 0) * SPR;
      ctx.drawImage(spr, snap(px - w / 2), snap(py - h + SPR - lift), snap(w), snap(h));
    });
    drawDust(ctx, dt);
  }

  // Pre-snap play art: each receiver's route in his own color, with an arrow
  // at the end; a short bar for blockers; the run lane as a dashed arrow.
  function arrowLine(ctx, pts, color, alpha, dashed) {
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i].x), sy(pts[i].y));
    ctx.stroke();
    ctx.setLineDash([]);
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const ang = Math.atan2(sy(b.y) - sy(a.y), sx(b.x) - sx(a.x));
    const hx = sx(b.x), hy = sy(b.y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang) * 4, hy + Math.sin(ang) * 4);
    ctx.lineTo(hx + Math.cos(ang + 2.5) * 4, hy + Math.sin(ang + 2.5) * 4);
    ctx.lineTo(hx + Math.cos(ang - 2.5) * 4, hy + Math.sin(ang - 2.5) * 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawRoutes(ctx, V) {
    const R2 = V.routes;
    if (!R2) return;
    for (const r of R2) {
      if (r.block) {
        const p = r.from;
        ctx.globalAlpha = r.alpha;
        ctx.fillStyle = r.color;
        ctx.fillRect(sx(p.x) + 6, sy(p.y) - 4, 2, 8);
        ctx.fillRect(sx(p.x) + 3, sy(p.y) - 0.5, 4, 1.6);
        ctx.globalAlpha = 1;
        continue;
      }
      arrowLine(ctx, r.pts, r.color, r.alpha, r.dashed);
    }
  }

  function drawBall(ctx, V) {
    const b = V.ball;
    if (!b || !b.visible) return;
    const carried = V.carrier >= 0 && b.st !== 'air' && b.st !== 'dead' && b.st !== 'snap';
    if (carried) return;
    const px = sx(b.x), py = sy(b.y), pz = b.z * R.SZ;
    ctx.fillStyle = PAL.shadow;
    ellipse(ctx, px, py, 2.5, 1.2);
    const big = clamp(b.z / 3.5, 0, 1.5) + 0.8;
    ctx.fillStyle = '#3a1d0c';
    ctx.fillRect(px - 3 - big, py - pz - 2 - big / 2, 6 + big * 2, 4 + big);
    ctx.fillStyle = PAL.ball;
    ctx.fillRect(px - 2 - big, py - pz - 1 - big / 2, 4 + big * 2, 2 + big);
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(px - 0.5, py - pz - 1 - big / 2, 1, 1);
  }

  function drawAim(ctx, V) {
    const a = V.aim;
    if (!a) return;
    // Until the pull is long enough to throw, the arc is faint: letting go cancels.
    ctx.globalAlpha = a.armed ? 1 : 0.35;
    ctx.fillStyle = a.max ? '#ff9a3c' : '#ffffff';
    for (const p of a.pts) ctx.fillRect(sx(p.x) - 1, sy(p.y) - Math.round(p.z * R.SZ) - 1, 2, 2);
    const tx = sx(a.x), ty = sy(a.y);
    ctx.fillStyle = a.lock != null ? '#5fd35f' : a.max ? '#ff9a3c' : PAL.good;
    ring(ctx, tx, ty, a.lock != null ? 7 : 5, a.lock != null ? 3.4 : 2.4);
    ctx.fillRect(tx - 1, ty - 1, 2, 2);
    ctx.globalAlpha = 1;
  }

  function drawLanding(ctx, V) {
    if (!V.landing || !V.ball || V.ball.st !== 'air') return;
    const pulse = 3 + Math.round(Math.sin(R.t * 12));
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ring(ctx, sx(V.landing.x), sy(V.landing.y), pulse + 2, pulse * 0.6 + 1);
  }

  // Floating joystick: base where the thumb landed, knob under the thumb.
  function drawJoy(ctx, V) {
    const j = V.joy;
    if (!j) return;
    const r = j.r || 20;
    ctx.fillStyle = 'rgba(13,15,20,0.28)';
    ellipse(ctx, j.x0, j.y0, r, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(j.x0, j.y0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = j.on ? 'rgba(255,210,63,0.85)' : 'rgba(255,255,255,0.6)';
    ellipse(ctx, j.x1, j.y1, 8, 8);
  }

  // --- Weather --------------------------------------------------------------------
  function drawWeather(ctx, V, dt) {
    const type = V.wx && V.wx.type;
    if (type !== 'rain' && type !== 'snow') return;
    const n = type === 'rain' ? 90 : 70;
    while (R.rain.length < n) R.rain.push({ x: Math.random() * R.W, y: Math.random() * R.H, s: 0.6 + Math.random() * 0.8 });
    ctx.fillStyle = type === 'rain' ? 'rgba(170,200,255,0.55)' : 'rgba(255,255,255,0.85)';
    for (const p of R.rain) {
      if (type === 'rain') { p.y += 260 * p.s * dt; p.x -= 40 * dt; ctx.fillRect(p.x | 0, p.y | 0, 1, 3); }
      else { p.y += 30 * p.s * dt; p.x += Math.sin(R.t + p.s * 9) * 12 * dt; ctx.fillRect(p.x | 0, p.y | 0, p.s > 1 ? 2 : 1, p.s > 1 ? 2 : 1); }
      if (p.y > R.H) { p.y = -4; p.x = Math.random() * R.W; }
      if (p.x < 0) p.x += R.W;
      if (p.x > R.W) p.x -= R.W;
    }
  }

  // --- HUD ------------------------------------------------------------------------
  function drawHUD(ctx, V) {
    const g = V.g;
    if (!g) return;
    const G = RB.Game;
    const narrow = R.W < 330;
    const boxW = narrow ? 64 : 76, clockW = narrow ? 58 : 64, h = 17;
    const total = boxW * 2 + clockW;
    const x0 = Math.round(R.W / 2 - total / 2), y0 = R.portrait ? 26 : 3;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x0 - 2, y0 - 2, total + 4, h + 4);
    for (let s = 0; s < 2; s++) {
      const u = V.uni[s];
      const bx = s === 0 ? x0 : x0 + boxW + clockW;
      const bg = u.jersey === '#f4f4f4' ? u.trim : u.jersey;
      ctx.fillStyle = bg;
      ctx.fillRect(bx, y0, boxW, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(bx, y0 + h - 3, boxW, 3);
      const name = V.teams[s].id;
      const fg = readable(bg);
      if (s === 0) {
        F.draw(ctx, name, bx + 4, y0 + 5, 1, fg);
        F.draw(ctx, String(g.score[0]), bx + boxW - 4, y0 + 2, 2, '#ffffff', 'right', 'rgba(0,0,0,0.4)');
      } else {
        F.draw(ctx, String(g.score[1]), bx + 4, y0 + 2, 2, '#ffffff', 'left', 'rgba(0,0,0,0.4)');
        F.draw(ctx, name, bx + boxW - 4, y0 + 5, 1, fg, 'right');
      }
      // Timeouts
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < g.to[s] ? PAL.amber : 'rgba(255,255,255,0.15)';
        const tx = s === 0 ? bx + 4 + i * 7 : bx + boxW - 9 - i * 7;
        ctx.fillRect(tx, y0 + h + 1, 5, 1);
      }
      // Possession football
      if (g.poss === s && !['final', 'half', 'coin'].includes(g.phase)) {
        ctx.fillStyle = PAL.ball;
        const fx = s === 0 ? bx + boxW - 30 : bx + 26;
        ctx.fillRect(fx, y0 + 7, 4, 3);
        ctx.fillStyle = '#fff';
        ctx.fillRect(fx + 1, y0 + 8, 2, 1);
      }
    }
    const cx = x0 + boxW;
    ctx.fillStyle = '#16181f';
    ctx.fillRect(cx, y0, clockW, h);
    const per = G.periodText(g);
    const clock = g.ot ? '' : G.fmtClock(g.clock);
    if (g.ot) F.draw(ctx, per, cx + clockW / 2, y0 + 5, 1, PAL.amber, 'center');
    else {
      F.draw(ctx, per, cx + 3, y0 + 5, 1, PAL.amber);
      F.draw(ctx, clock, cx + clockW - 3, y0 + 5, 1, g.clockRunning && g.phase === 'presnap' ? '#ffffff' : PAL.amber, 'right');
    }
    // Down & distance chyron
    if (['presnap', 'play', 'after', 'handoff'].includes(g.phase)) {
      const txt = `${G.downText(g)} · ${G.spotText(g.ballOn)}`;
      const w = F.width(txt, 1) + 10;
      const yy = y0 + h + 4;
      ctx.fillStyle = 'rgba(13,15,20,0.82)';
      ctx.fillRect(Math.round(R.W / 2 - w / 2), yy, w, 11);
      F.draw(ctx, txt, R.W / 2, yy + 2, 1, '#ffffff', 'center');
    }
  }

  function drawBanner(ctx, V) {
    const b = V.g && V.g.banner;
    if (!b) return;
    let scale = R.W >= 420 ? 3 : 2;
    while (scale > 1 && F.width(b.text, scale) > R.W - 16) scale--;
    const color = b.color === 'good' ? PAL.good : b.color === 'bad' ? PAL.bad : '#ffffff';
    const y = Math.round(R.hudH + (R.H - R.hudH - R.bottom) * 0.3);
    const bandH = 7 * scale + (b.sub ? 14 : 0) + 12;
    ctx.fillStyle = 'rgba(8,10,18,0.72)';
    ctx.fillRect(0, y - 6, R.W, bandH);
    ctx.fillStyle = color;
    ctx.fillRect(0, y - 6, R.W, 1);
    ctx.fillRect(0, y - 6 + bandH - 1, R.W, 1);
    F.draw(ctx, b.text, R.W / 2, y, scale, color, 'center', 'rgba(0,0,0,0.6)');
    if (b.sub) F.draw(ctx, b.sub, R.W / 2, y + 7 * scale + 5, 1, '#e8e8e8', 'center');
  }

  function drawNetInfo(ctx, V) {
    if (!V.netInfo) return;
    const w = F.width(V.netInfo, 1) + 8;
    const y = R.portrait ? R.hudH + 2 : 5;
    const x = 4;
    ctx.fillStyle = 'rgba(13,15,20,0.7)';
    ctx.fillRect(x, y - 2, w, 11);
    F.draw(ctx, V.netInfo, x + 4, y, 1, 'rgba(255,255,255,0.8)');
  }

  function drawFooter(ctx, V) {
    const g = V.g;
    if (!g || g.phase !== 'presnap' || !g.lastPlay) return;
    const y = R.H - R.bottom - 12;
    F.draw(ctx, `LAST: ${g.lastPlay}`, 6, y, 1, 'rgba(255,255,255,0.75)');
  }

  // --- Kick view ------------------------------------------------------------------
  function drawKick(ctx, V) {
    const k = V.kick;
    const W = R.W, H = R.H - R.bottom;
    const horizon = Math.round(R.hudH + (H - R.hudH) * 0.28);
    const camBack = 9, camH = 2.1, f = (H - R.hudH) * 0.95;
    const P = (x, d, h) => {
      const z = Math.max(0.5, d + camBack);
      return { x: Math.round(W / 2 + (x * f) / z), y: Math.round(horizon + ((camH - h) * f) / z), s: f / z };
    };
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, W, R.H);
    if (R.crowd) {
      for (let yy = horizon - 6 - R.crowd.height; yy > -R.crowd.height; yy -= R.crowd.height) ctx.drawImage(R.crowd, 0, yy);
      ctx.fillStyle = 'rgba(11,15,28,0.55)';
      ctx.fillRect(0, 0, W, horizon - 6);
    }
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(0, horizon - 6, W, 6);
    // Turf with 5-yard bands.
    const far = k.dist + 14;
    for (let d = -camBack + 1; d < far; d += 5) {
      const a = P(0, d, 0), b = P(0, Math.min(far, d + 5), 0);
      ctx.fillStyle = Math.floor((d + 100) / 5) % 2 ? PAL.turfA : PAL.turfB;
      ctx.fillRect(0, b.y, W, a.y - b.y + 1);
    }
    ctx.fillStyle = PAL.turfB;
    ctx.fillRect(0, horizon, W, P(0, far, 0).y - horizon);
    // Yard lines.
    ctx.fillStyle = PAL.chalk;
    for (let d = 0; d <= far; d += 5) {
      const l = P(-26.6, d, 0), r = P(26.6, d, 0);
      ctx.fillRect(l.x, l.y, r.x - l.x, d === k.dist - 10 ? 2 : 1);
    }
    // End zone behind the goal line.
    const gl = P(0, k.dist - 10, 0), bl = P(0, k.dist, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, bl.y, W, gl.y - bl.y);
    // Goal posts.
    const barL = P(-C_HALF(), k.dist, RB.Kick.BAR), barR = P(C_HALF(), k.dist, RB.Kick.BAR);
    const topL = P(-C_HALF(), k.dist, 10), base = P(0, k.dist + 1.2, 0), baseTop = P(0, k.dist + 1.2, RB.Kick.BAR);
    ctx.fillStyle = '#f4d23a';
    ctx.fillRect(base.x - 1, baseTop.y, 2, base.y - baseTop.y);
    ctx.fillRect(barL.x, barL.y - 1, barR.x - barL.x, 2);
    ctx.fillRect(barL.x - 1, topL.y, 2, barL.y - topL.y);
    ctx.fillRect(barR.x - 1, topL.y, 2, barR.y - topL.y);
    // Preview arc while aiming.
    if (k.phase === 'aim' && V.kickAim) {
      ctx.fillStyle = V.kickAim.power >= k.need ? '#ffffff' : '#ff9a3c';
      for (const p of RB.Kick.preview(k, V.kickAim.aim, V.kickAim.power, 16)) {
        const q = P(p.x, p.d, p.h);
        ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
      }
    }
    // Holder and kicker (from behind).
    const hp = P(0.4, 0, 0), kp = P(-1.4, -2.4, 0);
    ctx.fillStyle = V.kickUni.jersey;
    ctx.fillRect(hp.x - 3, hp.y - 7, 7, 6);
    ctx.fillStyle = V.kickUni.helmet;
    ctx.fillRect(hp.x - 2, hp.y - 10, 5, 3);
    const kickT = k.phase === 'aim' ? 0 : Math.min(1, k.t * 6);
    const kx = Math.round(kp.x + kickT * 10), ky = kp.y;
    ctx.fillStyle = V.kickUni.helmet;
    ctx.fillRect(kx - 4, ky - 26, 8, 6);
    ctx.fillStyle = V.kickUni.jersey;
    ctx.fillRect(kx - 5, ky - 20, 10, 10);
    ctx.fillStyle = V.kickUni.pants;
    ctx.fillRect(kx - 4, ky - 10, 8, 5);
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(kx - 4, ky - 5, 3, 5);
    ctx.fillRect(kx + 1, ky - 5 - Math.round(kickT * 4), 3, 5);
    // Ball.
    const b = k.ball;
    const bp = P(b.x, b.d, b.h), sp = P(b.x, b.d, 0);
    ctx.fillStyle = PAL.shadow;
    ellipse(ctx, sp.x, sp.y, Math.max(1, bp.s * 0.3), Math.max(1, bp.s * 0.1));
    const bs = Math.max(2, Math.round(bp.s * 0.35));
    ctx.fillStyle = PAL.ball;
    ctx.fillRect(bp.x - (bs >> 1), bp.y - bs, bs, Math.max(2, Math.round(bs * 0.7)));
    // Power meter + wind.
    const mh = Math.round((H - R.hudH) * 0.55), mx = W - 18, my = R.hudH + 30;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(mx - 2, my - 2, 10, mh + 4);
    const pw = k.phase === 'aim' ? (V.kickAim ? V.kickAim.power : 0) : k.power;
    const fillH = Math.round(Math.min(1.08, pw) / 1.08 * mh);
    ctx.fillStyle = pw >= k.need ? '#5fd35f' : '#ff9a3c';
    ctx.fillRect(mx, my + mh - fillH, 6, fillH);
    const needY = my + mh - Math.round(Math.min(1.08, k.need) / 1.08 * mh);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mx - 4, needY, 14, 1);
    F.draw(ctx, 'PWR', mx + 3, my + mh + 5, 1, '#ffffff', 'center');
    drawWind(ctx, V.wx, 10, R.hudH + 30);
    const title = `${k.type === 'xp' ? 'EXTRA POINT' : 'FIELD GOAL'} · ${k.dist} YDS`;
    plate(ctx, title, W / 2, R.hudH + 6, PAL.amber);
    if (k.phase === 'aim' && V.kickHint) plate(ctx, V.kickHint, W / 2, H - 18, '#ffffff');
  }
  function C_HALF() {
    return RB.Kick.HALF_W;
  }

  // One line of text on a dark plate, centered on x.
  function plate(ctx, text, x, y, color) {
    const w = F.width(text, 1) + 10;
    ctx.fillStyle = 'rgba(13,15,20,0.85)';
    ctx.fillRect(Math.round(x - w / 2), y - 3, w, 13);
    F.draw(ctx, text, x, y, 1, color, 'center');
  }

  function drawWind(ctx, wx, x, y) {
    if (!wx) return;
    const label = `WIND ${wx.wind} MPH`;
    ctx.fillStyle = 'rgba(13,15,20,0.85)';
    ctx.fillRect(x - 4, y - 3, F.width(label, 1) + 8, 38);
    F.draw(ctx, label, x, y, 1, '#ffffff', 'left');
    const cx = x + 14, cy = y + 20, r = 9;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ellipse(ctx, cx, cy, r + 2, r + 2);
    if (wx.wind > 0) {
      // Angle 0 = tailwind (toward the posts, up on screen).
      const dx = Math.sin(wx.windDir), dy = -Math.cos(wx.windDir);
      ctx.fillStyle = PAL.amber;
      for (let i = -r; i <= r; i++) ctx.fillRect(Math.round(cx + dx * i), Math.round(cy + dy * i), 1, 1);
      ctx.fillRect(Math.round(cx + dx * r) - 1, Math.round(cy + dy * r) - 1, 3, 3);
    }
  }

  // --- Helpers ------------------------------------------------------------------------
  function ellipse(ctx, cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function ring(ctx, cx, cy, rx, ry) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }
  function hexToRgb(h) {
    return [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
  }
  function shade(h, amt) {
    const [r, g, b] = hexToRgb(h);
    const f = (v) => clamp(Math.round(v * (1 + amt)), 0, 255).toString(16).padStart(2, '0');
    return `#${f(r)}${f(g)}${f(b)}`;
  }
  function lighten(h) {
    const [r, g, b] = hexToRgb(h);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 60 ? '#e8e8e8' : h;
  }
  function readable(h) {
    const [r, g, b] = hexToRgb(h);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
  }

  function frame(V, dt) {
    const ctx = R.ctx;
    R.t += dt;
    ctx.setTransform(R.S, 0, 0, R.S, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (V.uni) buildCrowd(V.uni);
    if (V.mode === 'kick' && V.kick) {
      drawKick(ctx, V);
      drawHUD(ctx, V);
      drawBanner(ctx, V);
      return;
    }
    updateZoom(V, dt);
    updateCamera(V, dt);
    drawStadium(ctx, V);
    if (V.uni) {
      drawField(ctx, V);
      if (V.players) {
        drawLines(ctx, V);
        drawRoutes(ctx, V);
        drawLanding(ctx, V);
        drawPlayers(ctx, V, dt);
        drawBall(ctx, V);
        drawAim(ctx, V);
      }
    }
    drawWeather(ctx, V, dt);
    drawJoy(ctx, V);
    drawHUD(ctx, V);
    drawFooter(ctx, V);
    drawNetInfo(ctx, V);
    drawBanner(ctx, V);
  }

  // Team preview on the pick screen: one standing player, drawn at 1:1.
  function drawSprite(ctx, uni, skin) {
    ctx.drawImage(sprite(uni, skin, 'stand', 0, 1, false, 'pick'), 0, 0);
  }

  RB.Render = { R, init, resize, frame, toWorld, screenDeltaToWorld, sx, sy, PAL, readable, shade, drawSprite };
})(typeof window !== 'undefined' ? window : globalThis);
