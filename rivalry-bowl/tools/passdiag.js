// Where passing yards come from: separation at the catch, air yards vs yards
// after the catch, completion and interception rates, for two bot QBs:
//   careful: throws only to a receiver with room (like a good player)
//   any:     throws to a random receiver on time (like someone forcing it)
// Usage: node tools/passdiag.js [plays] [diff] [off] [def]
'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB;
const { Sim, C } = RB;
const N = +process.argv[2] || 400;
const diff = process.argv[3] != null ? +process.argv[3] : 1;
const offR = RB.buildRoster(RB.TEAM_BY_ID[process.argv[4] || 'ALA']);
const defR = RB.buildRoster(RB.TEAM_BY_ID[process.argv[5] || 'UGA']);

function lead(play, r) {
  const q = play.players[0];
  let T = 0.8, g = Sim.predictRoute(play, r, T);
  for (let k = 0; k < 2; k++) { T = Sim.flightTime(q, Math.hypot(g.x - q.x, g.y - q.y)); g = Sim.predictRoute(play, r, T); }
  return { g, T };
}
function sepAt(play, x, y, T) {
  let s = 99;
  for (let j = 11; j < 22; j++) { const d = play.players[j]; s = Math.min(s, Math.hypot(d.x + d.vx * T * 0.6 - x, d.y + d.vy * T * 0.6 - y)); }
  return s;
}
function run(mode) {
  const rng = RB.makeRng(777);
  const t = { att: 0, comp: 0, int: 0, sack: 0, air: 0, yac: 0, yds: 0, td: 0, sepSum: 0, sepN: 0, brk: 0 };
  for (let n = 0; n < N; n++) {
    const ballOn = rng.int(15, 70);
    const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn, ballY: rng.chance(0.5) ? C.HASH_TOP : C.HASH_BOT, kind: 'pass',
      defCall: Sim.aiDefCall(rng, { down: 1 + (n % 3), toGo: 10, ballOn, lead: 0, secsLeft: 600, q: 1 }), diff, rng });
    const patience = rng.range(1.0, 2.2);
    let thrown = null, catchX = null;
    while (play.phase === 'live' && play.t < 30) {
      const input = {};
      if (Sim.canThrow(play) && play.t > patience) {
        const P = play.players, cands = Sim.ELIGIBLE.map((i) => P[i]).filter((r) => r.role === 'route');
        let pick = null;
        if (mode === 'careful') {
          let bs = -1;
          for (const r of cands) { const { g, T } = lead(play, r); const s = sepAt(play, g.x, g.y, T); if (s > 2.4 && s + (g.x - play.los) * 0.05 > bs && g.y > 1 && g.y < C.FIELD_W - 1) { bs = s + (g.x - play.los) * 0.05; pick = { g, s }; } }
          if (!pick && play.t > 3.2 && cands.length) { const { g, T } = lead(play, cands[0]); pick = { g, s: sepAt(play, g.x, g.y, T) }; }
        } else if (cands.length) {
          const r = cands[Math.floor(rng.next() * cands.length)]; const { g, T } = lead(play, r); pick = { g, s: sepAt(play, g.x, g.y, T) };
        }
        if (pick) { input.throwAt = pick.g; thrown = pick; }
      }
      Sim.step(play, C.DT, input);
      if (play.stats.comp && catchX == null) catchX = play.players[play.stats.receiver].x;
    }
    const res = play.result, s = res.stats;
    t.att += s.passAtt; t.comp += s.comp; t.int += s.int; t.sack += s.sack;
    if (thrown && s.passAtt) { t.sepSum += thrown.s; t.sepN++; }
    if (s.comp) { t.yds += res.yds; const air = catchX - play.los; t.air += air; t.yac += res.yds - air; }
    if (res.kind === 'td') t.td++;
  }
  const f = (v, d = 1) => v.toFixed(d);
  console.log(`${mode.padEnd(8)} comp ${f(100 * t.comp / t.att)}%  int ${f(100 * t.int / t.att)}%  sack ${f(100 * t.sack / N)}%  yds/att ${f(t.yds / t.att)}  air/comp ${f(t.air / t.comp)}  yac/comp ${f(t.yac / t.comp)}  sep@throw ${f(t.sepSum / t.sepN)}  td ${t.td}`);
}
run('careful');
run('any');
