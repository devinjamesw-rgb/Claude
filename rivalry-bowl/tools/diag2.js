'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB; const { Sim, C } = RB; const { QB } = Sim.IDX;
const offR = RB.buildRoster(RB.TEAM_BY_ID.ALA), defR = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const rng = RB.makeRng(99);
let shown = 0;
for (let n = 0; n < 200 && shown < 6; n++) {
  const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 30, ballY: C.HASH_TOP, kind: 'run', defCall: 'zone', diff: 1, rng });
  let log = [], caught = false;
  while (play.phase === 'live' && play.t < 20) {
    const n0 = play.events.length;
    Sim.step(play, C.DT, {});
    for (const e of play.events.slice(n0)) if (e.type !== 'dead') log.push(`${play.t.toFixed(2)} ${e.type}`);
    if (play.carrier === 1 && Math.round(play.t * 60) % 20 === 0) {
      const c = play.players[1];
      const ds = play.players.slice(11).map((d) => `${d.i}:${Math.hypot(d.x - c.x, d.y - c.y).toFixed(1)}${d.eng >= 0 ? 'E' : ''}${d.down > 0 ? 'D' : ''}`).join(' ');
      log.push(`${play.t.toFixed(2)} car x=${(c.x - play.los).toFixed(1)} v=${Math.hypot(c.vx, c.vy).toFixed(1)} | ${ds}`);
    }
  }
  if (play.result.yds > 15) { shown++; console.log('--- yds', play.result.yds, play.result.kind); console.log(log.join('\n')); }
}
