/* Табла — приложение: режими, ход на играта, подсказки. */
(function () {
  'use strict';
  const E = window.TablaEngine, B = window.TablaBoard;
  const HUMAN = 0, CPU = 1;
  const $ = (s) => document.querySelector(s);
  const QCOLOR = { 'q-best': '#2e9e4f', 'q-good': '#7cb342', 'q-ok': '#f0a020', 'q-weak': '#e06020', 'q-bad': '#d32f2f' };
  const SPEED = { slow: 1600, normal: 800, fast: 350 };

  function load(k, def) { try { const v = localStorage.getItem(k); return v ? Object.assign({}, def, JSON.parse(v)) : def; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* няма хранилище */ } }
  const settings = load('tabla-settings', { trainLevel: 'normal', gameLevel: 'normal', trainSpeed: 'slow', gameSpeed: 'normal', sound: true });
  const score = load('tabla-score', { training: { you: 0, cpu: 0 }, game: { you: 0, cpu: 0 } });

  const SND = window.TablaSound || { move() {}, dice() {}, hit() {}, bearoff() {} };
  SND.enabled = settings.sound !== false;
  // звук за един ход: удар, изваждане или обикновено местене
  function moveSound(before, after, p, delay) {
    if (after[1 - p][24] > before[1 - p][24]) SND.hit(delay);
    else if (E.offCount(after, p) > E.offCount(before, p)) SND.bearoff(delay);
    else SND.move(delay);
  }

  let G = null;
  let timer = null;
  const rollDie = () => 1 + Math.floor(Math.random() * 6);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------- навигация ----------------
  // ---------------- цял екран ----------------
  // Опитваме истински цял екран; ако браузърът откаже, остава режимът „на цял прозорец“ (CSS).
  let realFs = false;
  function setFs(on) {
    const body = document.body;
    if (on === body.classList.contains('fs')) return;
    body.classList.toggle('fs', on);
    if (on) {
      const de = document.documentElement;
      if (de.requestFullscreen) de.requestFullscreen().then(() => { realFs = true; }).catch(() => { realFs = false; });
    } else if (realFs && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (!on) realFs = false;
    window.scrollTo(0, 0);
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && realFs) { realFs = false; setFs(false); } });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-fs]')) setFs(!document.body.classList.contains('fs')); });
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const inMode = !$('#view-play').hidden || (!$('#view-strategies').hidden && document.querySelector('#strat-board'));
    if (e.key === 'Escape' && document.body.classList.contains('fs') && !realFs) setFs(false);
    else if ((e.key === 'f' || e.key === 'F' || e.key === 'ф' || e.key === 'Ф') && !e.ctrlKey && !e.metaKey && !e.altKey && inMode) setFs(!document.body.classList.contains('fs'));
  });

  function showView(name) {
    if (name !== 'strategies' && window.TablaStrategies) window.TablaStrategies.stop();
    for (const v of ['home', 'play', 'rules', 'strategies']) $('#view-' + v).hidden = v !== name;
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === (name === 'play' ? G && G.mode : name)));
    window.scrollTo(0, 0);
  }
  function route() {
    const h = (location.hash || '#home').slice(1);
    if (h === 'training' || h === 'game') {
      if (!G || G.mode !== h) newGame(h);
      showView('play');
      render();
    } else if (h === 'rules' || h.startsWith('r-')) {
      clearTimeout(timer); showView('rules');
      const el = h !== 'rules' && document.getElementById(h);
      if (el) el.scrollIntoView();
    }
    else if (h === 'strategies' || h.startsWith('s-')) {
      clearTimeout(timer); showView('strategies');
      if (window.TablaStrategies) window.TablaStrategies.open(h === 'strategies' ? null : h.slice(2));
    }
    else { showView('home'); }
    const fsOk = h === 'training' || h === 'game' || h.startsWith('s-');
    if (!fsOk) setFs(false);
  }

  // ---------------- игра ----------------
  function newGame(mode) {
    clearTimeout(timer);
    G = {
      mode, training: mode === 'training', board: E.initialBoard(), phase: 'opening', dice: null, turn: null,
      selected: null, destMap: null, preview: null, hoverPlay: null, pinPlay: null, showAll: false,
      log: [], lastCpu: null, notes: [], msg: null, openingDice: null, hint: null, winner: null,
    };
    if (G.training) {
      addLog('rule', 'Добре дошли в <b>тренировъчния режим</b>! Вие играете с <b>белите</b> пулове и се движите от точка 24 към точка 1 (обратно на часовника), като събирате пуловете в своя дом — долу вдясно (точки 1–6). Компютърът играе с черните в обратна посока.');
      addLog('rule', '<b>Начало на играта:</b> всеки хвърля по един зар. Който има по-голямо число, започва и играе двете хвърлени числа. При равенство се хвърля отново.');
    } else {
      addLog('info', 'Нова игра. Хвърлете за начало — по-високият зар започва.');
    }
  }

  function addLog(type, html) { G.log.unshift({ type, html }); if (G.log.length > 60) G.log.pop(); }
  const speed = () => SPEED[G.training ? settings.trainSpeed : settings.gameSpeed] || 800;
  const level = () => (G.training ? settings.trainLevel : settings.gameLevel);

  function openingRoll() {
    const a = rollDie(), c = rollDie();
    G.openingDice = [a, c];
    SND.dice();
    if (a === c) {
      addLog('rule', `И двамата хвърлихте <b>${a}</b>. При равенство се хвърля отново.`);
      render();
      return;
    }
    if (a > c) {
      addLog(G.training ? 'rule' : 'info', `Вие хвърлихте <b>${a}</b>, компютърът — <b>${c}</b>. Вие започвате и играете ${a} и ${c}.`);
      startHumanTurn([a, c]);
    } else {
      addLog(G.training ? 'rule' : 'info', `Компютърът хвърли <b>${c}</b>, вие — <b>${a}</b>. Компютърът започва и играе ${c} и ${a}.`);
      startCpuTurn([c, a]);
    }
  }

  function startHumanTurn(dice) {
    G.dice = dice;
    const info = E.analyzeTurn(G.board, HUMAN, dice);
    G.turn = { startBoard: G.board, rem: info.rem.slice(), moves: [], boards: [], maxLen: info.maxLen, forcedDie: info.forcedDie, plays: info.plays };
    G.selected = null; G.preview = null; G.hoverPlay = null; G.pinPlay = null; G.hint = null; G.msg = null; G.showAll = false;
    G.notes = E.turnNotes(G.board, HUMAN, dice, info.plays, info.maxLen, info.forcedDie);
    G.phase = info.maxLen === 0 ? 'human-nomove' : 'human-move';
    if (info.maxLen === 0) addLog('you', `Хвърлихте ${dice[0]}–${dice[1]} — няма възможен ход.`);
    render();
  }

  const needed = () => G.turn.maxLen - G.turn.moves.length;
  function currentSteps() {
    return E.legalSteps(G.board, HUMAN, G.turn.rem, needed(), G.turn.moves.length === 0 ? G.turn.forcedDie : null);
  }
  const bestScore = () => (G.turn.plays.length ? G.turn.plays[0].score : 0);

  /** Най-добро завършване на хода от дадена междинна позиция. */
  function bestCompletion(board, rem, need) {
    if (need <= 0 || !rem.length) return { score: E.evaluate(board, HUMAN), moves: [], board };
    const plays = E.rankPlays(board, HUMAN, rem);
    if (!plays.length) return { score: E.evaluate(board, HUMAN), moves: [], board };
    return { score: plays[0].score, moves: plays[0].moves, board: plays[0].board };
  }

  /** Всички дестинации за избрания пул (включително с няколко стъпки). */
  function destinationsFrom(src) {
    const res = new Map();
    const rec = (board, rem, moved, from, path) => {
      const need = G.turn.maxLen - moved;
      const steps = E.legalSteps(board, HUMAN, rem, need, moved === 0 ? G.turn.forcedDie : null).filter((m) => m.from === from);
      for (const m of steps) {
        const nb = E.applyMove(board, HUMAN, m), nrem = E.removeOne(rem, m.die), np = path.concat([m]);
        const comp = bestCompletion(nb, nrem, need - 1);
        const ex = res.get(m.to);
        if (!ex || comp.score > ex.comp.score + 1e-9 || (Math.abs(comp.score - ex.comp.score) < 1e-9 && np.length < ex.path.length)) {
          res.set(m.to, { to: m.to, path: np, board: nb, rem: nrem, comp });
        }
        if (m.to >= 0) rec(nb, nrem, moved + 1, m.to, np);
      }
    };
    rec(G.board, G.turn.rem, G.turn.moves.length, src, []);
    for (const d of res.values()) d.q = E.quality(bestScore() - d.comp.score);
    return res;
  }

  function onBoardClick(t) {
    if (!G) return;
    if (G.phase === 'opening') { G.msg = 'Натиснете „Хвърли за начало“.'; render(); return; }
    if (G.phase === 'human-roll') { G.msg = 'Първо хвърлете заровете.'; render(); return; }
    if (G.phase !== 'human-move') return;
    G.msg = null;
    if (needed() <= 0) { G.msg = 'Ходът е завършен — потвърдете го или го отменете.'; render(); return; }
    // избор на дестинация
    if (G.selected !== null && G.destMap && G.destMap.has(t)) {
      const d = G.destMap.get(t);
      if (G.training && !(G.preview && G.preview.to === t)) { G.preview = d; render(); return; }
      commitPath(d.path);
      return;
    }
    const steps = currentSteps();
    const sources = E.uniq(steps.map((m) => m.from));
    if (sources.includes(t)) {
      if (G.selected === t) { G.selected = null; G.destMap = null; G.preview = null; render(); return; }
      G.selected = t; G.destMap = destinationsFrom(t); G.preview = null; G.pinPlay = null;
      if (G.training && G.destMap.size === 1) G.preview = [...G.destMap.values()][0];
      render();
      return;
    }
    const own = t === 24 ? G.board[0][24] > 0 : t >= 0 && G.board[0][t] > 0;
    if (own) G.msg = '<b>Този пул не може да се мести.</b> ' + E.whyCannot(G.board, HUMAN, t, G.turn.rem, needed(), G.turn.moves.length === 0 ? G.turn.forcedDie : null);
    else if (t >= 0 && G.board[1][23 - t] > 0) G.msg = 'Това са пулове на компютъра (черните). Вие местите белите.';
    else if (G.selected !== null) G.msg = 'Пулът не може да отиде там. Позволените места са оцветени.';
    G.selected = null; G.destMap = null; G.preview = null;
    render();
  }

  function commitPath(path) {
    path.forEach((m, i) => {
      G.turn.boards.push(G.board);
      G.turn.moves.push(m);
      const prev = G.board;
      G.board = E.applyMove(G.board, HUMAN, m);
      moveSound(prev, G.board, HUMAN, i * 0.18);
      G.turn.rem = E.removeOne(G.turn.rem, m.die);
    });
    G.selected = null; G.destMap = null; G.preview = null; G.hoverPlay = null; G.pinPlay = null; G.hint = null; G.msg = null;
    if (E.offCount(G.board, HUMAN) === 15) { endHumanTurn(); return; }
    render();
  }
  function undo(all) {
    if (!G.turn || !G.turn.moves.length) return;
    do {
      const m = G.turn.moves.pop();
      G.board = G.turn.boards.pop();
      G.turn.rem.push(m.die);
    } while (all && G.turn.moves.length);
    G.selected = null; G.destMap = null; G.preview = null; G.pinPlay = null; G.msg = null;
    render();
  }

  function endHumanTurn() {
    const t = G.turn;
    const txt = E.playText(HUMAN, t.moves);
    if (t.moves.length) {
      const sc = E.evaluate(G.board, HUMAN);
      const q = E.quality(bestScore() - sc);
      if (G.training) {
        let h = `Изиграхте <b>${G.dice[0]}–${G.dice[1]}: ${txt}</b> <span class="badge ${q.cls}">${q.text}</span>`;
        if (q.cls !== 'q-best' && t.plays.length) h += `<br>Най-добрият ход според компютъра беше <b>${E.playText(HUMAN, t.plays[0].moves)}</b>.`;
        addLog('you', h);
      } else addLog('you', `Вие: ${G.dice[0]}–${G.dice[1]} ${txt}`);
    } else addLog('you', 'Пропуснахте хода (няма възможен ход).');
    G.lastCpu = null;
    if (E.offCount(G.board, HUMAN) === 15) { gameOver(HUMAN); return; }
    startCpuTurn();
  }

  function startCpuTurn(dice) {
    clearTimeout(timer);
    G.phase = 'cpu'; G.turn = null; G.selected = null; G.preview = null; G.hint = null; G.msg = null; G.notes = [];
    const d = dice || [rollDie(), rollDie()];
    if (!dice) SND.dice();
    G.dice = d;
    G.cpuMoves = [];
    render();
    timer = setTimeout(() => {
      const before = G.board;
      const play = E.chooseAIPlay(G.board, CPU, d, level());
      if (!play) {
        addLog('cpu', `Компютърът хвърли <b>${d[0]}–${d[1]}</b> и няма възможен ход${G.training ? ' — всички нужни точки са затворени от вас.' : '.'}`);
        finishCpu();
        return;
      }
      let k = 0;
      const step = () => {
        if (k < play.moves.length) {
          const prev = G.board;
          G.board = E.applyMove(G.board, CPU, play.moves[k]);
          moveSound(prev, G.board, CPU, 0);
          k++;
          G.cpuMoves = play.moves.slice(0, k);
          G.lastCpu = { before, moves: play.moves.slice(0, k) };
          render();
          timer = setTimeout(step, speed());
        } else {
          const txt = E.playText(CPU, play.moves);
          if (G.training) {
            const ex = E.explainPlay(before, CPU, play.moves, G.board);
            const lines = ex.pros.concat(ex.cons).slice(0, 4);
            addLog('cpu', `Компютърът хвърли <b>${d[0]}–${d[1]}</b> и изигра <b>${txt}</b>.` + (lines.length ? '<ul>' + lines.map((x) => `<li>${x}</li>`).join('') + '</ul>' : ''));
          } else addLog('cpu', `Компютър: ${d[0]}–${d[1]} ${txt}`);
          finishCpu();
        }
      };
      step();
    }, speed());
  }
  function finishCpu() {
    if (E.offCount(G.board, CPU) === 15) { gameOver(CPU); return; }
    G.phase = 'human-roll';
    G.cpuMoves = [];
    render();
  }

  function gameOver(w) {
    clearTimeout(timer);
    const l = 1 - w;
    const mars = E.offCount(G.board, l) === 0;
    const pts = mars ? 2 : 1;
    G.phase = 'over'; G.winner = w; G.winPts = pts; G.mars = mars;
    const sc = score[G.mode];
    if (w === HUMAN) sc.you += pts; else sc.cpu += pts;
    save('tabla-score', score);
    addLog('info', w === HUMAN ? `🎉 <b>Победа${mars ? ' с марс' : ''}!</b> Печелите ${pts} ${pts === 1 ? 'точка' : 'точки'}.` : `Компютърът печели${mars ? ' <b>с марс</b>' : ''} (${pts} ${pts === 1 ? 'точка' : 'точки'}).`);
    if (mars && G.training) addLog('rule', '<b>Марс</b> — когато победителят изведе всички пулове, а загубилият не е извадил нито един. Тогава победата е двойна (2 точки).');
    render();
  }

  // ---------------- изглед ----------------
  function diceView() {
    if (G.phase === 'opening' && G.openingDice) return { dice: [{ v: G.openingDice[0], p: 0 }, { v: G.openingDice[1], p: 1 }], side: 'right' };
    if (!G.dice || G.phase === 'opening' || G.phase === 'human-roll' || G.phase === 'over') return { dice: [], side: 'right' };
    if (G.phase === 'cpu') {
      const d = G.dice, dbl = d[0] === d[1];
      const all = dbl ? [d[0], d[0], d[0], d[0]] : d;
      const usedN = G.cpuMoves ? G.cpuMoves.length : 0;
      return { dice: all.map((v, k) => ({ v, p: 1, used: dbl ? k < usedN : G.cpuMoves && G.cpuMoves.some((m) => m.die === v) })), side: 'left' };
    }
    const d = G.dice, dbl = d[0] === d[1];
    if (dbl) { const usedN = 4 - G.turn.rem.length; return { dice: [0, 1, 2, 3].map((k) => ({ v: d[0], p: 0, used: k < usedN })), side: 'right' }; }
    return { dice: d.map((v) => ({ v, p: 0, used: !G.turn.rem.includes(v) })), side: 'right' };
  }

  function boardView() {
    const dv = diceView();
    const view = { board: G.board, interactive: true, dice: dv.dice, diceSide: dv.side, sources: [], dests: [], arrows: [], lastArrows: [] };
    if (G.lastCpu && (G.phase === 'human-roll' || G.phase === 'cpu' || (G.phase === 'human-move' && !G.turn.moves.length))) {
      view.lastArrows = B.arrowsForPlay(G.lastCpu.before, CPU, G.lastCpu.moves, '#9aa0a6');
    }
    if (G.phase === 'human-move' && needed() > 0) {
      const steps = currentSteps();
      view.sources = E.uniq(steps.map((m) => m.from));
      view.selected = G.selected;
      if (G.selected !== null && G.destMap) {
        for (const d of G.destMap.values()) {
          const color = G.training ? QCOLOR[d.q.cls] : '#f5b301';
          if (d.to < 0) view.offDest = color; else view.dests.push({ i: d.to, color });
        }
      }
      if (G.preview) {
        view.ghost = { i: G.preview.to };
        view.arrows = B.arrowsForPlay(G.board, HUMAN, G.preview.path, '#5aa0ff');
        if (G.preview.comp.moves.length) view.arrows = view.arrows.concat(B.arrowsForPlay(G.preview.board, HUMAN, G.preview.comp.moves, '#9aa0a6').map((a) => Object.assign(a, { faded: true })));
      }
      const hp = G.hoverPlay || G.pinPlay || G.hint;
      if (hp && !G.preview) view.arrows = B.arrowsForPlay(G.board, HUMAN, hp.moves, '#5aa0ff');
    }
    if (G.phase === 'over') view.centerText = G.winner === HUMAN ? 'ПОБЕДА!' : 'ЗАГУБА';
    return view;
  }

  function exList(ex, opts) {
    opts = opts || {};
    const items = [];
    for (const t of ex.pros) items.push(`<li class="pro">${t}</li>`);
    for (const t of ex.cons) items.push(`<li class="con">${t}</li>`);
    if (!opts.noInfo) for (const t of ex.info) items.push(`<li class="inf">${t}</li>`);
    const lim = opts.limit ? items.slice(0, opts.limit) : items;
    return lim.length ? `<ul class="ex">${lim.join('')}</ul>` : '';
  }
  const badge = (q) => `<span class="badge ${q.cls}">${q.text}</span>`;

  /** Факти за конкретната стъпка (преди ходът да е завършен). */
  function stepExplain(d) {
    const ex = E.explainPlay(G.board, HUMAN, d.path, d.board, { final: d.comp.moves.length === 0 });
    const last = d.path[d.path.length - 1], first = d.path[0];
    const contact = E.isContact(d.board);
    if (contact && d.comp.moves.length) {
      if (last.to >= 0 && d.board[0][last.to] === 1) ex.cons.push(`Пулът ще стои <b>сам</b> на точка ${last.to + 1}. Ако не го покриете с останалото число, противникът може да го удари.`);
      if (first.from !== 24 && d.board[0][first.from] === 1) ex.cons.push(`На точка ${first.from + 1} остава единичен пул.`);
    }
    if (last.to >= 0 && G.board[0][last.to] >= 2) ex.info.unshift(`Добавяте пул към вече затворената точка ${last.to + 1} — там е безопасно.`);
    if (last.to >= 0 && G.board[0][last.to] === 1 && d.board[0][last.to] === 2 && !ex.pros.some((t) => t.includes('Затваря'))) ex.pros.push(`Покривате единичния си пул на точка ${last.to + 1}.`);
    if (!ex.pros.length && !ex.cons.length && first.from >= 18 && last.to < 18) ex.pros.push('Изтегляте заден пул от дома на противника.');
    ex.info = ex.info.filter((t) => !t.startsWith('Пипове'));
    return ex;
  }

  function rankedFromHere() {
    const plays = E.rankPlays(G.board, HUMAN, G.turn.rem);
    if (G.turn.moves.length === 0 && G.turn.forcedDie) return plays.filter((p) => p.moves[0].die === G.turn.forcedDie);
    return plays;
  }

  function panelHtml() {
    let h = '';
    const sc = score[G.mode];
    h += `<div class="panel-head"><div><span class="mode-tag ${G.training ? 'train' : 'game'}">${G.training ? 'Тренировка' : 'Игра'}</span> <span class="score">Резултат: вие <b>${sc.you}</b> : <b>${sc.cpu}</b> компютър</span></div>
      <button class="btn small ghost" data-a="new">Нова игра</button></div>`;
    h += `<div class="pips">Пипове: <b>вие ${E.pip(G.board, 0)}</b> · компютър ${E.pip(G.board, 1)} · извадени: ${E.offCount(G.board, 0)} / ${E.offCount(G.board, 1)}</div>`;

    // статус и бутони
    h += '<div class="status">';
    if (G.phase === 'opening') {
      h += `<p class="big">Хвърлете за начало.</p><button class="btn primary" data-a="opening">🎲 Хвърли за начало</button>`;
    } else if (G.phase === 'human-roll') {
      h += `<p class="big">Ваш ред е.</p><button class="btn primary" data-a="roll">🎲 Хвърли заровете</button>`;
      if (G.training && G.lastCpu) h += `<p class="muted">Сивите пунктирани стрелки показват последния ход на компютъра.</p>`;
    } else if (G.phase === 'human-nomove') {
      h += `<p class="big">Хвърлихте ${G.dice[0]}–${G.dice[1]}. Няма възможен ход.</p><button class="btn primary" data-a="pass">Продължи</button>`;
    } else if (G.phase === 'cpu') {
      h += `<p class="big">Компютърът играе… <span class="muted">(${G.dice[0]}–${G.dice[1]})</span></p>`;
    } else if (G.phase === 'over') {
      h += `<p class="big">${G.winner === HUMAN ? '🎉 Вие печелите' : 'Компютърът печели'}${G.mars ? ' с марс' : ''} (+${G.winPts}).</p><button class="btn primary" data-a="new">Нова игра</button>`;
    } else if (G.phase === 'human-move') {
      const n = needed();
      const remTxt = G.turn.rem.length ? G.turn.rem.join(', ') : '—';
      h += `<p class="big">Хвърлихте <b>${G.dice[0]}–${G.dice[1]}</b>. ${n > 0 ? `Остават числа: <b>${remTxt}</b>.` : 'Ходът е завършен.'}</p>`;
      if (G.turn.moves.length) h += `<p>Изиграно досега: <b>${E.playText(HUMAN, G.turn.moves)}</b></p>`;
      h += '<div class="btns">';
      if (n <= 0) h += `<button class="btn primary" data-a="confirm">✔ Потвърди хода</button>`;
      h += `<button class="btn" data-a="undo" ${G.turn.moves.length ? '' : 'disabled'}>↶ Върни</button>`;
      h += `<button class="btn" data-a="undoall" ${G.turn.moves.length > 1 ? '' : 'disabled'}>Върни всичко</button>`;
      if (!G.training && n > 0) h += `<button class="btn" data-a="hint">💡 Подсказка</button>`;
      h += '</div>';
      if (n > 0 && G.selected === null) h += `<p class="muted">Кликнете върху пул с жълт кръг, за да видите къде може да отиде.</p>`;
    }
    if (G.msg) h += `<div class="msg">${G.msg}</div>`;
    h += '</div>';

    if (G.phase === 'human-move' && G.hint && !G.training) {
      h += `<div class="card"><h4>💡 Подсказка</h4><p>Най-добрият ход: <b>${E.playText(HUMAN, G.turn.moves.concat(G.hint.moves))}</b> (синьо на дъската).</p></div>`;
    }

    if (G.training && G.phase === 'human-move') h += trainingPanel();


    // дневник
    h += `<div class="card log"><h4>${G.training ? 'Коментари и правила' : 'Ходове'}</h4>${G.log.map((e) => `<div class="log-${e.type}">${e.html}</div>`).join('')}</div>`;
    return h;
  }

  function trainingPanel() {
    let h = '';
    const n = needed();
    if (G.notes.length && G.turn.moves.length === 0) {
      h += `<div class="card rules-now"><h4>📘 Правила за този ход</h4><ul>${G.notes.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
    }
    if (n <= 0) {
      const sc = E.evaluate(G.board, HUMAN);
      const q = E.quality(bestScore() - sc);
      const ex = E.explainPlay(G.turn.startBoard, HUMAN, G.turn.moves, G.board);
      h += `<div class="card verdict"><h4>Вашият ход: ${E.playText(HUMAN, G.turn.moves)} ${badge(q)}</h4>${exList(ex)}`;
      if (q.cls !== 'q-best' && G.turn.plays.length) {
        const bp = G.turn.plays[0];
        const bex = E.explainPlay(G.turn.startBoard, HUMAN, bp.moves, bp.board);
        h += `<p><b>По-добре:</b> ${E.playText(HUMAN, bp.moves)}</p>${exList(bex, { noInfo: true, limit: 4 })}<p class="muted">Можете да върнете хода и да опитате пак.</p>`;
      }
      h += `<button class="btn primary" data-a="confirm">✔ Потвърди хода</button></div>`;
      return h;
    }
    if (G.preview) {
      const d = G.preview;
      const step = stepExplain(d);
      const fullMoves = G.turn.moves.concat(d.path, d.comp.moves);
      const fex = E.explainPlay(G.turn.startBoard, HUMAN, fullMoves, d.comp.board);
      h += `<div class="card preview"><h4>👁 Преглед: ${E.playText(HUMAN, d.path)} ${badge(d.q)}</h4>`;
      h += `<p class="muted">Синята стрелка е избраната стъпка${d.comp.moves.length ? ', сивата — най-доброто продължение' : ''}.</p>`;
      h += `<p><b>Тази стъпка:</b></p>` + (exList(step) || '<p>Обикновено преместване.</p>');
      if (d.comp.moves.length) {
        h += `<p><b>Най-добро продължение:</b> ${E.playText(HUMAN, d.comp.moves)} → целият ход <b>${E.playText(HUMAN, fullMoves)}</b></p>${exList(fex, { limit: 6 })}`;
      } else {
        h += `<p class="inf-line">${fex.info.join(' ')}</p>`;
      }
      h += `<div class="btns"><button class="btn primary" data-a="play-preview">▶ Изиграй</button><button class="btn" data-a="cancel-preview">Откажи</button></div>
        <p class="muted">Може и да кликнете повторно на същото място на дъската.</p></div>`;
    }
    if (G.selected !== null && G.destMap) {
      const from = G.selected === 24 ? 'бара' : 'точка ' + (G.selected + 1);
      const list = [...G.destMap.values()].sort((a, b) => b.comp.score - a.comp.score);
      h += `<div class="card"><h4>Възможни ходове за пула от ${from}</h4><p class="muted">Цветът на мястото показва колко е добър ходът (зелено = най-добър, червено = лош).</p><ul class="opts">`;
      for (const d of list) {
        const ex = stepExplain(d);
        const then = d.comp.moves.length ? `<div class="muted">→ най-добре после: ${E.playText(HUMAN, d.comp.moves)}</div>` : '';
        h += `<li class="opt ${G.preview === d ? 'on' : ''}" data-a="preview" data-to="${d.to}"><div>${badge(d.q)} <b>${E.playText(HUMAN, d.path)}</b> <span class="muted">(${d.path.map((m) => m.die).join('+')})</span></div>${then}${exList(ex, { noInfo: true, limit: 2 })}</li>`;
      }
      h += '</ul></div>';
    } else {
      const plays = rankedFromHere();
      const best = bestScore();
      const show = G.showAll ? plays.slice(0, 40) : plays.slice(0, 5);
      h += `<div class="card"><h4>💡 Всички възможни ходове (${plays.length})</h4><p class="muted">Подредени от най-добрия. Посочете ред, за да видите стрелките; кликнете за подробности.</p><ul class="opts">`;
      show.forEach((pl, k) => {
        const full = G.turn.moves.concat(pl.moves);
        const q = E.quality(best - pl.score);
        const pinned = G.pinPlay && G.pinPlay.key === E.key(pl.board);
        const ex = E.explainPlay(G.turn.startBoard, HUMAN, full, pl.board);
        h += `<li class="opt ${pinned ? 'on' : ''}" data-a="pin" data-k="${k}"><div>${badge(q)} <b>${E.playText(HUMAN, full)}</b></div>${pinned ? exList(ex) + '<button class="btn primary small" data-a="play-pinned">▶ Изиграй този ход</button>' : exList(ex, { noInfo: true, limit: 2 })}</li>`;
      });
      h += '</ul>';
      if (plays.length > 5) h += `<button class="btn small ghost" data-a="toggle-all">${G.showAll ? 'Покажи по-малко' : 'Покажи всички'}</button>`;
      h += '</div>';
      G._shown = show;
    }
    return h;
  }

  function render() {
    if (!G) return;
    $('#board').innerHTML = B.svg(boardView());
    $('#panel').innerHTML = panelHtml();
  }

  // ---------------- събития ----------------
  function onPanelClick(e) {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    if (a === 'new') { newGame(G.mode); render(); }
    else if (a === 'opening') openingRoll();
    else if (a === 'roll') { G.lastCpuKeep = true; SND.dice(); startHumanTurn([rollDie(), rollDie()]); }
    else if (a === 'pass') endHumanTurn();
    else if (a === 'confirm') endHumanTurn();
    else if (a === 'undo') undo(false);
    else if (a === 'undoall') undo(true);
    else if (a === 'hint') { const pl = rankedFromHere(); G.hint = pl[0] || null; render(); }
    else if (a === 'preview') {
      const to = Number(el.dataset.to);
      G.preview = G.destMap.get(to); render();
    } else if (a === 'play-preview') { if (G.preview) commitPath(G.preview.path); }
    else if (a === 'cancel-preview') { G.preview = null; render(); }
    else if (a === 'pin') {
      if (e.target.closest('button')) return;
      const pl = G._shown[Number(el.dataset.k)];
      G.pinPlay = G.pinPlay && G.pinPlay.key === E.key(pl.board) ? null : { key: E.key(pl.board), moves: pl.moves };
      render();
    } else if (a === 'play-pinned') { if (G.pinPlay) commitPath(G.pinPlay.moves); }
    else if (a === 'toggle-all') { G.showAll = !G.showAll; render(); }
  }
  function onPanelOver(e) {
    if (!G || !G.training || G.phase !== 'human-move' || G.selected !== null) return;
    const el = e.target.closest('[data-a="pin"]');
    const pl = el ? G._shown[Number(el.dataset.k)] : null;
    const cur = G.hoverPlay ? G.hoverPlay.key : null;
    const nk = pl ? E.key(pl.board) : null;
    if (cur === nk) return;
    G.hoverPlay = pl ? { key: nk, moves: pl.moves } : null;
    $('#board').innerHTML = B.svg(boardView());
  }

  // ---------------- настройки (в горното меню) ----------------
  function settingsHtml() {
    const sel = (key, opts) => `<select data-s="${key}">${opts.map(([v, t]) => `<option value="${v}" ${settings[key] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const LV = [['easy', 'Лесно'], ['normal', 'Нормално'], ['hard', 'Трудно']];
    const SP = [['slow', 'Бавно'], ['normal', 'Нормално'], ['fast', 'Бързо']];
    return `<h3>Настройки</h3>
      <fieldset><legend>🎓 Тренировка</legend>
        <label>Сила на компютъра ${sel('trainLevel', LV)}</label>
        <label>Темпо на компютъра ${sel('trainSpeed', SP)}</label>
        <div class="row"><span class="muted">Резултат: ${score.training.you} : ${score.training.cpu}</span><button class="btn small ghost" data-reset="training">Нулирай</button></div>
      </fieldset>
      <fieldset><legend>🏆 Игра</legend>
        <label>Сила на компютъра ${sel('gameLevel', LV)}</label>
        <label>Темпо на компютъра ${sel('gameSpeed', SP)}</label>
        <div class="row"><span class="muted">Резултат: ${score.game.you} : ${score.game.cpu}</span><button class="btn small ghost" data-reset="game">Нулирай</button></div>
      </fieldset>
      <fieldset><legend>🔊 Звук</legend>
        <label>Звукови ефекти <input type="checkbox" data-s="sound" ${settings.sound !== false ? 'checked' : ''}></label>
      </fieldset>
      <p class="muted">Промяната на силата важи от следващия ход на компютъра.</p>`;
  }
  function toggleSettings(open) {
    const pop = $('#settings-pop'), btn = $('#gear');
    if (open === undefined) open = pop.hidden;
    if (open) pop.innerHTML = settingsHtml();
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
  }
  function initSettings() {
    const pop = $('#settings-pop');
    $('#gear').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = e.target.closest('[data-reset]');
      if (!r) return;
      score[r.dataset.reset] = { you: 0, cpu: 0 }; save('tabla-score', score);
      pop.innerHTML = settingsHtml();
      render();
    });
    pop.addEventListener('change', (e) => {
      const k = e.target.dataset.s;
      if (!k) return;
      settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'sound') { SND.enabled = settings.sound; if (settings.sound) SND.move(); }
      save('tabla-settings', settings);
    });
    document.addEventListener('click', () => { if (!pop.hidden) toggleSettings(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { toggleSettings(false); $('#gear').focus(); } });
  }

  function init() {
    $('#board').addEventListener('click', (e) => {
      const r = e.target.closest('[data-t]');
      if (r) onBoardClick(Number(r.dataset.t));
    });
    $('#panel').addEventListener('click', onPanelClick);
    $('#panel').addEventListener('mouseover', onPanelOver);
    initSettings();
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.nav;
      if (location.hash === '#' + n) route(); else location.hash = n;
    }));
    window.addEventListener('hashchange', route);
    if (window.TablaRules) window.TablaRules.mount($('#rules-content'));
    if (window.TablaStrategies) window.TablaStrategies.mount($('#strategies-content'));
    route();
  }
  // помощни функции за автоматични тестове в браузъра
  window.__tabla = {
    state: () => G, settings, render,
    playBest() { const pl = rankedFromHere(); commitPath(pl.length ? pl[0].moves : []); },
    confirm: () => endHumanTurn(), roll: (d) => startHumanTurn(d), opening: () => openingRoll(),
  };
  document.addEventListener('DOMContentLoaded', init);
})();
