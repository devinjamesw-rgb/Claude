/* Rivalry Bowl: online head-to-head over presence.
 *
 * Every phone publishes one presence object. There are no messages to lose:
 * each side always publishes its latest absolute state and reads the other's.
 *  - The phone whose player is on offense (g.ctl) is the authority. It runs
 *    the simulation and publishes the game state `g` plus a compact snapshot
 *    of the play. Offense input never crosses the network, so passing has
 *    no lag.
 *  - The other phone renders those snapshots and publishes its defensive
 *    call, the defender it steers, its joystick and timeout requests.
 *  - When possession changes, the authority writes g.ctl = other seat. The
 *    other phone sees a higher g.ver, adopts the state and takes over.
 *
 * Transport: the claude.ai artifact `room` capability, or a BroadcastChannel
 * stand-in (open the page with #localnet) for testing with two tabs. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const { C, Game, Sim } = RB;
  const APP = 'rivalry';
  const PUB_MS = 55;
  const LOST_MS = 6000;

  // --- Transports -------------------------------------------------------------------
  // Both expose: me(), setPresence(obj), peers() -> [{peer, presence, isMe}],
  // connected(), close().
  async function roomTransport() {
    const use = root.claude && root.claude.use;
    if (!use) return null;
    let room = null;
    try { room = await use('room'); } catch (e) { room = null; }
    if (!room) return null;
    let mine = {};
    let err = null;
    let conn = false;
    const unConn = room.onConnection((c) => { conn = c; }, (e) => { err = e.code; });
    const unPeers = room.onPeers(() => {}, (e) => { err = e.code; });
    return {
      kind: 'room',
      me() {
        const p = room.peers().find((x) => x.sameTab);
        return p ? p.peer : null;
      },
      setPresence(obj) {
        // Plain JSON only: drop nulls (a top-level null means "remove").
        obj = JSON.parse(JSON.stringify(obj, (k, v) => (v === null && k !== '' ? undefined : v)));
        // Presence merges per field; null clears fields we no longer send.
        const patch = Object.assign({}, obj);
        for (const k of Object.keys(mine)) if (!(k in obj)) patch[k] = null;
        mine = obj;
        room.presence(patch).catch((e) => { if (e && e.code && e.code !== 'upstream_error') err = e.code; });
      },
      peers() {
        return room.peers().filter((p) => p.kind !== 'agent').map((p) => ({ peer: p.peer, presence: p.presence || {}, isMe: p.sameTab }));
      },
      connected() { return room.connected(); },
      error() { return err; },
      close() {
        try { room.presence(Object.fromEntries(Object.keys(mine).map((k) => [k, null]))); } catch (e) { /* closing anyway */ }
        unConn(); unPeers();
      },
      _conn: () => conn,
    };
  }

  function localTransport() {
    if (typeof BroadcastChannel === 'undefined') return null;
    const bc = new BroadcastChannel('rivalry-localnet');
    const id = Math.random().toString(36).slice(2, 10);
    const others = new Map();
    let mine = {};
    let lastSend = 0;
    const send = (type) => bc.postMessage({ type, peer: id, presence: mine, t: Date.now() });
    bc.onmessage = (e) => {
      const m = e.data;
      if (!m || m.peer === id) return;
      if (m.type === 'bye') { others.delete(m.peer); return; }
      others.set(m.peer, { presence: m.presence || {}, seen: Date.now() });
      if (m.type === 'hello') send('state');
    };
    send('hello');
    const hb = setInterval(() => {
      if (Date.now() - lastSend > 800) send('state');
      for (const [k, v] of others) if (Date.now() - v.seen > 4000) others.delete(k);
    }, 400);
    return {
      kind: 'local',
      me: () => id,
      setPresence(obj) { mine = obj; lastSend = Date.now(); send('state'); },
      peers() {
        const list = [{ peer: id, presence: mine, isMe: true }];
        for (const [peer, v] of others) list.push({ peer, presence: v.presence, isMe: false });
        return list;
      },
      connected: () => true,
      error: () => null,
      close() { send('bye'); clearInterval(hb); bc.close(); },
    };
  }

  // --- Snapshot encoding --------------------------------------------------------------
  const B36 = (n, w) => Math.max(0, Math.min(36 ** w - 1, Math.round(n))).toString(36).padStart(w, '0');
  const D36 = (s) => parseInt(s, 36);

  function encodePlay(play) {
    if (!play) return null;
    let s = '';
    for (const p of play.players) {
      const f = (p.face >= 0 ? 1 : 0) | (p.down > 0.25 ? 2 : 0) | ((p.lunge || 0) > 0 ? 4 : 0) | (p.eng >= 0 ? 8 : 0);
      s += B36((p.x + 5) * 10, 3) + B36((p.y + 3) * 10, 2) + f.toString(36);
    }
    const b = play.ball;
    const st = ['snap', 'held', 'air', 'dead', 'down'].indexOf(b.st);
    return {
      s,
      b: [r2(b.x), r2(b.y), r2(b.z), st, play.carrier],
      m: [r2(play.los), r2(play.fdX), r2(play.ballY), play.phase === 'live' ? 1 : play.phase === 'pre' ? 0 : 2, play.turnover ? 1 : 0, play.humanDefIdx],
      l: play.landing && b.st === 'air' ? [r2(play.landing.x), r2(play.landing.y)] : null,
    };
  }

  function decodePlay(o) {
    const players = [];
    for (let i = 0; i < 22; i++) {
      const c = o.s.substr(i * 6, 6);
      const f = D36(c[5]);
      players.push({ i, side: i < 11 ? 0 : 1, x: D36(c.substr(0, 3)) / 10 - 5, y: D36(c.substr(3, 2)) / 10 - 3, face: f & 1 ? 1 : -1, down: !!(f & 2), lunge: !!(f & 4), eng: !!(f & 8) });
    }
    return {
      players,
      ball: { x: o.b[0], y: o.b[1], z: o.b[2], st: ['snap', 'held', 'air', 'dead', 'down'][o.b[3]] || 'held', visible: true },
      carrier: o.b[4], los: o.m[0], fdX: o.m[1], ballY: o.m[2], live: o.m[3] === 1, pre: o.m[3] === 0,
      turnover: !!o.m[4], humanDefIdx: o.m[5], landing: o.l ? { x: o.l[0], y: o.l[1] } : null,
    };
  }

  function encodeKick(k) {
    if (!k) return null;
    return { ty: k.type, d: k.dist, ph: k.phase, t: r2(k.t), bx: r2(k.ball.x), bd: r2(k.ball.d), bh: r2(k.ball.h), nd: r2(k.need), pw: r2(k.power) };
  }
  function decodeKick(o) {
    return { type: o.ty, dist: o.d, phase: o.ph, t: o.t, ball: { x: o.bx, d: o.bd, h: o.bh }, need: o.nd, power: o.pw };
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const num = (v) => typeof v === 'number' && isFinite(v);
  // Presence comes from other people's pages: only adopt a well-formed game.
  function validG(g) {
    return !!(g && typeof g === 'object' && num(g.ver) && Array.isArray(g.teams) && g.teams.every((t) => RB.TEAM_BY_ID[t]) &&
      Array.isArray(g.score) && g.score.length === 2 && g.score.every(num) && (g.ctl === 0 || g.ctl === 1) &&
      (g.poss === 0 || g.poss === 1) && typeof g.phase === 'string' && Array.isArray(g.stats) && g.stats.length === 2 &&
      Array.isArray(g.names) && g.settings && num(g.settings.qlen));
  }
  function compactG(g) {
    return JSON.parse(JSON.stringify(g, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? r2(v) : v)));
  }
  function code4() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  // --- Session ------------------------------------------------------------------------------
  const Net = {
    App: null, t: null, state: 'idle', err: '',
    role: null, seat: 0, code: '', partner: null, partnerSeen: 0,
    G: null, lastPub: 0, disp: null, snap: null, kickSnap: null,
    fx: [], fxn: 0, fxSeen: -1, actN: 0, actSeen: {}, dcN: 0, lastDcN: -1, defIdx: Sim.IDX.S1,
    pending: null, lastAdoptVer: 0,

    async open(App) {
      this.App = App;
      App.net = this;
      this.reset();
      this.state = 'connecting';
      const wantLocal = /localnet/.test(location.hash);
      let t = wantLocal ? localTransport() : await roomTransport();
      if (!t && !wantLocal && !(root.claude && root.claude.use)) t = null;
      if (App.net !== this || App.screen !== 'lobby') { if (t) t.close(); return; }
      if (!t) { this.state = 'unavailable'; return; }
      this.t = t;
      this.state = 'lobby';
      this.publishLobby();
    },

    reset() {
      Object.assign(this, { role: null, partner: null, G: null, snap: null, kickSnap: null, disp: null, fx: [], fxn: 0, fxSeen: -1, actN: 0, actSeen: {}, dcN: 0, lastDcN: -1, pending: null, err: '', defIdx: Sim.IDX.S1, lastAdoptVer: 0 });
    },

    leave() {
      if (this.t) this.t.close();
      this.t = null;
      this.state = 'idle';
      this.reset();
      if (this.App) this.App.net = null;
    },

    me() { return this.t ? this.t.me() : null; },

    base() {
      const A = this.App;
      return { a: APP, v: 1, nm: A.names[0], tm: A.picks[0], role: this.role || 'idle' };
    },

    publishLobby() {
      if (!this.t) return;
      const p = this.base();
      const s = this.App.settings;
      if (this.role === 'host') Object.assign(p, { code: this.code, open: !this.partner, gp: this.partner || '', q: s.qlen, d: s.diff, e: s.even ? 1 : 0 });
      if (this.role === 'guest') Object.assign(p, { join: this.joinPeer, code: this.code });
      this.t.setPresence(p);
    },

    others() {
      return this.t ? this.t.peers().filter((p) => !p.isMe && p.presence && p.presence.a === APP) : [];
    },
    partnerPresence() {
      if (!this.partner) return null;
      const p = this.others().find((x) => x.peer === this.partner);
      if (p) this.partnerSeen = Date.now();
      return p ? p.presence : null;
    },

    // --- Lobby actions ---
    action(a, el) {
      if (a === 'host') {
        this.role = 'host';
        this.seat = 0;
        this.code = code4();
        this.state = 'hosting';
        this.publishLobby();
      } else if (a === 'join') {
        this.role = 'guest';
        this.seat = 1;
        this.joinPeer = el.dataset.peer;
        this.code = el.dataset.code;
        this.state = 'joining';
        this.publishLobby();
      } else if (a === 'cancel') {
        this.role = null;
        this.partner = null;
        this.state = 'lobby';
        this.publishLobby();
      } else if (a === 'fallback') {
        this.leave();
        this.App.mode = 'local';
        this.App.step = 1;
        this.App.screen = 'teams';
      }
    },

    // --- Per frame ---
    tick() {
      if (!this.t) return;
      const err = this.t.error && this.t.error();
      if (err && this.state !== 'playing') { this.state = 'unavailable'; this.err = err; }
      if (this.state === 'hosting') this.tickHost();
      else if (this.state === 'joining') this.tickGuest();
      else if (this.state === 'playing') this.tickGame();
    },

    tickHost() {
      const guest = this.others().find((p) => p.presence.role === 'guest' && p.presence.join === this.me() && p.presence.code === this.code);
      if (!guest) return;
      this.partner = guest.peer;
      const A = this.App, s = A.settings;
      const G = Game.create({
        mode: 'online', home: A.picks[0], away: guest.presence.tm || 'UGA',
        names: [A.names[0], String(guest.presence.nm || 'GUEST').slice(0, 10)],
        settings: { qlen: s.qlen, diff: s.diff, even: s.even },
      });
      this.startGame(G);
    },

    tickGuest() {
      const host = this.others().find((p) => p.peer === this.joinPeer);
      if (!host) return;
      const hp = host.presence;
      if (hp.gp === this.me() && validG(hp.g)) {
        this.partner = host.peer;
        const G = { g: JSON.parse(JSON.stringify(hp.g)), rt: null };
        Game.initRuntime(G);
        this.startGame(G);
      }
    },

    startGame(G) {
      this.G = G;
      this.state = 'playing';
      this.partnerSeen = Date.now();
      const A = this.App;
      A.G = G;
      A.mode = 'online';
      A.screen = 'game';
      A.paused = false;
      RB.Render.R.camInit = false;
      RB.UI.invalidate();
      if (this.isAuthority()) Game.takeover(G);
      this.publishGame(true);
    },

    isAuthority() {
      return !!(this.G && this.G.g.ctl === this.seat);
    },
    canControl() { return this.isAuthority(); },

    tickGame() {
      const G = this.G;
      const pp = this.partnerPresence();
      try {
        if (pp && validG(pp.g) && pp.g.ver > G.g.ver) this.adopt(pp);
        if (pp) this.readPartner(pp);
      } catch (e) {
        // A malformed update from the other side: skip it, keep playing.
      }
      this.publishGame(false);
    },

    adopt(pp) {
      const G = this.G;
      const wasAuth = this.isAuthority();
      const prevPhase = G.g.phase;
      G.g = JSON.parse(JSON.stringify(pp.g));
      this.lastAdoptVer = G.g.ver;
      if (!wasAuth && this.isAuthority()) {
        // Possession came to us: build fresh runtime and carry on.
        const keep = G.rt;
        Game.initRuntime(G);
        G.rt.humanDefIdx = keep && keep.humanDefIdx;
        Game.takeover(G);
      } else if (!this.isAuthority()) {
        if (G.g.phase !== prevPhase && G.g.phase === 'presnap') this.lastDcN = -1;
      }
    },

    readPartner(pp) {
      const G = this.G;
      if (this.isAuthority()) {
        // Defense's call, defender pick and requests.
        if (pp.dcn != null && pp.dcn !== this.lastDcN && G.g.phase === 'presnap' && pp.dcp === G.g.playNo) {
          this.lastDcN = pp.dcn;
          Game.act(G, { type: 'defcall', call: pp.dc });
        }
        if (Number.isInteger(pp.di) && pp.di >= 11 && pp.di <= 21) Game.act(G, { type: 'defplayer', idx: pp.di });
        if (pp.act && pp.act.n !== this.actSeen[this.partner]) {
          this.actSeen[this.partner] = pp.act.n;
          const a = pp.act;
          if (a.type === 'timeout') Game.act(G, { type: 'timeout', seat: 1 - this.seat });
        }
      } else {
        // Snapshots from the authority.
        this.snap = pp.p && typeof pp.p.s === 'string' && pp.p.s.length === 132 && Array.isArray(pp.p.b) && Array.isArray(pp.p.m) ? decodePlay(pp.p) : null;
        this.kickSnap = pp.k ? decodeKick(pp.k) : null;
        if (num(pp.fxn) && Array.isArray(pp.fx)) {
          const first = pp.fxn - pp.fx.length + 1;
          if (this.fxSeen < 0) this.fxSeen = pp.fxn;
          for (let n = Math.max(first, this.fxSeen + 1); n <= pp.fxn; n++) {
            const s = pp.fx[n - first];
            if (s === 'td') this.App.cheer = 2.5;
            RB.Audio.play(s);
          }
          this.fxSeen = Math.max(this.fxSeen, pp.fxn);
        }
      }
    },

    onSfx(name) {
      this.fxn++;
      this.fx.push(name);
      if (this.fx.length > 8) this.fx.shift();
    },

    publishGame(force) {
      const now = Date.now();
      if (!force && now - this.lastPub < PUB_MS) return;
      this.lastPub = now;
      const G = this.G;
      const p = this.base();
      p.role = this.role;
      p.code = this.code;
      p.gp = this.role === 'host' ? this.partner : '';
      p.join = this.role === 'guest' ? this.partner : '';
      p.g = compactG(G.g);
      if (this.isAuthority()) {
        const play = G.rt.play;
        p.p = ['presnap', 'play', 'after'].includes(G.g.phase) && play ? encodePlay(play) : null;
        p.k = G.g.phase === 'kick' ? encodeKick(G.rt.kick) : null;
        p.fx = this.fx.slice();
        p.fxn = this.fxn;
      } else {
        const inp = this.App.lastInput;
        const joy = inp && inp.joy && this.G.g.phase === 'play' ? [r2(inp.joy.x), r2(inp.joy.y)] : null;
        Object.assign(p, { dc: this.dc || '', dcn: this.dcN, dcp: this.dcP == null ? -1 : this.dcP, di: this.defIdx, dj: joy, act: this.pending });
      }
      this.t.setPresence(p);
    },

    // Authority: the defense player's joystick for this step.
    remoteInput() {
      const pp = this.partnerPresence();
      if (!pp || !Array.isArray(pp.dj) || !num(pp.dj[0]) || !num(pp.dj[1])) return {};
      const x = pp.dj[0], y = pp.dj[1], m = Math.hypot(x, y);
      return m > 1 ? { defJoy: { x: x / m, y: y / m } } : { defJoy: { x, y } };
    },

    // Follower requests.
    requestAct(act) {
      if (act.type !== 'timeout') return;
      this.actN++;
      this.pending = { n: this.actN, type: act.type };
    },
    defCall(call) {
      if (!Sim.DEF_CALLS.includes(call)) return;
      this.dc = call;
      this.dcN++;
      this.dcP = this.G.g.playNo;
      this.dcPick = { play: this.G.g.playNo, call };
    },

    inputContext() {
      const g = this.G && this.G.g;
      if (!g) return 'none';
      if (g.phase === 'play' && this.snap && this.snap.live) return 'def';
      if (g.phase === 'presnap') return 'pick';
      return 'none';
    },

    // Tap on a defender before the snap to take control of him.
    pickDefender(world) {
      if (!this.snap) return;
      let best = -1, bd = 4;
      for (const p of this.snap.players) {
        if (p.side !== 1) continue;
        const d = Math.hypot(p.x - world.x, p.y - world.y);
        if (d < bd) { bd = d; best = p.i; }
      }
      if (best >= 11) this.defIdx = best;
    },

    // --- Follower rendering ---
    view(inp) {
      const G = this.G, g = G.g, rt = G.rt;
      if (inp && inp.tapAt && g.phase === 'presnap') this.pickDefender(inp.tapAt);
      const V = {
        g, mode: 'field', teams: [Game.team(G, 0), Game.team(G, 1)], uni: rt.uniforms,
        offSeat: g.poss, defSeat: 1 - g.poss, wx: g.wx, phase: g.phase, cheer: this.App.cheer,
        carrier: -1, ctrl: -1, defCtrl: this.defIdx,
      };
      if (g.phase === 'kick' && this.kickSnap) {
        V.mode = 'kick';
        V.kick = this.kickSnap;
        V.kickUni = rt.uniforms[g.poss];
        return V;
      }
      V.los = C.GOAL_L + g.ballOn;
      V.ballY = g.ballY;
      V.fdX = g.twoPt ? null : C.GOAL_L + Math.min(100, g.ballOn + g.toGo);
      const s = this.snap;
      if (s && ['presnap', 'play', 'after'].includes(g.phase)) {
        const dt = 1 / 60;
        if (!this.disp || this.disp.length !== 22) this.disp = s.players.map((p) => Object.assign({ vx: 0, vy: 0 }, p));
        this.disp = s.players.map((p, i) => {
          const d = this.disp[i];
          const jump = Math.hypot(p.x - d.x, p.y - d.y) > 6;
          const f = jump ? 1 : 0.35;
          const nx = d.x + (p.x - d.x) * f, ny = d.y + (p.y - d.y) * f;
          const vx = jump ? 0 : (nx - d.x) / dt, vy = jump ? 0 : (ny - d.y) / dt;
          const skin = rt.rosters[i < 11 ? g.poss : 1 - g.poss][i < 11 ? 'off' : 'def'][i % 11].skin;
          return Object.assign({}, p, { x: nx, y: ny, vx: vx * 0.5 + d.vx * 0.5, vy: vy * 0.5 + d.vy * 0.5, skin });
        });
        V.players = this.disp;
        const b = s.ball;
        this.dispBall = this.dispBall && Math.hypot(b.x - this.dispBall.x, b.y - this.dispBall.y) < 8
          ? { x: this.dispBall.x + (b.x - this.dispBall.x) * 0.45, y: this.dispBall.y + (b.y - this.dispBall.y) * 0.45, z: this.dispBall.z + (b.z - this.dispBall.z) * 0.45, st: b.st, visible: true }
          : Object.assign({}, b);
        V.ball = this.dispBall;
        V.carrier = s.carrier;
        V.los = s.los;
        V.fdX = g.twoPt ? null : s.fdX;
        V.ballY = s.ballY;
        V.live = s.live;
        V.turnover = s.turnover;
        V.landing = s.landing;
        if (inp) V.joy = inp.joyScreen;
      }
      return V;
    },

    controls() {
      const G = this.G;
      if (!G || this.isAuthority()) return null;
      const g = G.g, esc = RB.UI.esc;
      const opp = g.names[1 - this.seat];
      if (g.phase === 'presnap' && g.poss !== this.seat) {
        const picked = this.dcPick && this.dcPick.play === g.playNo ? this.dcPick.call : null;
        const label = { man: 'Man', zone: 'Zone', blitz: 'Blitz', prevent: 'Prevent' };
        const btns = Sim.DEF_CALLS.map((c) => `<button class="btn small ${picked === c ? '' : 'ghost'}" type="button" data-action="defcall" data-call="${c}">${label[c]}</button>`).join('');
        const to = Game.canTimeout(g, this.seat) ? `<button class="btn small ghost" type="button" data-action="timeout" data-seat="${this.seat}">Timeout (${g.to[this.seat]})</button>` : '';
        return { key: `def|${g.playNo}|${picked}|${g.to}|${g.clockRunning}`, html: `<div class="who">DEFENSE · PICK A COVERAGE · TAP A DEFENDER TO STEER HIM</div><div class="row">${btns}${to}</div>` };
      }
      const waitFor = { pat: 'is choosing the try', kickchoice: 'is choosing the kickoff', kick: 'is kicking', presnap: 'is calling a play' }[g.phase];
      if (waitFor) return { key: `wait|${g.phase}|${g.ctl}`, html: `<div class="who">${esc(opp)} ${waitFor}…</div>` };
      return null;
    },

    overlay() {
      if (this.state !== 'playing') return null;
      if (Date.now() - this.partnerSeen > LOST_MS) {
        return { key: 'lost', html: `<div class="panel" style="max-width:420px"><p class="eyebrow">CONNECTION</p><h2>Your opponent dropped</h2><p class="muted">Waiting for them to come back. The game resumes on its own if they return to this page.</p><div class="row end"><button class="btn ghost" type="button" data-action="quit">Leave game</button></div></div>` };
      }
      return null;
    },

    // --- Lobby screen ---
    syncLobby() {
      const UI = RB.UI, esc = UI.esc, A = this.App;
      const t = RB.TEAM_BY_ID[A.picks[0]];
      let body = '', key = this.state;
      if (this.state === 'connecting') body = '<p class="status">Connecting to the game room…</p>';
      else if (this.state === 'unavailable') {
        key += this.err;
        body = `<p class="status err">Online play isn't available here.</p>
          <p>It runs through claude.ai: both of you open this same page while signed in, and the owner shares it with the other player. Opened anywhere else, only Pass &amp; Play works.</p>
          <div class="row end"><button class="btn" type="button" data-action="fallback">Play Pass &amp; Play instead</button></div>`;
      } else if (this.state === 'lobby') {
        const hosts = this.others().filter((p) => p.presence.role === 'host' && p.presence.open);
        key += hosts.map((h) => h.peer + h.presence.tm).join();
        const list = hosts.length
          ? hosts.map((h) => {
            const ht = RB.TEAM_BY_ID[h.presence.tm];
            return `<div class="lobby-item"><span><b>${esc(h.presence.nm || 'PLAYER')}</b> · ${esc(ht ? ht.name : '')} · ${Math.round((h.presence.q || 240) / 60)} MIN QTRS</span><button class="btn small" type="button" data-action="join" data-peer="${esc(h.peer)}" data-code="${esc(h.presence.code || '')}">Join</button></div>`;
          }).join('')
          : '<p class="status">No open games yet. Host one, or wait for your friend to host.</p>';
        body = `<div class="lobby-list">${list}</div><div class="row end"><button class="btn" type="button" data-action="host">Host a game</button></div>`;
      } else if (this.state === 'hosting') {
        key += this.code;
        body = `<p>Hosting as <b>${esc(A.names[0])}</b> with ${esc(t ? t.name : '')}.</p>
          <p class="status ok">Waiting for your friend… game <span class="code">${esc(this.code)}</span></p>
          <p class="muted">They open this same page, tap Online, pick a school and join your game. Quarter length and AI difficulty come from your settings.</p>
          <div class="row end"><button class="btn ghost" type="button" data-action="cancel">Cancel</button></div>`;
      } else if (this.state === 'joining') {
        key += this.code;
        body = `<p class="status ok">Joining game <span class="code">${esc(this.code)}</span>…</p><div class="row end"><button class="btn ghost" type="button" data-action="cancel">Cancel</button></div>`;
      }
      UI.show('lobby|' + key, `<div class="panel" style="max-width:560px"><p class="eyebrow">ONLINE · ${esc(A.names[0])} · ${esc(t ? t.name : '')}</p><h2>Head to head</h2>${body}
        ${this.state === 'lobby' || this.state === 'connecting' ? '<div class="row"><button class="btn ghost small" type="button" data-action="back">Back</button></div>' : ''}</div>`);
    },
  };

  RB.Net = Net;
  RB.NetCodec = { encodePlay, decodePlay, compactG };
})(typeof window !== 'undefined' ? window : globalThis);
