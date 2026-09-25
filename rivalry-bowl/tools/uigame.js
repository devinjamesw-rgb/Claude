// Plays a full pass & play game through the DOM and pointer gestures.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || '/tmp/shots';
const VW = +(process.env.VW || 844), VH = +(process.env.VH || 390);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForTimeout(600);
  await page.click('[data-action=set][data-key=qlen][data-val="120"]');
  await page.click('[data-action=local]');
  await page.click('[data-team=TEX]');
  await page.click('[data-action=lock]');
  await page.click('[data-team=OU]');
  await page.click('[data-action=lock]');
  const t0 = Date.now();
  let shots = 0, lastPhase = '', plays = 0, throws = 0;
  while (Date.now() - t0 < 600000) {
    const st = await page.evaluate(() => {
      const A = RB.App, G = A.G; if (!G) return { none: true };
      const g = G.g, play = G.rt.play, R = RB.Render.R;
      const out = { phase: g.phase, phaseT: g.phaseT, q: g.q, score: g.score, final: g.phase === 'final' };
      if (play && play.phase === 'live' && RB.Sim.canThrow(play) && play.t > 1.3) {
        // Find the most open receiver's spot, like a human would.
        const P = play.players; let best = null, bs = -1;
        for (const i of RB.Sim.ELIGIBLE) {
          const r = P[i]; if (r.role !== 'route') continue;
          let T = 0.8, gg = RB.Sim.predictRoute(play, r, T);
          T = RB.Sim.flightTime(P[0], Math.hypot(gg.x - P[0].x, gg.y - P[0].y)); gg = RB.Sim.predictRoute(play, r, T);
          let sep = 99; for (let j = 11; j < 22; j++) sep = Math.min(sep, Math.hypot(P[j].x - gg.x, P[j].y - gg.y));
          if (sep > bs) { bs = sep; best = gg; }
        }
        if (best) {
          const q = P[0], gain = RB.Input.AIM_GAIN;
          const wx = (best.x - q.x) / gain, wy = (best.y - q.y) / gain;
          out.drag = { dx: wx * R.SX * R.k, dy: wy * R.SY * R.k };
        }
      }
      if (g.phase === 'kick' && G.rt.kick && G.rt.kick.phase === 'aim') out.kickNeed = G.rt.kick.need;
      return out;
    });
    if (st.none) break;
    if (st.phase !== lastPhase) { lastPhase = st.phase; }
    const click = async (sel) => { const el = await page.$(sel); if (el) { await el.click().catch(() => {}); return true; } return false; };
    if (st.final) {
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${OUT}/30-final.png` });
      console.log('FINAL', JSON.stringify(st.score), 'plays', plays, 'throws', throws, 'secs', ((Date.now() - t0) / 1000).toFixed(0));
      break;
    }
    if (await click('[data-action=ready]')) continue;
    if (st.phase === 'half') { await page.screenshot({ path: `${OUT}/29-half.png` }); await click('[data-action=continue]'); continue; }
    if (st.phase === 'pat') { await click('[data-action=pat][data-choice=xp]') || await click('[data-action=pat][data-choice="2pt"]'); continue; }
    if (st.phase === 'kickchoice') { await click('[data-action=kickoff][data-choice=onside]'); continue; }
    if (st.phase === 'presnap') {
      const fg = await page.$('[data-action=call][data-kind=fg]');
      const punt = await page.$('[data-action=call][data-kind=punt]');
      if (fg) await fg.click(); else if (punt) await punt.click();
      else await click(`[data-action=call][data-kind=${Math.random() < 0.3 ? 'run' : 'pass'}]`);
      plays++;
      continue;
    }
    if (st.phase === 'kick' && st.kickNeed) {
      const x = VW / 2, y = VH * 0.3, dy = Math.min(1.05, st.kickNeed + 0.07) * VH * 0.42;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(x, y + (dy * i) / 6); await page.waitForTimeout(16); }
      await page.mouse.up();
      continue;
    }
    if (st.drag) {
      const sx = VW * 0.8, sy = VH * 0.5;
      await page.mouse.move(sx, sy); await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(sx - (st.drag.dx * i) / 6, sy - (st.drag.dy * i) / 6); await page.waitForTimeout(16); }
      await page.mouse.up();
      throws++;
      if (shots < 3) { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/2${5 + shots}-throw.png` }); shots++; }
      continue;
    }
    await page.waitForTimeout(120);
  }
  const s = await page.evaluate(() => RB.App.G && RB.App.G.g.stats);
  console.log(JSON.stringify(s));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
