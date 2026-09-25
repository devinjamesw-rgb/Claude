// Plays full games headlessly with bots making every decision.
// Usage: node tools/gametest.js [games] [qlenSeconds] [diff]
'use strict';
const path = require('path');
for (const f of ['data', 'sim', 'kick', 'game']) require(path.join(__dirname, `../src/${f}.js`));
const RB = globalThis.RB;
const { Sim, Game, C } = RB;
const { QB } = Sim.IDX;

const GAMES = +process.argv[2] || 20;
const QLEN = +process.argv[3] || 240;
const PRE = +(process.env.PRE || 2.2);
const DIFF = process.argv[4] != null ? +process.argv[4] : 1;

function botThrow(play) {
  const P = play.players;
  let best = null, bs = -1;
  for (const i of Sim.ELIGIBLE) {
    const r = P[i];
    if (r.role !== 'route') continue;
    const q = P[QB];
    let T = 0.8, g = Sim.predictRoute(play, r, T);
    for (let k = 0; k < 3; k++) { T = Sim.flightTime(q, Math.hypot(g.x - q.x, g.y - q.y)); g = Sim.predictRoute(play, r, T); }
    let sep = 99;
    for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x - g.x, P[j].y - g.y));
    if (sep > 2.6 && sep > bs && g.y > 1.5 && g.y < C.FIELD_W - 1.5) { bs = sep; best = { x: g.x, y: g.y }; }
  }
  return best;
}

const totals = { games: 0, pts: 0, ot: 0, plays: 0, maxOT: 0, ties: 0 };
const phasesSeen = new Set();
for (let n = 0; n < GAMES; n++) {
  const teams = RB.TEAMS;
  const home = teams[n % teams.length].id, away = teams[(n * 7 + 3) % teams.length].id;
  const G = Game.create({ mode: 'local', home, away, settings: { qlen: QLEN, diff: DIFF }, seed: 1000 + n });
  const rng = RB.makeRng(77 + n);
  let t = 0, guard = 0, patience = 1.5;
  while (G.g.phase !== 'final' && guard < 60 * 60 * 90) {
    guard++;
    const g = G.g;
    phasesSeen.add(g.phase);
    const input = {};
    if (g.phase === 'handoff') Game.act(G, { type: 'ready' });
    else if (g.phase === 'presnap' && g.phaseT > PRE) {
      const opts = Game.presnapOptions(g).map((o) => o.id);
      let kind = rng.chance(0.3) ? 'run' : 'pass';
      if (g.down === 4 && !g.twoPt) {
        const fgDist = 100 - g.ballOn + 17;
        if (opts.includes('fg') && fgDist <= 48) kind = 'fg';
        else if (g.toGo > 3 && opts.includes('punt')) kind = 'punt';
      }
      patience = rng.range(0.9, 2.2);
      Game.act(G, { type: 'call', kind });
      if (g.phase === 'play') totals.plays++;
    } else if (g.phase === 'play' && G.rt.play && Sim.canThrow(G.rt.play) && G.rt.play.t > patience) {
      const tgt = botThrow(G.rt.play) || (G.rt.play.t > 3.4 ? { x: G.rt.play.los + 15, y: 3 } : null);
      if (tgt) input.throwAt = tgt;
    } else if (g.phase === 'pat') Game.act(G, { type: 'pat', choice: Game.mustGoForTwo(g) || rng.chance(0.15) ? '2pt' : 'xp' });
    else if (g.phase === 'kick' && G.rt.kick && G.rt.kick.phase === 'aim' && g.phaseT > 0.5) {
      Game.act(G, { type: 'kick', aim: rng.range(-0.15, 0.15), power: Math.min(1.05, G.rt.kick.need + rng.range(0.02, 0.12)) });
    } else if (g.phase === 'kickchoice') Game.act(G, { type: 'kickoff', choice: rng.chance(0.5) ? 'onside' : 'deep' });
    else if (g.phase === 'half' && g.phaseT > 1) Game.act(G, { type: 'continue' });
    Game.update(G, C.DT, input);
    t += C.DT;
  }
  const g = G.g;
  if (g.phase !== 'final') { console.log('STUCK in phase', g.phase, 'q', g.q, 'clock', g.clock, g.ot); process.exitCode = 1; break; }
  totals.games++;
  totals.pts += g.score[0] + g.score[1];
  if (g.ot) { totals.ot++; totals.maxOT = Math.max(totals.maxOT, g.ot.n); }
  if (g.score[0] === g.score[1]) totals.ties++;
  const s = g.stats;
  console.log(`${g.teams[0].padEnd(4)} ${String(g.score[0]).padStart(2)} - ${String(g.score[1]).padEnd(2)} ${g.teams[1].padEnd(4)} ${g.ot ? 'OT' + g.ot.n : '   '} real ${(t / 60).toFixed(1)}m | ` +
    s.map((x) => `${x.pc}/${x.pa} ${x.py}py ${x.ry}ry ${x.int}int ${x.sk}sk ${x.fgm}/${x.fga}fg`).join(' | '));
}
console.log(`games ${totals.games} avg pts/team ${(totals.pts / totals.games / 2).toFixed(1)} OT ${totals.ot} maxOT ${totals.maxOT} ties ${totals.ties} plays/game ${(totals.plays / totals.games).toFixed(0)}`);
console.log('phases', [...phasesSeen].join(' '));
