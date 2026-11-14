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
    for (const v of ['home', 'play', 'rules', 'strategies', 'online']) $('#view-' + v).hidden = v !== name;
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === (name === 'play' ? G && G.mode : name)));
    window.scrollTo(0, 0);
  }
  function route() {
    const h = (location.hash || '#home').slice(1);
    if (!h.startsWith('room-')) leaveOnline();
    if (h === 'training' || h === 'game') {
      if (!G || G.mode !== h) newGame(h);
      showView('play');
      render();
    } else if (h === 'online') {
      clearTimeout(timer); showView('online');
      if (window.TablaOnline) window.TablaOnline.mountLobby($('#online-content'));
    } else if (h.startsWith('room-') && window.TablaOnline && window.TablaOnline.available) {
      const code = h.slice(5).toUpperCase();
      if (!G || !G.online || G.online.code !== code) startOnline(code);
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
    const fsOk = h === 'training' || h === 'game' || h.startsWith('s-') || h.startsWith('room-');
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
    // Резултатът остава на дъската, докато играчът не натисне „Започни“ — началото е отделна, ясна стъпка.
    G.phase = 'opening-done';
    G.openWinner = a > c ? HUMAN : CPU;
    if (a > c) addLog(G.training ? 'rule' : 'info', `Вие хвърлихте <b>${a}</b>, компютърът — <b>${c}</b>. Вие започвате и играете ${a} и ${c}.`);
    else addLog(G.training ? 'rule' : 'info', `Компютърът хвърли <b>${c}</b>, вие — <b>${a}</b>. Компютърът започва и играе ${c} и ${a}.`);
    render();
  }

  function beginGame() {
    if (G.phase !== 'opening-done') return;
    const [a, c] = G.openingDice;
    G.openingDice = null;
    if (G.openWinner === HUMAN) startHumanTurn([a, c]);
    else startCpuTurn([c, a]);
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
    if (G.phase === 'opening-done') { G.msg = 'Натиснете „Започни играта“.'; render(); return; }
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
    else if (t >= 0 && G.board[1][23 - t] > 0) G.msg = G.online ? `Това са пуловете на противника (${colorWord(1)}). Вие местите ${colorWord(0)}.` : 'Това са пулове на компютъра (черните). Вие местите белите.';
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
    if (G.online) {
      const moves = t.moves.map((m) => ({ from: m.from, to: m.to, die: m.die }));
      if (G.online.conn.send({ t: 'move', turnId: G.online.turnId, moves })) { G.phase = 'sent'; G.msg = null; }
      else G.msg = 'Няма връзка със сървъра. Ходът ще може да се изпрати, щом връзката се възстанови.';
      render();
      return;
    }
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

  // ---------------- онлайн игра ----------------
  const ON = () => window.TablaOnline;
  function leaveOnline() {
    closeMailDialog(); closeAnalysis();
    if (G && G.online) { G.online.conn && G.online.conn.close(); clearInterval(G.online.clockT); G = null; }
  }
  function startOnline(code) {
    leaveOnline();
    clearTimeout(timer);
    newGame('online');
    G.log = [];
    G.phase = 'connecting';
    G.online = { code, conn: null, srv: null, me: 0, turnId: -1, status: 'connecting', error: null, deadline: null, clockT: null };
    if (!ON().CODE_RE.test(code)) { G.phase = 'join-error'; G.online.error = 'Невалиден код на стая.'; return; }
    const seat = ON().seatFor(code);
    if (!seat) { G.phase = 'join'; checkRoom(code); return; }
    openConn(seat);
  }
  async function checkRoom(code) {
    try {
      const info = await ON().roomInfo(code);
      if (!G || !G.online || G.online.code !== code || G.phase !== 'join') return;
      if (!info.exists) { G.phase = 'join-error'; G.online.error = 'Няма стая с код ' + code + '. Може да е изтекла.'; }
      else if (info.full) { G.phase = 'join-error'; G.online.error = 'Стаята ' + code + ' вече е пълна.'; }
      else G.online.info = info;
    } catch (e) { G.online.error = 'Сървърът не отговаря. Опитайте пак след малко.'; }
    render();
  }
  function openConn(seat) {
    const O = G.online, code = O.code;
    const live = () => G && G.online === O;
    O.conn = ON().connect(code, seat, {
      state: (s) => { if (live()) onServerState(s); },
      status: (st) => {
        if (!live()) return;
        O.status = st;
        if (st === 'replaced') { G.phase = 'join-error'; O.error = 'Стаята е отворена в друг раздел или прозорец. Продължете играта там.'; }
        render();
      },
      error: (m) => {
        if (!live()) return;
        if (m.code === 'rule') { G.msg = m.msg; render(); return; }
        G.phase = 'join-error'; O.error = m.msg; render();
      },
      mail: (m) => { if (live()) mailResult(m); },
      analysis: (m) => { if (live()) analysisResult(m); },
    });
    clearInterval(O.clockT);
    O.clockT = setInterval(updateClock, 500);
  }
  function clockText() {
    const O = G.online;
    if (!O || !O.deadline) return '';
    const left = Math.max(0, Math.ceil((O.deadline - Date.now()) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  function updateClock() {
    const el = document.getElementById('clock');
    if (!el || !G || !G.online) return;
    el.textContent = clockText();
    const left = (G.online.deadline - Date.now()) / 1000;
    el.classList.toggle('low', left <= 10);
  }

  /** Цвят и страна на дома за всеки от двамата: създателят избира, вторият получава обратното.
   *  Локално индекс 0 винаги е „аз“. Огледалният изглед (дом отляво) прави двете картини
   *  точно завъртени на 180° една спрямо друга — както при истинска дъска между двама души. */
  function seatLook() {
    const s = G.online && G.online.srv;
    if (!s) return { colors: ['white', 'black'], flip: false };
    const c0 = s.settings.color || 'white', side0 = s.settings.side || 'right';
    const other = (c) => (c === 'white' ? 'black' : 'white');
    const mine = s.you === 0 ? c0 : other(c0);
    const side = s.you === 0 ? side0 : (side0 === 'right' ? 'left' : 'right');
    return { colors: [mine, other(mine)], flip: side === 'left', side };
  }
  const colorWord = (p) => (seatLook().colors[p] === 'white' ? 'белите' : 'черните');

  /** Ново състояние от сървъра. Дъската се обръща така, че играчът винаги е „0“ (белите, долу). */
  function onServerState(s) {
    const O = G.online, prev = O.srv;
    O.srv = s; O.me = s.you;
    if (prev && (prev.phase !== s.phase || prev.turnId !== s.turnId)) { G.msg = null; G.confirmResign = false; }
    const me = s.you, op = 1 - me;
    const persp = (b) => (me === 0 ? b : [b[1], b[0]]);
    O.deadline = s.deadline ? Date.now() + (s.deadline - s.now) : null;
    G.log = onlineLog(s);
    G.lastCpu = s.lastMove && s.lastMove.seat === op ? { before: persp(s.lastMove.before), moves: s.lastMove.moves } : null;
    // звуци
    const newRoll = !prev || prev.turnId !== s.turnId || String(prev.opening) !== String(s.opening);
    if (prev && newRoll && (s.dice || s.opening.some((x) => x != null))) SND.dice();
    if (prev && s.lastMove && (!prev.lastMove || prev.lastMove.at !== s.lastMove.at) && s.lastMove.seat === op) {
      let b = persp(s.lastMove.before);
      s.lastMove.moves.forEach((m, i) => { const nb = E.applyMove(b, CPU, m); moveSound(b, nb, CPU, i * 0.18); b = nb; });
    }
    const myTurn = s.turn === me;
    if (s.phase === 'move' && myTurn) {
      if (O.turnId === s.turnId && (G.phase === 'human-move' || G.phase === 'human-nomove' || G.phase === 'sent')) {
        if (G.phase === 'sent') G.phase = G.turn && G.turn.maxLen === 0 ? 'human-nomove' : 'human-move';
        render();
        return;
      }
      O.turnId = s.turnId;
      G.board = persp(s.board);
      G.log = onlineLog(s);
      startHumanTurn(s.dice);
      return;
    }
    O.turnId = s.turnId;
    G.board = persp(s.board);
    G.turn = null; G.selected = null; G.destMap = null; G.preview = null; G.hint = null; G.notes = [];
    G.dice = s.dice; G.cpuMoves = [];
    G.openingDice = s.phase === 'opening' ? [s.opening[me], s.opening[op]] : null;
    G.phase = s.phase === 'waiting' ? 'waiting' : s.phase === 'opening' ? 'opening' : s.phase === 'over' ? 'over' : myTurn ? 'human-roll' : 'cpu';
    if (s.phase === 'over') { G.winner = s.winner === me ? HUMAN : CPU; G.winPts = s.pts; G.mars = s.mars; }
    render();
    if (s.phase === 'over' && s.canAnalyze && !mailAsked(O.code, s.match)) openMailDialog(O.code, s.match);
    // ако отговорът се е изгубил (напр. прекъсната връзка), състоянието от сървъра пак казва, че е изпратено
    if (s.mailed && mailDlg && mailDlg.dataset.sending) mailResult({ ok: true, msg: 'Анализът е изпратен.' });
    if (s.phase !== 'over') { closeMailDialog(); closeAnalysis(); }
  }

  // ---------- след края на мача: анализ веднага или по имейл ----------
  // Питаме веднъж за всеки мач; отказът се помни само за този раздел.
  const mailKey = (code, match) => `tabla-mail-${code}-m${match}`;
  function mailAsked(code, match) { try { return !!sessionStorage.getItem(mailKey(code, match)); } catch (e) { return false; } }
  function markMailAsked(code, match) { try { sessionStorage.setItem(mailKey(code, match), '1'); } catch (e) { /* няма хранилище */ } }
  let mailDlg = null;
  function closeMailDialog() { if (mailDlg) { mailDlg.remove(); mailDlg = null; } }
  function openMailDialog(code, match) {
    if (mailDlg || anaEl) return;
    const s = G.online && G.online.srv;
    const canMail = !!(s && s.canMail && !s.mailed);
    const el = document.createElement('div');
    el.className = 'modal-back';
    el.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-labelledby="mail-title">
      <h2 id="mail-title">Искате ли анализ на играта си?</h2>
      <p>Личен анализ на вашите ходове: колко точно играхте, кои ходове струваха най-много и какъв беше по-добрият ход — нарисуван на дъската, плюс съвети за следващата игра.</p>
      <section class="choice">
        <h3>📊 Вижте го сега</h3>
        <p class="muted small">Отваря се тук, веднага. След това можете просто да затворите раздела или да продължите да играете срещу компютъра или в тренировка.</p>
        <button class="btn primary" type="button" data-now>Виж анализа</button>
      </section>
      ${canMail ? `<form class="choice" novalidate>
        <h3>📧 По имейл — за по-късно</h3>
        <label>Имейл адрес <input type="email" name="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="vie@primer.bg" required></label>
        <p class="muted small">Адресът е нужен само за да изпратим това писмо. Не го записваме в приложението и не го показваме на противника. Писмото идва от noreply.tabla@gospodinov.dev — не отговаряйте на него.</p>
        <div class="msg" hidden></div>
        <button class="btn" type="submit">Изпрати</button>
      </form>` : s && s.mailed ? '<p class="muted">Анализът вече е изпратен на имейла ви.</p>' : ''}
      <div class="btns"><button class="btn ghost" type="button" data-x>Откажи</button></div>
    </div>`;
    document.body.appendChild(el);
    mailDlg = el;
    const cancel = () => { markMailAsked(code, match); closeMailDialog(); };
    el.querySelector('[data-x]').addEventListener('click', cancel);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
    el.querySelector('[data-now]').addEventListener('click', () => { markMailAsked(code, match); closeMailDialog(); openAnalysis(); });
    const form = el.querySelector('form');
    if (form) {
      const input = form.email, msg = form.querySelector('.msg'), send = form.querySelector('[type=submit]');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { msg.hidden = false; msg.textContent = 'Въведете валиден имейл адрес.'; input.focus(); return; }
        if (!G.online || !G.online.conn.send({ t: 'mail', email })) { msg.hidden = false; msg.textContent = 'Няма връзка със сървъра.'; return; }
        send.disabled = true; msg.hidden = false; msg.textContent = 'Изпращаме…';
        el.dataset.sending = '1';
        clearTimeout(el.waitT);
        el.waitT = setTimeout(() => {
          if (mailDlg !== el || !el.dataset.sending) return;
          delete el.dataset.sending; send.disabled = false; msg.textContent = 'Няма отговор от сървъра. Опитайте отново.';
        }, 15000);
      });
    }
    setTimeout(() => el.querySelector('[data-now]').focus(), 0);
  }
  function mailResult(m) {
    if (!mailDlg) return;
    delete mailDlg.dataset.sending; clearTimeout(mailDlg.waitT);
    const form = mailDlg.querySelector('form');
    if (!form) return;
    const msg = form.querySelector('.msg');
    msg.hidden = false; msg.textContent = m.msg || '';
    if (!m.ok) { form.querySelector('[type=submit]').disabled = false; return; }
    const s = G.online && G.online.srv;
    if (s) markMailAsked(G.online.code, s.match);
    form.querySelector('label').remove();
    form.querySelector('[type=submit]').remove();
    form.querySelector('.muted').remove();
    mailDlg.querySelector('[data-x]').textContent = 'Затвори';
  }

  // ---------- анализът в приложението ----------
  let anaEl = null;
  function closeAnalysis() { if (anaEl) { anaEl.remove(); anaEl = null; document.body.classList.remove('no-scroll'); } }
  function openAnalysis() {
    if (!G || !G.online || !G.online.conn) return;
    closeAnalysis();
    anaEl = document.createElement('div');
    anaEl.className = 'ana-back';
    anaEl.innerHTML = '<article class="ana card" role="dialog" aria-modal="true" aria-label="Анализ на играта" tabindex="-1"><p class="big">Подготвяме анализа…</p></article>';
    document.body.appendChild(anaEl);
    document.body.classList.add('no-scroll');
    anaEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeAnalysis();
      else if (e.target.closest('a[href^="#"]')) closeAnalysis(); // към игра/тренировка: маршрутът сам напуска стаята
    });
    anaEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAnalysis(); });
    if (!G.online.conn.send({ t: 'analysis' })) analysisResult({ ok: false, msg: 'Няма връзка със сървъра.' });
  }
  function analysisResult(m) {
    if (!anaEl) return;
    const box = anaEl.querySelector('.ana'), esc2 = ON().esc;
    if (!m.ok) { box.innerHTML = `<p class="big">${esc2(m.msg || 'Анализът не е достъпен.')}</p><div class="btns"><button class="btn" data-close>Затвори</button></div>`; return; }
    const a = m.data, look = a.look;
    const board = (mi, moves, color) => B.svg({ board: mi.before, colors: look.colors, flip: look.flip, dice: mi.diceArr.map((v) => ({ v, p: 0 })), diceSide: 'right', arrows: B.arrowsForPlay(mi.before, 0, moves, color) });
    const cats = [['best', 'Най-добър'], ['good', 'Много добър'], ['ok', 'Приемлив'], ['weak', 'Слаб'], ['bad', 'Грешка']];
    let h = '<header class="ana-top"><h2>Анализ на вашата игра</h2><button class="btn small ghost" data-close>✕ Затвори</button></header>';
    h += `<p>${esc2(a.result)}${a.opponent ? ` <span class="muted">Противник: ${esc2(a.opponent)}${a.games > 1 ? ` · ${a.games} игри` : ''}.</span>` : ''}</p>`;
    h += `<div class="ana-score"><div class="ana-acc">${a.accuracy}%</div><div><b>точност</b> — дял на ходовете, които са най-добрите или много близо до тях (${a.scored} хода с избор).<br>${esc2(a.summary)}</div></div>`;
    h += `<p class="ana-counts">${cats.map(([k, t]) => `<span class="q-chip ${k}">${t}: <b>${a.counts[k]}</b></span>`).join('')}</p>`;
    h += '<h3>Ходовете, които струваха най-много</h3>';
    if (!a.mistakes.length) h += '<p>Нямаше ходове със значителна загуба. Браво!</p>';
    else h += `<p class="muted small">Номерът е поредният ваш ход${a.games > 1 ? ' в съответната игра' : ''}. Точките са по вашата номерация (домът ви е 1–6).</p>`;
    for (const mi of a.mistakes) {
      h += `<section class="ana-move"><p class="ana-head">Ход ${esc2(mi.where || mi.n)} · зарове <b>${esc2(mi.dice)}</b> · ${esc2(mi.label)}</p>
        <div class="ana-boards">
          <figure><figcaption class="bad">Изиграхте: <b>${esc2(mi.played)}</b> <span class="muted">(червените стрелки)</span></figcaption>${board(mi, mi.playedMoves, '#d32f2f')}</figure>
          <figure><figcaption class="good">По-добре: <b>${esc2(mi.best)}</b> <span class="muted">(зелените стрелки)</span></figcaption>${board(mi, mi.bestMoves, '#2e9e4f')}</figure>
        </div>
        <p>${mi.why ? esc2(mi.why) + ' ' : ''}${mi.bestWhy ? '<b>По-добрият ход:</b> ' + esc2(mi.bestWhy) : ''}</p></section>`;
    }
    if (a.strengths.length) h += `<h3>Какво направихте добре</h3><ul>${a.strengths.map((x) => `<li>${esc2(x)}</li>`).join('')}</ul>`;
    if (a.tips.length) h += `<h3>Препоръки за следващата игра</h3><ul>${a.tips.map((x) => `<li>${esc2(x)}</li>`).join('')}</ul>`;
    h += `<footer class="ana-next"><p><b>Какво следва?</b> Можете просто да затворите раздела или да продължите да се упражнявате:</p>
      <div class="btns"><a class="btn primary" href="#game">🏆 Игра срещу компютъра</a><a class="btn" href="#training">🎓 Тренировка</a></div></footer>`;
    box.innerHTML = h;
    box.scrollTop = 0;
    box.focus();
  }

  function oppName() {
    const s = G.online.srv, p = s && s.players[1 - s.you];
    return p ? p.name : 'противникът';
  }
  function onlineLog(s) {
    const me = s.you, esc2 = ON().esc;
    const who = (seat) => (seat === me ? 'Вие' : `<b>${esc2(s.players[seat] ? s.players[seat].name : 'Противникът')}</b>`);
    const out = [];
    for (const e of s.events) {
      let type = e.seat === me ? 'you' : e.seat == null ? 'info' : 'cpu', html = '';
      if (e.k === 'create') html = e.seat === me ? 'Създадохте стаята. Изпратете кода на противника си.' : `${who(e.seat)} създаде стаята.`;
      else if (e.k === 'join') html = e.seat === me ? 'Влязохте в стаята.' : `${who(e.seat)} влезе в стаята.`;
      else if (e.k === 'open') { type = 'info'; html = `Хвърляне за начало: вие <b>${e.d[me]}</b>, ${esc2(s.players[1 - me] ? s.players[1 - me].name : 'противникът')} <b>${e.d[1 - me]}</b>.` + (e.d[0] === e.d[1] ? ' Равенство — хвърля се отново.' : e.d[me] > e.d[1 - me] ? ' Вие започвате.' : ''); }
      else if (e.k === 'roll') continue;
      else if (e.k === 'move') html = `${who(e.seat)}: ${e.dice[0]}–${e.dice[1]} ${e.moves.length ? E.playText(e.seat === me ? HUMAN : CPU, e.moves) : 'няма възможен ход'}${e.auto ? ' <span class="muted">(автоматично)</span>' : ''}`;
      else if (e.k === 'timeout') html = `${who(e.seat)} — времето за хода изтече.`;
      else if (e.k === 'resign') html = `${who(e.seat)} ${e.seat === me ? 'се предадохте' : 'се предаде'}.`;
      else if (e.k === 'over') { type = 'info'; html = e.seat === me ? `🎉 <b>Победа${e.mars ? ' с марс' : ''}!</b> +${e.pts}` : `${who(e.seat)} печели${e.mars ? ' с марс' : ''} (+${e.pts}).`; }
      else if (e.k === 'matchover') { type = 'info'; html = e.seat === me ? `🏆 <b>Спечелихте мача ${e.score[me]}:${e.score[1 - me]}!</b>` : `🏆 ${who(e.seat)} спечели мача ${e.score[e.seat]}:${e.score[1 - e.seat]}.`; }
      else if (e.k === 'newgame') { type = 'info'; html = `<b>Игра ${e.n}</b> започва. Хвърлете за начало.`; }
      else continue;
      out.unshift({ type, html });
    }
    return out.slice(0, 60);
  }

  function onlinePanel() {
    const O = G.online, s = O.srv, esc2 = ON().esc;
    let h = '';
    const tag = `<span class="mode-tag online">Онлайн${O.code ? ' · ' + O.code : ''}</span>`;
    if (G.phase === 'join' || G.phase === 'join-error' || (G.phase === 'connecting' && !s)) {
      h += `<div class="panel-head"><div>${tag}</div></div><div class="status">`;
      if (G.phase === 'join-error') h += `<p class="big">${esc2(O.error)}</p><a class="btn primary" href="#online">Към онлайн лобито</a>`;
      else if (G.phase === 'join') {
        h += `<p class="big">Покана за игра в стая <b>${O.code}</b>${O.info && O.info.host ? ` от <b>${esc2(O.info.host)}</b>` : ''}.</p>`;
        if (O.info) h += `<p>Ще играете с <b>${O.info.settings.color === 'black' ? 'белите' : 'черните'}</b> пулове, домът ви е <b>${O.info.settings.side === 'left' ? 'долу вдясно' : 'долу вляво'}</b>.</p>`;
        if (O.info) h += `<p class="muted">${ON().targetText(O.info.settings.target || 1)} · Време за ход: ${ON().timeText(O.info.settings.moveTime)} · Запис: ${O.info.settings.record ? 'да' : 'не'}</p>`;
        h += `<form class="join-form" data-form="join-room"><label>Вашето име <input name="name" maxlength="20" autocomplete="nickname" value="${esc2(ON().lastName())}" placeholder="напр. Мария" required></label><button class="btn primary" type="submit">Влез в играта</button></form>`;
        if (O.error) h += `<div class="msg">${esc2(O.error)}</div>`;
      } else h += '<p class="big">Свързване със стаята…</p>';
      return h + '</div>';
    }
    const me = s.you, op = 1 - me, opp = s.players[op];
    const target = s.settings.target || 1;
    h += `<div class="panel-head"><div>${tag} <span class="score">${target > 1 ? `Мач до ${target}: ` : 'Резултат: '}вие <b>${s.score[me]}</b> : <b>${s.score[op]}</b> ${opp ? esc2(opp.name) : ''}</span></div>
      <button class="btn small ghost" data-a="leave">Напусни</button></div>`;
    const conn = O.status === 'open' ? '' : `<div class="msg">Връзката със сървъра прекъсна — свързваме се отново…</div>`;
    h += conn;
    h += `<div class="pips">Пипове: <b>вие ${E.pip(G.board, 0)}</b> · ${opp ? esc2(opp.name) : 'противник'} ${E.pip(G.board, 1)} · извадени: ${E.offCount(G.board, 0)} / ${E.offCount(G.board, 1)}</div>`;
    h += `<div class="players"><span><i class="chip ${seatLook().colors[0]}"></i>Вие (${esc2(s.players[me] ? s.players[me].name : '')}) — ${colorWord(0)}, домът ви е ${seatLook().side === 'left' ? 'долу вляво' : 'долу вдясно'}</span><span><i class="chip ${seatLook().colors[1]}"></i><i class="dot ${opp && opp.online ? 'on' : 'off'}"></i>${opp ? `${esc2(opp.name)} — ${colorWord(1)}${opp.online ? '' : ' <span class="muted">(офлайн)</span>'}` : '<span class="muted">чакаме противник</span>'}</span></div>`;
    const clock = O.deadline ? ` <span class="clock" id="clock">${clockText()}</span>` : '';
    h += '<div class="status">';
    if (G.phase === 'waiting') {
      const link = ON().roomLink(O.code);
      h += `<p class="big">Чакаме противника.</p><p>Изпратете му кода на стаята или линка:</p>
        <div class="share"><div class="room-code">${O.code}</div><button class="btn small" data-a="copy" data-copy="${O.code}">Копирай кода</button></div>
        <div class="share"><input class="link" readonly value="${esc2(link)}"><button class="btn small" data-a="copy" data-copy="${esc2(link)}">Копирай линка</button></div>`;
    } else if (G.phase === 'opening') {
      const mine = s.opening[me], theirs = s.opening[op];
      if (mine == null) h += `<p class="big">Хвърлете за начало — по-високият зар започва.</p><button class="btn primary" data-a="opening">🎲 Хвърли за начало</button>`;
      else h += `<p class="big">Хвърлихте <b>${mine}</b>. Чакаме ${esc2(oppName())}${theirs == null ? '' : ''}…</p>`;
      const dieOf = (p) => (seatLook().colors[p] === 'white' ? 'red' : 'white');
      h += `<p class="dice-key"><i class="die-chip ${dieOf(0)}"></i> вашият зар · <i class="die-chip ${dieOf(1)}"></i> зарът на ${esc2(oppName())}</p>`;
    } else if (G.phase === 'human-roll') {
      h += `<p class="big">Ваш ред е.${clock}</p><button class="btn primary" data-a="roll">🎲 Хвърли заровете</button>`;
      if (G.lastCpu) h += `<p class="muted">Сивите пунктирани стрелки показват последния ход на ${esc2(oppName())}.</p>`;
    } else if (G.phase === 'human-nomove') {
      h += `<p class="big">Хвърлихте ${G.dice[0]}–${G.dice[1]}. Няма възможен ход.${clock}</p><button class="btn primary" data-a="pass">Продължи</button>`;
    } else if (G.phase === 'cpu') {
      h += `<p class="big">Ход на ${esc2(oppName())}${G.dice ? ` <span class="muted">(${G.dice[0]}–${G.dice[1]})</span>` : ''}…${clock}</p>`;
    } else if (G.phase === 'sent') {
      h += '<p class="big">Изпращане на хода…</p>';
    } else if (G.phase === 'over') {
      h += `<p class="big">${G.winner === HUMAN ? '🎉 Вие печелите' : esc2(oppName()) + ' печели'}${target > 1 ? ' играта' : ''}${G.mars ? ' с марс' : ''} (+${G.winPts}).</p>`;
      if (!s.matchOver) {
        // мачът продължава: следващата игра започва, когато и двамата са готови
        h += `<p>Резултат в мача: <b>${s.score[me]} : ${s.score[op]}</b> — играе се до ${target} точки.</p>`;
        if (s.rematch[me]) h += `<p>Готови сте. Чакаме ${esc2(oppName())}…</p>`;
        else h += `<button class="btn primary" data-a="rematch">▶ Следваща игра</button>${s.rematch[op] ? ` <span class="muted">${esc2(oppName())} е готов.</span>` : ''}`;
      } else {
        if (target > 1) h += `<p class="big">🏆 ${s.matchWinner === me ? '<b>Вие спечелихте мача</b>' : `<b>${esc2(oppName())}</b> спечели мача`} ${s.score[s.matchWinner]}:${s.score[1 - s.matchWinner]}.</p>`;
        if (s.canAnalyze) {
          h += `<div class="btns"><button class="btn" data-a="analysis">📊 Виж анализа</button>`;
          if (s.canMail && !s.mailed) h += `<button class="btn ghost" data-a="mail">📧 Анализ по имейл</button>`;
          h += '</div>';
          if (s.mailed) h += `<p class="muted">Анализът е изпратен на имейла ви.</p>`;
        }
        const again = target > 1 ? '↻ Нов мач' : '↻ Реванш';
        if (s.rematch[me]) h += `<p>Поискахте ${target > 1 ? 'нов мач' : 'реванш'}. Чакаме ${esc2(oppName())}…</p>`;
        else h += `<p><button class="btn primary" data-a="rematch">${again}</button>${s.rematch[op] ? ` <span class="muted">${esc2(oppName())} иска ${target > 1 ? 'нов мач' : 'реванш'}.</span>` : ''}</p>`;
      }
    } else if (G.phase === 'human-move') {
      const n = needed();
      const remTxt = G.turn.rem.length ? G.turn.rem.join(', ') : '—';
      h += `<p class="big">Хвърлихте <b>${G.dice[0]}–${G.dice[1]}</b>. ${n > 0 ? `Остават числа: <b>${remTxt}</b>.` : 'Ходът е завършен.'}${clock}</p>`;
      if (G.turn.moves.length) h += `<p>Изиграно досега: <b>${E.playText(HUMAN, G.turn.moves)}</b></p>`;
      h += '<div class="btns">';
      if (n <= 0) h += `<button class="btn primary" data-a="confirm">✔ Потвърди хода</button>`;
      h += `<button class="btn" data-a="undo" ${G.turn.moves.length ? '' : 'disabled'}>↶ Върни</button>`;
      h += `<button class="btn" data-a="undoall" ${G.turn.moves.length > 1 ? '' : 'disabled'}>Върни всичко</button>`;
      h += '</div>';
      if (n > 0 && G.selected === null) h += `<p class="muted">Кликнете върху пул с жълт кръг, за да видите къде може да отиде.</p>`;
    }
    if (G.msg) h += `<div class="msg">${G.msg}</div>`;
    h += '</div>';
    h += `<div class="room-info muted">${ON().targetText(target)} · Време за ход: ${ON().timeText(s.settings.moveTime)} · Запис на играта: ${s.settings.record ? 'включен' : 'изключен'}${s.phase !== 'waiting' && s.phase !== 'over' ? ' · <button class="link-btn" data-a="resign">Предай се</button>' : ''}</div>`;
    h += `<div class="card log"><h4>Ходове</h4>${G.log.map((e) => `<div class="log-${e.type}">${e.html}</div>`).join('')}</div>`;
    return h;
  }

  function onlineAction(a, el) {
    const O = G.online;
    if (a === 'opening' || a === 'roll') { if (!O.conn.send({ t: 'roll' })) G.msg = 'Няма връзка със сървъра.'; render(); return true; }
    if (a === 'rematch') { O.conn.send({ t: 'rematch' }); return true; }
    if (a === 'mail') { if (O.srv) { closeMailDialog(); openMailDialog(O.code, O.srv.match); } return true; }
    if (a === 'analysis') { closeMailDialog(); openAnalysis(); return true; }
    if (a === 'leave') { location.hash = 'online'; return true; }
    if (a === 'resign') {
      if (G.confirmResign) { G.confirmResign = false; O.conn.send({ t: 'resign' }); }
      else { G.confirmResign = true; G.msg = 'Сигурни ли сте? Натиснете „Предай се“ още веднъж, за да потвърдите.'; render(); setTimeout(() => { if (G && G.confirmResign) { G.confirmResign = false; G.msg = null; render(); } }, 5000); }
      return true;
    }
    if (a === 'copy') {
      const txt = el.dataset.copy;
      const done = () => { el.textContent = '✔ Копирано'; setTimeout(() => render(), 1500); };
      const fallback = () => { const inp = el.parentElement.querySelector('input'); if (inp) { inp.select(); } else { const r = document.createRange(); r.selectNodeContents(el.parentElement.querySelector('.room-code')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
      try { navigator.clipboard.writeText(txt).then(done, fallback); } catch (e) { fallback(); }
      return true;
    }
    return false;
  }

  // ---------------- изглед ----------------
  function diceView() {
    // хвърляне за начало: вашият зар е във вашата половина (вдясно), на противника — вляво
    if ((G.phase === 'opening' || G.phase === 'opening-done') && G.openingDice) return { dice: [{ v: G.openingDice[0], p: 0, side: 'right' }, { v: G.openingDice[1], p: 1, side: 'left' }].filter((d) => d.v != null), side: 'right' };
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
    if (G.online) Object.assign(view, seatLook());
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
    if (G.online) return onlinePanel();
    let h = '';
    const sc = score[G.mode];
    h += `<div class="panel-head"><div><span class="mode-tag ${G.training ? 'train' : 'game'}">${G.training ? 'Тренировка' : 'Игра'}</span> <span class="score">Резултат: вие <b>${sc.you}</b> : <b>${sc.cpu}</b> компютър</span></div>
      <button class="btn small ghost" data-a="new">Нова игра</button></div>`;
    h += `<div class="pips">Пипове: <b>вие ${E.pip(G.board, 0)}</b> · компютър ${E.pip(G.board, 1)} · извадени: ${E.offCount(G.board, 0)} / ${E.offCount(G.board, 1)}</div>`;

    // статус и бутони
    h += '<div class="status">';
    if (G.phase === 'opening') {
      const tie = G.openingDice && G.openingDice[0] === G.openingDice[1];
      h += `<div class="opening-step"><p class="step-no">Стъпка 1 · Кой започва?</p>`;
      if (tie) h += `<p class="big">Равенство — и двамата хвърлихте <b>${G.openingDice[0]}</b>. Хвърлете отново.</p>`;
      else h += `<p class="big">Всеки хвърля по един зар. По-високото число започва и играе двата зара.</p>`;
      h += `<p class="dice-key"><i class="die-chip red"></i> вашият зар (белите пулове) · <i class="die-chip white"></i> зарът на компютъра (черните)</p>`;
      h += `<button class="btn primary" data-a="opening">🎲 ${tie ? 'Хвърли отново' : 'Хвърли за начало'}</button></div>`;
    } else if (G.phase === 'opening-done') {
      const [a, c] = G.openingDice, you = G.openWinner === HUMAN;
      h += `<div class="opening-step"><p class="step-no">Стъпка 1 · Кой започва?</p>`;
      h += `<p class="big">Вие: <b>${a}</b> · Компютърът: <b>${c}</b>.</p>`;
      h += `<p class="big">${you ? `<b>Вие започвате</b> и играете ${a} и ${c}.` : `<b>Компютърът започва</b> и играе ${c} и ${a}.`}</p>`;
      h += `<button class="btn primary" data-a="begin">▶ Започни играта</button></div>`;
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
    if (G.online && onlineAction(a, el)) return;
    if (a === 'new') { newGame(G.mode); render(); }
    else if (a === 'opening') openingRoll();
    else if (a === 'begin') beginGame();
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
  function onPanelSubmit(e) {
    const f = e.target.closest('form[data-form="join-room"]');
    if (!f || !G || !G.online) return;
    e.preventDefault();
    const name = String(new FormData(f).get('name') || '').trim().slice(0, 20);
    if (!name) { G.online.error = 'Въведете име, за да влезете в стаята.'; render(); return; }
    ON().rememberName(name);
    const seat = { token: ON().newToken(), name };
    ON().saveSeat(G.online.code, seat.token, name);
    G.phase = 'connecting';
    openConn(seat);
    render();
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
    $('#panel').addEventListener('submit', onPanelSubmit);
    if (!window.TablaOnline || !window.TablaOnline.available) document.querySelectorAll('[data-online]').forEach((el) => { el.hidden = true; });
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
    confirm: () => endHumanTurn(), roll: (d) => startHumanTurn(d), opening: () => openingRoll(), begin: () => beginGame(),
  };
  document.addEventListener('DOMContentLoaded', init);
})();
