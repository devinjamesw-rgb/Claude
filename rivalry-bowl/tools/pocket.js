'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB; const { Sim, C } = RB;
const offR = RB.buildRoster(RB.TEAM_BY_ID[process.argv[2] || 'ALA']), defR = RB.buildRoster(RB.TEAM_BY_ID[process.argv[3] || 'UGA']);
const rng = RB.makeRng(5);
for (const call of ['man', 'zone', 'blitz', 'prevent']) {
  const ts = [];
  for (let n = 0; n < 200; n++) {
    const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 40, ballY: C.HASH_TOP, kind: 'pass', defCall: call, diff: 1, rng });
    while (play.phase === 'live' && play.t < 12) Sim.step(play, C.DT, {});
    ts.push(play.t);
  }
  ts.sort((a, b) => a - b);
  const q = (f) => ts[Math.floor(f * ts.length)].toFixed(2);
  console.log(call.padEnd(8), 'p10', q(0.1), 'p25', q(0.25), 'median', q(0.5), 'p75', q(0.75));
}
