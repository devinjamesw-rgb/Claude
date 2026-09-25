// Pre-snap routes, New play, aim-assist lock and hold-to-steer running.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || '/tmp/shots';
const VW = +(process.env.VW || 844), VH = +(process.env.VH || 390);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => { errors.push('PAGEERROR ' + e.message); console.log('PAGEERROR', e.message); });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForTimeout(500);
  await page.click('[data-action=local]');
  await page.click('[data-team=ORE]'); await page.click('[data-action=lock]');
  await page.click('[data-team=USC]'); await page.click('[data-action=lock]');
  await page.waitForSelector('[data-action=ready]', { timeout: 15000 }); await page.click('[data-action=ready]');
  await page.waitForSelector('[data-action=shuffle]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/70-routes-${VW}.png` });
  const before = await page.evaluate(() => JSON.stringify(RB.App.G.rt.play.plan.routes[8].name));
  await page.click('[data-action=shuffle]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.stringify(RB.App.G.rt.play.plan.routes[8].name));
  console.log('WR1 route before/after New play:', before, after);
  await page.screenshot({ path: `${OUT}/71-shuffled-${VW}.png` });
  await page.click('[data-action=call][data-kind=pass]');
  await page.waitForTimeout(1500);
  // Aim roughly (2 yards off) at WR1's predicted spot and check the lock.
  const drag = await page.evaluate(() => {
    const play = RB.App.G.rt.play, P = play.players, R = RB.Render.R;
    const g = RB.Sim.predictRoute(play, P[8], 1.0);
    const tx = g.x + 1.6, ty = g.y - 1.2;
    const lock = RB.Sim.assistAim(play, tx, ty);
    const gain = RB.Input.AIM_GAIN;
    return { dx: ((tx - P[0].x) / gain) * R.SX * R.k, dy: ((ty - P[0].y) / gain) * R.SY * R.k, lock: lock && lock.i };
  });
  const sx = VW * 0.8, sy = VH * 0.5;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(sx - (drag.dx * i) / 8, sy - (drag.dy * i) / 8); await page.waitForTimeout(16); }
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${OUT}/72-lock-${VW}.png` });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const res = await page.evaluate(() => { const r = RB.App.G.rt.lastResult || {}; return { kind: r.kind, yds: r.yds, comp: r.stats && r.stats.comp }; });
  console.log('assist lock target', drag.lock, 'result', JSON.stringify(res));
  // Run play: hold a finger above-ahead of the runner and watch him head there.
  await page.waitForSelector('[data-action=call][data-kind=run]', { timeout: 10000 });
  await page.click('[data-action=call][data-kind=run]');
  await page.waitForTimeout(900);
  const y0 = await page.evaluate(() => RB.App.G.rt.play && RB.App.G.rt.play.players[1].y);
  await page.mouse.move(VW * 0.62, VH * 0.18); await page.mouse.down();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/73-steer-${VW}.png` });
  const y1 = await page.evaluate(() => RB.App.G.rt.play && RB.App.G.rt.play.players[1].y);
  await page.mouse.up();
  console.log('runner y before/after holding above him:', y0 && y0.toFixed(1), y1 && y1.toFixed(1));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
