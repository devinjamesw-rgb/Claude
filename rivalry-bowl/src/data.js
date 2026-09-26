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

  // Each school's stars follow its long-standing program identity (WR U, DB U,
  // Linebacker U, the service academies' option QBs...). Player names are
  // made up; only the kind of team is real.
  const STAR = {
    qb_arm: { side: 'off', slot: 0, boost: { ARM: 14, ACC: 3 }, tag: 'CANNON ARM' },
    qb_acc: { side: 'off', slot: 0, boost: { ACC: 14, ARM: 3 }, tag: 'PINPOINT' },
    qb_run: { side: 'off', slot: 0, boost: { SPD: 22, ELU: 14 }, tag: 'DUAL THREAT' },
    rb_spd: { side: 'off', slot: 1, boost: { SPD: 10, ELU: 10 }, tag: 'BURNER' },
    rb_pow: { side: 'off', slot: 1, boost: { STR: 14, ELU: 6 }, tag: 'BULLDOZER' },
    te: { side: 'off', slot: 7, boost: { HND: 10, SPD: 6 }, tag: 'SAFE HANDS' },
    wr_spd: { side: 'off', slot: 8, boost: { SPD: 12, HND: 2 }, tag: 'DEEP THREAT' },
    wr_hnd: { side: 'off', slot: 9, boost: { HND: 12, ELU: 4 }, tag: 'SURE HANDS' },
    edge: { side: 'def', slot: 0, boost: { RSH: 14, SPD: 6 }, tag: 'EDGE RUSHER' },
    dt: { side: 'def', slot: 1, boost: { RSH: 12, TKL: 6 }, tag: 'INTERIOR WALL' },
    lb: { side: 'def', slot: 4, boost: { TKL: 10, SPD: 8, COV: 6 }, tag: 'TACKLING MACHINE' },
    cb: { side: 'def', slot: 7, boost: { COV: 12, SPD: 8, HND: 6 }, tag: 'LOCKDOWN' },
    k: { side: 'k', slot: undefined, boost: { PWR: 8, ACC: 8 }, tag: 'BIG LEG' },
  };
  const TRAITS = {
    ALA: ['edge', 'wr_spd'], UGA: ['lb', 'dt', 'rb_pow'], OSU: ['wr_spd', 'wr_hnd'], MICH: ['rb_pow', 'dt', 'cb'],
    TEX: ['qb_arm', 'wr_spd'], LSU: ['wr_spd', 'cb'], CLEM: ['dt', 'edge'], ORE: ['qb_acc', 'wr_spd'],
    USC: ['qb_acc', 'wr_hnd'], ND: ['te', 'rb_pow'], FSU: ['edge', 'wr_spd'], PSU: ['lb', 'rb_spd'],
    OU: ['qb_acc', 'wr_spd'], TENN: ['qb_arm', 'wr_spd'], UF: ['wr_spd', 'cb'], MIA: ['edge', 'wr_spd'],
    TAMU: ['dt', 'wr_hnd'], AUB: ['rb_spd', 'edge'], WIS: ['rb_pow', 'te'], UW: ['qb_arm', 'wr_hnd'],
    NEB: ['rb_pow', 'lb'], IOWA: ['cb', 'te', 'k'], COLO: ['qb_acc', 'cb'], BSU: ['rb_spd', 'qb_acc'],
    UTAH: ['dt', 'lb'], MISS: ['qb_arm', 'wr_spd'], OKST: ['rb_spd', 'wr_spd'], VT: ['k', 'cb'],
    ARMY: ['qb_run', 'rb_pow'], NAVY: ['qb_run', 'rb_spd'],
  };
  // Which ratings each position shows, in order of importance.
  const SHOWN = {
    QB: ['ARM', 'ACC', 'SPD'], RB: ['SPD', 'ELU', 'STR'], TE: ['HND', 'SPD'], WR: ['SPD', 'HND', 'ELU'],
    OL: ['BLK'], DL: ['RSH', 'TKL'], LB: ['TKL', 'SPD', 'COV'], CB: ['COV', 'SPD'], S: ['COV', 'SPD'], K: ['PWR', 'ACC'],
  };
  // Speed rating <-> yards per second: 99 runs 8.6, 85 runs 7.9, 60 runs 6.8.
  const speedRating = (yds) => Math.round(Math.max(40, Math.min(99, (yds - 4.2) / 0.044)));

  // Every player gets his own ratings: his position group's team rating
  // (compressed so stars can stand above it), his own form, a little noise
  // per rating, and the school's stars on top. The sim reads them as
  // attributes; the shown SPD comes from his real speed, so an SPD 90
  // corner runs exactly as fast as an SPD 90 receiver.
  function buildRoster(team, even, dev) {
    const r = even ? evenRatings() : team.r;
    const rng = makeRng(hashStr(team.id + (even ? ':even' : '')));
    const spread = even ? 0 : 1;
    const traits = even ? [] : TRAITS[team.id] || [];
    const lvl = (g) => 60 + (g - 50) * 0.6; // team rating 50-99 -> 60-89
    const f = (v) => Math.max(-0.5, Math.min(1.3, (v - 60) / 30)); // 0 at 60, 1 at 90
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
    // Growth from earlier games (per player, per rating), unless ratings are even.
    const grown = (!even && dev && typeof dev === 'object') ? dev : null;
    function rate(base, side, slot) {
      const form = rng.gauss() * 3 * spread;
      const v = {};
      for (const [k, x] of Object.entries(base)) v[k] = x + form + rng.gauss() * 2.5 * spread;
      const gk = side === 'off' ? 'o' + slot : side === 'def' ? 'd' + slot : 'k';
      const gd = grown && grown[gk];
      let star = null;
      for (const t of traits) {
        const S = STAR[t];
        if (S.side !== side || S.slot !== slot) continue;
        star = S.tag;
        for (const [k, x] of Object.entries(S.boost)) v[k] += x;
      }
      let up = 0;
      if (gd) for (const k of Object.keys(v)) if (typeof gd[k] === 'number') { const n = Math.max(0, Math.min(GROW_CAP, gd[k])); v[k] += n; up += n; }
      for (const k of Object.keys(v)) v[k] = Math.round(Math.max(45, Math.min(99, v[k])));
      return { v, star, up };
    }
    const depth = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, -3]; // WR1 a touch better, WR3 a step down
    const off = OFF_POS.map((pos, i) => {
      const p = person(pos);
      let q;
      if (pos === 'QB') {
        q = rate({ ARM: lvl(r.qb), ACC: lvl(r.qb), SPD: 64, ELU: 62 }, 'off', i);
        const v = q.v;
        Object.assign(p, { spd: 6.45 + f(v.SPD) * 1.4, arm: 0.72 + f(v.ARM) * 0.28, acc: 0.6 + f(v.ACC) * 0.38, hands: 0.6, str: 0.5, elus: 0.3 + f(v.ELU) * 0.4 });
      } else if (pos === 'RB') {
        q = rate({ SPD: lvl(r.rb), ELU: lvl(r.rb), STR: lvl(r.rb), HND: lvl(r.rb) }, 'off', i);
        const v = q.v;
        Object.assign(p, { spd: 7.35 + f(v.SPD) * 0.75, hands: 0.78 + f(v.HND) * 0.12, str: 0.5 + f(v.STR) * 0.4, elus: 0.5 + f(v.ELU) * 0.45, block: 0.45 });
      } else if (pos === 'OL') {
        q = rate({ BLK: lvl(r.ol) }, 'off', i);
        Object.assign(p, { spd: 5.4, block: 0.45 + f(q.v.BLK) * 0.5, str: 0.9 });
      } else if (pos === 'TE') {
        q = rate({ HND: lvl(r.wr), SPD: lvl(r.wr), BLK: lvl(r.ol) }, 'off', i);
        const v = q.v;
        Object.assign(p, { spd: 6.8 + f(v.SPD) * 0.4, hands: 0.8 + f(v.HND) * 0.12, str: 0.75, elus: 0.35, block: 0.4 + f(v.BLK) * 0.35 });
      } else {
        const b = lvl(r.wr) + depth[i];
        q = rate({ SPD: b, HND: b, ELU: b }, 'off', i);
        const v = q.v;
        Object.assign(p, { spd: 7.55 + f(v.SPD) * 0.8, hands: 0.84 + f(v.HND) * 0.12, str: 0.4, elus: 0.5 + f(v.ELU) * 0.4, block: 0.3 });
      }
      return Object.assign(p, { rt: Object.assign(q.v, { SPD: speedRating(p.spd) }), star: q.star, up: q.up, slot: 'o' + i });
    });
    const def = DEF_POS.map((pos, i) => {
      const p = person(pos);
      let q;
      if (pos === 'DL') {
        q = rate({ RSH: lvl(r.dl), TKL: lvl(r.dl), SPD: lvl(r.dl) }, 'def', i);
        const v = q.v;
        Object.assign(p, { spd: 6.1 + f(v.SPD) * 0.5, rush: 0.45 + f(v.RSH) * 0.5, tackle: 0.75 + f(v.TKL) * 0.2, cover: 0.2, hands: 0.25 });
      } else if (pos === 'LB') {
        q = rate({ TKL: lvl(r.lb), SPD: lvl(r.lb), COV: lvl(r.lb), RSH: lvl(r.lb) }, 'def', i);
        const v = q.v;
        Object.assign(p, { spd: 6.9 + f(v.SPD) * 0.5, rush: 0.4 + f(v.RSH) * 0.4, tackle: 0.78 + f(v.TKL) * 0.18, cover: 0.4 + f(v.COV) * 0.35, hands: 0.4 });
      } else if (pos === 'CB') {
        q = rate({ COV: lvl(r.db), SPD: lvl(r.db), HND: lvl(r.db), TKL: lvl(r.db) }, 'def', i);
        const v = q.v;
        Object.assign(p, { spd: 7.45 + f(v.SPD) * 0.8, tackle: 0.62 + f(v.TKL) * 0.2, cover: 0.5 + f(v.COV) * 0.45, hands: 0.45 + f(v.HND) * 0.2, rush: 0.35 });
      } else {
        q = rate({ COV: lvl(r.db), SPD: lvl(r.db), HND: lvl(r.db), TKL: lvl(r.db) }, 'def', i);
        const v = q.v;
        Object.assign(p, { spd: 7.3 + f(v.SPD) * 0.6, tackle: 0.7 + f(v.TKL) * 0.2, cover: 0.45 + f(v.COV) * 0.45, hands: 0.45 + f(v.HND) * 0.2, rush: 0.35 });
      }
      return Object.assign(p, { rt: Object.assign(q.v, { SPD: speedRating(p.spd) }), star: q.star, up: q.up, slot: 'd' + i });
    });
    const kq = rate({ PWR: lvl(r.k), ACC: lvl(r.k) }, 'k', undefined);
    const k = { power: 49 + f(kq.v.PWR) * 11, acc: Math.min(0.99, 0.7 + f(kq.v.ACC) * 0.28), name: rng.pick(FIRST.split('')) + '. ' + rng.pick(LAST), num: number('K'), pos: 'K', rt: kq.v, star: kq.star, up: kq.up, slot: 'k' };
    return { off, def, k };
  }

  // --- Growth between games ------------------------------------------------------
  // After each game a school's players grow from what they did in it (one
  // point per milestone, at most GROW_CAP per rating over a career). `ps` is
  // the game's player stats for this seat (keys "o8", "d7"...; see game.js).
  const GROW_CAP = 12;
  function growthFrom(ps, won, rng) {
    const out = [];
    const bump = (slot, rating, why) => out.push({ slot, rating, why });
    for (const [slot, r] of Object.entries(ps)) {
      if (slot === 'o0') {
        if ((r.y || 0) >= 150) bump(slot, 'ACC', `${r.y} PASS YDS`);
        if ((r.t || 0) >= 2) bump(slot, 'ARM', `${r.t} TD PASSES`);
        else if ((r.a || 0) >= 10 && !(r.i || 0)) bump(slot, 'ACC', 'NO PICKS');
      } else if (slot[0] === 'o') {
        const ry = r.rcy || 0, rt = (r.rct || 0) + (r.rt || 0);
        if (ry >= 50) bump(slot, 'HND', `${ry} REC YDS`);
        if (ry >= 100 || (r.rct || 0) >= 1) bump(slot, 'SPD', (r.rct || 0) ? `${r.rct} TD CATCH${r.rct > 1 ? 'ES' : ''}` : `${ry} REC YDS`);
        if ((r.ry || 0) >= 40) bump(slot, 'ELU', `${r.ry} RUSH YDS`);
        if ((r.ry || 0) >= 90 || (r.rt || 0) >= 1) bump(slot, 'STR', (r.rt || 0) ? `${r.rt} RUSH TD` : `${r.ry} RUSH YDS`);
        void rt;
      } else {
        if ((r.tk || 0) >= 3) bump(slot, 'TKL', `${r.tk} TACKLES`);
        if ((r.sk || 0) >= 1) bump(slot, 'RSH', `${r.sk} SACK${r.sk > 1 ? 'S' : ''}`);
        if ((r.pi || 0) >= 1) bump(slot, 'COV', `${r.pi} INT`);
      }
    }
    if (won) {
      // A win lifts somebody who didn't make the box score.
      const slot = rng.pick(['o2', 'o3', 'o4', 'o5', 'o6', 'd0', 'd1', 'd2', 'd3']);
      bump(slot, slot[0] === 'o' ? 'BLK' : 'RSH', 'WIN');
    }
    return out;
  }
  // Applies a game's growth to a stored program; returns what actually grew.
  function applyGrowth(dev, list) {
    const done = [];
    for (const b of list) {
      const d = dev[b.slot] || (dev[b.slot] = {});
      if ((d[b.rating] || 0) >= GROW_CAP) continue;
      d[b.rating] = (d[b.rating] || 0) + 1;
      done.push(b);
    }
    return done;
  }
  // Only well-formed growth from another phone: known slots, small numbers.
  function cleanDev(dev) {
    if (!dev || typeof dev !== 'object') return null;
    const out = {};
    for (const [slot, r] of Object.entries(dev)) {
      if (!/^(o([0-9]|10)|d([0-9]|10)|k)$/.test(slot) || !r || typeof r !== 'object') continue;
      for (const [k, v] of Object.entries(r)) {
        if (!/^[A-Z]{3}$/.test(k) || typeof v !== 'number' || !isFinite(v)) continue;
        (out[slot] || (out[slot] = {}))[k] = Math.max(0, Math.min(GROW_CAP, Math.round(v)));
      }
    }
    return out;
  }

  // The players worth knowing about: the stars, then the QB and top receiver.
  function keyPlayers(roster) {
    const all = roster.off.concat(roster.def, [roster.k]);
    const list = all.filter((p) => p.star);
    for (const p of [roster.off[0], roster.off[8]]) if (list.length < 3 && !list.includes(p)) list.push(p);
    return list.map((p) => ({ pos: p.pos, num: p.num, name: p.name, star: p.star, up: p.up || 0, show: (SHOWN[p.pos] || Object.keys(p.rt)).map((k) => [k, p.rt[k]]) }));
  }

  // --- Home stadiums -----------------------------------------------------------
  // What each school's home game looks like: the stadium's name and town, the
  // usual kickoff light, the scenery past the stands, and a few signatures
  // (Boise State's blue turf, Tennessee's checkerboard end zones, the hedges
  // at Georgia, Penn State's white-out). Drawn as pixel art, no logos.
  //   time: day | dusk | night
  //   scene: layers behind the stands, far to near
  //   facade: stand facing (concrete, brick, stone)
  //   tiers: decks of seating; home: share of the crowd in home colors
  const ENV_ROWS = {
    ALA: ['BRYANT-DENNY STADIUM', 'TUSCALOOSA', 'dusk', ['hills', 'trees'], { tiers: 2 }],
    UGA: ['SANFORD STADIUM', 'ATHENS', 'day', ['hills', 'trees'], { hedges: true }],
    OSU: ['OHIO STADIUM', 'COLUMBUS', 'day', ['skyline'], { tiers: 2, home: 0.8 }],
    MICH: ['MICHIGAN STADIUM', 'ANN ARBOR', 'day', ['fall'], { tiers: 1, home: 0.75 }],
    TEX: ['DKR-TEXAS MEMORIAL STADIUM', 'AUSTIN', 'dusk', ['skyline', 'tower'], { tiers: 2 }],
    LSU: ['TIGER STADIUM', 'BATON ROUGE', 'night', ['oaks'], { tiers: 2, home: 0.8 }],
    CLEM: ['MEMORIAL STADIUM', 'CLEMSON', 'day', ['lake', 'trees'], { home: 0.8 }],
    ORE: ['AUTZEN STADIUM', 'EUGENE', 'day', ['mountains', 'pines'], { rainy: true }],
    USC: ['LA MEMORIAL COLISEUM', 'LOS ANGELES', 'dusk', ['skyline', 'arches', 'palms'], { facade: 'stone' }],
    ND: ['NOTRE DAME STADIUM', 'SOUTH BEND', 'day', ['fall', 'dome'], { facade: 'brick' }],
    FSU: ['DOAK CAMPBELL STADIUM', 'TALLAHASSEE', 'night', ['oaks'], { facade: 'brick', tiers: 2 }],
    PSU: ['BEAVER STADIUM', 'STATE COLLEGE', 'night', ['mountains', 'fall'], { tiers: 2, whiteout: true }],
    OU: ['OWEN FIELD', 'NORMAN', 'day', ['plains'], { facade: 'brick', tiers: 2 }],
    TENN: ['NEYLAND STADIUM', 'KNOXVILLE', 'day', ['hills', 'river'], { checker: true, tiers: 2, home: 0.8 }],
    UF: ['THE SWAMP', 'GAINESVILLE', 'day', ['palms'], { facade: 'brick', tiers: 2 }],
    MIA: ['HARD ROCK STADIUM', 'MIAMI GARDENS', 'night', ['palms'], { canopy: true, tiers: 2 }],
    TAMU: ['KYLE FIELD', 'COLLEGE STATION', 'day', ['plains'], { tiers: 3, home: 0.8 }],
    AUB: ['JORDAN-HARE STADIUM', 'AUBURN', 'dusk', ['trees'], { tiers: 2 }],
    WIS: ['CAMP RANDALL STADIUM', 'MADISON', 'night', ['lake', 'capitol'], { facade: 'brick' }],
    UW: ['HUSKY STADIUM', 'SEATTLE', 'day', ['mountains', 'lake', 'boats'], { canopy: true, tiers: 2 }],
    NEB: ['MEMORIAL STADIUM', 'LINCOLN', 'day', ['plains'], { home: 0.9 }],
    IOWA: ['KINNICK STADIUM', 'IOWA CITY', 'day', ['fall', 'hospital'], { facade: 'brick' }],
    COLO: ['FOLSOM FIELD', 'BOULDER', 'day', ['flatirons', 'pines'], {}],
    BSU: ['ALBERTSONS STADIUM', 'BOISE', 'night', ['mountains'], { turf: 'blue' }],
    UTAH: ['RICE-ECCLES STADIUM', 'SALT LAKE CITY', 'night', ['mountains'], {}],
    MISS: ['VAUGHT-HEMINGWAY STADIUM', 'OXFORD', 'day', ['oaks'], {}],
    OKST: ['BOONE PICKENS STADIUM', 'STILLWATER', 'day', ['plains'], { facade: 'brick' }],
    VT: ['LANE STADIUM', 'BLACKSBURG', 'night', ['mountains', 'fall'], { facade: 'stone' }],
    ARMY: ['MICHIE STADIUM', 'WEST POINT', 'day', ['hills', 'river', 'fall'], { facade: 'stone' }],
    NAVY: ['NAVY-MARINE CORPS STADIUM', 'ANNAPOLIS', 'day', ['bay', 'boats'], {}],
  };
  const ENV = {};
  for (const [id, [name, town, time, scene, o]] of Object.entries(ENV_ROWS)) {
    ENV[id] = Object.assign({ id, name, town, time, scene, facade: 'concrete', tiers: 1, home: 0.65, turf: 'green' }, o);
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
  RB.ENV = ENV;
  RB.buildRoster = buildRoster;
  RB.keyPlayers = keyPlayers;
  // Growth travels between phones as a short string ("o8:SPD3HND4;d7:COV1")
  // to stay well inside the live room's 4 KiB presence limit.
  function encodeDev(dev) {
    const d = cleanDev(dev);
    if (!d) return '';
    return Object.entries(d).map(([slot, r]) => slot + ':' + Object.entries(r).filter(([, v]) => v > 0).map(([k, v]) => k + v).join('')).filter((x) => !/:$/.test(x)).join(';').slice(0, 1000);
  }
  function decodeDev(str) {
    if (typeof str !== 'string' || !str) return null;
    const out = {};
    for (const part of str.split(';')) {
      const m = /^(o(?:[0-9]|10)|d(?:[0-9]|10)|k):((?:[A-Z]{3}\d{1,2})+)$/.exec(part);
      if (!m) continue;
      for (const [, k, v] of m[2].matchAll(/([A-Z]{3})(\d{1,2})/g)) (out[m[1]] || (out[m[1]] = {}))[k] = Math.min(GROW_CAP, +v);
    }
    return Object.keys(out).length ? out : null;
  }
  RB.Growth = { from: growthFrom, apply: applyGrowth, clean: cleanDev, encode: encodeDev, decode: decodeDev, CAP: GROW_CAP };
  RB.SHOWN = SHOWN;
  RB.uniforms = uniforms;
})(typeof window !== 'undefined' ? window : globalThis);
