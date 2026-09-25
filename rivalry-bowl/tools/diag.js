'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB;
const { Sim, C } = RB;
const { QB } = Sim.IDX;
const N = +process.argv[2] || 300;
const offR = RB.buildRoster(RB.TEAM_BY_ID.ALA), defR = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const rng = RB.makeRng(777);
function bot(play, patience) {
  const P = play.players; let best = null, bs = -1;
  for (const i of Sim.ELIGIBLE) {
    const r = P[i]; if (r.role !== 'route') continue;
    const q = P[QB];
    let T = 0.8;
    let g = Sim.predictRoute(play, r, T);
    for (let k = 0; k < 3; k++) { const d = Math.hypot(g.x - q.x, g.y - q.y); T = Sim.flightTime(q, d); g = Sim.predictRoute(play, r, T); }
    let sep = 99;
    for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x + P[j].vx * T * 0.5 - g.x, P[j].y + P[j].vy * T * 0.5 - g.y));
    const sc = sep + (g.x - play.los) * 0.04;
    if (sep > 2.5 && sc > bs && g.y > 1.5 && g.y < C.FIELD_W - 1.5) { bs = sc; best = { x: g.x, y: g.y, sep }; }
  }
  return best && play.t > patience ? best : null;
}
const out = { att: 0, comp: 0, int: 0, early: 0, inc: {}, yac: [], air: [], td: 0, sack: 0, sepAtThrow: [], tracked: 0, noTrack: 0 };
for (let n = 0; n < N; n++) {
  const ballOn = rng.int(15, 60);
  const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn, ballY: C.HASH_TOP, kind: 'pass', defCall: Sim.aiDefCall(rng, { down: 1, toGo: 10, ballOn, lead: 0, secsLeft: 600, q: 1 }), diff: 1, rng });
  const pat = rng.range(0.9, 2.2); let catchX = null, thrownAt = null;
  while (play.phase === 'live' && play.t < 30) {
    const input = {};
    if (Sim.canThrow(play) && play.t > 0.5) {
      const t = bot(play, pat);
      if (t) { input.throwAt = t; out.sepAtThrow.push(t.sep); }
      else if (play.t > 3.6) { const r = play.players[8]; input.throwAt = { x: r.x + r.vx, y: r.y + r.vy }; }
    }
    const nEv = play.events.length;
    Sim.step(play, C.DT, input);
    for (const e of play.events.slice(nEv)) {
      if (e.type === 'throw') { thrownAt = play.t; if (play.ball.target >= 0) out.tracked++; else out.noTrack++; }
      if (e.type === 'catch') catchX = play.players[e.who].x;
      if (e.type === 'int' && play.ball.bt < play.ball.T * 0.72) out.early++;
    }
  }
  const r = play.result, s = r.stats;
  out.att += s.passAtt; out.comp += s.comp; out.int += s.int; out.sack += s.sack;
  if (r.kind === 'inc') out.inc[r.text] = (out.inc[r.text] || 0) + 1;
  if (catchX != null) { out.yac.push(r.x - catchX); out.air.push(catchX - play.los); }
  if (r.kind === 'td') out.td++;
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
console.log('att', out.att, 'comp%', (100 * out.comp / out.att).toFixed(1), 'int', out.int, 'earlyInt', out.early, 'sack', out.sack, 'td', out.td);
console.log('tracked', out.tracked, 'noTrack', out.noTrack, 'inc', out.inc);
const sy = out.yac.slice().sort((a, b) => a - b); const pq = (f) => sy[Math.floor(f * sy.length)].toFixed(1);
console.log('avg air', avg(out.air), 'avg yac', avg(out.yac), 'yac p25/50/75/90', pq(0.25), pq(0.5), pq(0.75), pq(0.9), 'sep@throw', avg(out.sepAtThrow));
