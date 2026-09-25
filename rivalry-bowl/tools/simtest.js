// Headless balance check: runs many plays with a bot QB and prints rates.
// Usage: node tools/simtest.js [plays] [diff] [teamA] [teamB]
'use strict';
const path = require('path');
require(path.join(__dirname, '../src/data.js'));
require(path.join(__dirname, '../src/sim.js'));
const RB = globalThis.RB;
const { Sim, C } = RB;
const { QB } = Sim.IDX;

const N = +process.argv[2] || 400;
const diff = process.argv[3] != null ? +process.argv[3] : 1;
const offT = RB.TEAM_BY_ID[process.argv[4] || 'ALA'];
const defT = RB.TEAM_BY_ID[process.argv[5] || 'UGA'];
const offR = RB.buildRoster(offT), defR = RB.buildRoster(defT);
const rng = RB.makeRng(12345);

// Picks the receiver with the most room at the catch point, like a decent human.
function botThrow(play, patience) {
  const P = play.players;
  let best = null, bs = -1;
  for (const i of Sim.ELIGIBLE) {
    const r = P[i];
    if (r.role !== 'route') continue;
    const q = P[QB];
    let d = Math.hypot(r.x + r.vx * 0.8 - q.x, r.y + r.vy * 0.8 - q.y);
    const T = Sim.flightTime(q, d);
    const tx = r.x + r.vx * T, ty = r.y + r.vy * T;
    let sep = 99;
    for (let j = 11; j < 22; j++) {
      const dd = Math.hypot(P[j].x + P[j].vx * T * 0.6 - tx, P[j].y + P[j].vy * T * 0.6 - ty);
      sep = Math.min(sep, dd);
    }
    const score = sep + (tx - play.los) * 0.05;
    if (sep > 2.2 && score > bs && ty > 1 && ty < C.FIELD_W - 1) { bs = score; best = { x: tx, y: ty }; }
  }
  if (best && play.t > patience) return best;
  return null;
}

const tally = { plays: 0, att: 0, comp: 0, int: 0, sack: 0, yds: 0, td: 0, runs: 0, runYds: 0, passYds: 0, fum: 0, time: 0 };
const kinds = {};
for (let n = 0; n < N; n++) {
  const isRun = n % 4 === 0;
  const ballOn = rng.int(15, 70);
  const play = Sim.createPlay({
    offRoster: offR, defRoster: defR, ballOn, ballY: rng.chance(0.5) ? C.HASH_TOP : C.HASH_BOT,
    kind: isRun ? 'run' : 'pass', defCall: Sim.aiDefCall(rng, { down: 1 + (n % 3), toGo: 10, ballOn, lead: 0, secsLeft: 600, q: 1 }),
    diff, rng,
  });
  const patience = rng.range(0.9, 2.2);
  let steps = 0;
  while (play.phase === 'live' && steps < 60 * 30) {
    const input = {};
    if (!isRun && Sim.canThrow(play) && play.t > 0.5) {
      const tgt = botThrow(play, patience);
      if (tgt) input.throwAt = tgt;
      else if (play.t > 3.4) {
        // Force a throw at the least covered guy.
        const P = play.players;
        let r = P[Sim.IDX.WR1];
        input.throwAt = { x: r.x + r.vx, y: r.y + r.vy };
      }
    }
    Sim.step(play, C.DT, input);
    steps++;
  }
  const res = play.result;
  if (!res) { console.log('play never ended', play.t); continue; }
  kinds[res.kind] = (kinds[res.kind] || 0) + 1;
  tally.plays++;
  tally.time += play.t;
  const s = res.stats;
  if (isRun) { tally.runs++; tally.runYds += res.yds; }
  else {
    tally.att += s.passAtt; tally.comp += s.comp; tally.int += s.int; tally.sack += s.sack;
    if (s.comp) tally.passYds += res.yds;
    if (s.sack) tally.passYds += res.yds;
  }
  if (res.kind === 'td') tally.td++;
  if (res.kind === 'fumble') tally.fum++;
  if (!res.turnover && res.kind !== 'inc') tally.yds += res.yds;
}
const passPlays = tally.plays - tally.runs;
console.log(`${offT.name} O vs ${defT.name} D, diff ${diff}, ${tally.plays} plays`);
console.log(`comp% ${(100 * tally.comp / Math.max(1, tally.att)).toFixed(1)}  att ${tally.att}/${passPlays}  INT% ${(100 * tally.int / Math.max(1, tally.att)).toFixed(1)}  sack% ${(100 * tally.sack / passPlays).toFixed(1)}`);
console.log(`yds/pass-play ${(tally.passYds / passPlays).toFixed(1)}  yds/rush ${(tally.runYds / tally.runs).toFixed(1)}  TD ${tally.td}  fumbles ${tally.fum}  avg play ${(tally.time / tally.plays).toFixed(2)}s`);
console.log(kinds);
