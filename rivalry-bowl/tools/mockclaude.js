// A stand-in for the claude.ai artifact runtime (window.claude) following the
// room and permissions type definitions, backed by BroadcastChannel so two
// tabs share one "room". Injected by tools/onlinetest.js when MOCK=1.
(function () {
  const PERM_START = (window.__mockPerm || 'prompt');
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
  const send = (type) => { if (perm === 'granted') bc.postMessage({ type, peer: me, presence: mine }); };
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
  const permissions = Object.freeze({
    state(name) { return Promise.resolve(name === 'room' ? perm : 'unavailable'); },
    request(names) { return new Promise((res) => setTimeout(() => { if ((names || []).includes('room')) grant(); res({ room: perm }); }, 200)); },
  });
  const api = {
    use(name) {
      if (this !== api) throw new TypeError('use() must be called as claude.use()');
      return new Promise((res) => setTimeout(() => res(name === 'room' ? room : name === 'permissions' ? permissions : null), 150));
    },
  };
  window.claude = Object.freeze(api);
  window.__mockGrant = grant;
})();
