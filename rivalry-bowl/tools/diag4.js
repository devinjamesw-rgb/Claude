'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB; const { Sim, C } = RB; const { QB } = Sim.IDX;
const offR = RB.buildRoster(RB.TEAM_BY_ID.ALA), defR = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const rng = RB.makeRng(31337);
function bot(play, patience) {
  const P = play.players; let best = null, bs = -1;
  for (const i of Sim.ELIGIBLE) {
    const r = P[i]; if (r.role !== 'route') continue;
    const q = P[QB]; let T = 0.8; let g = Sim.predictRoute(play, r, T);
    for (let k = 0; k < 3; k++) { T = Sim.flightTime(q, Math.hypot(g.x - q.x, g.y - q.y)); g = Sim.predictRoute(play, r, T); }
    let sep = 99; for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x - g.x, P[j].y - g.y));
    if (sep > 3 && sep > bs && g.y > 1.5 && g.y < C.FIELD_W - 1.5) { bs = sep; best = { x: g.x, y: g.y, sep, T }; }
  }
  return best && play.t > patience ? best : null;
}
const rows = [];
for (let n = 0; n < 400; n++) {
  const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 30, ballY: C.HASH_TOP, kind: 'pass', defCall: Sim.aiDefCall(rng, { down: 1, toGo: 10, ballOn: 30, lead: 0, secsLeft: 600, q: 1 }), diff: 1, rng });
  const pat = rng.range(0.9, 2); let th = null, arr = null;
  while (play.phase === 'live' && play.t < 20) {
    const input = {};
    if (Sim.canThrow(play) && play.t > 0.5) { const t = bot(play, pat); if (t) { input.throwAt = t; th = t; } }
    Sim.step(play, C.DT, input);
    const b = play.ball;
    if (th && !arr && (b.resolved || b.st !== 'air')) {
      const P = play.players;
      let dd = 99; for (let j = 11; j < 22; j++) dd = Math.min(dd, Math.hypot(P[j].x - b.x, P[j].y - b.y));
      const r = b.target >= 0 ? P[b.target] : null;
      arr = { def: dd, rec: r ? Math.hypot(r.x - b.x, r.y - b.y) : 99 };
    }
  }
  if (th) rows.push({ sepThrow: th.sep, T: th.T, ...arr, res: play.result.kind === 'inc' ? play.result.text : play.result.stats.int ? 'INT' : play.result.stats.comp ? 'COMP' : play.result.kind });
}
const by = {};
for (const r of rows) { const k = r.res; by[k] = by[k] || { n: 0, def: 0, rec: 0, sep: 0, T: 0 }; by[k].n++; by[k].def += r.def; by[k].rec += r.rec; by[k].sep += r.sepThrow; by[k].T += r.T; }
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(12), v.n, 'defDist@arrive', (v.def / v.n).toFixed(2), 'recDist', (v.rec / v.n).toFixed(2), 'sep@throw', (v.sep / v.n).toFixed(1), 'T', (v.T / v.n).toFixed(2));
