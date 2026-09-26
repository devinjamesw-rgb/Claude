// How far behind the defense phone's picture is: both tabs log the running
// back's position by wall clock during a run play; for each frame on the
// defense phone, find when the offense phone had him there. Also reports how
// jumpy the defense picture is (mean frame-to-frame acceleration).
// MOCK=1 [ISOLATED=1 DB=1] node tools/onlinelag.js
'use strict';
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8765);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.addInitScript(`window.__mockIsolated = ${!!process.env.ISOLATED}; window.__mockDb = ${!!process.env.DB};`);
  await ctx.addInitScript({ path: require('path').join(__dirname, 'mockclaude.js') });
  const A = await ctx.newPage(), B = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/index.html`;
  await A.goto(url); await B.goto(url); await A.waitForTimeout(500);
  for (const [p, t] of [[A, 'LSU'], [B, 'CLEM']]) { await p.click('[data-action=online]'); await p.click(`[data-team=${t}]`); await p.click('[data-action=lock]'); }
  for (const p of [A, B]) { await p.waitForSelector('[data-action=allow]'); await p.click('[data-action=allow]'); }
  for (const p of [A, B]) await p.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 25000 });
  let off = null, def = null;
  for (let i = 0; i < 300 && !off; i++) {
    for (const [p, q] of [[A, B], [B, A]]) if (await p.evaluate(() => RB.App.net.isAuthority() && RB.App.G.g.phase === 'presnap' && RB.App.G.g.poss === RB.App.net.seat)) { off = p; def = q; break; }
    await A.waitForTimeout(100);
  }
  const results = [];
  for (let rep = 0; rep < 3; rep++) {
    await off.waitForFunction(() => RB.App.G.g.phase === 'presnap' && RB.App.G.g.poss === RB.App.net.seat, null, { timeout: 30000 });
    await off.waitForTimeout(1500);
    // Record on both sides for 2.5 s after the snap.
    const recOff = off.evaluate(() => new Promise((res) => {
      const out = [], t0 = Date.now();
      (function tick() { const pl = RB.App.G.rt.play; if (pl && pl.phase === 'live') { const p = pl.players[1]; out.push([Date.now(), p.x, p.y]); } if (Date.now() - t0 < 4000) requestAnimationFrame(tick); else res(out); })();
    }));
    const recDef = def.evaluate(() => new Promise((res) => {
      const out = [], t0 = Date.now(), orig = RB.Render.frame;
      RB.Render.frame = function (V, dt) { orig.call(this, V, dt); if (V.live && V.players) out.push([Date.now(), V.players[1].x, V.players[1].y]); };
      setTimeout(() => { RB.Render.frame = orig; res(out); }, 4000);
    }));
    await off.click('[data-action=call][data-kind=run]');
    const [ao, bo] = await Promise.all([recOff, recDef]);
    // Lag: for each defense frame, the offense time when the RB was nearest that spot.
    const lags = [];
    for (const [t, x, y] of bo) {
      let best = null, bd = 0.6;
      for (const [ta, xa, ya] of ao) { const d = Math.hypot(xa - x, ya - y); if (d < bd && Math.abs(t - ta) < 1500) { bd = d; best = ta; } }
      if (best != null) lags.push(t - best);
    }
    lags.sort((p, q) => p - q);
    let jerk = 0;
    for (let i = 2; i < bo.length; i++) jerk += Math.hypot(bo[i][1] - 2 * bo[i - 1][1] + bo[i - 2][1], bo[i][2] - 2 * bo[i - 1][2] + bo[i - 2][2]);
    results.push({ lagMedianMs: lags.length ? lags[lags.length >> 1] : null, lagP90Ms: lags.length ? lags[Math.floor(lags.length * 0.9)] : null, samples: lags.length, jerkYd: +(jerk / Math.max(1, bo.length - 2)).toFixed(4) });
  }
  console.log(JSON.stringify({ link: await A.evaluate(() => RB.App.net.t.kind), rtt: await def.evaluate(() => Math.round(RB.App.net.rtt || 0)), results }));
  await browser.close();
})();
