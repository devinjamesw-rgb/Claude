/* Rivalry Bowl: app controller. Screens, the frame loop, and glue between
 * the game, renderer, input, UI, audio and the network. */
(function () {
  'use strict';
  const RB = window.RB;
  const { C, Sim, Game, Render, Input, UI } = RB;
  const DT = C.DT;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('rivalry.' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try { localStorage.setItem('rivalry.' + k, JSON.stringify(v)); } catch (e) { /* storage is optional */ }
    },
  };

  const App = {
    screen: 'title', back: 'title',
    settings: Object.assign({ qlen: 240, diff: 1, even: false, sound: true, assist: true, growth: true, hand: 0, buzz: true }, store.get('settings', {})),
    picks: [null, null],
    names: store.get('names', ['PLAYER 1', 'PLAYER 2']),
    step: 0,
    G: null, mode: 'local', paused: false,
    demo: null, demoBot: { rng: RB.makeRng(4), patience: 1.2 },
    once: { throwAt: null, juke: false, dive: null },
    acc: 0, last: 0, cheer: 0,
    net: null,
    lastInput: null,
  };
  RB.App = App;

  // --- Boot --------------------------------------------------------------------------
  function start(hot) {
    const canvas = document.getElementById('game');
    Render.init(canvas);
    UI.init();
    RB.Audio.setOn(App.settings.sound);
    if (RB.Audio.setBuzz) RB.Audio.setBuzz(App.settings.buzz);
    applyHand();
    const app = document.getElementById('app');
    const doResize = () => Render.resize(app.clientWidth, app.clientHeight);
    doResize();
    if (window.ResizeObserver) new ResizeObserver(doResize).observe(app);
    window.addEventListener('orientationchange', () => setTimeout(doResize, 200));
    Input.attach(canvas, inputContext);
    document.addEventListener('click', onClick);
    document.getElementById('pad').addEventListener('pointerdown', onPad);
    document.addEventListener('input', onInput);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && App.screen === 'game' && App.mode === 'local') App.paused = true;
    });
    RB.Net.prewarm();
    if (hot && hot.g && hot.mode === 'local') resumeLocal(hot);
    else newDemo();
    try {
      window.claude?.hot?.snapshot?.(() => ({
        mode: App.screen === 'game' ? App.mode : null,
        g: App.screen === 'game' && App.mode === 'local' && App.G ? App.G.g : null,
        names: App.names,
      }));
    } catch (e) { /* hot reload is optional */ }
    requestAnimationFrame(loop);
  }

  function resumeLocal(hot) {
    const G = { g: hot.g, rt: null };
    Game.initRuntime(G);
    Game.resume(G);
    App.G = G;
    App.mode = 'local';
    App.screen = 'game';
    App.paused = true;
  }

  // --- Attract mode (bots play behind the menus) ------------------------------------------
  function newDemo() {
    const r = App.demoBot.rng;
    const a = r.int(0, RB.TEAMS.length - 1);
    let b = r.int(0, RB.TEAMS.length - 1);
    if (b === a) b = (a + 5) % RB.TEAMS.length;
    App.demo = Game.create({ mode: 'demo', home: RB.TEAMS[a].id, away: RB.TEAMS[b].id, settings: { qlen: 900, diff: 1 } });
  }

  function botThrow(play) {
    const P = play.players;
    let best = null, bs = -1;
    for (const i of Sim.ELIGIBLE) {
      const r = P[i];
      if (r.role !== 'route') continue;
      const q = P[0];
      let T = 0.8, g = Sim.predictRoute(play, r, T);
      for (let k = 0; k < 2; k++) { T = Sim.flightTime(q, Math.hypot(g.x - q.x, g.y - q.y)); g = Sim.predictRoute(play, r, T); }
      let sep = 99;
      for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x - g.x, P[j].y - g.y));
      if (sep > 2.6 && sep > bs && g.y > 1.5 && g.y < C.FIELD_W - 1.5) { bs = sep; best = { x: g.x, y: g.y }; }
    }
    return best;
  }

  function demoInput(G) {
    const g = G.g, bot = App.demoBot, r = bot.rng;
    const input = {};
    switch (g.phase) {
      case 'presnap':
        if (g.phaseT > 1.3) {
          let kind = r.chance(0.3) ? 'run' : 'pass';
          if (g.down === 4 && !g.twoPt) kind = Game.presnapOptions(g).some((o) => o.id === 'fg') && 100 - g.ballOn + 17 < 48 ? 'fg' : 'punt';
          bot.patience = r.range(1, 2.2);
          Game.act(G, { type: 'call', kind });
        }
        break;
      case 'play': {
        const play = G.rt.play;
        if (play && Sim.canThrow(play) && play.t > bot.patience) {
          const t = botThrow(play) || (play.t > 3.3 ? { x: play.los + 12, y: 2 } : null);
          if (t) input.throwAt = t;
        }
        break;
      }
      case 'pat': Game.act(G, { type: 'pat', choice: Game.mustGoForTwo(g) ? '2pt' : 'xp' }); break;
      case 'kick':
        if (G.rt.kick && G.rt.kick.phase === 'aim' && g.phaseT > 0.8) Game.act(G, { type: 'kick', aim: r.range(-0.1, 0.1), power: Math.min(1.05, G.rt.kick.need + 0.08) });
        break;
      case 'kickchoice': Game.act(G, { type: 'kickoff', choice: 'deep' }); break;
      case 'half': Game.act(G, { type: 'continue' }); break;
      case 'final': if (g.phaseT > 3) newDemo(); break;
    }
    return input;
  }

  // --- Game setup ----------------------------------------------------------------------
  function startLocal() {
    App.G = Game.create({
      mode: 'local', home: App.picks[0], away: App.picks[1], names: App.names.slice(),
      settings: { qlen: App.settings.qlen, diff: App.settings.diff, even: App.settings.even, assist: App.settings.assist },
      devs: [devFor(App.picks[0]), devFor(App.picks[1])],
    });
    App.mode = 'local';
    App.screen = 'game';
    App.paused = false;
    App.acc = 0;
    Render.R.camInit = false;
    UI.invalidate();
  }

  function quitToMenu() {
    if (App.net) App.net.leave();
    App.G = null;
    App.screen = 'title';
    App.paused = false;
    Input.reset();
    UI.invalidate();
    if (!App.demo) newDemo();
  }

  // --- Programs and the series (kept on this phone) ----------------------------------------
  // Each school's growth from earlier games, as RB.buildRoster takes it.
  function programs() { return store.get('programs', {}); }
  function devFor(teamId) {
    if (!App.settings.growth || App.settings.even) return null;
    const p = programs()[teamId];
    return p && p.dev ? p.dev : null;
  }
  function programOf(teamId) {
    return programs()[teamId] || { dev: {}, gp: 0, w: 0, l: 0 };
  }
  // At the final whistle: grow the schools this phone plays for and add the
  // result to the head-to-head series. Runs once per game.
  function recordFinal(G) {
    const g = G.g, rt = G.rt;
    if (rt.recorded) return;
    rt.recorded = true;
    const seats = App.net ? [App.net.seat] : [0, 1];
    const all = programs();
    rt.growth = [];
    const rng = RB.makeRng((g.seed ^ 0x5eed) >>> 0);
    for (const seat of seats) {
      const id = g.teams[seat], won = g.score[seat] > g.score[1 - seat];
      const prog = all[id] || { dev: {}, gp: 0, w: 0, l: 0 };
      prog.gp++;
      if (won) prog.w++; else prog.l++;
      if (App.settings.growth && !g.settings.even) {
        const mine = {};
        for (const [k, v] of Object.entries(g.ps || {})) if (+k[0] === seat) mine[k.slice(1)] = v;
        const grew = RB.Growth.apply(prog.dev, RB.Growth.from(mine, won, rng));
        const R = rt.rosters[seat];
        rt.growth.push({ seat, lines: grew.map((b) => {
          const p = b.slot === 'k' ? R.k : R[b.slot[0] === 'o' ? 'off' : 'def'][+b.slot.slice(1)];
          return `${p.pos} #${p.num} ${p.name} ${b.rating} +1 (${b.why})`;
        }) });
      }
      all[id] = prog;
    }
    store.set('programs', all);
    // Head-to-head series between these two names.
    const names = g.names.slice();
    const key = names.slice().sort().join('|');
    const series = store.get('series', {});
    const sr = series[key] || { names: names.slice().sort(), w: {}, games: [] };
    const winner = names[g.score[0] > g.score[1] ? 0 : 1];
    sr.w[winner] = (sr.w[winner] || 0) + 1;
    sr.games.unshift({ n: names, t: g.teams.slice(), s: g.score.slice(), d: Date.now() });
    sr.games = sr.games.slice(0, 10);
    series[key] = sr;
    store.set('series', series);
    store.set('lastSeries', key);
    rt.series = sr;
  }
  function lastSeries() {
    const key = store.get('lastSeries', null);
    return key ? store.get('series', {})[key] || null : null;
  }
  function applyHand() {
    const right = App.settings.hand === 1;
    if (Input.setHand) Input.setHand(right ? 'R' : 'L');
    const pad = document.getElementById('pad');
    if (pad) pad.classList.toggle('left', right);
  }

  // --- Input context ---------------------------------------------------------------------
  function inputContext() {
    if (App.screen !== 'game' || App.paused || !App.G) return 'none';
    const G = App.G, g = G.g;
    if (App.net && !App.net.canControl()) return App.net.inputContext();
    if (g.phase === 'kick') return G.rt.kick && G.rt.kick.phase === 'aim' ? 'kick' : 'none';
    if (g.phase !== 'play') return 'none';
    const play = G.rt.play;
    if (!play || play.phase !== 'live') return 'none';
    if (Sim.canThrow(play)) return 'qb';
    const c = play.carrier;
    if (c >= 0 && play.players[c].side === 0 && !play.turnover && !(c === Sim.IDX.RBK && !play.handedOff)) return 'run';
    return 'none';
  }

  function takeOnce() {
    const o = App.once;
    App.once = { throwAt: null, juke: false, dive: null };
    return o;
  }

  // --- Frame loop -------------------------------------------------------------------------
  function loop(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - (App.last || ts)) / 1000));
    App.last = ts;
    App.cheer = Math.max(0, App.cheer - dt);
    let V = null;
    if (App.net) App.net.tick(dt);
    const inGame = App.screen === 'game' && App.G;
    const G = inGame ? App.G : App.demo;
    if (G) {
      const isDemo = !inGame;
      let inp = null;
      if (!isDemo) {
        const play = G.rt.play;
        inp = Input.poll(play ? play.players[0] : null);
        if (inp.throwAt) App.once.throwAt = inp.throwAt;
        App.lastInput = inp;
      }
      const authority = isDemo || !App.net || App.net.isAuthority();
      if (authority && !(App.paused && App.mode === 'local')) {
        if (inp && inp.kickLaunch && G.g.phase === 'kick') Game.act(G, { type: 'kick', aim: inp.kickLaunch.aim, power: inp.kickLaunch.power });
        App.acc += dt;
        let steps = 0;
        while (App.acc >= DT && steps < 4 && (isDemo || !App.net || App.net.isAuthority())) {
          let input;
          if (isDemo) input = demoInput(G);
          else {
            input = Object.assign({ aiming: inp.aiming, joy: inp.joy }, takeOnce());
            if (App.net) Object.assign(input, App.net.remoteInput());
          }
          savePrev(G);
          Game.update(G, DT, input);
          App.acc -= DT;
          steps++;
        }
        if (steps === 4) App.acc = 0;
      }
      App.alpha = Math.max(0, Math.min(1, App.acc / DT));
      flushSfx(G, isDemo);
      V = !isDemo && App.net && !App.net.isAuthority() ? App.net.view(inp) : buildView(G, inp);
    }
    Render.frame(V || { mode: 'none' }, dt);
    syncUI();
    requestAnimationFrame(loop);
  }

  function flushSfx(G, isDemo) {
    const list = G.rt.sfx;
    if (!list.length) return;
    G.rt.sfx = [];
    if (isDemo) return;
    for (const s of list) {
      if (s === 'td') App.cheer = 2.5;
      RB.Audio.play(s);
      if (App.net) App.net.onSfx(s);
    }
  }

  // --- View model ---------------------------------------------------------------------------
  // The sim runs at a fixed 60 Hz. Drawing blends the last two sim states so
  // motion stays smooth whatever the screen's refresh rate.
  function savePrev(G) {
    const play = G.rt.play;
    if (play) {
      for (const p of play.players) { p.px = p.x; p.py = p.y; }
      const b = play.ball;
      b.px = b.x; b.py = b.y; b.pz = b.z;
    }
    const k = G.rt.kick;
    if (k) { k.ball.px = k.ball.x; k.ball.pd = k.ball.d; k.ball.ph = k.ball.h; }
  }
  const mix = (prev, cur, a) => (prev == null ? cur : prev + (cur - prev) * a);

  function viewPlayer(p, a) {
    return {
      i: p.i, x: mix(p.px, p.x, a), y: mix(p.py, p.y, a), vx: p.vx, vy: p.vy, side: p.side, face: p.face,
      down: p.down > 0.35, lunge: (p.lunge || 0) > 0 || (p.dive || 0) > 0, eng: p.eng >= 0, skin: p.skin, hot: p.hot || 0,
    };
  }

  function aimView(play, at) {
    const lock = Sim.assistAim(play, at.x, at.y);
    if (lock) at = lock;
    const a = Sim.clampAim(play, at.x, at.y);
    const q = play.players[0];
    const T = Sim.flightTime(q, a.d);
    const vz0 = (1.5 - 2 + 0.5 * C.GRAVITY * T * T) / T;
    const pts = [];
    for (let i = 1; i <= 30; i++) {
      const u = i / 30, bt = T * u;
      pts.push({ x: q.x + (a.x - q.x) * u, y: q.y + (a.y - q.y) * u, z: 2 + vz0 * bt - 0.5 * C.GRAVITY * bt * bt });
    }
    return { x: a.x, y: a.y, pts, max: a.max, lock: lock ? lock.i : null };
  }

  // Play art for the offense: routes in each receiver's color before the snap,
  // faint during the play until the ball is thrown.
  const ROUTE_COLORS = { 8: '#ffd23f', 9: '#5ae6ff', 10: '#ff7ad9', 7: '#7dff7a', 1: '#ffa24a' };
  function routesView(play) {
    const pre = play.phase === 'pre';
    if (!play.plan || (!pre && (play.phase !== 'live' || play.thrown || play.kind !== 'pass' || play.carrier !== 0))) return null;
    const alpha = pre ? 0.95 : 0.35;
    const out = [];
    for (const i of Sim.ELIGIBLE) {
      const r = play.plan.routes[i], p = play.players[i];
      if (r.name === 'block') { out.push({ block: true, from: { x: p.x0 != null && !pre ? p.x0 : p.x, y: p.y0 != null && !pre ? p.y0 : p.y }, color: ROUTE_COLORS[i], alpha }); continue; }
      const start = pre ? { x: p.x, y: p.y } : { x: p.x0, y: p.y0 };
      const pts = [start].concat(r.pts.map((q) => ({ x: q.x, y: q.y })));
      if (r.cont && pts.length > 2) {
        // Trim the "keep running" leg to a readable stub.
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, keep = Math.min(d, 9);
        pts[pts.length - 1] = { x: a.x + ((b.x - a.x) / d) * keep, y: a.y + ((b.y - a.y) / d) * keep };
      }
      out.push({ pts, color: ROUTE_COLORS[i], alpha });
    }
    if (pre && play.plan.run) {
      const rb = play.players[Sim.IDX.RBK];
      out.push({ pts: [{ x: rb.x, y: rb.y }].concat(play.plan.run.path.slice(-2).map((q, k) => (k ? { x: q.x - 6, y: q.y } : q))), color: '#ffffff', alpha: 0.5, dashed: true });
    }
    return out;
  }

  // Before the snap: who runs each colored route, and how good he is.
  const LEGEND_ORDER = [0, 8, 9, 10, 7, 1];
  function legendView(roster, heat, seat) {
    return LEGEND_ORDER.map((i) => {
      const p = roster.off[i], h = heat && heat[`${seat}o${i}`];
      const keys = RB.SHOWN[p.pos].slice(0, 2);
      const who = i === 0 ? 'QB' : `#${p.num}`;
      return { color: ROUTE_COLORS[i] || '#ffffff', text: `${who} ${keys.map((k) => `${k} ${p.rt[k]}`).join(' ')}${p.star ? ' *' : ''}${h > 0 ? ' ~'.repeat(h) : h < 0 ? ' -' : ''}` };
    });
  }

  function buildView(G, inp) {
    const g = G.g, rt = G.rt, play = rt.play;
    const V = {
      g, mode: 'field', teams: [Game.team(G, 0), Game.team(G, 1)], uni: rt.uniforms,
      offSeat: g.poss, defSeat: 1 - g.poss, wx: g.wx, phase: g.phase, cheer: App.cheer,
      carrier: -1, ctrl: -1, defCtrl: -1,
    };
    if (g.phase === 'kick' && rt.kick) {
      const k = rt.kick, a = App.alpha || 0;
      V.mode = 'kick';
      V.kick = Object.assign({}, k, { ball: { x: mix(k.ball.px, k.ball.x, a), d: mix(k.ball.pd, k.ball.d, a), h: mix(k.ball.ph, k.ball.h, a) } });
      V.kickUni = rt.uniforms[g.poss];
      V.kickAim = inp && inp.kick ? inp.kick : null;
      V.kickHint = 'DRAG DOWN FOR POWER · SIDEWAYS TO AIM';
      return V;
    }
    V.los = C.GOAL_L + g.ballOn;
    V.ballY = g.ballY;
    V.fdX = g.twoPt ? null : C.GOAL_L + Math.min(100, g.ballOn + g.toGo);
    if (play && ['presnap', 'play', 'after'].includes(g.phase)) {
      V.los = play.los;
      V.ballY = play.ballY;
      V.fdX = g.twoPt ? null : play.fdX;
      const a = App.alpha || 0;
      V.players = play.players.map((p) => viewPlayer(p, a));
      const b = play.ball;
      V.ball = { x: mix(b.px, b.x, a), y: mix(b.py, b.y, a), z: mix(b.pz, b.z, a), st: b.st, visible: true };
      V.carrier = play.carrier;
      V.live = play.phase === 'live';
      V.turnover = play.turnover;
      V.ctrl = play.turnover ? -1 : play.carrier >= 0 && play.players[play.carrier].side === 0 ? play.carrier : 0;
      V.landing = play.landing;
      V.defCtrl = App.net ? play.humanDefIdx : -1;
      if (inp && inp.aiming && inp.aimAt && Sim.canThrow(play)) {
        V.aim = Object.assign(aimView(play, inp.aimAt), { armed: inp.aimArmed });
        V.lock = V.aim.lock;
      }
      if (inp) V.joy = inp.joyScreen;
      V.routes = routesView(play);
      if (App.net) V.netInfo = App.net.netInfo();
      if (V.routes && play.phase === 'pre') {
        V.routeColors = ROUTE_COLORS;
        V.legend = legendView(rt.rosters[g.poss], g.heat, g.poss);
      }
    }
    return V;
  }

  // --- UI sync ----------------------------------------------------------------------------
  function team(G, s) {
    return Game.team(G, s);
  }

  function controlsFor(G, mine) {
    const g = G.g;
    const esc = UI.esc;
    if (!mine) return null;
    if (g.phase === 'presnap') {
      const opts = Game.presnapOptions(g);
      const cls = { pass: '', run: 'alt', punt: 'ghost', fg: 'ghost', spike: 'ghost', kneel: 'ghost' };
      const who = `${team(G, g.poss).name} BALL · ${g.names[g.poss]}`;
      const main = opts.map((o) => `<button class="btn ${cls[o.id]}" type="button" data-action="call" data-kind="${o.id}">${esc(o.label)}</button>`).join('');
      const seats = App.net ? [App.net.seat] : [0, 1];
      const tos = '<button class="btn small ghost" type="button" data-action="shuffle">New play</button>' + seats.filter((s) => Game.canTimeout(g, s))
        .map((s) => `<button class="btn small ghost" type="button" data-action="timeout" data-seat="${s}">Timeout ${esc(team(G, s).id)} (${g.to[s]})</button>`).join('');
      return { key: `pre|${g.playNo}|${opts.map((o) => o.id)}|${g.to}|${g.clockRunning}`, html: `<div class="who">${esc(who)}</div><div class="row">${main}</div><div class="row">${tos}</div>` };
    }
    if (g.phase === 'pat') {
      const two = Game.mustGoForTwo(g);
      return { key: `pat|${g.patFor}|${two}`, html: `<div class="who">${esc(team(G, g.patFor).name)} · TRY FOR POINTS</div><div class="row">${two ? '' : '<button class="btn" type="button" data-action="pat" data-choice="xp">Kick PAT</button>'}<button class="btn alt" type="button" data-action="pat" data-choice="2pt">Go for 2</button></div>` };
    }
    if (g.phase === 'kickchoice') {
      return { key: `kc|${g.kickingTeam}`, html: `<div class="who">${esc(team(G, g.kickingTeam).name)} KICKOFF</div><div class="row"><button class="btn" type="button" data-action="kickoff" data-choice="deep">Kick deep</button><button class="btn alt" type="button" data-action="kickoff" data-choice="onside">Onside kick</button></div>` };
    }
    return null;
  }

  function hintFor(ctx, g) {
    if (!g || g.playNo > 8) return '';
    if (ctx === 'qb') return 'PULL BACK TO AIM · RELEASE TO THROW · STICK MOVES THE QB';
    if (ctx === 'run') return 'STICK TO RUN';
    if (ctx === 'def') return 'STICK TO MOVE · TAP A PLAYER OR SWITCH';
    return '';
  }

  function syncUI() {
    const s = App.screen;
    if (s !== 'game' || !App.G) UI.pad(null);
    if (s === 'title') {
      const sr = lastSeries();
      UI.show('title|' + (sr ? JSON.stringify(sr.w) : '') + '|' + JSON.stringify(App.settings), UI.title(App.settings, sr));
      UI.controls('', null);
      UI.hint('');
      UI.showPause(false);
      return;
    }
    if (s === 'howto') { UI.show('howto', UI.howto()); return; }
    if (s === 'options') { UI.show(`options|${JSON.stringify(App.settings)}|${!!App.resetArmed}`, UI.options(App.settings, App.resetArmed)); return; }
    if (s === 'teams') {
      const cur = App.picks[App.step];
      if (UI.show(`teams|${App.step}|${App.picks.join()}|${App.settings.even}|${App.mode}`, UI.teams(App.step, App.picks, App.names, App.settings.even, App.mode === 'online', cur ? programOf(cur) : null, cur ? devFor(cur) : null))) drawHelmet();
      UI.controls('', null);
      UI.showPause(false);
      return;
    }
    if (s === 'lobby') {
      if (App.net) App.net.syncLobby();
      UI.controls('', null);
      UI.showPause(false);
      return;
    }
    if (s !== 'game' || !App.G) return;
    const G = App.G, g = G.g;
    const online = !!App.net;
    const mine = online ? App.net.isAuthority() && g.ctl === App.net.seat : true;
    if (App.paused) UI.show('pause', UI.pause(online));
    else if (g.phase === 'handoff' && !online) UI.show(`handoff|${g.ctl}|${g.playNo}|${g.afterHandoff}`, UI.handoff(G));
    else if (g.phase === 'half') UI.show(`half|${online && App.net.seat === 0}`, UI.halftime(G, !online || App.net.seat === 0));
    else if (g.phase === 'final' && g.phaseT > 2.4) { recordFinal(G); UI.show('final', UI.final(G, online)); }
    else if (online && App.net.overlay()) UI.show('net|' + App.net.overlay().key, App.net.overlay().html);
    else UI.show('', null);
    UI.showPause(!App.paused && g.phase !== 'final');
    const portrait = Render.R.portrait;
    let ctl = App.paused || g.phase === 'handoff' ? null : controlsFor(G, mine);
    if (!ctl && online && !App.paused) ctl = App.net.controls();
    UI.controls(ctl ? ctl.key + portrait : '', ctl ? ctl.html : null, portrait);
    const ictx = App.paused ? 'none' : inputContext();
    UI.hint(hintFor(ictx, g));
    UI.pad(ictx === 'run' ? ['dive', 'juke'] : ictx === 'def' ? ['switch', 'dive'] : null);
  }

  function drawHelmet() {
    const c = document.getElementById('helmet');
    const id = App.picks[App.step];
    if (!c || !id) return;
    const t = RB.TEAM_BY_ID[id];
    const x = c.getContext('2d');
    x.clearRect(0, 0, 9, 12);
    Render.drawSprite(x, { jersey: t.jersey, helmet: t.helmet, pants: t.pants, trim: t.trim }, '#c68642');
  }

  // --- Actions ------------------------------------------------------------------------------
  function readName() {
    const el = document.getElementById('name-in');
    if (!el) return;
    const v = el.value.trim().toUpperCase().replace(/[^A-Z0-9 .'-]/g, '').slice(0, 10);
    App.names[App.step] = v || `PLAYER ${App.step + 1}`;
    store.set('names', App.names);
  }

  function onInput(e) {
    if (e.target && e.target.id === 'name-in') {
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      try { e.target.setSelectionRange(pos, pos); } catch (err) { /* not all inputs support it */ }
    }
  }

  function onClick(e) {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    RB.Audio.unlock();
    RB.Audio.play('tap');
    const a = b.dataset.action;
    const G = App.G;
    switch (a) {
      case 'local':
        App.mode = 'local';
        App.step = 0;
        App.picks = [null, null];
        App.screen = 'teams';
        break;
      case 'online':
        App.mode = 'online';
        App.step = 0;
        App.picks = [null, null];
        App.screen = 'teams';
        break;
      case 'howto':
        App.back = App.screen;
        App.screen = 'howto';
        break;
      case 'options':
        App.screen = 'options';
        App.resetArmed = false;
        break;
      case 'back':
        if (App.screen === 'options') App.screen = 'title';
        else if (App.screen === 'howto') App.screen = App.back || 'title';
        else if (App.screen === 'teams') {
          readName();
          if (App.step === 1) App.step = 0;
          else App.screen = 'title';
        } else if (App.screen === 'lobby') {
          if (App.net) App.net.leave();
          App.screen = 'teams';
        }
        break;
      case 'set': {
        const k = b.dataset.key, v = +b.dataset.val;
        App.settings[k] = k === 'even' || k === 'sound' || k === 'assist' || k === 'growth' || k === 'buzz' ? !!v : v;
        if (k === 'sound') RB.Audio.setOn(!!v);
        if (k === 'buzz' && RB.Audio.setBuzz) RB.Audio.setBuzz(!!v);
        if (k === 'hand') applyHand();
        store.set('settings', App.settings);
        UI.invalidate();
        break;
      }
      case 'pick':
        readName();
        App.picks[App.step] = b.dataset.team;
        break;
      case 'lock':
        readName();
        if (!App.picks[App.step]) break;
        if (App.mode === 'online') {
          App.screen = 'lobby';
          RB.Net.open(App);
        } else if (App.step === 0) App.step = 1;
        else startLocal();
        break;
      case 'ready': if (G) Game.act(G, { type: 'ready' }); break;
      case 'call': sendAct({ type: 'call', kind: b.dataset.kind }); break;
      case 'shuffle': sendAct({ type: 'shuffle' }); break;
      case 'timeout': sendAct({ type: 'timeout', seat: +b.dataset.seat }); break;
      case 'pat': sendAct({ type: 'pat', choice: b.dataset.choice }); break;
      case 'kickoff': sendAct({ type: 'kickoff', choice: b.dataset.choice }); break;
      case 'continue': sendAct({ type: 'continue' }); break;
      case 'defcall': if (App.net) App.net.defCall(b.dataset.call); break;
      case 'pause': App.paused = true; Input.reset(); break;
      case 'resume': App.paused = false; App.acc = 0; break;
      case 'quit': case 'menu': quitToMenu(); break;
      case 'rematch': startLocal(); break;
      case 'resetgrowth':
        // Two taps: the first arms it, the second wipes every school's growth.
        if (b.dataset.armed) { store.set('programs', {}); App.resetArmed = false; }
        else { App.resetArmed = true; }
        break;
      default:
        if (App.net) App.net.action(a, b);
    }
    UI.invalidate();
  }

  // JUKE / DIVE / SWITCH, pressed with the thumb that isn't on the stick.
  function onPad(e) {
    const b = e.target.closest('[data-pad]');
    if (!b) return;
    e.preventDefault();
    RB.Audio.unlock();
    b.classList.add('on');
    setTimeout(() => b.classList.remove('on'), 140);
    const a = b.dataset.pad, ctx = inputContext();
    if (ctx === 'def' && App.net) {
      if (a === 'switch') App.net.switchNearest();
      if (a === 'dive') App.net.defDive();
      return;
    }
    if (ctx !== 'run') return;
    if (a === 'juke') App.once.juke = true;
    if (a === 'dive') {
      // Dive the way the stick points, or straight ahead.
      const j = App.lastInput && App.lastInput.joy;
      App.once.dive = j ? { x: j.x, y: j.y } : { x: 0, y: 0 };
    }
  }

  function sendAct(act) {
    if (!App.G) return;
    if (App.net && !App.net.isAuthority()) { App.net.requestAct(act); return; }
    Game.act(App.G, act);
  }

  RB.Main = { store, startOnlineGame: null, quitToMenu, buildView, viewPlayer, devFor };

  const boot = () => {
    if (window.claude?.hot?.ready) window.claude.hot.ready(start);
    else start(window.claude?.hot?.data ?? {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
