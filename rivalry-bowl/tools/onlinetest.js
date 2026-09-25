// Two tabs, one host and one guest, over the #localnet BroadcastChannel transport.
'use strict';
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/shots';
const PORT = +(process.env.PORT || 8765);
const URL = `http://127.0.0.1:${PORT}/index.html#localnet`;
const RUN_MS = +(process.env.RUN_MS || 150000);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const A = await ctx.newPage(), B = await ctx.newPage();
  const errors = [];
  for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', (e) => errors.push(n + ' PAGEERROR ' + e.message));
  await A.goto(URL); await B.goto(URL);
  await A.waitForTimeout(600);
  await A.click('[data-action=set][data-key=qlen][data-val="120"]');
  for (const [p, t] of [[A, 'LSU'], [B, 'CLEM']]) {
    await p.click('[data-action=online]');
    await p.click(`[data-team=${t}]`);
    await p.click('[data-action=lock]');
  }
  // No buttons: both phones are matched automatically.
  await A.waitForTimeout(150);
  await A.screenshot({ path: `${OUT}/40-lobby.png` });
  await A.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 10000 });
  await B.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 10000 });
  console.log('paired');
  const t0 = Date.now();
  let transfers = 0, lastAuth = null, shotN = 0, defCalls = 0;
  const pages = [A, B];
  while (Date.now() - t0 < RUN_MS) {
    for (const p of pages) {
      const st = await p.evaluate(() => {
        const N = RB.App.net, G = RB.App.G; if (!G) return null;
        const g = G.g;
        const o = { auth: N.isAuthority(), seat: N.seat, phase: g.phase, score: g.score, q: g.q, ver: g.ver, ctl: g.ctl, poss: g.poss };
        const play = G.rt.play;
        if (o.auth && play && play.phase === 'live' && RB.Sim.canThrow(play) && play.t > 1.4) {
          const P = play.players; let best = null, bs = -1;
          for (const i of RB.Sim.ELIGIBLE) { const r = P[i]; if (r.role !== 'route') continue; const gg = RB.Sim.predictRoute(play, r, 1); let sep = 99; for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x - gg.x, P[j].y - gg.y)); if (sep > bs) { bs = sep; best = gg; } }
          if (best) { RB.App.once.throwAt = { x: best.x, y: best.y }; }
        }
        if (o.auth && g.phase === 'kick' && G.rt.kick && G.rt.kick.phase === 'aim') RB.Game.act(G, { type: 'kick', aim: 0, power: Math.min(1.05, G.rt.kick.need + 0.08) });
        return o;
      });
      if (!st) continue;
      const tag = p === A ? 'A' : 'B';
      if (st.auth && lastAuth !== tag) { if (lastAuth) transfers++; lastAuth = tag; }
      const click = async (sel) => { const el = await p.$(sel); if (el) { await el.click({ timeout: 1000 }).catch(() => {}); return true; } return false; };
      if (st.phase === 'final') continue;
      if (st.auth) {
        if (st.phase === 'presnap') {
          if (!(await click('[data-action=call][data-kind=fg]')) && !(await click('[data-action=call][data-kind=punt]'))) await click(`[data-action=call][data-kind=${Math.random() < 0.3 ? 'run' : 'pass'}]`);
        } else if (st.phase === 'pat') await click('[data-action=pat][data-choice=xp]');
        else if (st.phase === 'kickchoice') await click('[data-action=kickoff][data-choice=deep]');
        else if (st.phase === 'half') await click('[data-action=continue]');
      } else if (st.phase === 'presnap') {
        if (await click('[data-action=defcall][data-call=blitz]')) defCalls++;
        if (shotN < 2) { await p.screenshot({ path: `${OUT}/4${1 + shotN}-follower-${tag}.png` }); shotN++; }
      } else if (st.phase === 'play' && shotN < 4) {
        await p.screenshot({ path: `${OUT}/4${1 + shotN}-follower-play-${tag}.png` }); shotN++;
      }
    }
    const done = await A.evaluate(() => RB.App.G && RB.App.G.g.phase === 'final' && RB.App.G.g.phaseT > 3);
    if (done) break;
    await A.waitForTimeout(150);
  }
  const sa = await A.evaluate(() => ({ phase: RB.App.G.g.phase, score: RB.App.G.g.score, q: RB.App.G.g.q, ver: RB.App.G.g.ver }));
  const sb = await B.evaluate(() => ({ phase: RB.App.G.g.phase, score: RB.App.G.g.score, q: RB.App.G.g.q, ver: RB.App.G.g.ver }));
  await A.screenshot({ path: `${OUT}/48-A-end.png` });
  await B.screenshot({ path: `${OUT}/49-B-end.png` });
  const size = await A.evaluate(() => { const G = RB.App.G; return JSON.stringify({ g: RB.NetCodec.compactG(G.g), p: G.rt.play ? RB.NetCodec.encodePlay(G.rt.play) : null }).length; });
  console.log('A', JSON.stringify(sa), 'B', JSON.stringify(sb), 'authority transfers', transfers, 'defcalls', defCalls, 'presence bytes ~', size);
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
