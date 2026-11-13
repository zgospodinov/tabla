/* Режим „Стратегии“ — симулации ход по ход с обяснения. */
(function (root) {
  'use strict';
  const E = root.TablaEngine, B = root.TablaBoard, C = root.TablaStratCore;
  const DATA = root.TablaStratData || [];
  const SND = root.TablaSound || { move() {}, dice() {}, hit() {}, bearoff() {} };
  const SPEEDS = { slow: 10000, normal: 6500, fast: 3500 };
  const COLORS = ['#5aa0ff', '#f39c12'];
  const WHO = ['⚪ Белите', '⚫ Черните'];

  let el = null;
  const compiled = new Map();
  const S = { id: null, k: 0, playing: false, speed: 'normal', anim: null };
  let timer = null, animTimer = null;

  function loadSpeed() { try { const v = localStorage.getItem('tabla-strat-speed'); if (SPEEDS[v]) S.speed = v; } catch (e) { /* няма хранилище */ } }
  function saveSpeed() { try { localStorage.setItem('tabla-strat-speed', S.speed); } catch (e) { /* няма хранилище */ } }

  function strat(id) { return DATA.find((s) => s.id === id); }
  function comp(id) {
    if (!compiled.has(id)) {
      try { compiled.set(id, C.compile(strat(id))); } catch (e) { console.error(e); compiled.set(id, null); }
    }
    return compiled.get(id);
  }
  const list = (arr) => `<ul>${arr.map((x) => `<li>${x}</li>`).join('')}</ul>`;

  // ---------- изглед ----------
  function overviewHtml() {
    return `<div class="strat-top">
      <h1>Стратегии</h1>
      <p class="lead">Пет известни стратегии в обикновената табла. Всяка е симулация: пуснете я и гледайте ход по ход — с какви зарове, какво се играе и защо. Можете да спирате, да се връщате и да прескачате към всеки ход.</p>
      <div class="cards strat-cards">
        ${DATA.map((s) => `<a class="mode-card strat-card" href="#s-${s.id}">
          <div class="ic">${s.icon}</div><h2>${s.title}</h2><p class="en">${s.en}</p>
          <p>${s.short}</p><span class="go">Пусни симулацията →</span></a>`).join('')}
      </div>
      <div class="card tip"><h4>Как да избера стратегия?</h4>
        <ul>
          <li><b>Водя в пиповете</b> → бягаща игра: изведи задните пулове и не търси контакт.</li>
          <li><b>Противникът има задни пулове, а аз имам много строители</b> → прайм или блиц.</li>
          <li><b>Противникът е на бара, а неговият дом е слаб</b> → блиц.</li>
          <li><b>Изоставам, но имам котва на точка 20 или 18</b> → задържаща игра.</li>
          <li><b>Изоставам много и имам две котви дълбоко</b> → обратна игра (последна мярка).</li>
        </ul>
        <p class="muted">По време на игра стратегията се сменя често: бягаща игра може да стане задържаща, а блиц — прайм. Важното е да оценявате позицията след всеки ход.</p>
      </div>
    </div>`;
  }

  function tabsHtml() {
    return `<nav class="toc strat-tabs" aria-label="Стратегии">${DATA.map((s) => `<a href="#s-${s.id}" class="${s.id === S.id ? 'on' : ''}" ${s.id === S.id ? 'aria-current="page"' : ''}>${s.icon} ${s.title}</a>`).join('')}</nav>`;
  }

  function playerShell(s, c) {
    return `<div class="strat-top">${tabsHtml()}</div>
    <div class="play strat-play">
      <div class="board-wrap">
        <div id="strat-board"></div>
        <button class="fs-btn" data-fs title="Цял екран — F, изход с Esc" aria-label="Цял екран"><span class="i-on">⛶</span><span class="i-off">✕</span></button>
        <div class="strat-controls" role="group" aria-label="Управление на симулацията">
          <button class="btn" data-sc="first" title="В началото">⏮<span class="sr"> В началото</span></button>
          <button class="btn" data-sc="prev" title="Назад (←)">◀<span class="lbl"> Назад</span></button>
          <button class="btn primary" data-sc="play" id="strat-playbtn"></button>
          <button class="btn" data-sc="next" title="Напред (→)"><span class="lbl">Напред </span>▶</button>
          <label class="speed">Темпо <select data-sc="speed">
            ${[['slow', 'Бавно'], ['normal', 'Нормално'], ['fast', 'Бързо']].map(([v, t]) => `<option value="${v}" ${S.speed === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
        </div>
        <div class="strat-progress" aria-hidden="true"><div id="strat-bar"></div></div>
      </div>
      <aside class="panel" id="strat-panel" aria-live="polite"></aside>
    </div>`;
  }

  function diceFor(st) {
    const d = st.dice, dbl = d[0] === d[1];
    return (dbl ? [d[0], d[0], d[0], d[0]] : d).map((v) => ({ v, p: st.p }));
  }

  function boardView(s, c) {
    if (S.k === 0) return { board: c.start, dice: [], arrows: [] };
    const st = c.steps[S.k - 1];
    const pre = S.anim === 'pre';
    return {
      board: pre ? st.before : st.after,
      dice: diceFor(st),
      diceSide: st.p === 0 ? 'right' : 'left',
      arrows: pre ? [] : B.arrowsForPlay(st.before, st.p, st.moves, COLORS[st.p]),
    };
  }

  function pipLine(b) {
    const w = E.pip(b, 0), k = E.pip(b, 1), d = Math.abs(w - k);
    const lead = d === 0 ? 'равни' : `${w < k ? 'белите' : 'черните'} водят с ${d}`;
    const off = [E.offCount(b, 0), E.offCount(b, 1)];
    return `<div class="pips">Пипове: ⚪ ${w} · ⚫ ${k} (${lead})${off[0] || off[1] ? ` · Извадени: ⚪ ${off[0]} · ⚫ ${off[1]}` : ''}${E.isContact(b) ? '' : ' · <b>без контакт</b>'}</div>`;
  }

  function stepTitle(st) {
    const d = `${st.dice[0]}–${st.dice[1]}`;
    if (!st.moves.length) return `${WHO[st.p]} хвърлят <b>${d}</b> и нямат ход`;
    return `${WHO[st.p]} хвърлят <b>${d}</b> и играят <b>${st.notation}</b>`;
  }

  function panelHtml(s, c) {
    const N = c.steps.length;
    let h = `<div class="panel-head"><span class="mode-tag strat">${s.icon} ${s.title}</span><span class="muted">${s.en}</span></div>`;
    const about = `<p>${s.idea}</p>
      <h5>Кога да я избера</h5>${list(s.when)}
      <h5>Как се играе</h5>${list(s.how)}
      <h5>Рискове</h5>${list(s.risks)}`;
    if (S.k === 0) {
      h += `<div class="card about"><h4>Идеята</h4>${about}</div>`;
      h += `<div class="status"><p class="big">Начална позиция</p><p>${s.setupText}</p>${pipLine(c.start)}
        <p class="muted">Натиснете <b>▶ Пусни</b> или <b>Напред</b>. Сините стрелки показват ходовете на белите, оранжевите — на черните.</p></div>`;
    } else {
      const st = c.steps[S.k - 1];
      h += `<div class="status step-card ${st.p ? 'black' : 'white'}">
        <div class="step-meta"><span class="muted">Ход ${S.k} от ${N}</span>${st.phase ? `<span class="phase">${st.phase}</span>` : ''}</div>
        <p class="big">${stepTitle(st)}</p>
        <p>${st.text}</p>${S.anim === 'pre' ? '' : pipLine(st.after)}</div>`;
      if (S.k === N) {
        h += `<div class="card verdict"><h4>Изводът</h4><p>${s.summary}</p>
          <div class="btns"><button class="btn" data-sc="first">⏮ Отначало</button>${nextStratBtn()}<a class="btn primary" href="#training">Пробвай в тренировка</a></div></div>`;
      }
      h += `<details class="card about"><summary>За стратегията</summary>${about}</details>`;
    }
    h += `<div class="card"><h4>Всички ходове</h4><ol class="timeline">
      <li class="${S.k === 0 ? 'on' : ''}" data-k="0" tabindex="0">Начална позиция</li>
      ${c.steps.map((st, i) => `<li class="${S.k === i + 1 ? 'on' : ''} ${st.p ? 'tb' : 'tw'}" data-k="${i + 1}" tabindex="0"><span class="n">${i + 1}.</span> ${st.p ? '⚫' : '⚪'} ${st.dice[0]}–${st.dice[1]} <b>${st.notation}</b>${st.phase ? ` <span class="ph">${st.phase}</span>` : ''}</li>`).join('')}
    </ol></div>`;
    return h;
  }

  function nextStratBtn() {
    const i = DATA.findIndex((s) => s.id === S.id);
    const n = DATA[(i + 1) % DATA.length];
    return `<a class="btn" href="#s-${n.id}">Следваща: ${n.title} →</a>`;
  }

  function render(scrollList) {
    if (!el || !S.id) return;
    const s = strat(S.id), c = comp(S.id);
    if (!c) return;
    el.querySelector('#strat-board').innerHTML = B.svg(boardView(s, c));
    const panel = el.querySelector('#strat-panel');
    const open = panel.querySelector('details.about[open]');
    panel.innerHTML = panelHtml(s, c);
    if (open) { const d = panel.querySelector('details.about'); if (d) d.open = true; }
    const pb = el.querySelector('#strat-playbtn');
    const atEnd = S.k >= c.steps.length;
    pb.innerHTML = S.playing ? '⏸ Пауза' : atEnd ? '↺ Отначало' : '▶ Пусни';
    pb.setAttribute('aria-pressed', String(S.playing));
    el.querySelector('[data-sc="prev"]').disabled = S.k === 0;
    el.querySelector('[data-sc="first"]').disabled = S.k === 0;
    el.querySelector('[data-sc="next"]').disabled = atEnd;
    el.querySelector('#strat-bar').style.width = (100 * S.k / c.steps.length) + '%';
    if (scrollList) {
      const li = panel.querySelector('.timeline li.on');
      const ol = panel.querySelector('.timeline');
      if (li && ol) ol.scrollTop = li.offsetTop - ol.offsetTop - ol.clientHeight / 2;
    }
  }

  // ---------- звук ----------
  function soundsFor(st) {
    st.moves.reduce((b, m, i) => {
      const a = E.applyMove(b, st.p, m);
      if (a[1 - st.p][24] > b[1 - st.p][24]) SND.hit(i * 0.2);
      else if (E.offCount(a, st.p) > E.offCount(b, st.p)) SND.bearoff(i * 0.2);
      else SND.move(i * 0.2);
      return a;
    }, st.before);
  }

  // ---------- управление ----------
  function clearTimers() { clearTimeout(timer); clearTimeout(animTimer); timer = animTimer = null; }
  function go(k, animate) {
    const c = comp(S.id);
    if (!c) return;
    k = Math.max(0, Math.min(c.steps.length, k));
    clearTimeout(animTimer);
    S.k = k;
    if (animate && k > 0) {
      const st = c.steps[k - 1];
      S.anim = 'pre';
      SND.dice();
      render(true);
      animTimer = setTimeout(() => {
        S.anim = null;
        if (st.moves.length) soundsFor(st);
        render(false);
        schedule();
      }, 750);
    } else {
      S.anim = null;
      render(true);
      schedule();
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!S.playing) return;
    const c = comp(S.id);
    if (S.k >= c.steps.length) { S.playing = false; render(false); return; }
    const st = S.k > 0 ? c.steps[S.k - 1] : null;
    const base = SPEEDS[S.speed];
    // по-дълъг текст → повече време за четене
    const wait = st ? Math.max(base * 0.6, base * Math.min(1.6, st.text.length / 260)) : base * 0.6;
    timer = setTimeout(() => go(S.k + 1, true), wait);
  }
  function togglePlay() {
    const c = comp(S.id);
    if (S.playing) { S.playing = false; clearTimeout(timer); render(false); return; }
    S.playing = true;
    if (S.k >= c.steps.length) go(0, false);
    else go(S.k + 1, true);
  }

  function onClick(e) {
    const b = e.target.closest('[data-sc]');
    if (b && b.tagName !== 'SELECT') {
      const a = b.dataset.sc;
      if (a === 'play') togglePlay();
      else if (a === 'next') { S.playing = false; go(S.k + 1, true); }
      else if (a === 'prev') { S.playing = false; go(S.k - 1, false); }
      else if (a === 'first') { S.playing = false; go(0, false); }
      return;
    }
    const li = e.target.closest('.timeline li[data-k]');
    if (li) { S.playing = false; go(Number(li.dataset.k), false); }
  }
  function onKey(e) {
    if (!el || !S.id || el.closest('[hidden]')) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const li = e.target.closest && e.target.closest('.timeline li[data-k]');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); S.playing = false; go(Number(li.dataset.k), false); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); S.playing = false; go(S.k + 1, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); S.playing = false; go(S.k - 1, false); }
  }

  function open(id) {
    if (!el) return;
    stop();
    if (!id || !strat(id) || !comp(id)) {
      S.id = null;
      el.innerHTML = overviewHtml();
      return;
    }
    if (S.id !== id) { S.id = id; S.k = 0; }
    el.innerHTML = playerShell(strat(id), comp(id));
    S.anim = null;
    render(true);
  }
  function stop() {
    S.playing = false;
    clearTimers();
    if (S.anim) { S.anim = null; render(false); }
  }

  function mount(node) {
    el = node;
    loadSpeed();
    el.addEventListener('click', onClick);
    el.addEventListener('change', (e) => {
      if (e.target.dataset.sc === 'speed') { S.speed = e.target.value; saveSpeed(); if (S.playing) schedule(); }
    });
    document.addEventListener('keydown', onKey);
  }

  root.TablaStrategies = { mount, open, stop, state: () => S };
})(window);
