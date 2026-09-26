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
    // Opening shot: while the welcome and coin toss play, look up at the
    // home stadium, then settle onto the field.
    const establish = V.mode === 'field' && V.phase === 'coin';
    const baseLead = R.portrait ? 6 : 9;
    if (V.mode === 'field') {
      const car = V.players && V.carrier >= 0 ? V.players[V.carrier] : null;
      const b = V.ball;
      if (establish) { fx = 60; fy = -19; lead = 0; }
      else if (!V.players) { fx = V.los; fy = V.ballY; lead = baseLead; }
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
    const minY = (establish ? -36 : -14) + halfH, maxY = FW + 5 - halfH; // show some of the far stands
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
  // The home school's stadium: sky for the kickoff time, the scenery past the
  // stands (RB.ENV), decks of fans in both schools' colors, light towers for
  // evening games. Built once per school and screen size, then scrolled.
  const DEFAULT_ENV = { id: '', name: '', town: '', time: 'day', scene: ['hills'], facade: 'concrete', tiers: 1, home: 0.65, turf: 'green' };
  const SKY = {
    day: { top: '#4f9de0', bot: '#bfe0f7', stands: ['#2d3344', '#282d3d'] },
    dusk: { top: '#26295e', bot: '#f08c55', stands: ['#22263a', '#1d2133'] },
    night: { top: '#03060f', bot: '#17224a', stands: ['#161d33', '#131a2e'] },
  };
  const FACADE = { concrete: '#8d919b', brick: '#8b3d2c', stone: '#a7a091' };
  const TURF = { green: ['#3f8f3b', '#398437', '#2e6e2d'], blue: ['#2f63c4', '#2a58b0', '#22468c'] };
  function envOf(V) {
    const id = V.teams && V.teams[0] && V.teams[0].id;
    return (RB.ENV && RB.ENV[id]) || DEFAULT_ENV;
  }

  function buildCrowd(uniforms, env) {
    const key = R.SX0 + '|' + uniforms.map((u) => u.jersey).join() + '|' + env.id;
    if (key === R.crowdKey) return;
    R.crowdKey = key;
    R.scene = null;
    const w = Math.ceil(140 * R.SX0), h = 60;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const rows = SKY[env.time].stands;
    x.fillStyle = rows[0];
    x.fillRect(0, 0, w, h);
    const rng = RB.makeRng(7 + RB.hashStr(env.id || 'x') % 1000);
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
    const homeShirt = uniforms[0].jersey, awayShirt = uniforms[1].jersey === '#f4f4f4' ? uniforms[1].trim : uniforms[1].jersey;
    for (let row = 0; row < 12; row++) {
      x.fillStyle = rows[row % 2];
      x.fillRect(0, row * 5, w, 5);
      for (let col = 0; col < w; col += 3) {
        if (rng.chance(0.08)) continue;
        const r = rng.next();
        let shirt;
        if (env.whiteout) shirt = r < 0.82 ? '#f4f4f4' : r < 0.9 ? homeShirt : awayShirt;
        else shirt = r < env.home ? homeShirt : r < env.home + (1 - env.home) * 0.6 ? awayShirt : rng.pick(['#e8e8e8', '#6b7a8f', '#d9c27a', '#3a4a6b']);
        x.fillStyle = rng.pick(skins);
        x.fillRect(col, row * 5 + 1, 2, 1);
        x.fillStyle = shirt;
        x.fillRect(col, row * 5 + 2, 2, 2);
      }
    }
    R.crowd = c;
  }

  // The scenery strip past the stadium rim: sky, then each layer of
  // env.scene from far to near, standing on the strip's bottom edge.
  const SCENE_H = 72;
  function buildScene(env) {
    const W = Math.ceil(R.W * 1.5) + 64, H = SCENE_H;
    const key = env.id + '|' + W;
    if (R.scene && R.sceneKey === key) return R.scene;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const sky = SKY[env.time], night = env.time === 'night', dusk = env.time === 'dusk';
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.bot);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    const rng = RB.makeRng(RB.hashStr('scene' + env.id));
    const px = (cx, cy, w, h, col) => { x.fillStyle = col; x.fillRect(Math.round(cx), Math.round(cy), w, h); };
    if (night) for (let i = 0; i < W / 9; i++) px(rng.int(0, W), rng.int(0, H * 0.6), 1, 1, rng.chance(0.3) ? '#ffffff' : '#8fa0d0');
    if (night) { px(W * 0.72, 8, 6, 6, '#e8ecf5'); px(W * 0.72 + 1, 7, 4, 8, '#e8ecf5'); px(W * 0.72 + 3, 9, 3, 3, '#c9d0e0'); }
    if (dusk) { x.fillStyle = 'rgba(255,190,110,0.55)'; x.beginPath(); x.arc(W * 0.3, H - 6, 16, 0, Math.PI * 2); x.fill(); }
    if (env.time === 'day') { x.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < W / 120; i++) { const cx = rng.int(0, W), cy = rng.int(6, 24); x.fillRect(cx, cy, 18, 3); x.fillRect(cx + 4, cy - 2, 9, 2); } }
    const tone = (day, duskC, nightC) => (night ? nightC : dusk ? duskC : day);
    const ridge = (base, amp, step, col, cap) => {
      x.fillStyle = col;
      x.beginPath();
      x.moveTo(0, H);
      let yy = H - base;
      const peaks = [];
      for (let xx = 0; xx <= W + step; xx += step) {
        yy = H - base - rng.range(0, amp);
        x.lineTo(xx, yy);
        peaks.push([xx, yy]);
      }
      x.lineTo(W, H);
      x.closePath();
      x.fill();
      if (cap) for (const [xx, yy] of peaks) if (H - yy > base + amp * 0.6) { px(xx - 3, yy, 7, 2, cap); px(xx - 1, yy - 1, 3, 1, cap); }
    };
    const trees = (colors, hMin, hMax, kind) => {
      for (let xx = -4; xx < W + 8; xx += rng.int(5, 9)) {
        const h = rng.int(hMin, hMax), col = rng.pick(colors);
        if (kind === 'pine') {
          for (let k = 0; k < h; k++) px(xx - Math.floor((k * 0.45)), H - h + k, 1 + Math.floor(k * 0.9), 1, col);
        } else {
          const r = Math.round(h * 0.45);
          x.fillStyle = col;
          x.beginPath();
          x.ellipse(xx, H - h + r, r + (kind === 'oak' ? 3 : 1), r, 0, 0, Math.PI * 2);
          x.fill();
          px(xx - r * 0.4, H - h + r * 0.4, 2, 1, shade(col, 0.25));
        }
      }
    };
    const water = (h, col, glint) => {
      px(0, H - h, W, h, col);
      for (let i = 0; i < W / 10; i++) px(rng.int(0, W), H - h + rng.int(1, h - 1), rng.int(2, 6), 1, glint);
    };
    for (const layer of env.scene) {
      switch (layer) {
        case 'mountains': ridge(22, 26, 22, tone('#71819e', '#4b416e', '#1a2142'), night ? null : '#eef2f8'); ridge(10, 10, 14, tone('#58698a', '#3a3358', '#131a33')); break;
        case 'flatirons':
          ridge(20, 20, 26, tone('#6d7c98', '#4b416e', '#1a2142'), night ? null : '#eef2f8');
          for (let xx = 10; xx < W; xx += 90) for (let k = 0; k < 3; k++) {
            x.fillStyle = tone('#a0694e', '#6d4a4a', '#2a2030');
            x.beginPath(); x.moveTo(xx + k * 16, H - 8); x.lineTo(xx + k * 16 + 10, H - 40 + k * 6); x.lineTo(xx + k * 16 + 18, H - 8); x.closePath(); x.fill();
          }
          break;
        case 'hills': ridge(12, 10, 30, tone('#5b8a52', '#3b4a4c', '#121a28')); break;
        case 'plains': px(0, H - 5, W, 5, tone('#8aa35a', '#4d4a3c', '#141a24')); trees([tone('#4c7a3a', '#2f3a30', '#0e141c')], 4, 7); break;
        case 'trees': trees([tone('#3f7a38', '#2c3b31', '#0e161c'), tone('#4d8a40', '#334235', '#111a20')], 9, 15); break;
        case 'oaks': trees([tone('#35683a', '#26352d', '#0b1318'), tone('#2e5c33', '#223028', '#0a1116')], 12, 18, 'oak'); break;
        case 'pines': trees([tone('#2d5a3a', '#223428', '#0a1418'), tone('#27503a', '#1e3026', '#09121a')], 12, 20, 'pine'); break;
        case 'fall': trees(night ? ['#1a1512', '#20150f', '#141612'] : dusk ? ['#7a3b24', '#8a5a26', '#4a3a2a'] : ['#d9642b', '#e8a33a', '#b8412c', '#7a9a3c', '#c9502a'], 9, 15); break;
        case 'palms':
          for (let xx = 8; xx < W; xx += rng.int(26, 44)) {
            const h = rng.int(24, 34), lean = rng.pick([-1, 1]);
            for (let k = 0; k < h; k++) px(xx + Math.round((k / h) * 3 * lean), H - k, 2, 1, tone('#7a5a3a', '#3a2c26', '#120e10'));
            const fx = xx + 3 * lean, fy = H - h, leaf = tone('#3f8a3a', '#26402c', '#0b1414');
            for (const [dx, dy] of [[-7, 2], [-5, -1], [0, -3], [5, -1], [7, 2], [-3, 3], [3, 3]]) px(fx + Math.min(0, dx), fy + Math.min(0, dy), Math.abs(dx) + 2, 2, leaf);
          }
          break;
        case 'skyline':
          for (let xx = 0; xx < W; xx += rng.int(8, 16)) {
            const bw = rng.int(7, 14), bh = rng.int(14, 44);
            px(xx, H - bh, bw, bh, tone('#8f9fb6', '#3a3c5c', '#10152a'));
            if (night || dusk) for (let wy = H - bh + 3; wy < H - 2; wy += 3) for (let wx = xx + 2; wx < xx + bw - 1; wx += 3) if (rng.chance(0.45)) px(wx, wy, 1, 1, '#ffd98a');
            else if (!night && !dusk) px(xx + 1, H - bh + 1, 1, bh - 2, '#b7c4d6');
          }
          break;
        case 'tower': {
          const tx = Math.round(W * 0.42);
          px(tx, H - 58, 9, 58, tone('#d8cdb0', '#b7a07a', '#3a3428'));
          px(tx - 1, H - 62, 11, 5, tone('#c9bd9c', '#a88f6a', '#302a22'));
          px(tx + 3, H - 68, 3, 6, tone('#c9bd9c', '#a88f6a', '#302a22'));
          if (night || dusk) { px(tx, H - 58, 9, 10, '#ff8a1c'); px(tx - 1, H - 62, 11, 5, '#ff9d3c'); }
          break;
        }
        case 'dome': {
          const dx = Math.round(W * 0.55);
          px(dx - 16, H - 20, 32, 20, tone('#e3dccb', '#9d8f7a', '#2a2622'));
          px(dx - 6, H - 30, 12, 10, tone('#e3dccb', '#9d8f7a', '#2a2622'));
          x.fillStyle = '#d9b233';
          x.beginPath(); x.ellipse(dx, H - 30, 7, 9, 0, Math.PI, 0); x.fill();
          px(dx - 1, H - 44, 2, 6, '#d9b233');
          break;
        }
        case 'capitol': {
          const dx = Math.round(W * 0.6);
          px(dx - 18, H - 16, 36, 16, tone('#e8e6e0', '#a09aa0', '#262630'));
          px(dx - 7, H - 26, 14, 10, tone('#e8e6e0', '#a09aa0', '#262630'));
          x.fillStyle = tone('#f2f0ea', '#b8b0b0', night ? '#3a3a48' : '#2a2a34');
          x.beginPath(); x.ellipse(dx, H - 26, 8, 10, 0, Math.PI, 0); x.fill();
          px(dx - 1, H - 40, 2, 5, '#d9b233');
          break;
        }
        case 'hospital': {
          const hx = Math.round(W * 0.36);
          px(hx, H - 46, 40, 46, tone('#c9ccd4', '#7a7a90', '#1c2030'));
          for (let wy = H - 43; wy < H - 2; wy += 4) for (let wx = hx + 3; wx < hx + 38; wx += 4) px(wx, wy, 2, 2, night || dusk ? (rng.chance(0.6) ? '#ffe7a8' : '#2a3048') : '#7f95b3');
          break;
        }
        case 'arches': {
          const ax = Math.round(W * 0.38), n = 7;
          px(ax, H - 30, n * 9 + 3, 30, tone('#d9c9a8', '#a8876a', '#2c261f'));
          for (let k = 0; k < n; k++) { px(ax + 3 + k * 9, H - 22, 6, 22, tone('#6d86a8', '#3a2f55', '#0d1122')); x.fillStyle = tone('#6d86a8', '#3a2f55', '#0d1122'); x.beginPath(); x.arc(ax + 6 + k * 9, H - 22, 3, Math.PI, 0); x.fill(); }
          px(ax + Math.round(n * 4.5) - 1, H - 38, 4, 8, tone('#c9b894', '#8d7458', '#2a241e'));
          px(ax + Math.round(n * 4.5) - 1, H - 43, 4, 5, '#ff9a2a');
          px(ax + Math.round(n * 4.5), H - 46, 2, 3, '#ffd23f');
          break;
        }
        case 'lake': water(9, tone('#3a78b4', '#3b3f6e', '#0e1732'), tone('#a6d0f2', '#f2a877', '#3b4c7a')); break;
        case 'bay': water(12, tone('#2f6ea8', '#34396a', '#0c152e'), tone('#9cc8ee', '#f2a877', '#34467a')); break;
        case 'river': water(6, tone('#3a78b4', '#3b3f6e', '#0e1732'), tone('#a6d0f2', '#f2a877', '#3b4c7a')); break;
        case 'boats':
          for (let xx = 20; xx < W; xx += rng.int(40, 70)) {
            const by = H - rng.int(3, 7);
            px(xx, by, 8, 2, tone('#f4f4f4', '#d9cbbd', '#5a5f70'));
            x.fillStyle = tone('#ffffff', '#f0dcc8', '#6a7088');
            x.beginPath(); x.moveTo(xx + 4, by - 9); x.lineTo(xx + 4, by - 1); x.lineTo(xx + 9, by - 1); x.closePath(); x.fill();
          }
          break;
      }
    }
    R.scene = c;
    R.sceneKey = key;
    return c;
  }

  // Draws the scenery strip with its bottom at y, scrolled a little with the
  // camera (it's far away), and fills any sky above it.
  function drawScene(ctx, env, bottom, drift) {
    const c = buildScene(env);
    const top = bottom - c.height;
    if (top > 0) {
      ctx.fillStyle = SKY[env.time].top;
      ctx.fillRect(0, 0, R.W, top);
    }
    const off = -((((drift || 0) % c.width) + c.width) % c.width);
    for (let xx = off; xx < R.W; xx += c.width) ctx.drawImage(c, Math.round(xx), top);
  }

  // A stretch of crowd rows (h px tall, cut from the crowd tile) with its
  // bottom at y, lined up with the field at world x = -10.
  function crowdBand(ctx, y, h, bounce) {
    if (!R.crowd || h <= 0) return;
    const cx = sx(-10);
    let yy = y;
    while (yy > y - h) {
      const hh = Math.min(R.crowd.height, yy - (y - h));
      ctx.drawImage(R.crowd, 0, R.crowd.height - hh, R.crowd.width, hh, cx, yy - hh + bounce, R.crowd.width, hh);
      yy -= hh;
    }
  }

  // Name band on the stand facing: the stadium's name, repeated along it.
  function facadeBand(ctx, env, V, y, h) {
    const col = FACADE[env.facade] || FACADE.concrete;
    ctx.fillStyle = env.time === 'night' ? shade(col, -0.45) : env.time === 'dusk' ? shade(col, -0.25) : col;
    ctx.fillRect(0, y, R.W, h);
    const u = V.uni ? V.uni[0] : null;
    if (u) {
      ctx.fillStyle = u.jersey === '#f4f4f4' ? u.trim : u.jersey;
      ctx.fillRect(0, y + h - 2, R.W, 2);
    }
    if (env.name && h >= 9) {
      const step = F.width(env.name, 1) + 60;
      const base = sx(-10);
      for (let xx = base + 20; xx < R.W + step; xx += step) if (xx + step > 0) F.draw(ctx, env.name, xx, y + 1, 1, '#ffffff');
    }
  }

  // The halo around a bank of stadium lights, drawn once and reused.
  let GLOW = null;
  function glowSprite() {
    if (GLOW) return GLOW;
    GLOW = document.createElement('canvas');
    GLOW.width = 54; GLOW.height = 52;
    const x = GLOW.getContext('2d');
    const g = x.createRadialGradient(27, 26, 1, 27, 26, 26);
    g.addColorStop(0, 'rgba(255,246,208,0.55)');
    g.addColorStop(1, 'rgba(255,246,208,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 54, 52);
    return GLOW;
  }

  // Light towers along the rim for dusk and night games.
  function lightTowers(ctx, env, rim) {
    if (env.time === 'day') return;
    for (const wx of [8, 38, 82, 112]) {
      const x0 = sx(wx);
      if (x0 < -20 || x0 > R.W + 20) continue;
      ctx.fillStyle = '#3a3f4f';
      ctx.fillRect(x0, rim - 26, 2, 26);
      ctx.drawImage(glowSprite(), x0 - 26, rim - 56);
      ctx.fillStyle = '#fff6d0';
      ctx.fillRect(x0 - 6, rim - 33, 14, 6);
      ctx.fillStyle = '#c9c2a0';
      for (let k = 0; k < 4; k++) ctx.fillRect(x0 - 5 + k * 3.5, rim - 30, 1, 1);
    }
  }

  function drawStadium(ctx, V) {
    const env = envOf(V);
    const night = env.time === 'night';
    ctx.fillStyle = SKY[env.time].top;
    ctx.fillRect(0, 0, R.W, R.H);
    // Far side, bottom up: wall, lower bowl, name band, upper decks, rim,
    // roof canopy, then the scenery past the stadium.
    const top = sy(-4);
    if (top > 0 && R.crowd) {
      const bounce = V.cheer > 0 ? Math.round(Math.sin(R.t * 30) * 1) : 0;
      let y = top - 4;
      const lower = env.tiers === 1 ? 44 : 30;
      crowdBand(ctx, y, lower, bounce);
      y -= lower;
      facadeBand(ctx, env, V, y - 10, 10);
      y -= 10;
      for (let t = 1; t < env.tiers; t++) {
        crowdBand(ctx, y, 22, bounce);
        y -= 22;
        ctx.fillStyle = shade(FACADE[env.facade] || FACADE.concrete, night ? -0.5 : -0.2);
        ctx.fillRect(0, y - 3, R.W, 3);
        y -= 3;
      }
      if (env.canopy) {
        ctx.fillStyle = night ? '#0e1220' : '#3a3f4c';
        ctx.fillRect(0, y - 6, R.W, 6);
        ctx.fillStyle = night ? '#1a2033' : '#5a606e';
        for (let xx = (sx(0) % 14 + 14) % 14; xx < R.W; xx += 14) ctx.fillRect(xx, y - 6, 1, 6);
        y -= 6;
      }
      // Landmarks sit mid-strip; scroll so they're centered at midfield.
      if (y > 0) drawScene(ctx, env, y, (R.cam.x - 60) * R.SX * 0.3 + (buildScene(env).width * 0.47 - R.W / 2));
      lightTowers(ctx, env, y);
      ctx.fillStyle = PAL.wall;
      ctx.fillRect(0, top - 4, R.W, 4);
      ctx.fillStyle = V.uni ? V.uni[0].jersey : '#333';
      ctx.fillRect(0, top - 4, R.W, 1);
    }
    // Apron around the field.
    ctx.fillStyle = (TURF[env.turf] || TURF.green)[2];
    const ax0 = sx(-4), ax1 = sx(124), ay0 = sy(-4), ay1 = sy(FW + 4);
    ctx.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
    if (env.hedges) {
      // "Between the hedges": privet hedges ring the field.
      const hh = Math.max(5, Math.round(1.3 * R.SY));
      for (const hy of [sy(-3.6), sy(FW + 2.3)]) {
        ctx.fillStyle = '#1c4523';
        ctx.fillRect(ax0, hy, ax1 - ax0, hh);
        ctx.fillStyle = '#2c6a33';
        for (let xx = ax0; xx < ax1; xx += 5) { ctx.fillRect(xx, hy - 2, 4, 3); ctx.fillRect(xx + 2, hy + 2, 2, 2); }
        ctx.fillStyle = '#3f8a44';
        for (let xx = ax0 + 1; xx < ax1; xx += 5) ctx.fillRect(xx, hy - 2, 2, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(ax0, hy + hh, ax1 - ax0, 1);
      }
    }
    // Near-side wall and the lower bowl behind it.
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(0, ay1, R.W, 4);
    if (R.crowd && ay1 + 4 < R.H) {
      const cx = sx(-10);
      for (let yy = ay1 + 4; yy < R.H; yy += R.crowd.height) ctx.drawImage(R.crowd, cx, yy);
      ctx.fillStyle = night ? 'rgba(8,11,22,0.72)' : 'rgba(11,15,28,0.55)';
      ctx.fillRect(0, ay1 + 4, R.W, R.H - ay1 - 4);
    }
  }

  function drawField(ctx, V) {
    const y0 = sy(0), y1 = sy(FW);
    const xMin = Math.max(0, Math.floor(R.cam.x - R.W / 2 / R.SX) - 1);
    const xMax = Math.min(120, Math.ceil(R.cam.x + R.W / 2 / R.SX) + 1);
    const env = envOf(V), turf = TURF[env.turf] || TURF.green;
    // Turf stripes every 5 yards.
    for (let x = 10; x < 110; x += 5) {
      if (x + 5 < xMin || x > xMax) continue;
      ctx.fillStyle = (x / 5) % 2 ? turf[0] : turf[1];
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
      if (env.checker) {
        // Checkerboard end zones: orange-and-white bands at the back and the
        // goal line, the school's name in the solid middle.
        const hu = V.uni[0], a = hu.jersey === '#f4f4f4' ? hu.trim : hu.jersey, sq = 2.5;
        for (const bx of [e.x, e.x + 7.5]) for (let j = 0; j * sq < FW; j++) {
          for (let c = 0; c < 2; c++) {
            ctx.fillStyle = (j + c) % 2 ? a : '#f4f4f4';
            const xa = sx(bx + c * 1.25), xb = sx(bx + (c + 1) * 1.25);
            ctx.fillRect(xa, sy(j * sq), xb - xa, sy(Math.min(FW, (j + 1) * sq)) - sy(j * sq));
          }
        }
      }
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
      if (p.hot && !st.down) {
        // Hot streak: a flickering flame over his head (a cold QB gets a blue drip).
        const hy = py - spr.height * SPR - 3 * SPR, f = Math.floor(R.t * 10 + p.i) % 2;
        if (p.hot > 0) {
          ctx.fillStyle = p.hot > 1 ? '#ff4a1c' : '#ff8a1c';
          ctx.fillRect(px - SPR, hy - (f ? 2 : 1.5) * SPR, 2 * SPR, 2.5 * SPR);
          ctx.fillStyle = '#ffd23f';
          ctx.fillRect(px - 0.5 * SPR, hy - (f ? 1 : 0.5) * SPR, SPR, 1.5 * SPR);
          if (p.hot > 1) { ctx.fillStyle = '#ff4a1c'; ctx.fillRect(px + (f ? 1 : -2) * SPR, hy - 3 * SPR, SPR, SPR); }
        } else {
          ctx.fillStyle = '#5ab4ff';
          ctx.fillRect(px - 0.5 * SPR, hy - SPR, SPR, 2 * SPR);
        }
      }
      if (p.i === V.defCtrl && !p.down) {
        ctx.fillStyle = 'rgba(90,230,255,0.95)';
        ring(ctx, px, py, 6 * SPR, 2.5 * SPR);
        // A marker over his head so he's easy to find; solid once he's yours.
        const hy = py - spr.height * SPR - 2 * SPR, t = 2.2 * SPR;
        ctx.fillStyle = V.defOwn ? '#5ae6ff' : 'rgba(90,230,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(px - t, hy - t * 1.2);
        ctx.lineTo(px + t, hy - t * 1.2);
        ctx.lineTo(px, hy);
        ctx.closePath();
        ctx.fill();
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

  // Fixed joystick in the bottom-left corner; the knob follows the thumb.
  function drawJoy(ctx, V) {
    const j = V.joy;
    if (!j) return;
    const r = j.r || 20;
    ctx.fillStyle = j.held ? 'rgba(13,15,20,0.42)' : 'rgba(13,15,20,0.28)';
    ellipse(ctx, j.x0, j.y0, r, r);
    ctx.strokeStyle = j.held ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(j.x0, j.y0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = j.on ? 'rgba(255,210,63,0.9)' : j.held ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)';
    ellipse(ctx, j.x1, j.y1, r * 0.36, r * 0.36);
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
    // During the opening stadium shot the banner sits low, clear of the scenery.
    const y = Math.round(R.hudH + (R.H - R.hudH - R.bottom) * (V.phase === 'coin' && V.mode === 'field' ? 0.74 : 0.3));
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

  // Pre-snap key: each route color, who runs it and his top ratings (* = star).
  function drawLegend(ctx, V) {
    if (!V.legend || V.phase !== 'presnap') return;
    const x = 4, lh = 9;
    // Landscape: top-left, behind the formation. Portrait: in the space under the field.
    let y = R.portrait ? R.H - R.bottom + 4 : 5 + (V.netInfo ? 13 : 0);
    const w = Math.max(...V.legend.map((l) => F.width(l.text, 1))) + 14;
    ctx.fillStyle = 'rgba(13,15,20,0.55)';
    ctx.fillRect(x, y - 2, w, V.legend.length * lh + 3);
    for (const l of V.legend) {
      ctx.fillStyle = l.color;
      ctx.fillRect(x + 3, y + 1, 5, 5);
      F.draw(ctx, l.text, x + 11, y, 1, 'rgba(255,255,255,0.9)');
      y += lh;
    }
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
    const horizon = Math.round(R.hudH + (H - R.hudH) * 0.34);
    const camBack = 9, camH = 2.1, f = (H - R.hudH) * 0.95;
    const P = (x, d, h) => {
      const z = Math.max(0.5, d + camBack);
      return { x: Math.round(W / 2 + (x * f) / z), y: Math.round(horizon + ((camH - h) * f) / z), s: f / z };
    };
    // Behind the posts: the end-zone stands and the scenery past them.
    const env = envOf(V);
    ctx.fillStyle = SKY[env.time].top;
    ctx.fillRect(0, 0, W, R.H);
    const standsTop = horizon - 6 - 28 - 9;
    drawScene(ctx, env, standsTop, buildScene(env).width * 0.47 - W / 2);
    if (R.crowd) {
      for (let yy = horizon - 6; yy > standsTop + 9; yy -= R.crowd.height) {
        const hh = Math.min(R.crowd.height, yy - standsTop - 9);
        ctx.drawImage(R.crowd, 0, R.crowd.height - hh, R.crowd.width, hh, 0, yy - hh, R.crowd.width, hh);
      }
    }
    facadeBand(ctx, env, V, standsTop, 9);
    lightTowers(ctx, env, standsTop);
    ctx.fillStyle = PAL.wall;
    ctx.fillRect(0, horizon - 6, W, 6);
    // Turf with 5-yard bands.
    const far = k.dist + 14, kturf = TURF[env.turf] || TURF.green;
    for (let d = -camBack + 1; d < far; d += 5) {
      const a = P(0, d, 0), b = P(0, Math.min(far, d + 5), 0);
      ctx.fillStyle = Math.floor((d + 100) / 5) % 2 ? kturf[0] : kturf[1];
      ctx.fillRect(0, b.y, W, a.y - b.y + 1);
    }
    ctx.fillStyle = kturf[1];
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
    plate(ctx, title, W / 2, H - 34, PAL.amber);
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
    if (V.uni) buildCrowd(V.uni, envOf(V));
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
    drawLegend(ctx, V);
    drawBanner(ctx, V);
  }

  // Team preview on the pick screen: one standing player, drawn at 1:1.
  function drawSprite(ctx, uni, skin) {
    ctx.drawImage(sprite(uni, skin, 'stand', 0, 1, false, 'pick'), 0, 0);
  }

  RB.Render = { R, init, resize, frame, toWorld, screenDeltaToWorld, sx, sy, PAL, readable, shade, drawSprite };
})(typeof window !== 'undefined' ? window : globalThis);
