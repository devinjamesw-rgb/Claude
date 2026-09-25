// A stand-in for the claude.ai artifact runtime (window.claude) following the
// room and permissions type definitions, backed by BroadcastChannel so two
// tabs share one "room". Injected by tools/onlinetest.js when MOCK=1.
(function () {
  const PERM_START = (window.__mockPerm || 'prompt');
  // ISOLATED reproduces what two phones on one account saw in the Claude app:
  // the room connects and confirms presence, but each page only sees itself.
  const ISOLATED = !!window.__mockIsolated;
  const HAS_DB = !!window.__mockDb;
  const bc = new BroadcastChannel('mock-claude-room');
  const me = 'p' + Math.random().toString(36).slice(2, 12);
  const others = new Map();
  let mine = {};
  let perm = PERM_START;
  let connected = false;
  const waiting = [];
  const peerFns = [], connFns = [];
  let snapshot = Object.freeze([]);
  function rebuild() {
    const list = [{ peer: me, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze(Object.assign({}, mine)), updatedAt: Date.now() }];
    for (const [peer, v] of others) list.push({ peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(v.presence), updatedAt: v.seen });
    snapshot = Object.freeze(list);
    for (const f of peerFns) f({ peers: snapshot, joined: [], left: [], updated: [] });
  }
  const send = (type) => { if (perm === 'granted' && !ISOLATED) bc.postMessage({ type, peer: me, presence: mine }); };
  bc.onmessage = (e) => {
    const m = e.data;
    if (!m || m.peer === me) return;
    if (m.type === 'bye') others.delete(m.peer);
    else others.set(m.peer, { presence: m.presence || {}, seen: Date.now() });
    if (m.type === 'hello') send('state');
    rebuild();
  };
  setInterval(() => { send('state'); for (const [k, v] of others) if (Date.now() - v.seen > 4000) others.delete(k); rebuild(); }, 500);
  setTimeout(() => { connected = true; for (const f of connFns) f(true); send('hello'); rebuild(); }, 300);
  function grant() {
    perm = 'granted';
    send('hello');
    while (waiting.length) waiting.shift()();
  }
  const room = Object.freeze({
    presence(patch) {
      if (!patch || typeof patch !== 'object') return Promise.reject({ code: 'invalid_argument', message: 'patch' });
      const json = JSON.stringify(patch);
      if (/null/.test(JSON.stringify(Object.values(patch).filter((v) => v !== null)))) return Promise.reject({ code: 'invalid_argument', message: 'nested null' });
      const apply = () => {
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete mine[k]; else mine[k] = v; }
        if (JSON.stringify(mine).length > 4096) return Promise.reject({ code: 'invalid_argument', message: 'over 4 KiB' });
        rebuild();
        send('state');
      };
      void json;
      if (perm === 'granted') { apply(); return Promise.resolve(); }
      // Consent pending: the call waits for the viewer's answer.
      return new Promise((res) => waiting.push(() => { apply(); res(); }));
    },
    peers() { return snapshot; },
    onPeers(fn) { peerFns.push(fn); Promise.resolve().then(() => fn({ peers: snapshot, joined: snapshot, left: [], updated: [] })); return () => {}; },
    onConnection(fn) { connFns.push(fn); Promise.resolve().then(() => fn(connected)); return () => {}; },
    connected() { return connected; },
    emit() { return Promise.resolve(); },
    on() { return () => {}; },
  });
  // --- db: documents synced between tabs with ~150 ms delivery delay ---
  let dbPerm = HAS_DB ? PERM_START : 'unavailable';
  const docs = new Map(); // path -> body
  const colListeners = []; // {col, fn}
  const dbc = new BroadcastChannel('mock-claude-db');
  const deliver = () => {
    for (const l of colListeners) {
      const list = [];
      for (const [path, body] of docs) {
        const i = path.lastIndexOf('/');
        if (path.slice(0, i) === l.col) list.push({ id: path.slice(i + 1), exists: true, data: () => body, metadata: { fromCache: false, hasPendingWrites: false } });
      }
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
      l.fn({ docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
    }
  };
  let pendingDeliver = null;
  const schedule = () => { if (!pendingDeliver) pendingDeliver = setTimeout(() => { pendingDeliver = null; deliver(); }, 150); };
  dbc.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'set') docs.set(m.path, m.body);
    else if (m.type === 'del') docs.delete(m.path);
    else if (m.type === 'hello') for (const [path, body] of docs) dbc.postMessage({ type: 'set', path, body });
    schedule();
  };
  dbc.postMessage({ type: 'hello' });
  let writes = 0;
  setInterval(() => { writes = 0; }, 1000);
  const dbReady = () => (dbPerm === 'granted' ? Promise.resolve() : new Promise((res) => waitingDb.push(res)));
  const waitingDb = [];
  const docRef = (path) => ({
    id: path.slice(path.lastIndexOf('/') + 1), path,
    set(body) {
      return dbReady().then(() => {
        if (++writes > 12) return Promise.reject({ code: 'resource_exhausted', message: 'rate' });
        if (JSON.stringify(body).length > 256 * 1024) return Promise.reject({ code: 'invalid_argument', message: 'size' });
        const copy = JSON.parse(JSON.stringify(body));
        docs.set(path, copy);
        dbc.postMessage({ type: 'set', path, body: copy });
        schedule();
      });
    },
    delete() { docs.delete(path); dbc.postMessage({ type: 'del', path }); schedule(); return Promise.resolve(); },
  });
  const db = Object.freeze({
    doc: (path) => docRef(path),
    collection: (col) => ({
      path: col,
      doc: (id) => docRef(col + '/' + id),
      onSnapshot(fn) { colListeners.push({ col, fn }); schedule(); return () => {}; },
    }),
  });
  const permissions = Object.freeze({
    state(name) { return Promise.resolve(name === 'room' ? perm : name === 'db' ? dbPerm : 'unavailable'); },
    request(names) {
      return new Promise((res) => setTimeout(() => {
        if ((names || []).includes('room')) grant();
        if ((names || []).includes('db') && HAS_DB) { dbPerm = 'granted'; while (waitingDb.length) waitingDb.shift()(); }
        res({ room: perm, db: dbPerm });
      }, 200));
    },
  });
  const api = {
    use(name) {
      if (this !== api) throw new TypeError('use() must be called as claude.use()');
      return new Promise((res) => setTimeout(() => res(name === 'room' ? room : name === 'permissions' ? permissions : name === 'db' && HAS_DB ? db : null), 150));
    },
  };
  window.claude = Object.freeze(api);
  window.__mockGrant = grant;
})();
