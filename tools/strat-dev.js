// Помощник за писане на сценарии: node tools/strat-dev.js [id]
const E = require('../js/engine.js');
const C = require('../js/strat-core.js');
const { STRATS } = require('../js/strategies-data.js');
const show = (b) => {
  const w = [], k = [];
  for (let n = 24; n >= 1; n--) { const c = b[0][n - 1]; if (c) w.push(n + '×' + c); }
  for (let n = 1; n <= 24; n++) { const c = b[1][24 - n]; if (c) k.push(n + '×' + c); }
  if (b[0][24]) w.push('бар×' + b[0][24]); if (b[1][24]) k.push('бар×' + b[1][24]);
  return `Б: ${w.join(' ')} вън${E.offCount(b, 0)} | Ч: ${k.join(' ')} вън${E.offCount(b, 1)} | пипове Б${E.pip(b, 0)} Ч${E.pip(b, 1)}${E.isContact(b) ? '' : ' | БЕЗ КОНТАКТ'}`;
};
const only = process.argv[2];
for (const s of STRATS) {
  if (only && s.id !== only) continue;
  console.log('== ' + s.id);
  const strat = Object.assign({}, s, { steps: [] });
  let board = C.setupBoard(s.setup);
  console.log('   ' + show(board));
  for (const st of s.steps) {
    strat.steps.push(st);
    try {
      const r = C.compile(strat);
      const last = r.steps[r.steps.length - 1];
      console.log(`${String(strat.steps.length).padStart(2)} ${st.p ? 'Ч' : 'Б'} ${st.dice.join('-')} ${last.notation.padEnd(18)} ${show(last.after)}`);
      board = last.after;
    } catch (e) {
      console.log('ГРЕШКА: ' + e.message);
      const pl = E.generatePlays(board, st.p, E.remFromDice(st.dice));
      console.log('Легални: ' + pl.map((x) => E.playText(st.p, x.moves)).join(' | '));
      process.exitCode = 1;
      break;
    }
  }
}
