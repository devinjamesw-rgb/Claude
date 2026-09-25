// Times Render.frame during a live play at several device pixel ratios.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  for (const dpr of (process.env.DPRS || '1,2,3').split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: dpr });
    await page.goto('file://' + path.resolve(__dirname, '../index.html'));
    await page.waitForTimeout(400);
    await page.click('[data-action=local]');
    await page.click('[data-team=ALA]'); await page.click('[data-action=lock]');
    await page.click('[data-team=UGA]'); await page.click('[data-action=lock]');
    await page.waitForSelector('[data-action=ready]', { timeout: 15000 }); await page.click('[data-action=ready]');
    await page.waitForSelector('[data-action=call][data-kind=pass]'); await page.click('[data-action=call][data-kind=pass]');
    const r = await page.evaluate(() => new Promise((resolve) => {
      const orig = RB.Render.frame, times = [], gaps = [];
      let last = 0;
      RB.Render.frame = function (V, dt) {
        const t0 = performance.now(); orig.call(this, V, dt); times.push(performance.now() - t0);
        if (last) gaps.push(t0 - last); last = t0;
      };
      setTimeout(() => {
        RB.Render.frame = orig;
        const s = times.slice().sort((a, b) => a - b), g = gaps.slice().sort((a, b) => a - b);
        resolve({ n: times.length, med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], gapP95: g[Math.floor(g.length * 0.95)], canvas: RB.Render.R.canvas.width + 'x' + RB.Render.R.canvas.height });
      }, 2000);
    }));
    console.log(`dpr ${dpr}: canvas ${r.canvas} frames ${r.n} render median ${r.med.toFixed(2)} ms p95 ${r.p95.toFixed(2)} ms, frame gap p95 ${r.gapP95.toFixed(1)} ms`);
    await page.close();
  }
  await browser.close();
})();
