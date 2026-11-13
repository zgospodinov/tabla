/* Стратегии — превръща записа на ходовете в проверени ходове на engine-а.
   Записът е с номерацията на дъската (от гледна точка на белите):
   белите (p 0) се движат от 24 към 1, черните (p 1) — от 1 към 24. „бар“ и „вън“ са специални. */
(function (root) {
  'use strict';
  const E = root.TablaEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  function idx(p, tok) {
    if (tok === 'бар' || tok === 'bar') return 24;
    if (tok === 'вън' || tok === 'off') return -1;
    const n = Number(tok);
    if (!(n >= 1 && n <= 24)) throw new Error('Непозната точка: ' + tok);
    return p === 0 ? n - 1 : 24 - n;
  }

  function setupBoard(s) {
    if (!s || s === 'start') return E.initialBoard();
    const b = [new Array(25).fill(0), new Array(25).fill(0)];
    [['w', 0], ['b', 1]].forEach(([k, p]) => {
      for (const [pt, c] of Object.entries(s[k] || {})) b[p][idx(p, pt)] += c;
    });
    for (const p of [0, 1]) {
      const n = b[p].reduce((a, x) => a + x, 0);
      if (n > 15) throw new Error('Повече от 15 пула за ' + p);
    }
    return b;
  }

  // "13/7*/4 8/4(2)" → [{from,to}, ...] с отделни сегменти
  function parse(p, text) {
    const segs = [];
    for (let tok of text.trim().split(/\s+/)) {
      let mult = 1;
      const mm = tok.match(/^(.*)\((\d)\)$/);
      if (mm) { tok = mm[1]; mult = Number(mm[2]); }
      const pts = tok.replace(/\*/g, '').split('/');
      const chain = [];
      for (let k = 0; k < pts.length - 1; k++) chain.push({ from: idx(p, pts[k]), to: idx(p, pts[k + 1]) });
      for (let r = 0; r < mult; r++) segs.push(...chain);
    }
    return segs;
  }

  // намира последователност от единични ходове, която изпълнява сегментите
  function resolve(board, p, rem, segs) {
    function rec(b, rem, si, cur, acc) {
      if (si === segs.length) return { board: b, moves: acc, rem };
      const seg = segs[si];
      const from = cur === null ? seg.from : cur;
      for (const d of E.uniq(rem)) {
        for (const m of E.singleMoves(b, p, d)) {
          if (m.from !== from) continue;
          const nb = E.applyMove(b, p, m), nr = E.removeOne(rem, d);
          if (m.to === seg.to) {
            const r = rec(nb, nr, si + 1, null, acc.concat([m]));
            if (r) return r;
          } else if (m.to >= 0 && seg.to !== -1 ? m.to > seg.to : m.to >= 0 && seg.to === -1) {
            const r = rec(nb, nr, si, m.to, acc.concat([m]));
            if (r) return r;
          }
        }
      }
      return null;
    }
    return rec(board, rem, 0, null, []);
  }

  /** Превръща сценария в стъпки с дъски преди/след; хвърля грешка при нелегален ход. */
  function compile(strat) {
    let board = setupBoard(strat.setup);
    const out = [];
    strat.steps.forEach((st, n) => {
      const where = `${strat.id} ход ${n + 1} (${st.p === 0 ? 'бели' : 'черни'} ${st.dice.join('-')} ${st.play})`;
      const rem = E.remFromDice(st.dice);
      const legal = E.generatePlays(board, st.p, rem);
      let moves = [];
      if (st.play !== '—') {
        const r = resolve(board, st.p, rem, parse(st.p, st.play));
        if (!r) throw new Error('Невъзможен запис: ' + where);
        moves = r.moves;
      }
      const after = E.applyMoves(board, st.p, moves);
      if (legal.length) {
        const ok = legal.some((pl) => E.key(pl.board) === E.key(after));
        if (!ok) throw new Error('Нелегален ход (трябва да се изиграят повече зарове или по-голямото число): ' + where);
      } else if (moves.length) throw new Error('Няма легален ход, а е записан: ' + where);
      out.push(Object.assign({}, st, { before: board, after, moves, notation: E.playText(st.p, moves) }));
      board = after;
    });
    return { start: setupBoard(strat.setup), steps: out };
  }

  const api = { setupBoard, parse, resolve, compile, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TablaStratCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
