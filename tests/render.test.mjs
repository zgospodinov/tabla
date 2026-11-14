// node tests/render.test.mjs — рисува картинки на грешките от примерна игра (PNG в email/preview-img/)
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const A = require('../js/analysis.js');
globalThis.TablaEngine = E;
const B = require('../js/board.js');
const UPNG = require('upng-js');
const { initWasm, Resvg } = await import('@resvg/resvg-wasm');
await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const font = fs.readFileSync(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'));
const roll = () => 1 + Math.floor(Math.random() * 6);
let b = E.initialBoard(), seat = 0; const record = [];
for (let t = 0; t < 400; t++) {
  const dice = [roll(), roll()];
  const pl = E.chooseAIPlay([b[seat], b[1 - seat]], 0, dice, seat === 0 ? 'easy' : 'hard');
  record.push({ game: 1, seat, dice, before: b, moves: pl ? pl.moves : [] });
  const after = pl ? pl.board : [b[seat], b[1 - seat]];
  b = seat === 0 ? after : [after[1], after[0]];
  if (E.offCount(b, seat) === 15) break;
  seat = 1 - seat;
}
const a = A.analyzeGame(E, record, 0, 1);
fs.mkdirSync('email/preview-img', { recursive: true });
let total = 0, bytes = 0;
for (const m of a.mistakes) {
  for (const [kind, moves, color] of [['played', m.playedMoves, '#d32f2f'], ['best', m.bestMoves, '#2e9e4f']]) {
    const svg = B.svgFlat({ board: m.before, colors: ['white', 'black'], flip: false, dice: m.diceArr.map((v) => ({ v, p: 0 })), diceSide: 'right', arrows: B.arrowsForPlay(m.before, 0, moves, color) });
    const t0 = Date.now();
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: 640 }, font: { fontBuffers: [font], defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false } });
    const img = r.render(); const png = Buffer.from(UPNG.encode([img.pixels.buffer.slice(img.pixels.byteOffset, img.pixels.byteOffset + img.pixels.byteLength)], img.width, img.height, 96));
    total += Date.now() - t0; bytes += png.length;
    fs.writeFileSync(`email/preview-img/${m.n}-${kind}.png`, png);
  }
}
console.log('images', a.mistakes.length * 2, 'ms', total, 'KB', Math.round(bytes / 1024));
