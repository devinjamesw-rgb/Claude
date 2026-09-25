// Filmstrip of a tackle: crops the canvas around the ball carrier at fixed
// times after the play goes dead, to check the falling animation.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || '/tmp/shots';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForTimeout(400);
  await page.click('[data-action=local]');
  await page.click('[data-team=MICH]'); await page.click('[data-action=lock]');
  await page.click('[data-team=OSU]'); await page.click('[data-action=lock]');
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.waitForSelector('[data-action=ready], [data-action=call][data-kind=run]', { timeout: 20000 });
    if (await page.$('[data-action=ready]')) { await page.click('[data-action=ready]'); await page.waitForSelector('[data-action=call][data-kind=run]'); }
    await page.click('[data-action=call][data-kind=run]');
    const url = await page.evaluate(() => new Promise((resolve) => {
      const times = [0, 70, 140, 210, 300, 450, 700];
      const cv = RB.Render.R.canvas, S = cv.width / RB.Render.R.W;
      const strip = document.createElement('canvas');
      const cw = 56 * S, ch = 40 * S;
      strip.width = cw * times.length; strip.height = ch;
      const sx = strip.getContext('2d');
      let t0 = null, k = 0;
      const tick = (now) => {
        const play = RB.App.G.rt.play;
        if (!play) { requestAnimationFrame(tick); return; }
        if (t0 === null && play.phase === 'dead') t0 = now;
        if (t0 !== null && now - t0 >= times[k]) {
          const c = play.players[play.result && play.result.carrier >= 0 ? play.result.carrier : 1];
          const x = RB.Render.sx(c.x) * S - cw / 2, y = RB.Render.sy(c.y) * S - ch * 0.65;
          sx.imageSmoothingEnabled = false; sx.drawImage(cv, x, y, cw, ch, k * cw, 0, cw, ch);
          sx.fillStyle = '#fff'; sx.font = `${6 * S}px monospace`; sx.fillText(times[k] + 'ms', k * cw + 4, 12 * S);
          k++;
          if (k === times.length) { resolve(play.result.kind + '|' + strip.toDataURL('image/png')); return; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    const [kind, data] = url.split('|');
    if (kind === 'tackle' || kind === 'sack') {
      fs.writeFileSync(`${OUT}/90-fall.png`, Buffer.from(data.split(',')[1], 'base64'));
      console.log('captured', kind);
      break;
    }
    console.log('play ended with', kind, '- trying again');
  }
  await browser.close();
})();
