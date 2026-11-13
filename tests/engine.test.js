// node tests/engine.test.js
const E = require('../js/engine.js');
const assert = require('assert');
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('ok -', name); }
const empty = () => [new Array(25).fill(0), new Array(25).fill(0)];

t('initial pips 167', () => { const b = E.initialBoard(); assert.equal(E.pip(b, 0), 167); assert.equal(E.pip(b, 1), 167); });
t('opening 3-1 has 8/5 6/5 as best-ish', () => {
  const pl = E.rankPlays(E.initialBoard(), 0, [3, 1]);
  assert.ok(pl.length > 5);
  assert.equal(E.playText(0, pl[0].moves).split('  ').sort().join(' '), ['6/5', '8/5'].join(' '));
});
t('bar must enter first', () => {
  const b = E.initialBoard(); b[0][5]--; b[0][24] = 1;
  const pl = E.generatePlays(b, 0, [6, 5]);
  assert.ok(pl.every(x => x.moves[0].from === 24));
});
t('blocked entry => no moves', () => {
  const b = empty(); b[0][24] = 1; b[0][5] = 14;
  for (let k = 0; k < 6; k++) b[1][k] = 2; b[1][10] = 3;
  assert.equal(E.generatePlays(b, 0, [6, 5]).length, 0);
});
t('higher die rule', () => {
  // only one die playable: checker on 24-pt (idx 23); opponent blocks so that only one of 6/5 works but not both
  const b = empty(); b[0][23] = 1; b[0][0] = 14;
  // block 6-away (idx17 -> opp idx 6) and 11-away (idx12 -> opp idx 11), and (idx 18 after 5)-6 = idx12 blocked, idx17 blocked
  b[1][6] = 2; b[1][11] = 2; b[1][23 - 7] = 2; b[1][2] = 9;
  // moves from 1-pt (idx0) impossible (not all home). So 5: idx23->18 ok; then 6: 18->12 blocked. 6: 23->17 blocked.
  const pl = E.generatePlays(b, 0, [6, 5]);
  assert.equal(pl.length, 1); assert.equal(pl[0].moves[0].die, 5);
});
t('bear off with higher die from highest point', () => {
  const b = empty(); b[0][2] = 2; b[0][0] = 1; b[1][20] = 15;
  const pl = E.generatePlays(b, 0, [6, 5]);
  assert.ok(pl.length >= 1);
  assert.equal(E.offCount(pl[0].board, 0), 14);
});
t('cannot bear off with higher die if higher checker', () => {
  const b = empty(); b[0][4] = 1; b[0][1] = 1; b[0][10] = 0; b[1][20] = 15;
  const ms = E.singleMoves(b, 0, 3);
  // from idx1 with 3: to=-2, higher checker at idx4 -> not allowed; from idx4 -> idx1 ok
  assert.ok(!ms.some(m => m.from === 1 && m.to === -1));
});
t('doubles four moves', () => {
  const pl = E.generatePlays(E.initialBoard(), 0, [2, 2, 2, 2]);
  assert.ok(pl.every(x => x.moves.length === 4));
});
t('shot count direct 6 = 17/36? (single blot 6 away, no blocks)', () => {
  const b = empty(); b[0][10] = 1; b[0][0] = 14; // blot on my 11 -> opp idx 12
  b[1][19] = 1; b[1][0] = 14; // opp idx 19, blot at opp idx 13 -> distance 6
  assert.equal(E.shotInfo(b, 0).total, 17);
});
t('random self-play games are consistent', () => {
  for (let g = 0; g < 60; g++) {
    let b = E.initialBoard(), p = g % 2, turns = 0;
    while (true) {
      const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      const pl = E.chooseAIPlay(b, p, d, g % 3 === 0 ? 'easy' : 'normal');
      if (pl) {
        // verify step-wise legality via legalSteps
        let cur = b, rem = E.remFromDice(d); const info = E.analyzeTurn(b, p, d);
        pl.moves.forEach((m, k) => {
          const steps = E.legalSteps(cur, p, rem, info.maxLen - k, k === 0 ? info.forcedDie : null);
          assert.ok(steps.some(s => s.from === m.from && s.to === m.to && s.die === m.die), 'step legal');
          cur = E.applyMove(cur, p, m); rem = E.removeOne(rem, m.die);
        });
        b = pl.board;
      }
      for (const q of [0, 1]) { const tot = b[q].reduce((a, x) => a + x, 0) + E.offCount(b, q); assert.equal(tot, 15); assert.ok(b[q].every(x => x >= 0)); }
      for (let i = 0; i < 24; i++) assert.ok(!(b[0][i] && b[1][23 - i]), 'no shared point');
      if (E.offCount(b, p) === 15) break;
      p = 1 - p; if (++turns > 2000) throw new Error('too long');
    }
  }
});
t('hard AI runs fast', () => {
  const t0 = Date.now(); E.chooseAIPlay(E.initialBoard(), 1, [3, 3], 'hard'); const dt = Date.now() - t0;
  console.log('   hard 3-3 opening ms:', dt); assert.ok(dt < 3000);
});
t('explain produces text', () => {
  const b = E.initialBoard(); const pl = E.rankPlays(b, 0, [6, 5]);
  const ex = E.explainPlay(b, 0, pl[0].moves, pl[0].board);
  assert.ok(ex.pros.length + ex.info.length > 0);
});
t('strategy scenarios are legal', () => {
  const C = require('../js/strat-core.js');
  const { STRATS } = require('../js/strategies-data.js');
  assert.ok(STRATS.length >= 5);
  for (const s of STRATS) {
    const r = C.compile(s);
    assert.strictEqual(r.steps.length, s.steps.length);
    for (const st of r.steps) assert.ok(st.text && st.text.length > 20, s.id + ': липсва обяснение');
  }
});
console.log(`\n${pass} tests passed`);
