// Pairs two tabs over #localnet and measures motion smoothness on the
// defending (follower) tab during a pass play.
'use strict';
const { chromium } = require('playwright');
const URL = `http://127.0.0.1:${process.env.PORT || 8765}/index.html#localnet`;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3 });
  const A = await ctx.newPage(), B = await ctx.newPage();
  await A.goto(URL); await B.goto(URL);
  await A.waitForTimeout(500);
  for (const [p, t] of [[A, 'LSU'], [B, 'CLEM']]) { await p.click('[data-action=online]'); await p.click(`[data-team=${t}]`); await p.click('[data-action=lock]'); }
  await A.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 10000 });
  await B.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 10000 });
  // Wait until some tab is authority in presnap, then snap a pass from it.
  let auth = null, fol = null;
  for (let i = 0; i < 200 && !auth; i++) {
    for (const [p, q] of [[A, B], [B, A]]) {
      const ok = await p.evaluate(() => RB.App.net.isAuthority() && RB.App.G.g.phase === 'presnap');
      if (ok) { auth = p; fol = q; break; }
    }
    await A.waitForTimeout(100);
  }
  await auth.click('[data-action=call][data-kind=pass]');
  const res = await fol.evaluate(() => new Promise((resolve) => {
    const R = RB.Render.R, orig = RB.Render.frame, out = [];
    RB.Render.frame = function (V, dt) {
      orig.call(this, V, dt);
      if (V.players && V.live) out.push({ x: RB.Render.sx(V.players[8].x) * R.k, y: RB.Render.sy(V.players[8].y) * R.k });
    };
    setTimeout(() => { RB.Render.frame = orig; resolve(out); }, 2500);
  }));
  let jerk = 0, n = 0;
  for (let i = 2; i < res.length; i++) { jerk += Math.hypot(res[i].x - 2 * res[i - 1].x + res[i - 2].x, res[i].y - 2 * res[i - 1].y + res[i - 2].y); n++; }
  console.log(`follower frames ${res.length} mean jerk ${(jerk / Math.max(1, n)).toFixed(3)} css px/frame^2`);
  await browser.close();
})();
