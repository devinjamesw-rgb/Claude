// Online defense tackles, judged the way the offense's phone judges them: a
// defender reported next to where the carrier was `lag` seconds ago (what the
// defense player saw) gets a tackle attempt; the same report without the lag
// correction is too far behind to touch him.
'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js')); require(path.join(__dirname, '../src/sim.js'));
const { Sim, C } = globalThis.RB;
const off = RB.buildRoster(RB.TEAM_BY_ID.ALA), def = RB.buildRoster(RB.TEAM_BY_ID.UGA);
function trial(seed, lag, useLag) {
  const rng = RB.makeRng(seed);
  const play = Sim.createPlay({ offRoster: off, defRoster: def, ballOn: 30, ballY: C.MID_Y, kind: 'run', defCall: 'prevent', diff: 1, rng, humanDefIdx: Sim.IDX.S1 });
  for (const d of play.players.slice(11)) if (d.i !== Sim.IDX.S1) d.x += 80; // only our man on the field
  const S = play.players[Sim.IDX.S1];
  let t = 0;
  while (play.phase === 'live' && t < 6) {
    const car = play.carrier >= 0 ? play.players[play.carrier] : null;
    const input = {};
    if (car && play.handedOff) {
      const h = play.hist[play.carrier], k = Math.min(h.length - 1, Math.round(lag / C.DT));
      const then = h[k] || car;
      // The defense phone shows him right on the carrier as it saw him.
      input.defOwn = { x: then.x - 0.5, y: then.y, vx: then.vx, vy: then.vy, age: 0, lag: useLag ? lag : 0, dive: false };
    }
    Sim.step(play, C.DT, input);
    t += C.DT;
  }
  return play.result ? play.result.kind : 'none';
}
for (const lag of [0.2, 0.4]) {
  const tally = (useLag) => { const r = {}; for (let s = 1; s <= 30; s++) { const k = trial(s, lag, useLag); r[k] = (r[k] || 0) + 1; } return r; };
  console.log(`lag ${lag}s  compensated:`, JSON.stringify(tally(true)), ' uncompensated:', JSON.stringify(tally(false)));
}
