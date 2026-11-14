// node tests/analysis.test.js — изиграва игра между двама ботове и проверява анализа
const E = require('../js/engine.js');
const A = require('../js/analysis.js');
const assert = require('assert');
const roll = () => 1 + Math.floor(Math.random() * 6);
function play(levels) {
  // сървърна номерация: board[seat]; ходовете са в номерацията на играча
  let b = E.initialBoard(), seat = 0; const record = [];
  for (let t = 0; t < 400; t++) {
    const dice = [roll(), roll()];
    const mine = [b[seat], b[1 - seat]];
    const pl = E.chooseAIPlay(mine, 0, dice, levels[seat]);
    const moves = pl ? pl.moves : [];
    record.push({ game: 1, seat, dice, before: b, moves, auto: false });
    const after = pl ? pl.board : mine;
    b = seat === 0 ? after : [after[1], after[0]];
    if (E.offCount(b, seat) === 15) return record;
    seat = 1 - seat;
  }
  throw new Error('no finish');
}
const rec = play(['hard', 'easy']);
let t0 = Date.now();
const a0 = A.analyzeGame(E, rec, 0, 1), a1 = A.analyzeGame(E, rec, 1, 1);
const ms = Date.now() - t0;
console.log('turns', rec.length, 'ms', ms);
console.log('hard:', a0.accuracy + '%', a0.counts, a0.summary);
console.log('easy:', a1.accuracy + '%', a1.counts, a1.summary);
console.log(JSON.stringify(a1.mistakes[0]), a1.tips);
assert.ok(a0.scored > 0 && a1.scored > 0);
assert.ok(a0.accuracy >= a1.accuracy - 10, 'по-силният бот трябва да е поне колкото по-слабия');
assert.ok(a1.mistakes.length <= 5);
console.log('analysis ok');
