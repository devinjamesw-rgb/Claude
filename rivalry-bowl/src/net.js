/* Rivalry Bowl: online head-to-head over presence.
 *
 * Every phone publishes one presence object. There are no messages to lose:
 * each side always publishes its latest absolute state and reads the other's.
 *  - The phone whose player is on offense (g.ctl) is the authority. It runs
 *    the simulation and publishes the game state `g` plus a compact snapshot
 *    of the play. Offense input never crosses the network, so passing has
 *    no lag.
 *  - The other phone renders those snapshots and publishes its defensive
 *    call and timeout requests. The defender it steers runs on that phone
 *    (no input lag): it publishes his position, the authority places him
 *    there and judges his tackles against where the ball carrier was on the
 *    defense player's screen.
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
    perm: 'not checked', permDb: 'not checked', useState: 'not asked', useMs: null, dbState: 'not asked',
    sent: 0, ok: 0, fail: 0, lastErr: '', listenerErr: '', switched: '',
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

  // Backup transport over the artifact's shared database. Each phone owns two
  // documents in the `lobby` collection ("<id>.a" and "<id>.b") holding its
  // presence, a sequence number and a heartbeat, and subscribes to the
  // collection. Each document takes one write at a time; alternating between
  // two roughly doubles the update rate. Readers keep the newest per phone.
  const DB_WRITE_MS = 140, DB_STALE_MS = 15000, DB_BEAT_MS = 4000;
  async function dbTransport(dbP) {
    const cl = root.claude;
    if (!cl || typeof cl.use !== 'function') return { fail: 'no-api' };
    let db = null;
    Diag.dbState = 'waiting for claude.ai';
    try { db = await (dbP || cl.use('db')); } catch (e) { Diag.dbState = 'threw'; return { fail: 'db-threw', detail: String((e && e.message) || e) }; }
    if (!db) { Diag.dbState = 'refused (null)'; return { fail: 'no-db' }; }
    Diag.dbState = 'granted';
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const col = db.collection('lobby');
    const lanes = ['a', 'b'].map((k) => ({ ref: col.doc(id + '.' + k), busy: false }));
    let list = [], err = null, lastSnap = 0, mine = {}, sq = 0;
    let pending = null, lastWrite = 0, gap = DB_WRITE_MS, timer = null;
    const unsub = col.onSnapshot((snap) => {
      lastSnap = Date.now();
      const now = Date.now();
      const best = new Map();
      let pruned = 0;
      for (const d of snap.docs) {
        const body = d.exists ? d.data() || {} : {};
        const hb = typeof body.hb === 'number' ? body.hb : 0;
        const peer = d.id.split('.')[0];
        if (peer !== id && now - hb > DB_STALE_MS) {
          // Leftovers from closed pages: tidy a few so the store stays small.
          if (now - hb > 10 * 60000 && pruned < 3) { pruned++; col.doc(d.id).delete().catch(() => {}); }
          continue;
        }
        const cur = best.get(peer);
        if (!cur || (body.sq || 0) > cur.sq) best.set(peer, { peer, presence: body.p || {}, sq: body.sq || 0, isMe: peer === id });
      }
      list = [...best.values()];
    }, (e) => { err = (e && e.code) || 'unknown'; Diag.listenerErr = err; });
    function pump() {
      if (!pending) return;
      const lane = lanes.find((l) => !l.busy);
      if (!lane) return;
      const wait = lastWrite + gap - Date.now();
      if (wait > 0) { if (!timer) timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
      const body = pending;
      pending = null;
      lane.busy = true;
      lastWrite = Date.now();
      Diag.sent++;
      const t0 = performance.now();
      lane.ref.set(body).then(() => {
        Diag.ok++;
        Diag.writeMs = Math.round(Diag.writeMs == null ? performance.now() - t0 : Diag.writeMs * 0.8 + (performance.now() - t0) * 0.2);
        gap = Math.max(DB_WRITE_MS, gap * 0.9);
      }, (e) => {
        Diag.fail++;
        const code = (e && e.code) || 'unknown';
        Diag.lastErr = code;
        if (code === 'resource_exhausted') gap = Math.min(3000, gap * 2);
        else if (code !== 'unavailable') err = code;
      }).then(() => { lane.busy = false; pump(); });
    }
    const queue = () => { pending = { p: mine, hb: Date.now(), sq: ++sq }; pump(); };
    const beat = setInterval(() => { if (!pending && Date.now() - lastWrite > DB_BEAT_MS) queue(); }, 1000);
    const bye = () => { for (const l of lanes) l.ref.delete().catch(() => {}); };
    root.addEventListener('pagehide', bye);
    return {
      kind: 'db',
      me: () => id,
      setPresence(obj) {
        mine = JSON.parse(JSON.stringify(obj, (k, v) => (v === null && k !== '' ? undefined : v)));
        queue();
      },
      peers() {
        const l = list.filter((x) => !x.isMe);
        l.unshift({ peer: id, presence: mine, isMe: true });
        return l;
      },
      rawPeers() { return this.peers().map((p) => ({ peer: p.peer, sameTab: p.isMe, kind: 'viewer', presence: p.presence })); },
      connected: () => lastSnap > 0,
      lastSnapAge: () => (lastSnap ? Date.now() - lastSnap : null),
      error: () => err,
      close() {
        clearInterval(beat);
        if (timer) clearTimeout(timer);
        root.removeEventListener('pagehide', bye);
        unsub();
        bye();
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
      const f = (p.face >= 0 ? 1 : 0) | (p.down > 0.35 ? 2 : 0) | ((p.lunge || 0) > 0 || (p.dive || 0) > 0 ? 4 : 0) | (p.eng >= 0 ? 8 : 0);
      s += B36((p.x + 5) * 10, 3) + B36((p.y + 3) * 10, 2) + f.toString(36);
    }
    const b = play.ball;
    const st = ['snap', 'held', 'air', 'dead', 'down'].indexOf(b.st);
    return {
      ts: Math.round(performance.now()),
      s,
      b: [r2(b.x), r2(b.y), r2(b.z), st, play.carrier],
      m: [r2(play.los), r2(play.fdX), r2(play.ballY), play.phase === 'live' ? 1 : play.phase === 'pre' ? 0 : 2, play.turnover ? 1 : 0, play.humanDefIdx,
        play.ownKnock || 0],
      l: play.landing && b.st === 'air' ? [r2(play.landing.x), r2(play.landing.y)] : null,
      // The throw itself, so the other phone can draw the ball's exact flight.
      f: b.st === 'air' ? [r2(b.fx), r2(b.fy), r2(b.tx), r2(b.ty), r2(b.T), r2(b.z0), r2(b.vz0), Math.round(b.bt * 1000) / 1000] : null,
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
      turnover: !!o.m[4], humanDefIdx: o.m[5], ownKnock: num(o.m[6]) ? o.m[6] : 0, landing: o.l ? { x: o.l[0], y: o.l[1] } : null,
      flight: Array.isArray(o.f) && o.f.length === 8 && o.f.every(num) ? { fx: o.f[0], fy: o.f[1], tx: o.f[2], ty: o.f[3], T: o.f[4], z0: o.f[5], vz0: o.f[6], bt: o.f[7] } : null,
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


  // Blend snapshot a -> b at u (u > 1 extrapolates past b, capped by the caller).
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
      this.dbP = cl.use('db');
      this.dbP.catch(() => {});
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
        try { Diag.permDb = await perm.state('db'); } catch (e) { Diag.permDb = 'error'; }
      } else Diag.perm = Diag.permDb = 'no permissions api';
      if (Diag.perm === 'prompt' || Diag.permDb === 'prompt') { this.state = 'needperm'; return; }
      if (Diag.perm === 'denied' && Diag.permDb !== 'granted') { this.state = 'unavailable'; this.err = 'denied'; return; }
      this.connect();
    },

    // From the viewer's tap: ask claude.ai for the live room in one dialog.
    allow() {
      if (!this.perm) return this.connect();
      this.state = 'asking';
      const names = ['room'];
      if (Diag.permDb !== 'unavailable') names.push('db');
      let req;
      try { req = this.perm.request(names); } catch (e) { req = Promise.reject(e); }
      req.then((res) => {
        Diag.perm = (res && res.room) || 'unknown';
        if (res && res.db) Diag.permDb = res.db;
        if (Diag.perm === 'denied' && Diag.permDb !== 'granted') { this.state = 'unavailable'; this.err = 'denied'; return; }
        this.connect();
      }, () => { Diag.perm = 'request failed'; this.connect(); });
    },

    async connect() {
      const App = this.App;
      this.state = 'connecting';
      let t = Diag.perm === 'denied' ? { fail: 'denied' } : await roomTransport(this.roomP);
      if ((!t || t.fail) && this.dbP) {
        const d = await dbTransport(this.dbP);
        if (d && !d.fail) { Diag.switched = 'live room unavailable, using backup sync'; t = d; }
      }
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
      this.seekSince = Date.now();
      this.publishLobby();
    },

    // The live room can connect yet show nobody else (seen with two phones on
    // one account in the Claude app). After a few quiet seconds, move to the
    // shared-database backup; the other phone does the same and they meet there.
    async switchToDb(reason) {
      if (this.switching || !this.dbP) return;
      this.switching = true;
      const d = await dbTransport(this.dbP);
      this.switching = false;
      if (!d || d.fail || this.state !== 'seeking' || !this.App.net) { this.noDb = true; if (d && !d.fail) d.close(); return; }
      if (this.t) this.t.close();
      Diag.switched = reason;
      this.tgt = '';
      this.begin(d);
    },

    reset() {
      Object.assign(Diag, { switched: '', sent: 0, ok: 0, fail: 0, lastErr: '', listenerErr: '' });
      Object.assign(this, { noDb: false, switching: false, seekSince: Date.now() });
      Object.assign(this, { role: null, partner: null, G: null, snap: null, kickSnap: null, disp: null, fx: [], fxn: 0, fxSeen: -1, actN: 0, actSeen: {}, dcN: 0, lastDcN: -1, pending: null, err: '', errDetail: '', defIdx: Sim.IDX.S1, lastAdoptVer: 0, tgt: '', buf: [], lastTs: -1, offset: null, lastLobbyPub: 0, gaps: [], lastArr: 0, rtt: null, lastEk: null, dc: '', dcP: null, dcPick: null, own: null, dvN: 0, lastDv: 0, dq: 0, lastDq: null, dpAt: 0, diveWant: false, viewTs: null, frameDt: 1 / 60 });
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
      const dv = RB.Main && RB.Main.devFor ? RB.Main.devFor(this.App.picks[0]) : null;
      this.t.setPresence(Object.assign(this.base(), { role: 'seek', tgt: this.tgt || '', q: s.qlen, d: s.diff, e: s.even ? 1 : 0, dv: RB.Growth.encode(dv) }));
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
    tick(dt) {
      if (dt > 0) this.frameDt = dt;
      if (!this.t) return;
      const err = this.t.error && this.t.error();
      if (err && this.state !== 'playing') { this.state = 'unavailable'; this.err = err; }
      if (this.state === 'seeking') {
        const alone = !this.others().length;
        if (this.t.kind === 'room' && alone && !this.noDb && this.dbP && Date.now() - this.seekSince > 8000) {
          this.switchToDb('nobody else in the live room after 8 s, switched to backup sync');
          return;
        }
        this.tickSeek();
      } else if (this.state === 'playing') this.tickGame();
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
        G.g.devs = Array.isArray(G.g.devs) ? G.g.devs.map((d) => RB.Growth.encode(RB.Growth.decode(d))) : ['', ''];
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
          settings: { qlen: s.qlen, diff: s.diff, even: s.even, assist: s.assist !== false },
          // Each school's growth: mine from this phone, theirs from their lobby entry.
          devs: s.growth === false || s.even ? ['', ''] : [RB.Main.devFor(A.picks[0]), RB.Growth.decode(pick.presence.dv)],
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
      // Your last coverage call carries over to the next play.
      const g = G.g;
      if (!this.isAuthority() && g.phase === 'presnap' && g.poss !== this.seat && this.dc && this.dcP !== g.playNo) this.defCall(this.dc);
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
      const devs = G.g.devs, prevPs = G.g.ps;
      G.g = JSON.parse(JSON.stringify(pp.g));
      // Growth is sent now and then (it never changes mid-game); keep ours.
      G.g.devs = Array.isArray(G.g.devs) ? G.g.devs.map((d) => RB.Growth.encode(RB.Growth.decode(d))) : devs;
      // Stats may be left out of an update that would be too big; keep ours then.
      if (!G.g.ps || typeof G.g.ps !== 'object') G.g.ps = prevPs || {};
      if (!G.g.heat || typeof G.g.heat !== 'object') G.g.heat = {};
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
        // Round trip: the defense echoes the newest snapshot time it has seen.
        if (num(pp.ek) && pp.ek !== this.lastEk) {
          this.lastEk = pp.ek;
          const r = performance.now() - pp.ek;
          if (r >= 0 && r < 15000) this.rtt = this.rtt == null ? r : this.rtt * 0.7 + r * 0.3;
        }
        if (pp.act && pp.act.n !== this.actSeen[this.partner]) {
          this.actSeen[this.partner] = pp.act.n;
          const a = pp.act;
          if (a.type === 'timeout') Game.act(G, { type: 'timeout', seat: 1 - this.seat });
        }
      } else {
        // Snapshots from the authority.
        const okSnap = pp.p && typeof pp.p.s === 'string' && pp.p.s.length === 132 && Array.isArray(pp.p.b) && Array.isArray(pp.p.m) && num(pp.p.ts);
        this.snap = okSnap ? decodePlay(pp.p) : null;
        if (num(pp.rtt)) this.rtt = pp.rtt;
        if (okSnap && pp.p.ts !== this.lastTs) {
          // Buffer timestamped snapshots; drawing runs a little behind the
          // other phone (as little as the arrival gaps allow) and blends
          // between the two snapshots around that moment.
          this.lastTs = pp.p.ts;
          const now = performance.now();
          if (this.lastArr) { this.gaps.push(now - this.lastArr); if (this.gaps.length > 24) this.gaps.shift(); }
          this.lastArr = now;
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
      // Growth doesn't change during a game: send it early on and every ~2 s
      // (for a phone that reconnects), not in every update.
      this.pubN = (this.pubN || 0) + 1;
      if (G.g.phase !== 'coin' && this.pubN % 36 !== 0) delete p.g.devs;
      if (this.isAuthority()) {
        const play = G.rt.play;
        p.p = ['presnap', 'play', 'after'].includes(G.g.phase) && play ? encodePlay(play) : null;
        p.k = G.g.phase === 'kick' ? encodeKick(G.rt.kick) : null;
        p.fx = this.fx.slice();
        p.fxn = this.fxn;
        if (this.rtt != null) p.rtt = Math.round(this.rtt);
      } else {
        Object.assign(p, { dc: this.dc || '', dcn: this.dcN, dcp: this.dcP == null ? -1 : this.dcP, di: this.defIdx, dv: this.dvN, ek: this.lastTs >= 0 ? this.lastTs : null, act: this.pending });
        const o = this.own;
        if (o) Object.assign(p, { dp: [r2(o.x), r2(o.y), r2(o.vx), r2(o.vy)], dq: ++this.dq, vt: this.viewTs != null ? Math.round(this.viewTs) : null });
      }
      // The live room takes at most 4 KiB per phone: drop what can wait.
      if (JSON.stringify(p).length > 3600 && p.g) { delete p.g.devs; if (JSON.stringify(p).length > 3600) delete p.g.ps; }
      this.t.setPresence(p);
    },

    // Authority: where the defense player's phone has his defender, how old
    // that report is, how far behind his screen was, and a new dive.
    remoteInput() {
      const pp = this.partnerPresence();
      if (!pp) return {};
      const dive = num(pp.dv) && pp.dv !== this.lastDv;
      if (num(pp.dv)) this.lastDv = pp.dv;
      if (!Array.isArray(pp.dp) || pp.dp.length !== 4 || !pp.dp.every(num) || pp.di !== this.G.rt.humanDefIdx) return {};
      const now = performance.now();
      if (pp.dq !== this.lastDq) { this.lastDq = pp.dq; this.dpAt = now; }
      if (now - this.dpAt > 1500) return {};
      const lag = num(pp.vt) ? Math.max(0, Math.min(0.6, (now - pp.vt) / 1000)) : 0;
      return { defOwn: { x: pp.dp[0], y: pp.dp[1], vx: pp.dp[2], vy: pp.dp[3], age: (now - this.dpAt) / 1000, lag, dive } };
    },

    // One line for the HUD: which link, and the measured round trip.
    netInfo() {
      if (!this.t || this.state !== 'playing') return '';
      const link = this.t.kind === 'db' ? 'BACKUP' : 'LIVE';
      return this.rtt != null ? `${link} · ${Math.round(this.rtt)} MS` : link;
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
      if (g.phase === 'play' && this.snap && this.snap.live && !this.snap.turnover) return 'def';
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

    // During the play a tap switches to the tapped defender, or to the one
    // closest to the ball when the tap isn't near anyone.
    switchDefender(world) {
      const s = this.interpSnap();
      if (!s) return;
      let best = -1, bd = 5;
      for (const p of s.players) {
        if (p.side !== 1) continue;
        const d = Math.hypot(p.x - world.x, p.y - world.y);
        if (d < bd) { bd = d; best = p.i; }
      }
      if (best < 0) {
        bd = 1e9;
        const b = s.ball;
        for (const p of s.players) {
          if (p.side !== 1 || p.down || p.eng) continue; // a blocked lineman can't be steered
          const d = Math.hypot(p.x - b.x, p.y - b.y);
          if (d < bd) { bd = d; best = p.i; }
        }
      }
      if (best >= 11) this.defIdx = best;
    },

    // SWITCH: the free defender closest to the ball (not the one you have).
    switchNearest() {
      const s = this.interpSnap();
      if (!s) return;
      const car = s.carrier >= 0 ? s.players[s.carrier] : null;
      const b = s.ball.st === 'air' && s.landing ? s.landing : car || s.ball;
      let best = -1, bd = 1e9;
      for (const p of s.players) {
        if (p.side !== 1 || p.i === this.defIdx || p.down) continue;
        const d = Math.hypot(p.x - b.x, p.y - b.y) + (p.eng ? 3 : 0);
        if (d < bd) { bd = d; best = p.i; }
      }
      if (best >= 11) { this.defIdx = best; this.own = null; }
    },
    defDive() {
      this.diveWant = true;
    },

    // The defender you steer, moved on this phone every frame. The computer
    // plays him until you touch the stick; from then on he's yours until the
    // play ends or you switch (let go and he stops, like any stick game).
    // Everything that happens to him (dives, stumbles, missed tackles) plays
    // out here, where he is, so he never jumps back to where the other phone
    // last saw him.
    ownStep(inp, s) {
      const g = this.G.g, latest = this.snap;
      const live = g.phase === 'play' && s && latest && latest.live && !latest.turnover;
      if (!live) { this.own = null; this.diveWant = false; return; }
      let o = this.own;
      if (o && o.idx !== this.defIdx) o = this.own = null;
      const joy = inp && inp.joy;
      if (!o) {
        const p = s.players[this.defIdx];
        if ((!joy && !this.diveWant) || !p || p.down) { this.diveWant = false; return; }
        o = this.own = { idx: this.defIdx, x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, dvx: 0, dvy: 0, face: p.face, lunge: 0, fall: 0, knock: latest.ownKnock };
      }
      const dt = Math.min(0.05, this.frameDt || 1 / 60);
      // The other phone says he missed a tackle or got juked: stumble right here.
      if (latest.ownKnock !== o.knock) {
        o.knock = latest.ownKnock;
        o.lunge = 0;
        o.fall = 0.45;
        o.vx *= 0.3; o.vy *= 0.3;
      }
      if (o.fall > 0) {
        o.fall -= dt;
        o.vx *= 0.85; o.vy *= 0.85;
        o.x += o.vx * dt; o.y += o.vy * dt;
        this.diveWant = false;
        return;
      }
      const car = s.carrier >= 0 ? s.players[s.carrier] : null;
      // Chasing a runner (anyone but the QB in his pocket): full pursuit speed.
      const chasing = !!car && car.side === 0 && (car.i !== 0 || car.x > s.los + 0.5);
      const spd = this.ownSpeed(o.idx) * (chasing ? 1.08 : 1);
      if (o.lunge > 0) {
        o.lunge -= dt;
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.lunge <= 0) { o.fall = 0.35; o.vx *= 0.4; o.vy *= 0.4; }
        return;
      }
      if (this.diveWant) {
        // Dive the way the stick points; with the stick idle, at where the
        // ball carrier is going to be.
        this.diveWant = false;
        let dx = joy ? joy.x : 0, dy = joy ? joy.y : 0;
        if (Math.hypot(dx, dy) < 0.2 && car && Math.hypot(car.x - o.x, car.y - o.y) < 7) {
          dx = car.x + (car.vx || 0) * 0.25 - o.x;
          dy = car.y + (car.vy || 0) * 0.25 - o.y;
        }
        if (Math.hypot(dx, dy) < 0.1) { dx = o.vx; dy = o.vy; }
        if (Math.hypot(dx, dy) < 0.1) { dx = -1; dy = 0; }
        const d = Math.hypot(dx, dy), sp = Math.max(spd * 1.5, Math.hypot(o.vx, o.vy) + 2.5);
        o.vx = (dx / d) * sp;
        o.vy = (dy / d) * sp;
        o.lunge = 0.32;
        this.dvN++;
        return;
      }
      // A blocker in the way slows him down.
      let slow = 1;
      for (const q of s.players) {
        if (q.side === 0 && q.i !== s.carrier && !q.down && Math.hypot(q.x - o.x, q.y - o.y) < 0.95) { slow = 0.45; break; }
      }
      // Pursuit angle: point the stick roughly at the runner and he takes the
      // angle that cuts him off instead of chasing his heels.
      let j = joy;
      if (joy && chasing) {
        const dx = car.x - o.x, dy = car.y - o.y, dd = Math.hypot(dx, dy), jl = Math.hypot(joy.x, joy.y);
        if (dd > 0.5 && dd < 20 && jl > 0 && (joy.x * dx + joy.y * dy) / (jl * dd) > 0.77) {
          const t = Sim.pursuitPoint(o, { x: car.x, y: car.y, vx: car.vx || 0, vy: car.vy || 0 }, spd * slow);
          const px = t.x - o.x, py = t.y - o.y, pl = Math.hypot(px, py);
          if (pl > 0.1) j = { x: (px / pl) * jl, y: (py / pl) * jl };
        }
      }
      Sim.driveOwned(o, j, spd * slow, dt);
      o.y = Math.max(-1.5, Math.min(C.FIELD_W + 1.5, o.y));
      if (Math.abs(o.vx) > 0.3) o.face = o.vx > 0 ? 1 : -1;
    },
    ownSpeed(idx) {
      const G = this.G, g = G.g;
      const r = G.rt.rosters[1 - g.poss].def[idx - 11];
      const wx = g.wx && g.wx.type;
      return (r && r.spd ? r.spd : 7) * (wx === 'snow' ? 0.95 : wx === 'rain' ? 0.98 : 1);
    },

    // --- Follower rendering ---
    view(inp) {
      const G = this.G, g = G.g, rt = G.rt;
      if (inp && inp.tapAt && g.phase === 'presnap') this.pickDefender(inp.tapAt);
      if (inp && inp.tapAt && g.phase === 'play') this.switchDefender(inp.tapAt);
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
      const s = this.displaySnap();
      if (s && ['presnap', 'play', 'after'].includes(g.phase)) {
        const rosters = rt.rosters;
        const heat = g.heat || {};
        V.players = s.players.map((p) => {
          const seat = p.i < 11 ? g.poss : 1 - g.poss;
          return Object.assign({}, p, { skin: rosters[seat][p.i < 11 ? 'off' : 'def'][p.i % 11].skin, hot: heat[`${seat}${p.i < 11 ? 'o' : 'd'}${p.i % 11}`] || 0 });
        });
        this.ownStep(inp, s);
        const o = this.own;
        if (o && V.players[o.idx]) {
          Object.assign(V.players[o.idx], { x: o.x, y: o.y, vx: o.vx, vy: o.vy, face: o.face, down: o.fall > 0.12, lunge: o.lunge > 0, eng: false });
        }
        V.defOwn = !!o;
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
      V.netInfo = this.netInfo();
      return V;
    },

    // How far behind the newest update to draw. Only a short cushion for
    // normal arrival jitter: longer gaps are covered by carrying each player's
    // motion forward (up to 0.35 s), and view() smooths the small corrections
    // when the next update lands. Waiting for a full buffer made the defense
    // see everything a quarter second later on the backup link.
    renderDelay() {
      const g = this.gaps, db = this.t && this.t.kind === 'db';
      if (g.length < 4) return db ? 120 : 50;
      const sorted = g.slice().sort((x, y) => x - y);
      const med = sorted[Math.floor(sorted.length * 0.5)];
      return Math.max(30, Math.min(db ? 160 : 90, med * 0.4 + 20));
    },

    interpSnap() {
      const buf = this.buf;
      if (!buf.length || this.offset == null) return this.snap;
      // Also look a little past the newest update, by part of the one-way trip
      // time, so what you react to is closer to what's really happening.
      const lead = this.rtt != null ? Math.min(90, this.rtt * 0.25) : 0;
      const t = performance.now() - this.offset - this.renderDelay() + lead;
      this.viewTs = t; // the other phone's clock at the moment on screen
      let a = buf[0], b = buf[buf.length - 1], out;
      if (t >= b.ts) {
        // Newer than anything received: carry the last motion forward.
        if (buf.length < 2) out = withVel(b.snap, null, 1);
        else {
          a = buf[buf.length - 2];
          const span = (b.ts - a.ts) / 1000;
          out = span <= 0 ? withVel(b.snap, null, 1) : withVel(b.snap, a.snap, 1 + Math.min(0.35, (t - b.ts) / 1000) / span, span);
        }
      } else {
        for (let i = buf.length - 1; i > 0; i--) {
          if (buf[i - 1].ts <= t) { a = buf[i - 1]; b = buf[i]; break; }
        }
        if (a === b || b.ts <= a.ts) out = withVel(b.snap, null, 1);
        else out = withVel(b.snap, a.snap, Math.max(0, Math.min(1, (t - a.ts) / (b.ts - a.ts))), (b.ts - a.ts) / 1000);
      }
      // A ball in the air follows its throw exactly: no guessing needed.
      const last = buf[buf.length - 1];
      const f = last.snap.flight;
      if (f && out.ball.st === 'air') {
        const bt = Math.max(0, Math.min(f.T, f.bt + (t - last.ts) / 1000)), u = f.T > 0 ? bt / f.T : 1;
        out.ball = Object.assign({}, out.ball, { x: f.fx + (f.tx - f.fx) * u, y: f.fy + (f.ty - f.fy) * u, z: Math.max(0, f.z0 + f.vz0 * bt - 0.5 * C.GRAVITY * bt * bt) });
      }
      return out;
    },

    // What the defense phone draws: the predicted play, with each player's
    // on-screen position eased toward it so corrections don't pop. Motion is
    // carried forward first, so the easing adds no delay to steady running.
    displaySnap() {
      const s = this.interpSnap();
      if (!s || !s.players) return s;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - (this.smT || now)) / 1000));
      this.smT = now;
      const k = 1 - Math.exp(-dt / 0.09);
      const sm = this.sm || (this.sm = []);
      const players = s.players.map((p, i) => {
        let m = sm[i];
        if (!m || Math.hypot(p.x - m.x, p.y - m.y) > 4 || p.down !== m.down) m = sm[i] = { x: p.x, y: p.y, down: p.down };
        else {
          m.x += (p.vx || 0) * dt; m.y += (p.vy || 0) * dt;
          m.x += (p.x - m.x) * k; m.y += (p.y - m.y) * k;
        }
        return Object.assign({}, p, { x: m.x, y: m.y });
      });
      // A carried ball stays in the (eased) carrier's hands.
      let ball = s.ball;
      if (ball && ball.st !== 'air' && s.carrier >= 0 && players[s.carrier]) {
        const c = players[s.carrier], r = s.players[s.carrier];
        ball = Object.assign({}, ball, { x: ball.x + c.x - r.x, y: ball.y + c.y - r.y });
      }
      return Object.assign({}, s, { players, ball });
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
        const how = 'DEFENSE · PICK A COVERAGE · TAP A PLAYER TO CONTROL HIM';
        return { key: `def|${g.playNo}|${picked}|${g.to}|${g.clockRunning}`, html: `<div class="who">${how}</div><div class="row">${btns}${to}</div>` };
      }
      const waitFor = { pat: 'is choosing the try', kickchoice: 'is choosing the kickoff', kick: 'is kicking', presnap: 'is calling a play' }[g.phase];
      if (waitFor) return { key: `wait|${g.phase}|${g.ctl}`, html: `<div class="who">${esc(opp)} ${waitFor}…</div>` };
      return null;
    },

    overlay() {
      if (this.state !== 'playing') return null;
      if (Date.now() - this.partnerSeen > (this.t && this.t.kind === 'db' ? LOST_MS * 4 : LOST_MS)) {
        return { key: 'lost', html: `<div class="panel" style="max-width:420px"><p class="eyebrow">CONNECTION</p><h2>Your opponent dropped</h2><p class="muted">Waiting for them to come back. The game resumes on its own if they return to this page.</p><div class="row end"><button class="btn ghost" type="button" data-action="quit">Leave game</button></div></div>` };
      }
      return null;
    },

    // --- Lobby screen ---
    diagText() {
      const L = [];
      const secs = ((Date.now() - (this.openedAt || Date.now())) / 1000).toFixed(0);
      L.push(`step: ${this.state} (${secs}s)`);
      L.push(`permission: room ${Diag.perm} · db ${Diag.permDb}`);
      L.push(`live room: ${Diag.useState}${Diag.useMs != null ? ` in ${Diag.useMs} ms` : ''} · backup db: ${Diag.dbState}`);
      if (Diag.switched) L.push(`note: ${Diag.switched}`);
      if (this.t) {
        const me = this.me();
        const age = this.t.lastSnapAge ? this.t.lastSnapAge() : null;
        L.push(`link: ${this.t.kind === 'db' ? 'backup sync (db)' : this.t.kind} · ${this.t.connected() ? 'connected' : 'NOT connected'}${age != null ? ` · last update ${(age / 1000).toFixed(1)}s ago` : ''} · you ${short(me)}`);
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
        // This copy has no backup sync (the public link): after a quiet wait,
        // say why same-account phones can't meet here and where they can.
        const alone = !this.others().length && Date.now() - this.seekSince > 9000;
        if (alone && this.noDb && this.t && this.t.kind === 'room') {
          const url = typeof root.RB_ONLINE_URL === 'string' && /^https:\/\/claude\.ai\//.test(root.RB_ONLINE_URL) ? root.RB_ONLINE_URL : '';
          body += `<p class="status err">Still nobody here. If both phones are signed in to the <b>same Claude account</b>, this link can't pair them: the live room shows each phone only itself.</p>
            <p>${url ? `Open the <b>Online</b> version on both phones instead: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>. It has a backup sync that works on one account.` : 'Use the Online version of this game, which has a backup sync that works on one account.'} On two different accounts, both of you need this page open at the same time.</p>`;
        }
      }
      const quiet = this.state === 'seeking' && this.noDb && !this.others().length && Date.now() - this.seekSince > 9000;
      const shown = UI.show('lobby|' + this.state + this.err + (quiet ? '|quiet' : ''), `<div class="panel" style="max-width:600px"><p class="eyebrow">ONLINE · ${esc(A.names[0])} · ${esc(t ? t.name : '')}</p><h2>Head to head</h2>${body}
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
