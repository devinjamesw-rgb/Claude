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
  // What the lobby shows so a failure on real phones can be read off the screen.
  const Diag = {
    perm: 'not checked', useState: 'not asked', useMs: null,
    sent: 0, ok: 0, fail: 0, lastErr: '', listenerErr: '',
  };
  const short = (id) => (id ? '#' + String(id).slice(-4) : '#????');

  // Resolves a transport, or { fail: reason } saying why there isn't one.
  async function roomTransport(roomP) {
    const cl = root.claude;
    if (!cl || typeof cl.use !== 'function') return { fail: 'no-api' };
    let room = null;
    const t0 = performance.now();
    Diag.useState = 'waiting for claude.ai';
    try { room = await (roomP || cl.use('room')); } catch (e) {
      Diag.useState = 'threw';
      return { fail: 'use-threw', detail: String((e && e.message) || e) };
    }
    Diag.useMs = Math.round(performance.now() - t0);
    if (!room) { Diag.useState = 'refused (null)'; return { fail: 'no-room' }; }
    Diag.useState = 'granted';
    let mine = {};
    let err = null;
    const onErr = (e) => { err = (e && e.code) || 'unknown'; Diag.listenerErr = err; };
    const unConn = room.onConnection(() => {}, onErr);
    const unPeers = room.onPeers(() => {}, onErr);
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
        Diag.sent++;
        room.presence(patch).then(() => { Diag.ok++; }, (e) => {
          Diag.fail++;
          Diag.lastErr = (e && e.code) || String(e);
          if (e && e.code && e.code !== 'upstream_error') err = e.code;
        });
      },
      peers() {
        return room.peers().filter((p) => p.kind !== 'agent').map((p) => ({ peer: p.peer, presence: p.presence || {}, isMe: p.sameTab }));
      },
      rawPeers() { return room.peers(); },
      connected() { return room.connected(); },
      error() { return err; },
      close() {
        try { room.presence(Object.fromEntries(Object.keys(mine).map((k) => [k, null]))); } catch (e) { /* closing anyway */ }
        unConn(); unPeers();
      },
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
      ts: Math.round(performance.now()),
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


  function withVel(b, a, u, span) {
    if (!a) return Object.assign({}, b, { players: b.players.map((p) => Object.assign({ vx: 0, vy: 0 }, p)) });
    const lerp = (x, y) => x + (y - x) * u;
    const players = b.players.map((p, i) => {
      const q = a.players[i];
      if (Math.hypot(p.x - q.x, p.y - q.y) > 6) return Object.assign({ vx: 0, vy: 0 }, p);
      return Object.assign({}, p, { x: lerp(q.x, p.x), y: lerp(q.y, p.y), vx: (p.x - q.x) / span, vy: (p.y - q.y) / span });
    });
    const bb = b.ball, ab = a.ball;
    const jump = Math.hypot(bb.x - ab.x, bb.y - ab.y) > 10;
    const ball = jump ? bb : Object.assign({}, bb, { x: lerp(ab.x, bb.x), y: lerp(ab.y, bb.y), z: lerp(ab.z, bb.z) });
    return Object.assign({}, b, { players, ball });
  }

  // --- Session ------------------------------------------------------------------------------
  const Net = {
    App: null, t: null, state: 'idle', err: '',
    role: null, seat: 0, code: '', partner: null, partnerSeen: 0,
    G: null, lastPub: 0, disp: null, snap: null, kickSnap: null,
    fx: [], fxn: 0, fxSeen: -1, actN: 0, actSeen: {}, dcN: 0, lastDcN: -1, defIdx: Sim.IDX.S1,
    pending: null, lastAdoptVer: 0,

    // Called at page load: resolve the platform handles early (use() never
    // prompts; consent comes on the first real call).
    prewarm() {
      const cl = root.claude;
      if (!cl || typeof cl.use !== 'function' || /localnet/.test(location.hash)) return;
      this.permP = cl.use('permissions').then((p) => { this.perm = p; return p; }, () => null);
      this.roomP = cl.use('room');
      this.roomP.catch(() => {});
    },

    async open(App) {
      this.App = App;
      App.net = this;
      this.reset();
      this.state = 'connecting';
      this.openedAt = Date.now();
      if (/localnet/.test(location.hash)) {
        const t = localTransport();
        if (!t) { this.state = 'unavailable'; this.err = 'no-broadcast'; return; }
        return this.begin(t);
      }
      if (!root.claude || typeof root.claude.use !== 'function') { this.state = 'unavailable'; this.err = 'no-api'; return; }
      if (!this.permP) this.prewarm();
      const perm = await this.permP;
      if (App.net !== this) return;
      if (perm) {
        try { Diag.perm = await perm.state('room'); } catch (e) { Diag.perm = 'error'; }
      } else Diag.perm = 'no permissions api';
      if (Diag.perm === 'prompt') { this.state = 'needperm'; return; }
      if (Diag.perm === 'denied') { this.state = 'unavailable'; this.err = 'denied'; return; }
      this.connect();
    },

    // From the viewer's tap: ask claude.ai for the live room in one dialog.
    allow() {
      if (!this.perm) return this.connect();
      this.state = 'asking';
      let req;
      try { req = this.perm.request(['room']); } catch (e) { req = Promise.reject(e); }
      req.then((res) => {
        Diag.perm = (res && res.room) || 'unknown';
        if (Diag.perm === 'denied') { this.state = 'unavailable'; this.err = 'denied'; return; }
        this.connect();
      }, () => { Diag.perm = 'request failed'; this.connect(); });
    },

    async connect() {
      const App = this.App;
      this.state = 'connecting';
      const t = await roomTransport(this.roomP);
      if (App.net !== this || App.screen !== 'lobby') { if (t && !t.fail) t.close(); return; }
      if (!t || t.fail) {
        this.state = 'unavailable';
        this.err = t ? t.fail : 'no-api';
        this.errDetail = (t && t.detail) || '';
        return;
      }
      this.begin(t);
    },

    begin(t) {
      this.t = t;
      this.state = 'seeking';
      this.publishLobby();
    },

    reset() {
      Object.assign(this, { role: null, partner: null, G: null, snap: null, kickSnap: null, disp: null, fx: [], fxn: 0, fxSeen: -1, actN: 0, actSeen: {}, dcN: 0, lastDcN: -1, pending: null, err: '', errDetail: '', defIdx: Sim.IDX.S1, lastAdoptVer: 0, tgt: '', buf: [], lastTs: -1, offset: null, lastLobbyPub: 0 });
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
      return { a: APP, v: 2, nm: A.names[0], tm: A.picks[0], role: this.role || 'idle' };
    },

    // While matchmaking: who I am, what I picked, and whom I'm trying to pair with.
    publishLobby() {
      if (!this.t) return;
      const s = this.App.settings;
      this.lastLobbyPub = Date.now();
      this.t.setPresence(Object.assign(this.base(), { role: 'seek', tgt: this.tgt || '', q: s.qlen, d: s.diff, e: s.even ? 1 : 0 }));
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

    action(a) {
      if (a === 'fallback') {
        this.leave();
        this.App.mode = 'local';
        this.App.step = 1;
        this.App.screen = 'teams';
      } else if (a === 'retry') {
        const App = this.App;
        this.leave();
        this.roomP = null;
        this.permP = null;
        RB.Net.open(App);
      } else if (a === 'allow') {
        this.allow();
      }
    },

    // --- Per frame ---
    tick() {
      if (!this.t) return;
      const err = this.t.error && this.t.error();
      if (err && this.state !== 'playing') { this.state = 'unavailable'; this.err = err; }
      if (this.state === 'seeking') this.tickSeek();
      else if (this.state === 'playing') this.tickGame();
    },

    // Automatic pairing. Everyone seeking points at the lowest-id free seeker;
    // when two point at each other they are a match, and the lower id hosts.
    tickSeek() {
      const me = this.me();
      if (!me) return;
      const others = this.others();
      const host = others.find((p) => p.presence.role === 'host' && p.presence.gp === me && validG(p.presence.g));
      if (host) {
        this.role = 'guest';
        this.seat = 1;
        this.partner = host.peer;
        const G = { g: JSON.parse(JSON.stringify(host.presence.g)), rt: null };
        Game.initRuntime(G);
        this.startGame(G);
        return;
      }
      const free = others.filter((p) => p.presence.role === 'seek' && (!p.presence.tgt || p.presence.tgt === me));
      free.sort((a, b) => (a.peer < b.peer ? -1 : 1));
      const pick = free[0];
      const tgt = pick ? pick.peer : '';
      if (tgt !== this.tgt) { this.tgt = tgt; this.publishLobby(); }
      else if (Date.now() - this.lastLobbyPub > 2000) this.publishLobby();
      if (pick && pick.presence.tgt === me && me < pick.peer) {
        this.role = 'host';
        this.seat = 0;
        this.partner = pick.peer;
        const A = this.App, s = A.settings;
        const G = Game.create({
          mode: 'online', home: A.picks[0], away: RB.TEAM_BY_ID[pick.presence.tm] ? pick.presence.tm : 'UGA',
          names: [A.names[0], String(pick.presence.nm || 'GUEST').replace(/[^A-Z0-9 .'-]/gi, '').slice(0, 10) || 'GUEST'],
          settings: { qlen: s.qlen, diff: s.diff, even: s.even },
        });
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
        const okSnap = pp.p && typeof pp.p.s === 'string' && pp.p.s.length === 132 && Array.isArray(pp.p.b) && Array.isArray(pp.p.m) && num(pp.p.ts);
        this.snap = okSnap ? decodePlay(pp.p) : null;
        if (okSnap && pp.p.ts !== this.lastTs) {
          // Buffer timestamped snapshots; drawing runs ~110 ms behind the
          // other phone and blends between the two around that moment.
          this.lastTs = pp.p.ts;
          const now = performance.now();
          const off = now - pp.p.ts;
          this.offset = this.offset == null || off < this.offset ? off : this.offset + (off - this.offset) * 0.002;
          this.buf.push({ ts: pp.p.ts, snap: this.snap });
          if (this.buf.length > 30) this.buf.shift();
        }
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
      p.gp = this.partner;
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
      const s = this.interpSnap();
      if (s && ['presnap', 'play', 'after'].includes(g.phase)) {
        const rosters = rt.rosters;
        V.players = s.players.map((p) => Object.assign({}, p, { skin: rosters[p.i < 11 ? g.poss : 1 - g.poss][p.i < 11 ? 'off' : 'def'][p.i % 11].skin }));
        V.ball = s.ball;
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

    // The play as it looked ~110 ms ago on the other phone, blended between the
    // two snapshots around that moment. Velocities come from the same pair.
    interpSnap() {
      const buf = this.buf;
      if (!buf.length || this.offset == null) return this.snap;
      const t = performance.now() - this.offset - 110;
      let a = buf[0], b = buf[buf.length - 1];
      if (t >= b.ts) a = b;
      else {
        for (let i = buf.length - 1; i > 0; i--) {
          if (buf[i - 1].ts <= t) { a = buf[i - 1]; b = buf[i]; break; }
        }
      }
      if (a === b || b.ts <= a.ts) return withVel(b.snap, null, 1);
      const u = Math.max(0, Math.min(1, (t - a.ts) / (b.ts - a.ts)));
      return withVel(b.snap, a.snap, u, (b.ts - a.ts) / 1000);
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
    diagText() {
      const L = [];
      const secs = ((Date.now() - (this.openedAt || Date.now())) / 1000).toFixed(0);
      L.push(`step: ${this.state} (${secs}s)`);
      L.push(`permission: ${Diag.perm}`);
      L.push(`live room: ${Diag.useState}${Diag.useMs != null ? ` in ${Diag.useMs} ms` : ''}`);
      if (this.t) {
        const me = this.me();
        L.push(`link: ${this.t.kind} · ${this.t.connected() ? 'connected' : 'NOT connected'} · you ${short(me)}`);
        L.push(`updates sent ${Diag.sent} · confirmed ${Diag.ok} · failed ${Diag.fail}${Diag.lastErr ? ' (' + Diag.lastErr + ')' : ''}`);
        if (Diag.listenerErr) L.push(`room error: ${Diag.listenerErr}`);
        const raw = this.t.rawPeers ? this.t.rawPeers() : this.t.peers().map((p) => ({ peer: p.peer, sameTab: p.isMe, kind: 'viewer', presence: p.presence }));
        L.push(`people on this page: ${raw.length}`);
        for (const p of raw.slice(0, 6)) {
          const pr = p.presence || {};
          const what = pr.a === APP ? `${pr.role || '?'}${pr.tgt ? ' → ' + short(pr.tgt) : ''} ${pr.tm || ''}` : 'no game data yet';
          L.push(`  ${short(p.peer)}${p.sameTab ? ' (this phone)' : ''} ${p.kind || ''}: ${what}`);
        }
      }
      if (this.err) L.push(`error: ${this.err}${this.errDetail ? ' · ' + this.errDetail : ''}`);
      return L.join('\n');
    },

    syncLobby() {
      const UI = RB.UI, esc = UI.esc, A = this.App;
      const t = RB.TEAM_BY_ID[A.picks[0]];
      let body = '';
      const REASONS = {
        'no-api': 'This copy of the page is not running inside claude.ai, so it has no live connection.',
        'no-room': 'claude.ai did not give this page a live connection.',
        'use-threw': 'claude.ai refused the live connection.',
        'no-broadcast': 'This browser cannot run the local test link.',
        denied: 'The live connection permission was declined. Reload the page and allow it.',
        not_granted: 'claude.ai says this viewer cannot join the live room.',
        revoked: 'Access to the live room was withdrawn.',
      };
      if (this.state === 'connecting' || this.state === 'asking') {
        body = `<p class="status">${this.state === 'asking' ? 'Waiting for you to allow the live connection…' : 'Connecting to the live room…'}</p>`;
      } else if (this.state === 'needperm') {
        body = `<p>Online play needs claude.ai's live connection for this page.</p>
          <div class="row"><button class="btn" type="button" data-action="allow">Allow live connection</button></div>`;
      } else if (this.state === 'unavailable') {
        body = `<p class="status err">Online play can't start: ${esc(REASONS[this.err] || 'error ' + this.err)}</p>
          <p>Both phones need the published artifact link open, signed in. Two phones on the same account is fine.</p>
          <div class="row end"><button class="btn ghost" type="button" data-action="retry">Try again</button><button class="btn" type="button" data-action="fallback">Play Pass &amp; Play instead</button></div>`;
      } else if (this.state === 'seeking') {
        body = `<p class="status ok">Looking for your opponent…</p>
          <p>Have your friend open this same page, tap <b>Online</b> and pick a school. You're matched automatically.</p>`;
      }
      const shown = UI.show('lobby|' + this.state + this.err, `<div class="panel" style="max-width:600px"><p class="eyebrow">ONLINE · ${esc(A.names[0])} · ${esc(t ? t.name : '')}</p><h2>Head to head</h2>${body}
        <p class="eyebrow" style="margin-top:14px">CONNECTION DETAILS · SCREENSHOT THIS IF IT STALLS</p>
        <pre id="net-diag" class="diag"></pre>
        <div class="row"><button class="btn ghost small" type="button" data-action="back">Back</button></div></div>`);
      const el = document.getElementById('net-diag');
      if (el) {
        const txt = this.diagText();
        if (shown || el.textContent !== txt) el.textContent = txt;
      }
    },
  };

  RB.Net = Net;
  RB.NetCodec = { encodePlay, decodePlay, compactG };
})(typeof window !== 'undefined' ? window : globalThis);
