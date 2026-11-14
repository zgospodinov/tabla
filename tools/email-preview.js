// node tools/email-preview.js — изиграва примерна игра, прави анализ и рисува шаблона
// на писмото с тези данни в email/preview.html (за преглед в браузъра; не се качва).
// Рендерът тук е опростен: поддържа само {{ x }}, | default:"…", {% if %}, {% for %}…{% empty %}…{% endfor %}.
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const A = require('../js/analysis.js');
globalThis.TablaEngine = E;
const B = require('../js/board.js');
const UPNG = require('upng-js');
const { initWasm, Resvg } = require('@resvg/resvg-wasm');

const roll = () => 1 + Math.floor(Math.random() * 6);
function play() {
  let b = E.initialBoard(), seat = 0; const record = [];
  for (let t = 0; t < 400; t++) {
    const dice = [roll(), roll()];
    const pl = E.chooseAIPlay([b[seat], b[1 - seat]], 0, dice, seat === 0 ? 'easy' : 'hard');
    record.push({ game: 1, seat, dice, before: b, moves: pl ? pl.moves : [], auto: false });
    const after = pl ? pl.board : [b[seat], b[1 - seat]];
    b = seat === 0 ? after : [after[1], after[0]];
    if (E.offCount(b, seat) === 15) return { record, winner: seat };
    seat = 1 - seat;
  }
}
const { record, winner } = play();
const a = A.analyzeGame(E, record, 0, 1);
const params = {
  name: 'Иван', opponent: 'Мария', date: new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, ''),
  result: winner === 0 ? 'Спечелихте (+1).' : 'Този път Мария спечели.',
  summary: a.summary, accuracy: String(a.accuracy), scored: String(a.scored),
  best: String(a.counts.best), good: String(a.counts.good), ok: String(a.counts.ok), weak: String(a.counts.weak), bad: String(a.counts.bad),
  mistakes: a.mistakes.map((m) => Object.assign({}, m, { n: String(m.n) })), strengths: a.strengths, tips: a.tips,
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = (ctx, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
function render(tpl, ctx) {
  // цикли (без вложени цикли от същия вид)
  tpl = tpl.replace(/\{% for (\w+) in ([\w.]+) %\}([\s\S]*?)(?:\{% empty %\}([\s\S]*?))?\{% endfor %\}/g, (_, v, list, body, empty) => {
    const arr = get(ctx, list) || [];
    if (!arr.length) return render(empty || '', ctx);
    return arr.map((it) => render(body, Object.assign({}, ctx, { [v]: it }))).join('');
  });
  // условия (без else)
  let prev;
  do { prev = tpl; tpl = tpl.replace(/\{% if ([\w.]+) %\}((?:(?!\{% if )[\s\S])*?)\{% endif %\}/g, (_, c, body) => { const v = get(ctx, c); return v && (!Array.isArray(v) || v.length) ? body : ''; }); } while (tpl !== prev);
  return tpl.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*default:"([^"]*)")?\s*\}\}/g, (_, p, def) => { const v = get(ctx, p); return esc(v == null || v === '' ? (def || '') : v); });
}
async function images() {
  // същите картинки като в Worker-а (worker/render.js), записани до прегледа
  await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const font = fs.readFileSync(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'));
  const dir = path.join(__dirname, '..', 'email', 'preview-img');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  a.mistakes.forEach((m, k) => {
    for (const [kind, moves, color, field] of [['played', m.playedMoves, '#d32f2f', 'imgPlayed'], ['best', m.bestMoves, '#2e9e4f', 'imgBest']]) {
      const svg = B.svgFlat({ board: m.before, colors: ['white', 'black'], dice: m.diceArr.map((v) => ({ v, p: 0 })), diceSide: 'right', arrows: B.arrowsForPlay(m.before, 0, moves, color) });
      const r = new Resvg(svg, { fitTo: { mode: 'width', value: 640 }, font: { fontBuffers: [font], defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false } });
      const img = r.render(), px = img.pixels;
      const png = Buffer.from(UPNG.encode([px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength)], img.width, img.height, 96));
      fs.writeFileSync(path.join(dir, m.n + '-' + kind + '.png'), png);
      // в прегледа картинките са вградени (data:), за да се виждат навсякъде; в писмото са https:// адреси от R2
      params.mistakes[k][field] = 'data:image/png;base64,' + png.toString('base64');
    }
  });
}

(async () => {
await images();
const tpl = fs.readFileSync(path.join(__dirname, '..', 'email', 'analysis-template.html'), 'utf8');
const out = path.join(__dirname, '..', 'email', 'preview.html');
fs.writeFileSync(out, render(tpl, { params }));
console.log('written', out, 'accuracy', a.accuracy, 'mistakes', a.mistakes.length);
})();
