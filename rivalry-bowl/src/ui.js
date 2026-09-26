/* Rivalry Bowl: DOM screens and in-game controls. Pure rendering of HTML;
 * every button carries data-action, handled by main.js. */
(function (root) {
  'use strict';
  const RB = root.RB;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let screenEl, controlsEl, hintEl, pauseEl, padEl;
  let screenKey = null, controlsKey = null, hintKey = null, padKey = null;

  function init() {
    screenEl = document.getElementById('screen');
    controlsEl = document.getElementById('controls');
    hintEl = document.getElementById('hint');
    pauseEl = document.getElementById('pause');
    padEl = document.getElementById('pad');
  }

  function stars(v) {
    const full = Math.floor(v), half = v - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '<span class="muted">' + '☆'.repeat(5 - full - (half ? 1 : 0)) + '</span>';
  }

  function seg(id, label, value, options) {
    return `<div class="setting"><span>${label}</span><div class="seg" role="group" aria-label="${esc(label)}">${options
      .map(([v, l]) => `<button type="button" data-action="set" data-key="${id}" data-val="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`)
      .join('')}</div></div>`;
  }

  // --- Screens ------------------------------------------------------------------
  function title(s) {
    return `<div class="title">
      <h1 class="logo">RIVALRY<span class="b">BOWL</span></h1>
      <p class="tag">Head-to-head college football. Pull back to throw, race for the end zone, hand the phone over.</p>
      <div class="menu">
        <button class="btn big" type="button" data-action="local">Pass &amp; Play<small>One phone. You each drive on offense and swap on every change of possession.</small></button>
        <button class="btn big alt" type="button" data-action="online">Online<small>Two phones. The defense picks the coverage and steers a safety.</small></button>
      </div>
      <div class="panel settings">
        ${seg('qlen', 'QUARTER LENGTH', s.qlen, [[120, '2 MIN'], [180, '3'], [240, '4'], [300, '5'], [420, '7']])}
        ${seg('diff', 'AI DEFENSE', s.diff, [[0, 'EASY'], [1, 'NORMAL'], [2, 'HARD']])}
        ${seg('even', 'TEAM RATINGS', s.even ? 1 : 0, [[0, 'REAL'], [1, 'EVEN']])}
        ${seg('assist', 'AIM ASSIST', s.assist === false ? 0 : 1, [[1, 'ON'], [0, 'OFF']])}
        ${seg('sound', 'SOUND', s.sound ? 1 : 0, [[1, 'ON'], [0, 'OFF']])}
      </div>
      <div class="row"><button class="btn ghost" type="button" data-action="howto">How to play</button></div>
    </div>`;
  }

  function teams(step, picks, names, even, online) {
    const who = online ? 'YOUR SCHOOL' : `PLAYER ${step + 1} · ${step === 0 ? 'HOME' : 'AWAY'}`;
    const cur = picks[step];
    const other = online ? null : picks[1 - step];
    const tiles = RB.TEAMS.map((t) => {
      const st = RB.teamStars(t, even);
      return `<button type="button" class="tile" data-action="pick" data-team="${t.id}" aria-pressed="${cur === t.id}" data-taken="${other === t.id && step === 1}">
        <span class="sw"><i style="background:${t.jersey}"></i><i style="background:${t.helmet}"></i><i style="background:${t.trim}"></i></span>
        <span class="nm">${esc(t.name)}</span><span class="st">${stars(st.ovr)}</span></button>`;
    }).join('');
    let detail = '<p class="muted">Pick a school.</p>';
    if (cur) {
      const t = RB.TEAM_BY_ID[cur];
      const st = RB.teamStars(t, even);
      const r = even ? { qb: 82, rb: 82, wr: 82, ol: 82, dl: 82, lb: 82, db: 82, k: 80 } : t.r;
      detail = `<div class="detail"><canvas id="helmet" width="9" height="12" aria-hidden="true"></canvas><div>
        <h2 style="margin-bottom:6px">${esc(t.name)}</h2>
        <p>OFF ${stars(st.off)}<br>DEF ${stars(st.def)}</p>
        <div class="ratings"><span>QB <b>${r.qb}</b></span><span>RB <b>${r.rb}</b></span><span>WR <b>${r.wr}</b></span><span>OL <b>${r.ol}</b></span>
        <span>DL <b>${r.dl}</b></span><span>LB <b>${r.lb}</b></span><span>DB <b>${r.db}</b></span><span>K <b>${r.k}</b></span></div>
        <p class="eyebrow" style="margin:10px 0 4px">KEY PLAYERS</p>
        <ul class="keys">${RB.keyPlayers(RB.buildRoster(t, even)).map((p) => `<li><b>${esc(p.pos)} #${p.num}</b> ${esc(p.name)}${p.star ? ` <i>${esc(p.star)}</i>` : ''}<br><span>${p.show.map(([k, v]) => `${k} <b>${v}</b>`).join(' · ')}</span></li>`).join('')}</ul></div></div>`;
    }
    return `<div class="panel teams">
      <header><div><p class="eyebrow">${who}</p><h2 style="margin:0">Pick your school</h2></div>
        <label class="row"><span class="muted">NAME</span><input class="name-in" id="name-in" maxlength="10" value="${esc(names[step])}" autocomplete="off" spellcheck="false"></label></header>
      <div class="teams-body"><div class="grid">${tiles}</div>
      <div class="side">${detail}
      <div class="row end"><button class="btn ghost" type="button" data-action="back">Back</button>
      <button class="btn" type="button" data-action="lock" ${cur ? '' : 'disabled'}>${online ? 'Continue' : step === 0 ? 'Lock in' : 'Kick off'}</button></div></div></div>
    </div>`;
  }

  function handoff(G) {
    const g = G.g, s = g.ctl, t = RB.Game.team(G, s);
    const pat = g.afterHandoff === 'pat';
    const sit = pat ? 'Extra point try' : g.twoPt ? '2-point try' : `${RB.Game.downText(g)} at ${RB.Game.spotText(g.ballOn)}`;
    const u = G.rt.uniforms[s];
    const col = u.jersey === '#f4f4f4' ? u.trim : u.jersey;
    return `<div class="panel" style="text-align:center;border-color:${col}">
      <p class="eyebrow">PASS THE PHONE</p>
      <h2>${esc(g.names[s])}</h2>
      <p style="font-size:26px">${esc(t.name)} ball · ${esc(sit)}</p>
      <p class="muted">${esc(RB.Game.team(G, 0).name)} ${g.score[0]} · ${esc(RB.Game.team(G, 1).name)} ${g.score[1]} · ${RB.Game.periodText(g)} ${g.ot ? '' : RB.Game.fmtClock(g.clock)}</p>
      <div class="row center"><button class="btn big" type="button" data-action="ready" style="align-items:center">I have the phone</button></div>
    </div>`;
  }

  function statsTable(G) {
    const g = G.g, s = g.stats;
    const T = [RB.Game.team(G, 0), RB.Game.team(G, 1)];
    const row = (label, f) => `<tr><td>${label}</td><td>${f(s[0])}</td><td>${f(s[1])}</td></tr>`;
    return `<table class="box"><thead><tr><th></th><th>${esc(T[0].id)}</th><th>${esc(T[1].id)}</th></tr></thead><tbody>
      ${row('Passing', (x) => `${x.pc}/${x.pa}, ${x.py}`)}
      ${row('Rushing', (x) => `${x.ra}, ${x.ry}`)}
      ${row('Total yards', (x) => x.py + x.ry)}
      ${row('First downs', (x) => x.fd)}
      ${row('Turnovers', (x) => x.to)}
      ${row('Sacked', (x) => x.sk)}
      ${row('Field goals', (x) => `${x.fgm}/${x.fga}`)}
    </tbody></table>`;
  }

  function scoreBig(G) {
    const g = G.g;
    return `<div class="score-big"><span>${esc(RB.Game.team(G, 0).id)}</span><span class="s">${g.score[0]}</span><span class="muted">–</span><span class="s">${g.score[1]}</span><span>${esc(RB.Game.team(G, 1).id)}</span></div>`;
  }

  function halftime(G, canContinue) {
    return `<div class="panel"><p class="eyebrow">HALFTIME</p>${scoreBig(G)}${statsTable(G)}
      <div class="row end">${canContinue ? '<button class="btn" type="button" data-action="continue">Start 2nd half</button>' : '<span class="status">Waiting for the host to start the 2nd half</span>'}</div></div>`;
  }

  function final(G, online) {
    const g = G.g;
    const w = g.score[0] > g.score[1] ? 0 : 1;
    const ot = g.ot ? ` in ${g.ot.n > 1 ? g.ot.n + ' overtimes' : 'overtime'}` : '';
    return `<div class="panel"><p class="eyebrow">FINAL${g.ot ? ' · OT' : ''}</p>
      <h2>${esc(g.names[w])} and ${esc(RB.Game.team(G, w).name)} win${ot}</h2>
      ${scoreBig(G)}${statsTable(G)}
      <div class="row end"><button class="btn ghost" type="button" data-action="menu">Main menu</button>
      ${online ? '' : '<button class="btn" type="button" data-action="rematch">Rematch</button>'}</div></div>`;
  }

  function pause(online) {
    return `<div class="panel" style="max-width:360px"><p class="eyebrow">PAUSED</p>
      <p class="muted">${online ? 'The game keeps running for your opponent.' : 'The clock is stopped.'}</p>
      <div class="stack"><button class="btn" type="button" data-action="resume">Resume</button>
      <button class="btn ghost" type="button" data-action="quit">Quit game</button></div></div>`;
  }

  function howto() {
    return `<div class="panel howto"><p class="eyebrow">HOW TO PLAY</p>
      <dl>
        <dt>SNAP</dt><dd>Pick PASS or RUN. The ball is snapped right away. On 4th down you can also punt or kick a field goal.</dd>
        <dt>THROW</dt><dd>Touch anywhere and pull <b>back</b>, away from the end zone, like a slingshot. The dotted arc shows where the ball will land. Release to throw. Lead your receiver: the ball goes where you aim, not where he is now.</dd>
        <dt>READ</dt><dd>Before the snap, the key in the corner shows who runs each colored route and his best ratings (SPD speed, HND hands, ARM and ACC for the QB). A * marks a star.</dd>
        <dt>MOVE</dt><dd>The joystick sits in the bottom-left corner. The QB moves with it in the pocket (cross the line and he can't throw). After a catch or handoff the runner keeps going upfield until you steer him. JUKE and DIVE are the buttons on the right.</dd>
        <dt>KICK</dt><dd>Drag down for power and sideways to aim (the ball goes the opposite way). Clear the white line on the power bar and watch the wind.</dd>
        <dt>HEAD TO HEAD</dt><dd>Pass &amp; Play: each of you plays your own offense against the computer's defense; hand the phone over on every change of possession. Online: the defense player calls the coverage and taps any defender to take him over. Touch the stick and he's yours with no delay (let go and he stops); SWITCH jumps to the defender nearest the ball, DIVE lays out for a tackle, or at a pass to knock it away or pick it off. Throwing into tight coverage gets intercepted.</dd>
        <dt>CLOCK</dt><dd>The clock runs between plays after tackles in bounds. Snap quickly to save time. Incompletions, out of bounds, scores and timeouts stop it. Overtime uses college rules.</dd>
      </dl>
      <div class="row end"><button class="btn" type="button" data-action="back">Got it</button></div></div>`;
  }

  // --- Mounting helpers -----------------------------------------------------------
  function show(key, html, clear) {
    if (key === screenKey) return false;
    screenKey = key;
    if (!html) {
      screenEl.hidden = true;
      screenEl.innerHTML = '';
      return true;
    }
    screenEl.hidden = false;
    screenEl.className = 'screen' + (clear ? ' clear' : '');
    screenEl.innerHTML = html;
    screenEl.scrollTop = 0;
    return true;
  }
  function controls(key, html, portrait) {
    if (key === controlsKey) return;
    controlsKey = key;
    controlsEl.hidden = !html;
    controlsEl.className = portrait ? 'portrait' : '';
    controlsEl.innerHTML = html || '';
  }
  function hint(text) {
    if (text === hintKey) return;
    hintKey = text;
    hintEl.hidden = !text;
    hintEl.textContent = text || '';
  }
  // Action buttons beside the joystick (JUKE / DIVE / SWITCH). They act on
  // pointerdown, so they respond instantly and work while the other thumb steers.
  const PAD_LABEL = { juke: 'JUKE', dive: 'DIVE', switch: 'SWITCH' };
  function pad(list) {
    const key = list ? list.join() : '';
    if (key === padKey) return;
    padKey = key;
    padEl.hidden = !list || !list.length;
    padEl.innerHTML = (list || []).map((a) => `<button class="pad-btn pad-${a}" type="button" data-pad="${a}">${PAD_LABEL[a]}</button>`).join('');
  }
  function showPause(v) {
    pauseEl.hidden = !v;
  }
  function invalidate() {
    screenKey = null;
    controlsKey = null;
    padKey = null;
  }

  RB.UI = { init, show, controls, hint, pad, showPause, invalidate, esc, title, teams, handoff, halftime, final, pause, howto, stars };
})(typeof window !== 'undefined' ? window : globalThis);
