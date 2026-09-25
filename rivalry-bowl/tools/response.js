// How long a runner at full speed takes to reach 90% speed in a new direction.
'use strict';
const path = require('path');
const dir = process.argv[2] || path.join(__dirname, '../src');
require(path.join(dir, 'data.js')); require(path.join(dir, 'sim.js'));
const { Sim, C } = globalThis.RB;
const rng = RB.makeRng(9);
const off = RB.buildRoster(RB.TEAM_BY_ID.ALA), def = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const results = {};
for (const [name, jx, jy] of [['cut 90 deg', 0, -1], ['cut 45 deg', 0.7, -0.7], ['reverse', -1, 0]]) {
  const ts = [];
  for (let k = 0; k < 20; k++) {
    const play = Sim.createPlay({ offRoster: off, defRoster: def, ballOn: 30, ballY: C.MID_Y, kind: 'run', defCall: 'prevent', diff: 1, rng });
    while (play.phase === 'live' && !play.handedOff) Sim.step(play, C.DT, {});
    const rb = play.players[1];
    for (const d of play.players.slice(11)) { d.x += 60; } // clear the field
    // Run straight ahead for a second, then cut.
    for (let i = 0; i < 60 && play.phase === 'live'; i++) Sim.step(play, C.DT, { joy: { x: 1, y: 0 } });
    const spd = Math.hypot(rb.vx, rb.vy);
    const ux = jx / Math.hypot(jx, jy), uy = jy / Math.hypot(jx, jy);
    let t = 0;
    while (play.phase === 'live' && t < 3) {
      Sim.step(play, C.DT, { joy: { x: jx, y: jy } });
      t += C.DT;
      if (rb.vx * ux + rb.vy * uy >= 0.9 * spd) break;
    }
    ts.push(t);
  }
  ts.sort((a, b) => a - b);
  results[name] = (ts[ts.length >> 1] * 1000).toFixed(0) + ' ms';
}
console.log(JSON.stringify(results));
