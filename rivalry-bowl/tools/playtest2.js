// Run play with joystick, a forced field goal, and portrait layout.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || '/tmp/shots';
const URL = 'file://' + path.resolve(__dirname, '../index.html');
async function setup(page) {
  await page.goto(URL);
  await page.waitForTimeout(700);
  await page.click('[data-action=local]');
  await page.click('[data-team=OSU]');
  await page.click('[data-action=lock]');
  await page.click('[data-team=MICH]');
  await page.click('[data-action=lock]');
  await page.waitForSelector('[data-action=ready]', { timeout: 15000 });
  await page.click('[data-action=ready]');
  await page.waitForSelector('[data-action=call][data-kind=pass]', { timeout: 8000 });
}
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // Landscape
  let page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(URL);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/10-title-land.png` });
  await page.click('[data-action=local]');
  await page.click('[data-team=OSU]');
  await page.screenshot({ path: `${OUT}/11-teams-land.png` });
  await page.goto(URL);
  await setup(page);
  await page.click('[data-action=call][data-kind=run]');
  await page.waitForTimeout(700);
  // The fixed stick sits in the bottom-left corner; JUKE / DIVE on the right.
  const cx = 72, cy = 390 - 72;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 4, cy - i * 3); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/12-run-joy.png` });
  const pad = await page.evaluate(() => [...document.querySelectorAll('#pad [data-pad]')].map((b) => b.dataset.pad).join(','));
  await page.dispatchEvent('[data-pad=juke]', 'pointerdown').catch(() => {});
  await page.waitForTimeout(600);
  await page.mouse.up();
  console.log('pad', pad, 'events', JSON.stringify(await page.evaluate(() => RB.App.G.rt.play ? RB.App.G.rt.play.events.map((e) => e.type) : [])));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/13-run-end.png` });
  // Force 4th and 5 at the opponent 20 then kick a FG. (The run may have
  // changed possession: click through any hand-off, try or kickoff first.)
  for (let i = 0; i < 60 && !(await page.$('[data-action=call][data-kind=pass]')); i++) {
    for (const sel of ['[data-action=ready]', '[data-action=pat][data-choice=xp]', '[data-action=kickoff][data-choice=deep]', '[data-action=continue]']) {
      const b = await page.$(sel); if (b) await b.click({ timeout: 500 }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-action=call][data-kind=pass]', { timeout: 10000 });
  await page.evaluate(() => { const G = RB.App.G; G.g.down = 4; G.g.toGo = 5; G.g.ballOn = 80; G.g.phase = 'handoff'; G.g.holder = G.g.poss; RB.Game.act(G, { type: 'ready' }); });
  await page.waitForSelector('[data-action=call][data-kind=fg]', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/14-fourth.png` });
  await page.click('[data-action=call][data-kind=fg]');
  await page.waitForTimeout(500);
  await page.mouse.move(420, 150);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(420 - i, 150 + i * 13); await page.waitForTimeout(16); }
  await page.screenshot({ path: `${OUT}/15-kick-aim.png` });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/16-kick-fly.png` });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/17-kick-res.png` });
  console.log('after kick', JSON.stringify(await page.evaluate(() => ({ phase: RB.App.G.g.phase, score: RB.App.G.g.score }))));
  await page.close();
  // Portrait
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(URL);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/20-title-port.png` });
  await setup(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/21-presnap-port.png` });
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
