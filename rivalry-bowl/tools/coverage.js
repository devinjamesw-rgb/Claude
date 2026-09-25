'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB; const { Sim, C } = RB;
const offR = RB.buildRoster(RB.TEAM_BY_ID.ALA), defR = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const rng = RB.makeRng(8);
const times = [1.0, 1.5, 2.0, 2.5, 3.0];
for (const call of ['man', 'zone', 'blitz', 'prevent']) {
  const acc = times.map(() => ({ all: [], best: [] }));
  for (let n = 0; n < 150; n++) {
    const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 35, ballY: rng.chance(0.5) ? C.HASH_TOP : C.HASH_BOT, kind: 'pass', defCall: call, diff: 1, rng });
    let ti = 0;
    while (play.phase === 'live' && ti < times.length) {
      Sim.step(play, C.DT, {});
      if (play.t >= times[ti]) {
        const P = play.players; let best = 0;
        for (const i of Sim.ELIGIBLE) {
          const r = P[i]; if (r.role !== 'route') continue;
          let sep = 99; for (let j = 11; j < 22; j++) if (P[j].role !== 'rush') sep = Math.min(sep, Math.hypot(P[j].x - r.x, P[j].y - r.y));
          acc[ti].all.push(sep); best = Math.max(best, sep);
        }
        acc[ti].best.push(best);
        ti++;
      }
    }
  }
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)].toFixed(1) : '-'; };
  console.log(call.padEnd(8), times.map((t, i) => `t${t}: med ${med(acc[i].all)} best ${med(acc[i].best)}`).join(' | '));
}
