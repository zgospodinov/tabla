/* Картинки на дъската (PNG) за писмата с анализ.
 * Дъската се рисува със същия код като в приложението (js/board.js) и се превръща в PNG с resvg. */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import font from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf';
import E from '../js/engine.js';
import B from '../js/board.js';
import UPNG from 'upng-js';

globalThis.TablaEngine = globalThis.TablaEngine || E; // board.js чете двигателя оттук (за стрелките)

export const PLAYED_COLOR = '#d32f2f';
export const BEST_COLOR = '#2e9e4f';

let ready = null;
const fontData = new Uint8Array(font);

/** SVG на позицията преди хода, със стрелки за дадените ходове. Анализираният играч е 0. */
export function boardSvg(before, dice, moves, color, look) {
  const view = {
    board: before, colors: look.colors, flip: look.flip,
    dice: dice.map((v) => ({ v, p: 0 })), diceSide: 'right',
    arrows: B.arrowsForPlay(before, 0, moves, color),
  };
  return B.svgFlat(view);
}

export async function toPng(svg, width) {
  if (!ready) ready = initWasm(wasm);
  await ready;
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontBuffers: [fontData], defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false },
  });
  const img = r.render();
  const px = img.pixels, w = img.width, h = img.height;
  img.free(); r.free();
  // палитра от 96 цвята: картинката става ~35 KB вместо ~170 KB, без видима разлика
  return new Uint8Array(UPNG.encode([px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength)], w, h, 96));
}
