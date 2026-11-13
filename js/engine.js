/* Табла (обикновена / backgammon) — двигател: правила, генериране на ходове, оценка, обяснения.
 *
 * Представяне: board[p][i] — брой пулове на играч p на НЕГОВАТА точка i+1 (i = 0..23),
 * board[p][24] — пулове на бара. Всеки играч се движи от 24 към 1 по своята номерация.
 * Точка i на играч p съвпада с точка 23-i на противника.
 * Играч 0 = човекът (номерацията на дъската е неговата), играч 1 = компютърът.
 */
(function (root) {
  'use strict';
  const BAR = 24;

  // ---------- основни помощни ----------
  function initialBoard() {
    const b = [new Array(25).fill(0), new Array(25).fill(0)];
    for (const p of [0, 1]) { b[p][23] = 2; b[p][12] = 5; b[p][7] = 3; b[p][5] = 5; }
    return b;
  }
  const cloneBoard = (b) => [b[0].slice(), b[1].slice()];
  const key = (b) => b[0].join(',') + '|' + b[1].join(',');
  const sum = (a) => { let s = 0; for (const x of a) s += x; return s; };
  const offCount = (b, p) => 15 - sum(b[p]);
  function pip(b, p) { let s = b[p][BAR] * 25; for (let i = 0; i < 24; i++) s += b[p][i] * (i + 1); return s; }
  function allHome(b, p) {
    if (b[p][BAR]) return false;
    for (let i = 6; i < 24; i++) if (b[p][i]) return false;
    return true;
  }
  function rearmost(b, p) {
    if (b[p][BAR]) return 24;
    for (let i = 23; i >= 0; i--) if (b[p][i]) return i;
    return -1;
  }
  function isContact(b) {
    const r0 = rearmost(b, 0), r1 = rearmost(b, 1);
    if (r0 < 0 || r1 < 0) return false;
    return r0 + r1 > 23;
  }
  /** Номер на точката, както е изписан на дъската (гледната точка на човека). */
  function label(p, i) {
    if (i === BAR) return 'бар';
    if (i < 0) return 'вън';
    return p === 0 ? i + 1 : 24 - i;
  }
  const remFromDice = (d) => (d[0] === d[1] ? [d[0], d[0], d[0], d[0]] : [d[0], d[1]]);
  function removeOne(arr, v) { const r = arr.slice(); const i = r.indexOf(v); if (i >= 0) r.splice(i, 1); return r; }
  const uniq = (arr) => [...new Set(arr)];
  function ord(n) {
    const s = n === 1 ? '-ва' : n === 2 ? '-ра' : (n === 7 || n === 8) ? '-ма' : '-та';
    return n + s;
  }

  // ---------- ходове ----------
  function singleMoves(b, p, d) {
    const res = [], me = b[p], op = b[1 - p];
    if (me[BAR] > 0) {
      const to = 24 - d;
      if (op[23 - to] < 2) res.push({ from: BAR, to, die: d, hit: op[23 - to] === 1 });
      return res;
    }
    const home = allHome(b, p);
    for (let i = 23; i >= 0; i--) {
      if (!me[i]) continue;
      const to = i - d;
      if (to >= 0) {
        if (op[23 - to] < 2) res.push({ from: i, to, die: d, hit: op[23 - to] === 1 });
      } else if (home) {
        if (to === -1) res.push({ from: i, to: -1, die: d, hit: false });
        else {
          let higher = false;
          for (let k = i + 1; k < 6; k++) if (me[k]) { higher = true; break; }
          if (!higher) res.push({ from: i, to: -1, die: d, hit: false });
        }
      }
    }
    return res;
  }

  function applyMove(b, p, m) {
    const n = cloneBoard(b);
    n[p][m.from]--;
    if (m.to >= 0) {
      n[p][m.to]++;
      const oi = 23 - m.to;
      if (n[1 - p][oi] === 1) { n[1 - p][oi] = 0; n[1 - p][BAR]++; }
    }
    return n;
  }
  function applyMoves(b, p, moves) { let n = b; for (const m of moves) n = applyMove(n, p, m); return n; }

  /** Максимален брой зарове, които могат да се изиграят от тази позиция. */
  function maxPlayable(b, p, rem, memo) {
    if (!rem.length) return 0;
    memo = memo || new Map();
    const k = key(b) + '#' + rem.slice().sort().join('');
    if (memo.has(k)) return memo.get(k);
    let best = 0;
    outer: for (const d of uniq(rem)) {
      const rest = removeOne(rem, d);
      for (const m of singleMoves(b, p, d)) {
        const v = 1 + maxPlayable(applyMove(b, p, m), p, rest, memo);
        if (v > best) best = v;
        if (best === rem.length) break outer;
      }
    }
    memo.set(k, best);
    return best;
  }

  /** Всички легални пълни ходове (уникални крайни позиции). */
  function generatePlays(b, p, rem) {
    const results = new Map(), seen = new Set();
    let maxLen = 0;
    const distinct2 = rem.length === 2 && rem[0] !== rem[1];
    const orders = distinct2 ? [rem.slice(), rem.slice().reverse()] : [rem.slice()];
    function rec(board, order, k, seq) {
      const sk = key(board) + '#' + order.slice(k).join('');
      if (seen.has(sk)) return;
      seen.add(sk);
      let moved = false;
      if (k < order.length) {
        for (const m of singleMoves(board, p, order[k])) {
          moved = true;
          rec(applyMove(board, p, m), order, k + 1, seq.concat([m]));
        }
      }
      if (!moved) {
        const fk = key(board);
        if (seq.length > maxLen) maxLen = seq.length;
        const ex = results.get(fk);
        if (!ex || ex.moves.length < seq.length) results.set(fk, { moves: seq, board });
      }
    }
    for (const o of orders) rec(b, o, 0, []);
    let plays = [...results.values()].filter((x) => x.moves.length === maxLen);
    if (maxLen === 0) return [];
    if (maxLen === 1 && distinct2) {
      const hi = Math.max(rem[0], rem[1]);
      if (plays.some((x) => x.moves[0].die === hi)) plays = plays.filter((x) => x.moves[0].die === hi);
    }
    return plays;
  }

  /** Легални единични стъпки в средата на хода (за интерактивното местене). */
  function legalSteps(b, p, rem, needed, forcedDie) {
    const out = [];
    if (needed <= 0) return out;
    const memo = new Map();
    for (const d of uniq(rem)) {
      if (forcedDie && d !== forcedDie) continue;
      const rest = removeOne(rem, d);
      for (const m of singleMoves(b, p, d)) {
        if (1 + maxPlayable(applyMove(b, p, m), p, rest, memo) >= needed) out.push(m);
      }
    }
    return out;
  }

  /** Информация за началото на хода. */
  function analyzeTurn(b, p, dice) {
    const rem = remFromDice(dice);
    const plays = rankPlays(b, p, rem);
    const maxLen = plays.length ? plays[0].moves.length : 0;
    const forcedDie = (maxLen === 1 && rem.length === 2 && rem[0] !== rem[1]) ? plays[0].moves[0].die : null;
    return { rem, plays, maxLen, forcedDie };
  }

  // ---------- изстрели (колко хвърляния удрят единичен пул) ----------
  function shotInfo(b, p) {
    const o = 1 - p, me = b[p], op = b[o];
    const blots = [];
    for (let i = 0; i < 24; i++) if (me[i] === 1) blots.push(i);
    const per = {};
    blots.forEach((i) => (per[i] = 0));
    if (!blots.length) return { total: 0, per, blots };
    const sources = [];
    for (let j = 24; j >= 0; j--) if (op[j]) sources.push(j);
    const onBar = op[BAR];
    const open = (x) => x >= 0 && x < 24 && me[23 - x] < 2;
    let total = 0;
    for (let a = 1; a <= 6; a++) for (let c = 1; c <= 6; c++) {
      let any = false;
      for (const i of blots) {
        const t = 23 - i;
        let h = false;
        for (const j of sources) {
          if (j <= t) continue;
          if (onBar >= 2 && j !== BAR && a !== c) continue;
          if (onBar === 1 && j !== BAR && a !== c) {
            // единият зар отива за влизане — удря се само с другия, директно
            const d = j - t;
            const entA = open(24 - a), entC = open(24 - c);
            if ((entA && c === d) || (entC && a === d)) { h = true; break; }
            continue;
          }
          const d = j - t;
          if (a !== c) {
            if (a === d || c === d) h = true;
            else if (a + c === d && (open(j - a) || open(j - c))) h = true;
          } else {
            for (let k = 1; k <= 4; k++) {
              if (a * k === d) {
                let ok = true;
                for (let m = 1; m < k; m++) if (!open(j - a * m)) { ok = false; break; }
                if (ok) h = true;
                break;
              }
            }
          }
          if (h) break;
        }
        if (h) { per[i]++; any = true; }
      }
      if (any) total++;
    }
    return { total, per, blots };
  }

  // ---------- оценка на позицията ----------
  const PV = [1, 2, 3, 4.5, 6, 5.5, 5, 3.5, 2.5, 2.5, 2, 1.5, 1, 1, 1, 1, 1.5, 3, 3.5, 4.5, 4, 2.5, 2, 1.5];
  const PRIME = [0, 0, 1, 4, 9, 16, 28];

  function longestPrime(b, s) {
    let best = 0, bs = -1, run = 0;
    for (let i = 0; i <= 22; i++) {
      if (b[s][i] >= 2) { run++; if (run > best) { best = run; bs = i - run + 1; } } else run = 0;
    }
    return { len: best, start: bs };
  }
  function oppBehind(b, s, start) {
    for (let j = 24; j > 23 - start; j--) if (b[1 - s][j]) return true;
    return false;
  }
  function closedHome(b, s) { let c = 0; for (let k = 0; k < 6; k++) if (b[s][k] >= 2) c++; return c; }

  function sideScore(b, s) {
    const me = b[s];
    let sc = 0;
    for (let i = 0; i < 24; i++) {
      if (me[i] >= 2) sc += PV[i];
      if (me[i] > 3) sc -= (me[i] - 3) * (i < 6 ? 0.8 : 1.2);
    }
    // задни пулове в дома на противника и твърде дълбоки пулове губят гъвкавост
    for (let i = 18; i < 24; i++) sc -= me[i] * 1.6;
    sc -= me[0] * 1.6 + me[1] * 0.9;
    const pr = longestPrime(b, s);
    if (pr.len >= 2 && oppBehind(b, s, pr.start)) sc += PRIME[Math.min(6, pr.len)];
    if (me[BAR]) sc -= me[BAR] * (3 + closedHome(b, 1 - s) * 1.5);
    sc += offCount(b, s) * 1.5;
    return sc;
  }

  /** Оценка от гледна точка на p, след като p е изиграл и противникът е на ход. */
  function evaluate(b, p) {
    const o = 1 - p;
    if (offCount(b, p) === 15) return 1000 + (offCount(b, o) === 0 ? 500 : 0);
    const pd = pip(b, o) - pip(b, p);
    if (!isContact(b)) {
      let v = pd - 4 + (offCount(b, p) - offCount(b, o)) * 2;
      for (let i = 0; i < 6; i++) if (b[p][i] > 3) v -= (b[p][i] - 3) * 0.4;
      return v;
    }
    let v = pd * 0.9 + sideScore(b, p) - sideScore(b, o);
    const sh = shotInfo(b, p);
    const closedO = closedHome(b, o);
    let risk = 0;
    for (const i of sh.blots) risk += (sh.per[i] / 36) * ((24 - i) * 0.9 + 5 + closedO * 2);
    v -= risk * 0.85;
    return v;
  }

  function rankPlays(b, p, rem) {
    const plays = generatePlays(b, p, rem);
    for (const pl of plays) pl.score = evaluate(pl.board, p);
    plays.sort((x, y) => y.score - x.score);
    return plays;
  }

  /** Двуходова проверка за „трудно“ ниво: усредняваме най-добрия отговор на противника. */
  function lookahead(board, p) {
    const o = 1 - p;
    if (offCount(board, p) === 15) return 10000;
    let tot = 0, w = 0;
    for (let a = 1; a <= 6; a++) for (let c = a; c <= 6; c++) {
      const wt = a === c ? 1 : 2;
      const replies = generatePlays(board, o, remFromDice([a, c]));
      let best = -Infinity;
      if (!replies.length) best = evaluate(board, o);
      for (const r of replies) { const v = evaluate(r.board, o); if (v > best) best = v; }
      tot += -best * wt; w += wt;
    }
    return tot / w;
  }

  function chooseAIPlay(b, p, dice, level) {
    const plays = rankPlays(b, p, remFromDice(dice));
    if (!plays.length) return null;
    if (level === 'hard') {
      const cand = plays.slice(0, 5);
      if (cand.length === 1 || !isContact(b)) return plays[0];
      let best = cand[0], bv = -Infinity;
      for (const pl of cand) {
        const v = 0.5 * lookahead(pl.board, p) + 0.5 * pl.score;
        if (v > bv) { bv = v; best = pl; }
      }
      return best;
    }
    const noise = level === 'easy' ? 9 : 2.5;
    let best = null, bv = -Infinity;
    for (const pl of plays) {
      const v = pl.score + (Math.random() * 2 - 1) * noise;
      if (v > bv) { bv = v; best = pl; }
    }
    return best;
  }

  // ---------- текстове ----------
  function moveText(p, m) {
    const f = m.from === BAR ? 'бар' : label(p, m.from);
    const t = m.to < 0 ? 'вън' : label(p, m.to);
    return f + '/' + t + (m.hit ? '*' : '');
  }
  /** Нотация на целия ход; последователните стъпки на един пул се сливат (13/10 10/8 → 13/8). */
  function playText(p, moves) {
    if (!moves.length) return '—';
    const chains = [];
    const used = new Array(moves.length).fill(false);
    for (let k = 0; k < moves.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      const parts = [moves[k]];
      let cur = moves[k];
      for (let n = k + 1; n < moves.length; n++) {
        if (!used[n] && cur.to >= 0 && moves[n].from === cur.to) { used[n] = true; parts.push(moves[n]); cur = moves[n]; }
      }
      let s = (parts[0].from === BAR ? 'бар' : label(p, parts[0].from));
      parts.forEach((m, idx) => {
        const last = idx === parts.length - 1;
        if (m.hit || last) s += '/' + (m.to < 0 ? 'вън' : label(p, m.to)) + (m.hit ? '*' : '');
      });
      chains.push(s);
    }
    const counts = new Map();
    for (const c of chains) counts.set(c, (counts.get(c) || 0) + 1);
    return [...counts].map(([c, n]) => (n > 1 ? `${c}(${n})` : c)).join('  ');
  }

  function quality(diff) {
    if (diff < 0.3) return { text: 'Най-добър', cls: 'q-best' };
    if (diff < 2.5) return { text: 'Много добър', cls: 'q-good' };
    if (diff < 6) return { text: 'Приемлив', cls: 'q-ok' };
    if (diff < 12) return { text: 'Слаб', cls: 'q-weak' };
    return { text: 'Грешка', cls: 'q-bad' };
  }

  function countRange(arr, a, b) { let s = 0; for (let i = a; i <= b; i++) s += arr[i]; return s; }

  /**
   * Обяснение на ход: плюсове, минуси, информация.
   * opts.final=false — ходът още не е завършен (не оценяваме риска от изстрели).
   */
  function explainPlay(before, p, moves, after, opts) {
    opts = opts || {};
    const final = opts.final !== false;
    const o = 1 - p, you = p === 0;
    const V = (a, b) => (you ? a : b);
    const L = (i) => label(p, i);
    const pros = [], cons = [], info = [];
    const contactB = isContact(before), contactA = isContact(after);
    const own = (i) => (you ? `${ord(i + 1)} точка` : `своята ${ord(i + 1)} точка (№${L(i)} на дъската)`);

    // удари
    for (const m of moves) {
      if (!m.hit) continue;
      pros.push(V(
        `Удряте единичния пул на противника на точка ${L(m.to)} — той отива на бара, губи ${m.to + 1} пипа и трябва първо да влезе отново.`,
        `Удря ваш единичен пул на точка ${L(m.to)} — вашият пул отива на бара и губите ${m.to + 1} пипа.`));
    }
    const entered = before[p][BAR] - after[p][BAR];
    if (entered > 0) info.push(V(`Влизате от бара с ${entered === 1 ? 'един пул' : entered + ' пула'}.`, `Влиза от бара с ${entered === 1 ? 'един пул' : entered + ' пула'}.`));
    const offN = offCount(after, p) - offCount(before, p);
    if (offN > 0) pros.push(V(`Изваждате ${offN === 1 ? 'един пул' : offN + ' пула'} — по-близо до победата.`, `Изважда ${offN === 1 ? 'един пул' : offN + ' пула'}.`));

    // направени точки
    for (let i = 0; i < 24; i++) {
      if (before[p][i] < 2 && after[p][i] >= 2) {
        const vb = V('Затваряте', 'Затваря');
        let t;
        if (i === 4) t = `${vb} ${own(i)} — „златната точка“, най-ценната точка в началото на играта.`;
        else if (i === 5) t = `${vb} ${own(i)} — силна точка в домашното поле.`;
        else if (i === 6) t = `${vb} бар точката (${own(i)}) — тя спира задните пулове на противника.`;
        else if (i < 6) t = `${vb} ${own(i)} в домашното поле — противникът ще влиза по-трудно от бара.`;
        else if (i >= 18) t = `${V('Правите', 'Прави')} „котва“ на ${own(i)} в дома на противника — сигурна опора за задните пулове.`;
        else t = `${vb} ${own(i)} — безопасно място и препятствие за противника.`;
        pros.push(t);
      }
    }
    // развалени точки
    if (contactA) {
      for (let i = 0; i < 24; i++) {
        if (before[p][i] >= 2 && after[p][i] < 2) {
          cons.push(`${V('Разваляте', 'Разваля')} затворената точка ${L(i)}${after[p][i] === 1 ? ' и там остава единичен пул' : ''}.`);
        }
      }
    }
    // бягство на задните пулове
    if (contactB) {
      const bb = countRange(before[p], 18, 24), ba = countRange(after[p], 18, 24);
      if (ba < bb) pros.push(V(
        `Изтегляте ${bb - ba === 1 ? 'заден пул' : (bb - ba) + ' задни пула'} от дома на противника — по-малък риск да бъдат блокирани.`,
        `Изтегля ${bb - ba === 1 ? 'заден пул' : (bb - ba) + ' задни пула'} от вашия дом.`));
    }
    // прайм
    const pb = longestPrime(before, p).len, pa = longestPrime(after, p).len;
    if (pa > pb && pa >= 3) pros.push(`${V('Изграждате', 'Изгражда')} блокада („прайм“) от ${pa} поредни затворени точки — пуловете зад нея минават трудно.`);

    // изстрели
    if (final && contactA) {
      const sh = shotInfo(after, p);
      const exposed = sh.blots.filter((i) => sh.per[i] > 0);
      if (sh.total > 0) {
        const pct = Math.round((sh.total * 100) / 36);
        const where = exposed.length === 1 ? `единичен пул на точка ${L(exposed[0])}` : `единични пулове на точки ${exposed.map(L).join(', ')}`;
        const risk = pct <= 12 ? ' — малък риск' : pct >= 40 ? ' — голям риск' : '';
        cons.push(V(
          `Оставяте ${where}: противникът ви удря с <b>${sh.total} от 36</b> хвърляния (≈${pct}%)${risk}.`,
          `Оставя ${where}: можете да го ударите с <b>${sh.total} от 36</b> хвърляния (≈${pct}%).`));
      } else if (sh.blots.length) {
        info.push(`Единичните пулове (${sh.blots.map(L).join(', ')}) са извън обсега на противника — засега са в безопасност.`);
      } else {
        const shB = contactB ? shotInfo(before, p).total : 0;
        if (shB > 0) pros.push(V('Прибирате уязвимите пулове — нямате единични пулове за удряне.', 'Не оставя уязвими пулове.'));
        else info.push(V('Нямате единични (уязвими) пулове.', 'Няма уязвими пулове.'));
      }
    }
    if (contactB && !contactA) info.push('Контактът е прекъснат — оттук нататък е чисто надбягване: печели който изведе по-бързо.');
    // трупане
    for (let i = 0; i < 24; i++) {
      if (after[p][i] >= 6 && after[p][i] > before[p][i] && contactA) {
        cons.push(`${V('Трупате', 'Трупа')} ${after[p][i]} пула на точка ${L(i)} — губи се гъвкавост, пуловете не работят.`);
      }
    }
    // противник на бара срещу затворен дом
    if (after[o][BAR] > 0) {
      const closed = closedHome(after, p);
      if (closed >= 3) pros.push(V(`Противникът е на бара срещу ${closed} затворени точки във вашия дом — трудно ще влезе.`, `Вие сте на бара срещу ${closed} затворени точки в дома му.`));
    }
    info.push(`Пипове след хода: ${V('вие', 'компютърът')} ${pip(after, p)}, ${V('компютърът', 'вие')} ${pip(after, o)} (по-малко = по-напред).`);
    return { pros, cons, info };
  }

  /** Правила, които важат точно в този ход (за тренировъчния режим). */
  function turnNotes(b, p, dice, plays, maxLen, forcedDie) {
    const notes = [];
    const rem = remFromDice(dice);
    if (dice[0] === dice[1]) {
      notes.push(`<b>Чифт ${dice[0]}–${dice[0]}!</b> При чифт числото се играе <b>четири пъти</b> — 4 хода по ${dice[0]} (с един или с няколко пула).`);
    } else {
      notes.push(`Хвърлихте <b>${dice[0]} и ${dice[1]}</b>. Това са два отделни хода — един с ${dice[0]} и един с ${dice[1]}. Може с два различни пула или с един пул общо ${dice[0] + dice[1]} точки (ако междинната точка е отворена).`);
    }
    if (b[p][BAR] > 0) {
      let t = `Имате <b>${b[p][BAR] === 1 ? 'пул' : b[p][BAR] + ' пула'} на бара</b>. Правило: докато има ваш пул на бара, не можете да местите други пулове. Влизате в дома на противника (точки 19–24): с число N влизате на точка ${'25 − N'}.`;
      const bl = uniq(rem).filter((d) => b[1 - p][23 - (24 - d)] >= 2);
      if (bl.length) t += ' ' + bl.map((d) => `Точка ${25 - d} е затворена — с ${d} не може да се влезе.`).join(' ');
      notes.push(t);
    }
    if (maxLen === 0) notes.push('<b>Няма възможен ход.</b> Когато никое от числата не може да се изиграе, губите хода си.');
    else if (maxLen < rem.length && !forcedDie) notes.push(`Могат да се изиграят само <b>${maxLen} от ${rem.length}</b> хода. Правило: длъжни сте да изиграете колкото е възможно повече числа; останалите се губят.`);
    if (forcedDie) {
      const hi = Math.max(dice[0], dice[1]);
      notes.push(forcedDie === hi
        ? `Може да се изиграе само едно от двете числа. Правило: в такъв случай е задължително да изиграете <b>по-голямото</b> — ${hi}.`
        : `Може да се изиграе само ${forcedDie} — с ${hi} няма възможен ход.`);
    }
    if (allHome(b, p)) notes.push('Всички ваши пулове са в дома (точки 1–6) — <b>можете да изваждате</b>. С число N вадите пул от точка N. Ако там няма пул, местите пул вътре в дома; ако на по-високите точки няма пулове, вадите от най-високата заета точка.');
    if (plays.some((pl) => pl.moves.some((m) => m.hit))) notes.push('Имате възможност да <b>ударите</b> единичен пул на противника. Ударен пул отива на бара и трябва да мине целия път отначало.');
    if (!isContact(b)) notes.push('Пуловете вече са се разминали — няма контакт. Важи само скоростта: не губете пипове и изваждайте бързо.');
    return notes;
  }

  /** Защо пулът на точка i не може да се мести. */
  function whyCannot(b, p, i, rem, needed, forcedDie) {
    if (needed <= 0) return 'Вече изиграхте всички възможни числа. Потвърдете хода или го отменете.';
    if (b[p][BAR] > 0 && i !== BAR) return 'Имате пул на бара. Правило: първо вкарвате всички пулове от бара и чак тогава можете да местите други.';
    const reasons = [];
    for (const d of uniq(rem)) {
      if (forcedDie && d !== forcedDie) continue;
      const to = i - d;
      if (to >= 0) {
        if (b[1 - p][23 - to] >= 2) reasons.push(`С ${d} пулът стига точка ${label(p, to)}, която е затворена от противника (2 или повече пула).`);
        else reasons.push(`С ${d} ходът сам по себе си е възможен, но тогава няма да можете да изиграете всички числа — правилото задължава да изиграете максимално много.`);
      } else if (!allHome(b, p)) {
        reasons.push(`С ${d} пулът би излязъл от дъската, но изваждане е позволено само когато всички пулове са в дома (точки 1–6).`);
      } else {
        reasons.push(`С ${d} не може да се извади от точка ${i + 1}: има пулове на по-високи точки в дома, които трябва да се изиграят първо.`);
      }
    }
    if (forcedDie) reasons.push(`Може да се изиграе само едно число и то трябва да е ${forcedDie}.`);
    return uniq(reasons).join(' ');
  }

  const api = {
    BAR, initialBoard, cloneBoard, key, offCount, pip, allHome, isContact, label, ord,
    remFromDice, removeOne, uniq, singleMoves, applyMove, applyMoves, maxPlayable,
    generatePlays, legalSteps, analyzeTurn, shotInfo, evaluate, rankPlays, chooseAIPlay,
    moveText, playText, quality, explainPlay, turnNotes, whyCannot, closedHome,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TablaEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
