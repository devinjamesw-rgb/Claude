// Measures on-screen motion smoothness of a running receiver during a play.
// Reports mean |second difference| of screen position (css px per frame^2)
// and how many frames the sprite did not move while its target was moving.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const FILE = process.env.FILE || path.resolve(__dirname, '../index.html');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: +(process.env.DPR || 3) });
  await page.goto('file://' + FILE);
  await page.waitForTimeout(500);
  await page.click('[data-action=local]');
  await page.click('[data-team=ALA]'); await page.click('[data-action=lock]');
  await page.click('[data-team=UGA]'); await page.click('[data-action=lock]');
  await page.waitForSelector('[data-action=ready]', { timeout: 15000 }); await page.click('[data-action=ready]');
  await page.waitForSelector('[data-action=call][data-kind=pass]'); await page.click('[data-action=call][data-kind=pass]');
  const res = await page.evaluate(() => new Promise((resolve) => {
    const R = RB.Render.R, orig = RB.Render.frame, samples = [];
    RB.Render.frame = function (V, dt) {
      orig.call(this, V, dt);
      if (V.players && V.players[8]) {
        const p = V.players[8];
        samples.push({ t: performance.now(), dt, x: RB.Render.sx(p.x) * R.k, y: RB.Render.sy(p.y) * R.k, cx: R.cam.x, a: RB.App.alpha });
      }
    };
    setTimeout(() => { RB.Render.frame = orig; resolve(samples); }, 2500);
  }));
  let jerk = 0, still = 0, n = 0;
  for (let i = 2; i < res.length; i++) {
    const a = res[i - 2], b = res[i - 1], c = res[i];
    const ax = c.x - 2 * b.x + a.x, ay = c.y - 2 * b.y + a.y;
    jerk += Math.hypot(ax, ay); n++;
    if (c.x === b.x && c.y === b.y && Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 0.5) still++;
  }
  const zeroDt = res.filter((r) => r.dt === 0).length;
  console.log(`frames ${res.length}  mean jerk ${(jerk / n).toFixed(3)} css px/frame^2  stalls ${still}  zero-dt frames ${zeroDt}`);
  if (process.env.DUMP) console.log(res.slice(40, 70).map((r) => `${r.t.toFixed(1)} dt=${(r.dt * 1000).toFixed(1)} a=${(r.a || 0).toFixed(2)} x=${r.x.toFixed(2)}`).join('\n'));
  await browser.close();
})();
