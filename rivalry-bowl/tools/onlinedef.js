// Online defense over the mock runtime: tap-to-switch, hold-to-steer target,
// sticky coverage call and the round-trip readout. ISOLATED=1 DB=1 forces the backup link.
'use strict';
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/shots';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.addInitScript(`window.__mockIsolated = ${!!process.env.ISOLATED}; window.__mockDb = ${!!process.env.DB};`);
  await ctx.addInitScript({ path: require('path').join(__dirname, 'mockclaude.js') });
  const A = await ctx.newPage(), B = await ctx.newPage();
  const errors = [];
  for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', (e) => errors.push(n + ' ' + e.message));
  const url = `http://127.0.0.1:${process.env.PORT || 8765}/index.html`;
  await A.goto(url); await B.goto(url); await A.waitForTimeout(500);
  for (const [p, t] of [[A, 'LSU'], [B, 'CLEM']]) { await p.click('[data-action=online]'); await p.click(`[data-team=${t}]`); await p.click('[data-action=lock]'); }
  for (const p of [A, B]) { await p.waitForSelector('[data-action=allow]'); await p.click('[data-action=allow]'); }
  await A.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 25000 });
  await B.waitForFunction(() => RB.App.screen === 'game', null, { timeout: 25000 });
  // Find offense (authority in presnap) and defense.
  let off = null, def = null;
  for (let i = 0; i < 200 && !off; i++) {
    for (const [p, q] of [[A, B], [B, A]]) if (await p.evaluate(() => RB.App.net.isAuthority() && RB.App.G.g.phase === 'presnap' && RB.App.G.g.poss === RB.App.net.seat)) { off = p; def = q; break; }
    await A.waitForTimeout(100);
  }
  await def.waitForSelector('[data-action=defcall][data-call=blitz]');
  await def.click('[data-action=defcall][data-call=blitz]');
  await off.waitForTimeout(900);
  const call1 = await off.evaluate(() => RB.App.G.g.defCall);
  await off.click('[data-action=call][data-kind=pass]');
  await def.waitForFunction(() => RB.App.net.snap && RB.App.net.snap.live, null, { timeout: 5000 });
  // Tap on a safety to take him over.
  const sPos = await def.evaluate(() => { const s = RB.App.net.interpSnap(), p = s.players[20], k = RB.Render.R.k; return { x: RB.Render.sx(p.x) * k, y: (RB.Render.sy(p.y) - 8) * k }; });
  await def.mouse.click(sPos.x, sPos.y);
  await def.waitForTimeout(150);
  const picked = await def.evaluate(() => RB.App.net.defIdx);
  // Hold a finger: the defender should head for it on the offense's phone.
  const target = await def.evaluate(() => { const k = RB.Render.R.k; return { x: 600, y: 300, w: RB.Render.toWorld(600 / k, 300 / k) }; });
  const before = await off.evaluate((w) => { const G = RB.App.G, p = G.rt.play.players[G.rt.play.humanDefIdx]; return { dist: Math.hypot(p.x - w.x, p.y - w.y).toFixed(1), eng: p.eng }; }, target.w);
  await def.mouse.move(target.x, target.y); await def.mouse.down();
  await def.waitForTimeout(1200);
  const seen = await off.evaluate((w) => { const G = RB.App.G, p = G.rt.play.players[G.rt.play.humanDefIdx]; return { idx: G.rt.play.humanDefIdx, dist: Math.hypot(p.x - w.x, p.y - w.y).toFixed(1) }; }, target.w);
  await def.screenshot({ path: `${OUT}/80-def-steer.png` });
  await def.mouse.up();
  // Wait for the next pre-snap and check the call carried over.
  await off.waitForFunction(() => RB.App.G.g.phase === 'presnap' || RB.App.G.g.poss !== RB.App.net.seat, null, { timeout: 20000 });
  await off.waitForTimeout(1500);
  const call2 = await off.evaluate(() => ({ phase: RB.App.G.g.phase, call: RB.App.G.g.defCall, stillOffense: RB.App.G.g.poss === RB.App.net.seat }));
  const info = await def.evaluate(() => RB.App.net.netInfo());
  console.log(JSON.stringify({ link: await A.evaluate(() => RB.App.net.t.kind), call1, picked, before, seen, call2, info }));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
