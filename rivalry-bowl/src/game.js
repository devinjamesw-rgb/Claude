/* Rivalry Bowl: game flow. Downs, clock, scoring, kicks, halftime, college OT.
 * `g` is plain JSON (it travels to the other phone in online games).
 * `rt` holds runtime-only objects: rosters, rng, the live play, the kick. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const { C, Sim } = RB;
  const W = C.FIELD_W;

  const ORD = ['', '1ST', '2ND', '3RD', '4TH'];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function blankStats() {
    return { pa: 0, pc: 0, py: 0, ptd: 0, int: 0, ra: 0, ry: 0, rtd: 0, sk: 0, fum: 0, fgm: 0, fga: 0, fd: 0, to: 0 };
  }

  function create(opts) {
    const seed = opts.seed != null ? opts.seed : (Math.random() * 2 ** 31) | 0;
    const rng = RB.makeRng(seed);
    const wxRoll = rng.next();
    const g = {
      v: 1, ver: 1,
      mode: opts.mode || 'local',
      settings: Object.assign({ qlen: 240, diff: 1, even: false, assist: true }, opts.settings),
      teams: [opts.home, opts.away],
      names: opts.names || ['PLAYER 1', 'PLAYER 2'],
      score: [0, 0],
      q: 1, clock: 0, clockRunning: false, drained: 0,
      poss: 0, ballOn: 25, ballY: C.MID_Y, down: 1, toGo: 10,
      to: [3, 3],
      phase: 'coin', phaseT: 0,
      openRecv: rng.chance(0.5) ? 0 : 1,
      ctl: 0,
      ot: null, twoPt: false, patFor: -1, kickChoiceFor: -1, kickingTeam: -1, pendingKick: -1,
      holder: -1, afterHandoff: 'presnap',
      stats: [blankStats(), blankStats()],
      wx: {
        type: wxRoll < 0.62 ? 'clear' : wxRoll < 0.84 ? 'rain' : 'snow',
        wind: Math.round(rng.range(0, 16)),
        windDir: rng.range(0, Math.PI * 2),
      },
      banner: null, bannerId: 0,
      defCall: 'zone', playNo: 0, lastPlay: '',
      kick: null,
      seed,
    };
    g.clock = g.settings.qlen;
    const G = { g, rt: null };
    initRuntime(G, rng);
    const winner = g.openRecv;
    banner(G, 'COIN TOSS', `${team(G, winner).name} WILL RECEIVE`, 2.6);
    g.ctl = winner;
    return G;
  }

  // Rebuilds runtime objects on a device that adopts a game mid-way.
  function initRuntime(G, rng) {
    const g = G.g;
    const home = RB.TEAM_BY_ID[g.teams[0]], away = RB.TEAM_BY_ID[g.teams[1]];
    G.rt = {
      rng: rng || RB.makeRng((g.seed ^ (g.ver * 2654435761)) >>> 0),
      rosters: [RB.buildRoster(home, g.settings.even), RB.buildRoster(away, g.settings.even)],
      uniforms: RB.uniforms(home, away),
      play: null, kick: null,
      bannerQ: [], bannerT: 0,
      sfx: [], events: [],
      pending: null,
      paused: false,
    };
    return G;
  }

  function team(G, seat) {
    return RB.TEAM_BY_ID[G.g.teams[seat]];
  }

  // --- Banners and sounds -------------------------------------------------------
  function banner(G, text, sub, dur, color) {
    G.rt.bannerQ.push({ text, sub: sub || '', dur: dur || 1.6, color: color || null });
  }
  function sfx(G, name) {
    G.rt.sfx.push(name);
  }
  function bump(G) {
    G.g.ver++;
  }

  // --- Formatting helpers used by HUD and banners --------------------------------
  function fmtClock(s) {
    s = Math.max(0, Math.ceil(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function spotText(ballOn) {
    const b = Math.round(ballOn);
    if (b === 50) return 'MIDFIELD';
    return b < 50 ? `OWN ${b}` : `OPP ${100 - b}`;
  }
  function downText(g) {
    if (g.twoPt) return '2-PT TRY';
    const goal = g.ballOn + g.toGo >= 100;
    const tg = goal ? 'GOAL' : g.toGo < 1 ? 'INCHES' : String(Math.round(g.toGo));
    return `${ORD[g.down]} & ${tg}`;
  }
  function periodText(g) {
    if (g.ot) return `OT${g.ot.n > 1 ? g.ot.n : ''}`;
    return `Q${g.q}`;
  }

  // --- Phase changes ----------------------------------------------------------------
  function setPhase(G, phase) {
    G.g.phase = phase;
    G.g.phaseT = 0;
    bump(G);
  }

  // After every stoppage, decide what comes next: quarter end or the next snap.
  function nextSnap(G) {
    const g = G.g;
    if (!g.ot && g.clock <= 0) return endQuarter(G);
    beginPossessionSnap(G);
  }

  function beginPossessionSnap(G) {
    handoffOr(G, G.g.poss, 'presnap');
  }

  // Pass & play: when a different player has to act, show the hand-off screen.
  function handoffOr(G, seat, next) {
    const g = G.g;
    g.ctl = seat;
    if (g.mode === 'local' && g.holder !== seat) {
      g.afterHandoff = next;
      setPhase(G, 'handoff');
      return;
    }
    g.holder = seat;
    if (next === 'pat') setPhase(G, 'pat');
    else enterPresnap(G);
  }

  function enterPresnap(G) {
    const g = G.g;
    makePresnapPlay(G);
    g.drained = 0;
    // Lining up takes a few seconds even in a hurry-up.
    if (g.clockRunning && !g.ot) {
      const d = Math.min(C.MIN_RUNOFF, g.clock);
      g.clock -= d;
      g.drained = d;
    }
    setPhase(G, 'presnap');
  }

  // The formation for the next snap (AI picks the coverage until a human does).
  function makePresnapPlay(G) {
    const g = G.g, rt = G.rt;
    const o = g.poss, d = 1 - o;
    const secsLeft = g.clock;
    g.defCall = Sim.aiDefCall(rt.rng, {
      down: g.down, toGo: g.toGo, ballOn: g.ballOn, lead: g.score[d] - g.score[o],
      secsLeft, q: g.ot ? 5 : g.q,
    });
    rt.play = Sim.createPlay({
      offRoster: rt.rosters[o], defRoster: rt.rosters[d],
      ballOn: g.ballOn, ballY: g.ballY, fdX: C.GOAL_L + Math.min(100, g.ballOn + g.toGo),
      defCall: g.defCall, diff: g.settings.diff, rng: rt.rng, wx: g.wx, assist: g.settings.assist !== false,
      humanDefIdx: g.mode === 'online' ? rt.humanDefIdx == null ? Sim.IDX.S1 : rt.humanDefIdx : -1,
    });
    rt.defCallFrom = 'ai';
  }

  // --- Actions from the players ----------------------------------------------------
  function canFG(g) {
    if (g.twoPt) return false;
    const dist = 100 - g.ballOn + 17;
    if (dist > 62) return false;
    if (g.down === 4 || g.ot) return true;
    return (g.q === 2 || g.q === 4) && g.clock <= 30;
  }
  function canPunt(g) {
    return !g.twoPt && !g.ot && g.down === 4;
  }
  function presnapOptions(g) {
    const o = [{ id: 'pass', label: 'PASS' }, { id: 'run', label: 'RUN' }];
    if (canPunt(g)) o.push({ id: 'punt', label: 'PUNT' });
    if (canFG(g)) o.push({ id: 'fg', label: `FG ${100 - g.ballOn + 17}` });
    return o;
  }
  function canTimeout(g, seat) {
    return !g.ot && g.phase === 'presnap' && g.to[seat] > 0 && g.clockRunning;
  }

  function act(G, a) {
    const g = G.g, rt = G.rt;
    switch (a.type) {
      case 'ready':
        if (g.phase !== 'handoff') break;
        g.holder = g.ctl;
        if (g.afterHandoff === 'pat') setPhase(G, 'pat');
        else enterPresnap(G);
        break;
      case 'call':
        if (g.phase !== 'presnap') break;
        if (a.kind === 'pass' || a.kind === 'run') snapBall(G, a.kind);
        else if (a.kind === 'punt' && canPunt(g)) punt(G);
        else if (a.kind === 'fg' && canFG(g)) startKick(G, 'fg', 100 - g.ballOn + 17);
        break;
      case 'shuffle':
        // A different formation and set of routes; the play clock keeps running.
        if (g.phase === 'presnap' && rt.play && rt.play.phase === 'pre') {
          const call = rt.defCallFrom === 'human' ? g.defCall : null;
          makePresnapPlay(G);
          if (call) { Sim.setDefense(rt.play, call); g.defCall = call; rt.defCallFrom = 'human'; }
          bump(G);
        }
        break;
      case 'defcall':
        if (g.phase === 'presnap' && rt.play && Sim.DEF_CALLS.includes(a.call)) {
          Sim.setDefense(rt.play, a.call);
          g.defCall = a.call;
          rt.defCallFrom = 'human';
          bump(G);
        }
        break;
      case 'defplayer':
        rt.humanDefIdx = a.idx;
        if (rt.play) rt.play.humanDefIdx = a.idx;
        break;
      case 'timeout':
        if (canTimeout(g, a.seat)) {
          g.to[a.seat]--;
          g.clockRunning = false;
          sfx(G, 'whistle');
          banner(G, 'TIMEOUT', `${team(G, a.seat).name} · ${g.to[a.seat]} LEFT`, 1.4);
          bump(G);
        }
        break;
      case 'pat':
        if (g.phase !== 'pat') break;
        if (a.choice === 'xp' && !mustGoForTwo(g)) startKick(G, 'xp', C.XP_DIST);
        else startTwoPoint(G);
        break;
      case 'kickoff':
        if (g.phase !== 'kickchoice') break;
        doKickoff(G, g.kickingTeam, a.choice === 'onside');
        break;
      case 'kick':
        if (g.phase === 'kick' && rt.kick && rt.kick.phase === 'aim') RB.Kick.launch(rt.kick, a.aim, a.power, rt.rng);
        break;
      case 'continue':
        if (g.phase === 'half') startSecondHalf(G);
        break;
    }
  }

  function snapBall(G, kind) {
    const g = G.g, rt = G.rt;
    g.clockRunning = true;
    g.playNo++;
    Sim.snap(rt.play, kind);
    sfx(G, 'hut');
    setPhase(G, 'play');
  }

  // --- Update loop (authority only) ---------------------------------------------
  function update(G, dt, input) {
    const g = G.g, rt = G.rt;
    if (rt.paused) return;
    g.phaseT += dt;
    tickBanner(G, dt);
    switch (g.phase) {
      case 'coin':
        if (g.phaseT > 2.6) kickoffStart(G, 1 - g.openRecv);
        break;
      case 'presnap':
        if (g.clockRunning && !g.ot && g.drained < C.PLAY_CLOCK_RUNOFF) {
          const d = Math.min(C.RUNOFF_RATE * dt, C.PLAY_CLOCK_RUNOFF - g.drained);
          g.drained += d;
          g.clock = Math.max(0, g.clock - d);
          if (g.clock <= 0) { rt.play = null; endQuarter(G); }
        }
        break;
      case 'play':
        updatePlay(G, dt, input);
        break;
      case 'kick':
        updateKick(G, dt);
        break;
      case 'after':
        if (rt.play && rt.play.phase === 'dead') Sim.step(rt.play, dt, null);
        if (g.phaseT > (rt.pending ? rt.pending.wait : 1.2) && !rt.bannerQ.length && !g.banner) {
          const f = rt.pending && rt.pending.next;
          rt.pending = null;
          if (f) f();
        }
        break;
      case 'quarter':
        if (g.phaseT > 2.2) {
          g.q++;
          g.clock = g.settings.qlen;
          g.clockRunning = false;
          const k = g.pendingKick;
          g.pendingKick = -1;
          if (k >= 0) kickoffStart(G, k);
          else beginPossessionSnap(G);
        }
        break;
      case 'half':
        if (g.phaseT > 45) startSecondHalf(G);
        break;
    }
  }

  // Waits for banners, then runs `next`. Keeps timing logic in one place.
  function after(G, wait, next) {
    G.rt.pending = { wait, next };
    setPhase(G, 'after');
  }

  function tickBanner(G, dt) {
    const rt = G.rt, g = G.g;
    if (g.banner) {
      rt.bannerT += dt;
      if (rt.bannerT >= g.banner.dur) { g.banner = null; bump(G); }
    }
    if (!g.banner && rt.bannerQ.length) {
      const b = rt.bannerQ.shift();
      g.bannerId++;
      g.banner = Object.assign({ id: g.bannerId }, b);
      rt.bannerT = 0;
      bump(G);
    }
  }

  function updatePlay(G, dt, input) {
    const g = G.g, rt = G.rt, play = rt.play;
    const nEv = play.events.length;
    Sim.step(play, dt, input);
    for (const e of play.events.slice(nEv)) onPlayEvent(G, e);
    if (!g.ot && play.phase === 'live') g.clock = Math.max(0, g.clock - dt);
    if (play.phase === 'dead' && play.deadT > 1.1) finishPlay(G, play.result);
  }

  function onPlayEvent(G, e) {
    const P = G.rt.play.players;
    switch (e.type) {
      case 'throw': sfx(G, 'throw'); break;
      case 'catch': sfx(G, 'catch'); break;
      case 'int': sfx(G, 'bad'); banner(G, 'INTERCEPTED!', P[e.who].name, 1.4, 'bad'); break;
      case 'broken': case 'juke': sfx(G, 'juke'); break;
      case 'jukeMove': sfx(G, 'swish'); break;
      case 'dive': sfx(G, 'swish'); break;
      case 'fumble':
        sfx(G, 'bad');
        if (e.text === 'RECOVERED') banner(G, 'FUMBLE', 'OFFENSE RECOVERS', 1.3);
        break;
      case 'dead': sfx(G, 'whistle'); break;
      case 'handoff': sfx(G, 'catch'); break;
    }
  }

  // --- Applying a play result -------------------------------------------------------
  function finishPlay(G, res) {
    const g = G.g, rt = G.rt, play = rt.play;
    const o = g.poss, d = 1 - o;
    const S = g.stats[o], st = res.stats;
    const P = play.players;
    const name = (i) => (i >= 0 ? `${P[i].name}` : '');
    S.pa += st.passAtt; S.pc += st.comp; S.py += st.passYds;
    S.ra += st.rushAtt; S.ry += st.rushYds + (st.sack ? st.sackYds || 0 : 0);
    if (st.int) { S.int++; S.to++; }
    if (st.sack) S.sk++;
    if (st.fum) { S.fum++; S.to++; }
    rt.lastResult = res;

    if (g.twoPt) return finishTwoPoint(G, res);

    const spot = clamp(res.x - C.GOAL_L, 0, 100);
    const hash = res.y < C.HASH_TOP ? C.HASH_TOP : res.y > C.HASH_BOT ? C.HASH_BOT : res.y;

    switch (res.kind) {
      case 'td': {
        g.score[o] += 6;
        if (st.comp) S.ptd++; else S.rtd++;
        g.clockRunning = false;
        sfx(G, 'td');
        const who = st.comp ? name(st.receiver) : name(res.carrier);
        banner(G, 'TOUCHDOWN!', `${team(G, o).name} · ${who}`, 2.4, 'good');
        g.lastPlay = `${who} ${res.yds} YD TD`;
        return after(G, 0.2, () => afterTouchdown(G, o));
      }
      case 'safety': {
        g.score[d] += 2;
        g.clockRunning = false;
        sfx(G, 'bad');
        banner(G, 'SAFETY!', `${team(G, d).name} +2`, 2, 'bad');
        return after(G, 0.2, () => endDrive(G, 'safety', () => freeKick(G, o)));
      }
      case 'int_td': {
        g.score[d] += 6;
        g.clockRunning = false;
        sfx(G, 'td');
        banner(G, 'PICK SIX!', team(G, d).name, 2.4, 'bad');
        return after(G, 0.2, () => endDrive(G, 'turnover', () => { g.poss = d; afterTouchdown(G, d); }));
      }
      case 'int_tb':
        g.clockRunning = false;
        return after(G, 0.2, () => endDrive(G, 'turnover', () => changePossession(G, d, 25, C.MID_Y)));
      case 'int':
      case 'fumble': {
        g.clockRunning = false;
        if (res.kind === 'fumble') banner(G, 'FUMBLE!', `${team(G, d).name} BALL`, 1.8, 'bad');
        const nb = clamp(100 - spot, 1, 99);
        return after(G, 0.2, () => endDrive(G, 'turnover', () => changePossession(G, d, nb, hash)));
      }
      case 'inc': {
        g.clockRunning = false;
        banner(G, res.text || 'INCOMPLETE', '', 1.1);
        g.lastPlay = 'INCOMPLETE';
        return after(G, 0.2, () => advanceDowns(G, g.ballOn, g.ballY));
      }
      default: {
        // tackle / oob / sack / dive
        g.clockRunning = res.kind !== 'oob';
        if (res.kind === 'sack') {
          banner(G, 'SACKED!', `LOSS OF ${Math.abs(res.yds)}`, 1.3, 'bad');
          sfx(G, 'bad');
        }
        const who = st.comp ? name(st.receiver) : name(res.carrier);
        g.lastPlay = res.kind === 'sack' ? `SACK ${res.yds}` : `${who} ${res.yds >= 0 ? '+' : ''}${res.yds}`;
        if (st.comp && res.kind !== 'sack') banner(G, `${res.yds >= 0 ? '+' : ''}${res.yds} YDS`, who, 1.1);
        return after(G, 0.2, () => advanceDowns(G, spot, hash));
      }
    }
  }

  function advanceDowns(G, spot, hash) {
    const g = G.g;
    const o = g.poss;
    g.ballY = hash;
    const line = g.ballOn + g.toGo;
    if (spot >= line - 1e-6) {
      g.stats[o].fd++;
      g.down = 1;
      g.ballOn = spot;
      g.toGo = Math.min(10, 100 - spot);
      banner(G, 'FIRST DOWN', '', 1.1, 'good');
      sfx(G, 'first');
      return nextSnap(G);
    }
    g.toGo = line - spot;
    g.ballOn = spot;
    g.down++;
    if (g.down > 4) {
      banner(G, 'TURNOVER ON DOWNS', '', 1.8, 'bad');
      g.clockRunning = false;
      return endDrive(G, 'downs', () => after(G, 0.1, () => changePossession(G, 1 - o, clamp(100 - spot, 1, 99), hash)));
    }
    nextSnap(G);
  }

  function changePossession(G, seat, ballOn, hash) {
    const g = G.g;
    g.poss = seat;
    g.ballOn = ballOn;
    g.ballY = hash == null ? C.MID_Y : hash;
    g.down = 1;
    g.toGo = Math.min(10, 100 - ballOn);
    g.clockRunning = false;
    nextSnap(G);
  }

  // --- Touchdowns, PATs, two-point tries ----------------------------------------------
  function mustGoForTwo(g) {
    return !!(g.ot && g.ot.n >= 2);
  }

  function afterTouchdown(G, seat) {
    const g = G.g;
    g.poss = seat;
    // Second team in an OT period that takes the lead wins right there.
    if (g.ot && g.ot.count === 1 && g.score[seat] > g.score[1 - seat]) return finalWhistle(G);
    // Untimed down: the PAT happens even at 0:00.
    g.patFor = seat;
    handoffOr(G, seat, 'pat');
  }

  function startTwoPoint(G) {
    const g = G.g;
    g.twoPt = true;
    g.ballOn = 97;
    g.ballY = C.MID_Y;
    g.down = 1;
    g.toGo = 3;
    enterPresnap(G);
  }

  function finishTwoPoint(G, res) {
    const g = G.g;
    const o = g.poss, d = 1 - o;
    g.twoPt = false;
    if (res.kind === 'td') {
      g.score[o] += 2;
      sfx(G, 'td');
      banner(G, '2-POINT GOOD', team(G, o).name, 1.8, 'good');
    } else if (res.kind === 'int_td') {
      g.score[d] += 2;
      banner(G, 'DEFENSIVE 2-PT', team(G, d).name, 1.8, 'bad');
    } else {
      banner(G, '2-POINT FAILS', team(G, o).name, 1.6, 'bad');
    }
    after(G, 0.3, () => afterScoreAttempt(G, o));
  }

  // After a PAT kick or a two-point try.
  function afterScoreAttempt(G, scorer) {
    const g = G.g;
    g.patFor = -1;
    if (g.ot) return endDrive(G, 'score', null);
    kickoffStart(G, scorer);
  }

  // --- Kicking ------------------------------------------------------------------------
  function startKick(G, type, dist) {
    const g = G.g, rt = G.rt;
    const k = rt.rosters[g.poss].k;
    rt.kick = RB.Kick.create({ type, dist, kicker: k, wx: g.wx, rng: rt.rng });
    g.kick = { type, dist };
    if (type === 'fg') g.stats[g.poss].fga++;
    setPhase(G, 'kick');
  }

  function updateKick(G, dt) {
    const g = G.g, rt = G.rt, k = rt.kick;
    RB.Kick.update(k, dt);
    if (k.phase === 'fly' && !k.sfxDone) { k.sfxDone = true; sfx(G, 'kick'); }
    if (k.phase !== 'done' || k.doneT < 1.2) return;
    const o = g.poss, good = k.result === 'good';
    const type = k.type;
    rt.kick = null;
    g.kick = null;
    if (type === 'xp') {
      if (good) g.score[o] += 1;
      banner(G, good ? 'EXTRA POINT GOOD' : 'NO GOOD', '', 1.5, good ? 'good' : 'bad');
      sfx(G, good ? 'first' : 'bad');
      return after(G, 0.2, () => afterScoreAttempt(G, o));
    }
    // Field goal
    g.clockRunning = false;
    if (good) {
      g.score[o] += 3;
      g.stats[o].fgm++;
      sfx(G, 'td');
      banner(G, 'FIELD GOAL IS GOOD', `${k.dist} YARDS`, 2, 'good');
      if (g.ot) return after(G, 0.2, () => endDrive(G, 'score', null));
      return after(G, 0.2, () => endDrive(G, 'score', () => kickoffStart(G, o)));
    }
    sfx(G, 'bad');
    banner(G, 'NO GOOD', `${k.dist} YARDS · ${k.resultText}`, 2, 'bad');
    // Miss: ball to the defense at the spot of the kick (the 20 at worst).
    const spotOfKick = g.ballOn - 7;
    const nb = Math.max(20, 100 - spotOfKick);
    return after(G, 0.2, () => endDrive(G, 'fg_miss', () => changePossession(G, 1 - o, nb, C.MID_Y)));
  }

  function punt(G) {
    const g = G.g, rt = G.rt, rng = rt.rng;
    const o = g.poss, d = 1 - o;
    const k = rt.rosters[o].k;
    g.clockRunning = false;
    let dist = Math.round(k.power - 12 + rng.gauss() * 5);
    if (rng.chance(0.05)) dist = rng.int(22, 30);
    if (g.wx.type === 'rain') dist -= 2;
    const land = g.ballOn + dist;
    let text, nb;
    if (land >= 100) {
      text = 'TOUCHBACK';
      nb = C.PUNT_TOUCHBACK;
    } else {
      const fair = rng.chance(0.45);
      const ret = fair ? 0 : Math.max(0, Math.round(rng.range(-2, 11) + (rng.chance(0.03) ? 30 : 0)));
      nb = clamp(100 - land + ret, 1, 99);
      text = fair ? `FAIR CATCH AT ${spotText(100 - land)}` : `RETURNED TO ${spotText(nb)}`;
    }
    g.clock = Math.max(0, g.clock - (g.ot ? 0 : 6));
    sfx(G, 'kick');
    banner(G, `PUNT · ${dist} YDS`, text, 2.2);
    after(G, 0.2, () => endDrive(G, 'punt', () => changePossession(G, d, nb, C.MID_Y)));
  }

  function kickoffStart(G, kicking) {
    const g = G.g;
    // A score at 0:00: the kickoff opens the next quarter instead.
    if (!g.ot && g.clock <= 0) {
      g.pendingKick = kicking;
      return endQuarter(G);
    }
    g.kickingTeam = kicking;
    // Offer an onside kick only when it could matter: trailing late.
    const trailing = g.score[kicking] < g.score[1 - kicking];
    if (!g.ot && g.q >= 4 && trailing) {
      g.kickChoiceFor = kicking;
      g.ctl = kicking;
      setPhase(G, 'kickchoice');
      return;
    }
    doKickoff(G, kicking, false);
  }

  function doKickoff(G, kicking, onside) {
    const g = G.g, rng = G.rt.rng;
    const recv = 1 - kicking;
    g.kickChoiceFor = -1;
    sfx(G, 'kick');
    if (onside) {
      if (rng.chance(0.18)) {
        banner(G, 'ONSIDE KICK', `${team(G, kicking).name} RECOVERS!`, 2.2, 'good');
        return after(G, 0.2, () => changePossession(G, kicking, rng.int(45, 49), C.MID_Y));
      }
      banner(G, 'ONSIDE KICK', `${team(G, recv).name} RECOVERS`, 2.2);
      return after(G, 0.2, () => changePossession(G, recv, 53, C.MID_Y));
    }
    let nb, text;
    const r = rng.next();
    if (r < 0.6) { nb = C.KICKOFF_TOUCHBACK; text = 'TOUCHBACK'; }
    else if (r < 0.985) { nb = clamp(Math.round(22 + rng.gauss() * 6), 12, 45); text = `RETURNED TO ${spotText(nb)}`; }
    else if (r < 0.995) { nb = rng.int(50, 70); text = `BIG RETURN TO ${spotText(nb)}`; }
    else {
      g.score[recv] += 6;
      banner(G, 'KICKOFF', 'RETURNED FOR A TOUCHDOWN!', 2.6, 'good');
      sfx(G, 'td');
      return after(G, 0.2, () => afterTouchdown(G, recv));
    }
    if (!g.ot && g.clock > 0 && text !== 'TOUCHBACK') g.clock = Math.max(1, g.clock - rng.int(4, 7));
    banner(G, 'KICKOFF', `${team(G, recv).name} · ${text}`, 1.8);
    after(G, 0.2, () => changePossession(G, recv, nb, C.MID_Y));
  }

  function freeKick(G, kicking) {
    const g = G.g, rng = G.rt.rng;
    const recv = 1 - kicking;
    const nb = clamp(Math.round(32 + rng.gauss() * 6), 20, 50);
    sfx(G, 'kick');
    banner(G, 'FREE KICK', `${team(G, recv).name} · ${spotText(nb)}`, 1.8);
    after(G, 0.2, () => changePossession(G, recv, nb, C.MID_Y));
  }

  // --- Quarters, halftime, overtime -------------------------------------------------------
  function endQuarter(G) {
    const g = G.g;
    g.clockRunning = false;
    sfx(G, 'whistle');
    if (g.q !== 1 && g.q !== 3) g.pendingKick = -1;
    if (g.q === 1 || g.q === 3) {
      banner(G, `END OF ${ORD[g.q]}`, `${team(G, 0).name} ${g.score[0]} · ${team(G, 1).name} ${g.score[1]}`, 2.2);
      setPhase(G, 'quarter');
      return;
    }
    if (g.q === 2) {
      g.ctl = 0;
      setPhase(G, 'half');
      return;
    }
    if (g.score[0] !== g.score[1]) return finalWhistle(G);
    startOT(G, 1, g.openRecv);
  }

  function startSecondHalf(G) {
    const g = G.g;
    g.q = 3;
    g.clock = g.settings.qlen;
    g.to = [3, 3];
    kickoffStart(G, g.openRecv);
  }

  function startOT(G, n, first) {
    const g = G.g;
    g.ot = { n, first, count: 0 };
    g.clockRunning = false;
    const two = n >= 3;
    banner(G, n === 1 ? 'OVERTIME' : `OVERTIME ${n}`, two ? '2-POINT SHOOTOUT' : `${team(G, first).name} BALL FIRST`, 2.4);
    after(G, 0.2, () => startOTPossession(G, first));
  }

  function startOTPossession(G, seat) {
    const g = G.g;
    if (g.ot.n >= 3) {
      g.poss = seat;
      g.twoPt = true;
      g.patFor = seat;
      g.ballOn = 97; g.ballY = C.MID_Y; g.down = 1; g.toGo = 3;
      return beginPossessionSnap(G);
    }
    changePossession(G, seat, 75, C.MID_Y);
  }

  // A possession is over. In OT this drives the period; otherwise `then` runs.
  function endDrive(G, why, then) {
    const g = G.g;
    if (!g.ot) { if (then) then(); return; }
    // OT turnovers and misses end the possession; nothing else happens.
    const ot = g.ot;
    ot.count++;
    const lead = g.score[0] - g.score[1];
    if (ot.count >= 2) {
      if (lead !== 0) return finalWhistle(G);
      return startOT(G, ot.n + 1, 1 - ot.first);
    }
    const next = 1 - ot.first;
    banner(G, `${team(G, next).name} BALL`, g.ot.n >= 3 ? '2-POINT TRY' : 'FROM THE 25', 1.6);
    after(G, 0.2, () => startOTPossession(G, next));
  }

  function finalWhistle(G) {
    const g = G.g;
    g.clockRunning = false;
    g.twoPt = false;
    sfx(G, 'final');
    const w = g.score[0] > g.score[1] ? 0 : 1;
    banner(G, 'FINAL', `${team(G, w).name} WINS`, 3, 'good');
    setPhase(G, 'final');
  }

  // A device picking a game back up (hot reload): replay the current down.
  function resume(G) {
    const g = G.g;
    g.banner = null;
    if (['play', 'after', 'kick', 'coin', 'quarter', 'presnap'].includes(g.phase)) {
      g.holder = g.poss;
      if (g.phase === 'coin') return kickoffStart(G, 1 - g.openRecv);
      if (g.phase === 'quarter') { g.phaseT = 0; return; }
      enterPresnap(G);
    }
  }

  // Online: this phone just became the authority with state from the other one.
  function takeover(G) {
    const g = G.g;
    if (g.phase === 'presnap' && !G.rt.play) { makePresnapPlay(G); bump(G); }
    if (['play', 'after', 'kick'].includes(g.phase)) resume(G);
  }

  // --- Public ---------------------------------------------------------------------------
  RB.Game = {
    create, initRuntime, update, act, team, resume, takeover,
    fmtClock, spotText, downText, periodText,
    presnapOptions, canTimeout, mustGoForTwo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
