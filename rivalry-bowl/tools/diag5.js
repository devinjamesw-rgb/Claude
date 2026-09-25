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
    if (sep > 3 && sep > bs && g.y > 1.5 && g.y < C.FIELD_W - 1.5) { bs = sep; best = { x: g.x, y: g.y, sep, T, i }; }
  }
  return best && play.t > patience ? best : null;
}
let shown = 0;
for (let n = 0; n < 400 && shown < 2; n++) {
  const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 30, ballY: C.HASH_TOP, kind: 'pass', defCall: Sim.aiDefCall(rng, { down: 1, toGo: 10, ballOn: 30, lead: 0, secsLeft: 600, q: 1 }), diff: 1, rng });
  const pat = rng.range(0.9, 2); let th = null; const log = [];
  while (play.phase === 'live' && play.t < 20) {
    const input = {};
    if (Sim.canThrow(play) && play.t > 0.5) { const t = bot(play, pat); if (t) { input.throwAt = t; th = t; } }
    Sim.step(play, C.DT, input);
    const b = play.ball;
    if (th && b.st === 'air' && Math.round(play.t * 60) % 6 === 0) {
      const P = play.players; const r = P[th.i];
      let nd = null, dd = 99; for (let j = 11; j < 22; j++) { const d = Math.hypot(P[j].x - b.tx, P[j].y - b.ty); if (d < dd) { dd = d; nd = P[j]; } }
      log.push(`bt ${b.bt.toFixed(2)}/${b.T.toFixed(2)} z ${b.z.toFixed(1)} rec#${th.i}(tgt ${b.target}) ${Math.hypot(r.x - b.tx, r.y - b.ty).toFixed(2)} v ${Math.hypot(r.vx, r.vy).toFixed(1)} role ${r.role} track ${!!r.track} | def#${nd.i} ${dd.toFixed(2)} role ${nd.role} v ${Math.hypot(nd.vx, nd.vy).toFixed(1)}`);
    }
  }
  if (play.result.stats.int) { shown++; console.log('--- INT', play.defCall, 'aim', th.x.toFixed(1), th.y.toFixed(1), 'landing', play.ball.tx.toFixed(1), play.ball.ty.toFixed(1)); console.log(log.join('\n')); }
}
