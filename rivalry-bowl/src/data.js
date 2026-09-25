/* Rivalry Bowl: constants, teams, rosters and a seeded RNG.
 * Every src file attaches to the shared RB namespace so the same code runs
 * in the browser and under node (tools/simtest.js). */
(function (root) {
  'use strict';
  const RB = (root.RB = root.RB || {});

  const C = {
    FIELD_LEN: 120,
    FIELD_W: 160 / 3,
    GOAL_L: 10,
    GOAL_R: 110,
    HASH_TOP: 20,
    HASH_BOT: 160 / 3 - 20,
    MID_Y: 80 / 3,
    DT: 1 / 60,
    GRAVITY: 10.7, // yd/s^2
    PR: 0.45, // player radius, yards
    PLAY_CLOCK_RUNOFF: 25,
    MIN_RUNOFF: 10,
    RUNOFF_RATE: 7, // game seconds drained per real second between plays
    KICKOFF_TOUCHBACK: 25,
    PUNT_TOUCHBACK: 20,
    XP_DIST: 20, // college PAT snapped from the 3
  };

  // --- RNG ------------------------------------------------------------------
  function makeRng(seed) {
    let a = seed >>> 0;
    function next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    let spare = null;
    return {
      next,
      range: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      gauss() {
        if (spare !== null) {
          const s = spare;
          spare = null;
          return s;
        }
        let u = 0, v = 0;
        while (u === 0) u = next();
        v = next();
        const m = Math.sqrt(-2 * Math.log(u));
        spare = m * Math.sin(2 * Math.PI * v);
        return m * Math.cos(2 * Math.PI * v);
      },
    };
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // --- Teams ----------------------------------------------------------------
  // Ratings: [QB, RB, WR, OL, DL, LB, DB, K], 50-99.
  // School names and colors only; no logos or marks.
  const TEAM_ROWS = [
    ['ALA', 'ALABAMA', '#9e1b32', '#9e1b32', '#f4f4f4', '#ffffff', [88, 86, 85, 90, 92, 88, 89, 80]],
    ['UGA', 'GEORGIA', '#ba0c2f', '#ba0c2f', '#c8c8c8', '#1a1a1a', [86, 88, 84, 90, 94, 90, 90, 82]],
    ['OSU', 'OHIO STATE', '#bb0000', '#a7b1b7', '#a7b1b7', '#ffffff', [90, 85, 95, 86, 90, 86, 88, 78]],
    ['MICH', 'MICHIGAN', '#00274c', '#00274c', '#ffcb05', '#ffcb05', [80, 88, 80, 92, 90, 88, 88, 80]],
    ['TEX', 'TEXAS', '#bf5700', '#f4f4f4', '#f4f4f4', '#ffffff', [89, 85, 88, 86, 86, 84, 84, 80]],
    ['LSU', 'LSU', '#461d7c', '#fdd023', '#fdd023', '#fdd023', [88, 82, 90, 82, 84, 82, 82, 78]],
    ['CLEM', 'CLEMSON', '#f56600', '#f4f4f4', '#f4f4f4', '#522d80', [80, 82, 80, 82, 88, 86, 84, 76]],
    ['ORE', 'OREGON', '#154733', '#fee123', '#154733', '#fee123', [90, 84, 86, 86, 84, 82, 82, 78]],
    ['USC', 'USC', '#990000', '#990000', '#ffc72c', '#ffc72c', [88, 80, 86, 78, 78, 76, 76, 76]],
    ['ND', 'NOTRE DAME', '#0c2340', '#c99700', '#c99700', '#c99700', [80, 84, 78, 90, 84, 84, 86, 80]],
    ['FSU', 'FLORIDA ST', '#782f40', '#ceb888', '#ceb888', '#ceb888', [78, 80, 80, 78, 84, 80, 80, 76]],
    ['PSU', 'PENN STATE', '#041e42', '#f4f4f4', '#f4f4f4', '#ffffff', [80, 88, 78, 86, 88, 88, 84, 80]],
    ['OU', 'OKLAHOMA', '#841617', '#841617', '#fdf9d8', '#fdf9d8', [82, 80, 82, 80, 80, 78, 78, 76]],
    ['TENN', 'TENNESSEE', '#ff8200', '#f4f4f4', '#f4f4f4', '#ffffff', [84, 82, 84, 82, 82, 78, 78, 76]],
    ['UF', 'FLORIDA', '#0021a5', '#0021a5', '#f4f4f4', '#fa4616', [78, 80, 80, 78, 80, 78, 80, 76]],
    ['MIA', 'MIAMI', '#005030', '#f4f4f4', '#f4f4f4', '#f47321', [82, 82, 82, 80, 80, 78, 78, 76]],
    ['TAMU', 'TEXAS A&M', '#500000', '#f4f4f4', '#f4f4f4', '#ffffff', [78, 80, 78, 84, 84, 80, 80, 78]],
    ['AUB', 'AUBURN', '#0c2340', '#f4f4f4', '#f4f4f4', '#e87722', [76, 80, 76, 80, 82, 80, 78, 76]],
    ['WIS', 'WISCONSIN', '#c5050c', '#f4f4f4', '#f4f4f4', '#ffffff', [72, 86, 72, 86, 80, 80, 78, 76]],
    ['UW', 'WASHINGTON', '#4b2e83', '#b7a57a', '#b7a57a', '#b7a57a', [82, 78, 84, 80, 78, 76, 78, 76]],
    ['NEB', 'NEBRASKA', '#e41c38', '#f4f4f4', '#f4f4f4', '#ffffff', [72, 76, 72, 78, 76, 76, 74, 72]],
    ['IOWA', 'IOWA', '#111111', '#ffcd00', '#ffcd00', '#ffcd00', [62, 76, 66, 84, 84, 86, 86, 82]],
    ['COLO', 'COLORADO', '#111111', '#cfb87c', '#cfb87c', '#cfb87c', [86, 74, 86, 70, 74, 72, 82, 72]],
    ['BSU', 'BOISE ST', '#0033a0', '#0033a0', '#0033a0', '#d64309', [76, 86, 74, 74, 74, 74, 74, 74]],
    ['UTAH', 'UTAH', '#cc0000', '#cc0000', '#f4f4f4', '#ffffff', [76, 78, 74, 82, 82, 80, 80, 78]],
    ['MISS', 'OLE MISS', '#ce1126', '#14213d', '#f4f4f4', '#14213d', [86, 82, 84, 78, 80, 76, 76, 76]],
    ['OKST', 'OKLAHOMA ST', '#ff7300', '#111111', '#111111', '#ffffff', [74, 80, 78, 74, 72, 72, 72, 74]],
    ['VT', 'VIRGINIA TECH', '#630031', '#630031', '#f4f4f4', '#cf4420', [70, 74, 72, 74, 76, 74, 76, 74]],
    ['ARMY', 'ARMY', '#111111', '#d4bf91', '#d4bf91', '#d4bf91', [66, 80, 62, 74, 70, 72, 70, 72]],
    ['NAVY', 'NAVY', '#00205b', '#c5b783', '#c5b783', '#c5b783', [66, 80, 62, 72, 70, 72, 70, 72]],
  ];

  const TEAMS = TEAM_ROWS.map(([id, name, jersey, helmet, pants, trim, r]) => ({
    id, name, jersey, helmet, pants, trim,
    r: { qb: r[0], rb: r[1], wr: r[2], ol: r[3], dl: r[4], lb: r[5], db: r[6], k: r[7] },
  }));
  const TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

  function teamStars(t, even) {
    const r = even ? evenRatings() : t.r;
    const off = (r.qb * 2 + r.rb + r.wr * 1.5 + r.ol) / 5.5;
    const def = (r.dl + r.lb + r.db) / 3;
    const toStars = (v) => Math.max(1, Math.min(5, Math.round(((v - 58) / 36) * 8) / 2 + 1));
    return { off: toStars(off), def: toStars(def), ovr: toStars((off + def) / 2) };
  }
  function evenRatings() {
    return { qb: 82, rb: 82, wr: 82, ol: 82, dl: 82, lb: 82, db: 82, k: 80 };
  }

  // --- Rosters --------------------------------------------------------------
  const FIRST = 'AJBCDEGHIKLMNOPRSTWZ';
  const LAST = [
    'SMITH', 'JOHNSON', 'WILLIAMS', 'BROWN', 'JONES', 'DAVIS', 'MILLER', 'WILSON', 'MOORE', 'TAYLOR',
    'THOMAS', 'JACKSON', 'WHITE', 'HARRIS', 'MARTIN', 'THOMPSON', 'ROBINSON', 'CLARK', 'LEWIS', 'WALKER',
    'HALL', 'ALLEN', 'YOUNG', 'KING', 'WRIGHT', 'HILL', 'GREEN', 'ADAMS', 'BAKER', 'NELSON',
    'CARTER', 'MITCHELL', 'ROBERTS', 'TURNER', 'PHILLIPS', 'CAMPBELL', 'PARKER', 'EVANS', 'EDWARDS', 'COLLINS',
    'STEWART', 'MORRIS', 'REED', 'COOK', 'MORGAN', 'BELL', 'MURPHY', 'BAILEY', 'COOPER', 'RICHARDSON',
    'COX', 'HOWARD', 'WARD', 'PETERSON', 'GRAY', 'JAMES', 'WATSON', 'BROOKS', 'KELLY', 'SANDERS',
    'PRICE', 'BENNETT', 'WOOD', 'BARNES', 'ROSS', 'HENDERSON', 'COLEMAN', 'JENKINS', 'PERRY', 'POWELL',
    'LONG', 'PATTERSON', 'HUGHES', 'WASHINGTON', 'BUTLER', 'SIMMONS', 'FOSTER', 'BRYANT', 'ALEXANDER', 'RUSSELL',
    'GRIFFIN', 'HAYES', 'MYERS', 'FORD', 'HAMILTON', 'GRAHAM', 'WALLACE', 'WEST', 'COLE', 'HAYNES',
  ];
  const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#6b4226', '#ffdbac', '#a0673c', '#4a2c17'];

  // Offense slots: QB RB C LG RG LT RT TE WR1 WR2 WR3
  // Defense slots: DE DT DT DE LB LB LB CB CB S S
  const OFF_POS = ['QB', 'RB', 'OL', 'OL', 'OL', 'OL', 'OL', 'TE', 'WR', 'WR', 'WR'];
  const DEF_POS = ['DL', 'DL', 'DL', 'DL', 'LB', 'LB', 'LB', 'CB', 'CB', 'S', 'S'];
  const NUM_RANGE = {
    QB: [1, 19], RB: [1, 49], OL: [50, 79], TE: [80, 89], WR: [1, 19],
    DL: [90, 99], LB: [30, 59], CB: [1, 39], S: [1, 49], K: [1, 49],
  };

  // Converts 50-99 ratings into sim attributes (speeds in yd/s, skills 0-1).
  function buildRoster(team, even) {
    const r = even ? evenRatings() : team.r;
    const rng = makeRng(hashStr(team.id + (even ? ':even' : '')));
    const f = (v) => (v - 50) / 50; // 0..1
    const jit = (a) => a + rng.range(-0.03, 0.03);
    const used = new Set();
    function number(pos) {
      const [lo, hi] = NUM_RANGE[pos];
      for (let k = 0; k < 40; k++) {
        const n = rng.int(lo, hi);
        if (!used.has(n)) { used.add(n); return n; }
      }
      return lo;
    }
    function person(pos) {
      return {
        pos,
        num: number(pos),
        name: rng.pick(FIRST.split('')) + '. ' + rng.pick(LAST),
        skin: rng.pick(SKIN),
      };
    }
    const off = OFF_POS.map((pos, i) => {
      const p = person(pos);
      if (pos === 'QB') Object.assign(p, { spd: 6.3 + f(r.qb) * 0.5 + rng.range(-0.3, 0.5), arm: jit(0.72 + f(r.qb) * 0.28), acc: jit(0.6 + f(r.qb) * 0.38), hands: 0.6, str: 0.5, elus: 0.45 });
      if (pos === 'RB') Object.assign(p, { spd: 7.35 + f(r.rb) * 0.75, hands: jit(0.78 + f(r.rb) * 0.12), str: jit(0.5 + f(r.rb) * 0.4), elus: jit(0.5 + f(r.rb) * 0.45), block: 0.45 });
      if (pos === 'OL') Object.assign(p, { spd: 5.4, block: jit(0.45 + f(r.ol) * 0.5), str: 0.9 });
      if (pos === 'TE') Object.assign(p, { spd: 6.8 + f(r.wr) * 0.4, hands: jit(0.8 + f(r.wr) * 0.12), str: 0.75, elus: 0.35, block: jit(0.4 + f(r.ol) * 0.35) });
      if (pos === 'WR') Object.assign(p, { spd: 7.55 + f(r.wr) * 0.8 - (i === 10 ? 0.1 : 0), hands: jit(0.84 + f(r.wr) * 0.12), str: 0.4, elus: jit(0.5 + f(r.wr) * 0.4), block: 0.3 });
      return p;
    });
    const def = DEF_POS.map((pos) => {
      const p = person(pos);
      if (pos === 'DL') Object.assign(p, { spd: 6.1 + f(r.dl) * 0.5, rush: jit(0.45 + f(r.dl) * 0.5), tackle: jit(0.75 + f(r.dl) * 0.2), cover: 0.2, hands: 0.25 });
      if (pos === 'LB') Object.assign(p, { spd: 6.9 + f(r.lb) * 0.5, rush: jit(0.4 + f(r.lb) * 0.4), tackle: jit(0.78 + f(r.lb) * 0.18), cover: jit(0.4 + f(r.lb) * 0.35), hands: 0.4 });
      if (pos === 'CB') Object.assign(p, { spd: 7.45 + f(r.db) * 0.8, tackle: jit(0.62 + f(r.db) * 0.2), cover: jit(0.5 + f(r.db) * 0.45), hands: jit(0.45 + f(r.db) * 0.2), rush: 0.35 });
      if (pos === 'S') Object.assign(p, { spd: 7.3 + f(r.db) * 0.6, tackle: jit(0.7 + f(r.db) * 0.2), cover: jit(0.45 + f(r.db) * 0.45), hands: jit(0.45 + f(r.db) * 0.2), rush: 0.35 });
      return p;
    });
    const k = { power: 49 + f(r.k) * 11, acc: 0.7 + f(r.k) * 0.28, name: rng.pick(FIRST.split('')) + '. ' + rng.pick(LAST), num: number('K') };
    return { off, def, k };
  }

  // Swap the away side to white jerseys when both teams' jerseys look alike.
  function colorDist(a, b) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
    const x = p(a), y = p(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  }
  function uniforms(home, away) {
    const h = { jersey: home.jersey, helmet: home.helmet, pants: home.pants, trim: home.trim };
    const a = { jersey: away.jersey, helmet: away.helmet, pants: away.pants, trim: away.trim };
    if (colorDist(home.jersey, away.jersey) < 110) {
      a.trim = away.jersey;
      a.jersey = '#f4f4f4';
    }
    return [h, a];
  }

  RB.C = C;
  RB.makeRng = makeRng;
  RB.hashStr = hashStr;
  RB.TEAMS = TEAMS;
  RB.TEAM_BY_ID = TEAM_BY_ID;
  RB.teamStars = teamStars;
  RB.buildRoster = buildRoster;
  RB.uniforms = uniforms;
})(typeof window !== 'undefined' ? window : globalThis);
