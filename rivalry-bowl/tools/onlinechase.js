// The defense chases a ball carrier with the stick and dives at him. Checks
// that the steered defender never jumps (largest move between two frames on
// the defense phone), and reports how often the chase ends in a tackle by him.
// MOCK=1 [ISOLATED=1 DB=1] node tools/onlinechase.js
'use strict';
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8765);
const REPS = +(process.env.REPS || 4);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.addInitScript(`window.__mockIsolated = ${!!process.env.ISOLATED}; window.__mockDb = ${!!process.env.DB};`);
  await ctx.addInitScript({ path: require('path').join(__dirname, 'mockclaude.js') });
  const A = await ctx.newPage(), B = await ctx.newPage();
  const errors = [];
  for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', (e) => errors.push(n + ' ' + e.message));
  const url = `http://127.0.0.1:${PORT}/index.html`;
  await A.goto(url); await B.goto(url); await A.waitForTimeout(500);
  for (const [p, t] of [[A, 'LSU'], [B, 'CLEM']]) { await p.click('[data-action=online]'); await p.click(`[data-team=${t}]`); await p.click('[data-action=lock]'); }
  for (const p of [A, B]) { await p.waitForSelector('[data-action=allow]'); await p.click('[data-action=allow]'); }
  for (const p of [A, B]) await p.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 25000 });
  let off = null, def = null;
  for (let i = 0; i < 400 && !off; i++) {
    for (const [p, q] of [[A, B], [B, A]]) if (await p.evaluate(() => RB.App.net.isAuthority() && RB.App.G.g.phase === 'presnap' && RB.App.G.g.poss === RB.App.net.seat)) { off = p; def = q; break; }
    await A.waitForTimeout(100);
  }
  const joyC = await def.evaluate(() => { const h = document.getElementById('game').getBoundingClientRect().height; return { x: RB.Input.JOY_M + RB.Input.JOY_R, y: h - RB.Input.JOY_M - RB.Input.JOY_R }; });
  const out = [];
  for (let rep = 0; rep < REPS; rep++) {
    await off.waitForFunction(() => RB.App.G.g.phase === 'presnap' && RB.App.G.g.poss === RB.App.net.seat, null, { timeout: 40000 });
    await off.waitForTimeout(1200);
    await def.evaluate(() => {
      window.__trace = [];
      const orig = RB.Render.frame;
      window.__origFrame = orig;
      RB.Render.frame = function (V, dt) { orig.call(this, V, dt); const o = RB.App.net.own; if (o) window.__trace.push([o.x, o.y, o.lunge > 0 ? 1 : 0, o.fall > 0 ? 1 : 0]); };
    });
    await off.click('[data-action=call][data-kind=run]');
    await def.waitForFunction(() => RB.App.net.inputContext() === 'def', null, { timeout: 5000 }).catch(() => {});
    await def.waitForTimeout(700);
    // Take the free defender nearest the ball, then chase with the stick.
    await def.dispatchEvent('[data-pad=switch]', 'pointerdown').catch(() => {});
    await def.mouse.move(joyC.x, joyC.y); await def.mouse.down();
    let dived = false;
    for (let k = 0; k < 90; k++) {
      const st = await def.evaluate(() => {
        const n = RB.App.net, s = n.interpSnap();
        if (!s || !s.live || s.carrier < 0) return null;
        const c = s.players[s.carrier], o = n.own || s.players[n.defIdx];
        return { dx: c.x - o.x, dy: c.y - o.y, sx: RB.Render.R.SX, sy: RB.Render.R.SY };
      });
      if (!st) break;
      const px = st.dx * st.sx, py = st.dy * st.sy, l = Math.hypot(px, py) || 1;
      await def.mouse.move(joyC.x + (px / l) * 40, joyC.y + (py / l) * 40);
      if (!dived && Math.hypot(st.dx, st.dy) < 2.6) { dived = true; await def.dispatchEvent('[data-pad=dive]', 'pointerdown').catch(() => {}); }
      await def.waitForTimeout(40);
    }
    await def.mouse.up();
    await off.waitForFunction(() => RB.App.G.g.phase !== 'play', null, { timeout: 15000 }).catch(() => {});
    const res = await off.evaluate(() => { const r = RB.App.G.rt.lastResult || (RB.App.G.rt.play && RB.App.G.rt.play.result); const pl = RB.App.G.rt.play; return r ? { kind: r.kind, yds: r.yds, byMe: pl ? pl.stats.tackler === pl.humanDefIdx : null } : null; });
    const tr = await def.evaluate(() => { RB.Render.frame = window.__origFrame; return window.__trace; });
    let maxJump = 0;
    for (let i = 1; i < tr.length; i++) maxJump = Math.max(maxJump, Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]));
    out.push({ dived, frames: tr.length, maxJumpYd: +maxJump.toFixed(2), result: res });
  }
  console.log(JSON.stringify({ link: await A.evaluate(() => RB.App.net.t.kind), out }));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
