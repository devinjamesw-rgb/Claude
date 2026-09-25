'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB; const { Sim, C } = RB; const { QB } = Sim.IDX;
const offR = RB.buildRoster(RB.TEAM_BY_ID.ALA), defR = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const rng = RB.makeRng(1);
function bot(play, patience) {
  const P = play.players; let best = null, bs = -1;
  for (const i of Sim.ELIGIBLE) {
    const r = P[i]; if (r.role !== 'route') continue;
    const q = P[QB]; let T = 0.8; let g = Sim.predictRoute(play, r, T);
    for (let k = 0; k < 3; k++) { T = Sim.flightTime(q, Math.hypot(g.x - q.x, g.y - q.y)); g = Sim.predictRoute(play, r, T); }
    let sep = 99; for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x - g.x, P[j].y - g.y));
    if (sep > 3 && sep > bs && g.y > 1.5 && g.y < C.FIELD_W - 1.5) { bs = sep; best = { x: g.x, y: g.y }; }
  }
  return best && play.t > patience ? best : null;
}
const buckets = { behindAll: [], defInFront: [] };
const byCall = {};
const byRoute = {};
for (let n = 0; n < 600; n++) {
  const call = Sim.DEF_CALLS[n % 4];
  const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 30, ballY: C.HASH_TOP, kind: 'pass', defCall: call, diff: 1, rng });
  const pat = rng.range(0.9, 2); let snap = null;
  while (play.phase === 'live' && play.t < 20) {
    const input = {};
    if (Sim.canThrow(play) && play.t > 0.5) { const t = bot(play, pat); if (t) input.throwAt = t; }
    const n0 = play.events.length;
    Sim.step(play, C.DT, input);
    for (const e of play.events.slice(n0)) if (e.type === 'catch') {
      const c = play.players[e.who];
      const front = play.players.slice(11).filter((d) => d.x > c.x + 1).length;
      snap = { x: c.x, front, route: c.routeName };
    }
  }
  if (snap) {
    const yac = play.result.x - snap.x;
    (snap.front === 0 ? buckets.behindAll : buckets.defInFront).push(yac);
    (byCall[call] = byCall[call] || []).push(yac);
    (byRoute[snap.route] = byRoute[snap.route] || []).push(yac);
  }
}
const st = (a) => { const s = a.slice().sort((x, y) => x - y); return `n=${a.length} mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} p50 ${s[Math.floor(s.length / 2)].toFixed(1)} p75 ${s[Math.floor(s.length * 0.75)].toFixed(1)}`; };
for (const [k, v] of Object.entries(buckets)) console.log(k, st(v));
for (const [k, v] of Object.entries(byCall)) console.log(k, st(v));
for (const [k, v] of Object.entries(byRoute)) console.log(k, st(v));
