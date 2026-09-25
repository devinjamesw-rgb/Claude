'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB; const { Sim, C } = RB; const { QB, WR1 } = Sim.IDX;
const offR = RB.buildRoster(RB.TEAM_BY_ID.ALA), defR = RB.buildRoster(RB.TEAM_BY_ID.UGA);
const rng = RB.makeRng(3);
const route = process.argv[2] || 'comeback', call = process.argv[3] || 'zone';
for (let n = 0; n < 1; n++) {
  const play = Sim.createPlay({ offRoster: offR, defRoster: defR, ballOn: 30, ballY: C.HASH_TOP, kind: 'pass', defCall: call, diff: 1, rng });
  // Force WR1's route
  const r = play.players[WR1];
  const R = Sim.ROUTES[route];
  r.route = R.pts.map(([dx, din]) => ({ x: r.x + dx, y: r.y + din }));
  if (R.cont) { const b = r.route[r.route.length - 1]; r.route.push({ x: b.x + 40, y: b.y }); }
  r.wp = 0; r.role = 'route'; r.routeName = route;
  let thrown = false;
  while (play.phase === 'live' && play.t < 12) {
    const input = {};
    if (!thrown && play.t > 1.9 && Sim.canThrow(play)) { const g = Sim.predictRoute(play, r, 0.9); input.throwAt = { x: g.x, y: g.y }; thrown = true; }
    const n0 = play.events.length;
    Sim.step(play, C.DT, input);
    for (const e of play.events.slice(n0)) console.log(play.t.toFixed(2), e.type, e.text);
    if (Math.round(play.t * 60) % 12 === 0 && play.t > 1.2) {
      const P = play.players, c = play.carrier >= 0 ? P[play.carrier] : r;
      const near = P.slice(11).map((d) => ({ d, dist: Math.hypot(d.x - c.x, d.y - c.y) })).sort((a, b) => a.dist - b.dist).slice(0, 3);
      console.log(play.t.toFixed(2), 'c', (c.x - play.los).toFixed(1), c.y.toFixed(1), 'v', c.vx.toFixed(1), c.vy.toFixed(1), '|', near.map(({ d, dist }) => `#${d.i}(${d.role}) dx ${(d.x - c.x).toFixed(1)} dy ${(d.y - c.y).toFixed(1)} v ${d.vx.toFixed(1)},${d.vy.toFixed(1)}${play.t < d.readAt ? ' R' : ''}${d.eng >= 0 ? ' E' : ''}${d.down > 0 ? ' D' : ''}`).join(' ; '));
    }
  }
  console.log('result', play.result.kind, play.result.yds);
}
