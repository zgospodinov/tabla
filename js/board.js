/* SVG дъска за табла. Номерацията на точките е от гледна точка на човека (играч 0). */
(function (root) {
  'use strict';
  const W = 920, H = 660, L = 30, BARX = 390, BARW = 60, RX = 450, TOP = 30, BOT = 630, PH = 250, R = 26;
  const TRAYX = 832, TRAYW = 64, MID = 330;
  const COL_A = '#8c2f1c', COL_B = '#efe2c2';

  function pointX(h) {
    const n = h + 1;
    if (n <= 6) return RX + (6 - n) * 60 + 30;
    if (n <= 12) return L + (12 - n) * 60 + 30;
    if (n <= 18) return L + (n - 13) * 60 + 30;
    return RX + (n - 19) * 60 + 30;
  }
  const isTop = (h) => h >= 12;
  const toH = (p, i) => (p === 0 ? i : 23 - i);
  function stackStep(count) { return count > 5 ? Math.min(2 * R, (PH + 14 - 2 * R) / (count - 1)) : 2 * R; }
  function stackPos(h, k, count) {
    const st = stackStep(Math.max(count, k + 1));
    const x = pointX(h);
    return isTop(h) ? { x, y: TOP + R + k * st } : { x, y: BOT - R - k * st };
  }
  const barPos = (p, k) => ({ x: BARX + BARW / 2, y: p === 0 ? MID + 42 + k * 40 : MID - 42 - k * 40 });
  const offPos = (p, k) => (p === 0 ? { x: TRAYX + TRAYW / 2, y: BOT - 9 - k * 15 } : { x: TRAYX + TRAYW / 2, y: TOP + 9 + k * 15 });
  const offCount = (b, p) => 15 - b[p].reduce((a, x) => a + x, 0);

  /** Позиция на пул на собствена точка i (24 = бар, -1 = вън), слот k. */
  function slotPos(b, p, i, k) {
    if (i === 24) return barPos(p, k);
    if (i < 0) return offPos(p, k);
    const h = toH(p, i);
    return stackPos(h, k, Math.max(b[p][i], k + 1));
  }
  function topPos(b, p, i) {
    const c = i < 0 ? offCount(b, p) : b[p][i];
    return slotPos(b, p, i, Math.max(0, c - 1));
  }

  /** Стрелки за поредица от ходове. */
  function arrowsForPlay(board, p, moves, color) {
    const E = root.TablaEngine;
    const out = [];
    let b = board;
    for (const m of moves) {
      const from = topPos(b, p, m.from);
      let to;
      if (m.to < 0) to = offPos(p, offCount(b, p));
      else to = slotPos(b, p, m.to, m.hit ? 0 : b[p][m.to]);
      out.push({ from, to, color: color || '#f5b301', hit: m.hit });
      b = E.applyMove(b, p, m);
    }
    return out;
  }

  const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  // Всеки играч хвърля своя чифт: белите пулове — с червени зарове, черните — с бели.
  function dieSvg(x, y, v, red, used, size) {
    const s = size, r = s * 0.09, off = s * 0.26;
    let g = `<g class="die ${red ? 'red' : 'white'}${used ? ' used' : ''}" transform="translate(${x},${y})">`;
    g += `<rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="${s * 0.18}" fill="${red ? '#c62828' : '#fffdf6'}" stroke="${red ? '#7f1010' : '#8a7a55'}" stroke-width="2"/>`;
    for (const [dx, dy] of PIPS[v]) g += `<circle cx="${dx * off}" cy="${dy * off}" r="${r}" fill="${red ? '#fffaf0' : '#222'}"/>`;
    return g + '</g>';
  }

  let UID = '';
  let uidCounter = 0;
  // Цвят на пуловете на всеки играч и огледален изглед (дом отляво) — задават се за всяко рисуване.
  let COLORS = ['white', 'black'], MIR = false;
  const isW = (p) => COLORS[p] === 'white';
  const mx = (x) => (MIR ? W - x : x);
  function checkerSvg(x, y, p, extraCls) {
    const w = isW(p);
    const fill = w ? `url(#chkW${UID})` : `url(#chkB${UID})`;
    const stroke = w ? '#9c8a5c' : '#000';
    return `<g class="chk ${extraCls || ''}"><circle cx="${x}" cy="${y}" r="${R - 1}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
      `<circle cx="${x}" cy="${y}" r="${R - 9}" fill="none" stroke="${w ? '#d8cba4' : '#4a4a4a'}" stroke-width="1.5"/></g>`;
  }

  /**
   * view = { board, interactive, dice:[{v,p,used}], diceSide:'left'|'right',
   *   sources:[ownIdx], selected:ownIdx|null, dests:[{i, color}], ghost:{i,p}, arrows:[...], zones:bool, lastArrows:[...] }
   * Индексите в sources/selected/dests са собствени индекси на човека (24 = бар, -1 = вън).
   */
  function svg(view) {
    const b = view.board;
    UID = 'u' + (++uidCounter);
    COLORS = view.colors || ['white', 'black'];
    MIR = !!view.flip;
    let T = ''; // текстове и зарове — рисуват се извън огледалната група, за да не се обръщат
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="board-svg" role="img" aria-label="Дъска за табла">`;
    // самостоятелна картинка (PNG за писмата): стиловете не идват от CSS на страницата
    if (view.standalone) s += `<style>text{font-family:'DejaVu Sans',Arial,sans-serif}.pt-num{fill:#f2dfb8;font-size:15px;font-weight:700}.stack-num{font-size:19px;font-weight:700;fill:#3a2a10}.stack-num.dark{fill:#fff}.center-text{font-size:34px;font-weight:700;fill:#fff6dc;paint-order:stroke;stroke:#4a2a14;stroke-width:5px}.die.used{opacity:.3}.zone-label{fill:#fff3d6;font-size:13px;font-weight:700}</style>`;
    s += `<defs>
      <radialGradient id="chkW${UID}" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e9dfc4"/></radialGradient>
      <radialGradient id="chkB${UID}" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#5a5a5a"/><stop offset="100%" stop-color="#151515"/></radialGradient>
      <linearGradient id="wood${UID}" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#e2bf86"/><stop offset="100%" stop-color="#cfa66a"/></linearGradient>
      ${['#f5b301', '#2e9e4f', '#7cb342', '#f0a020', '#e06020', '#d32f2f', '#5aa0ff', '#9aa0a6'].map((c, k) => `<marker id="ah${k}${UID}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('')}
    </defs>`;
    // рамка и полета (при огледален изглед цялата геометрия се обръща хоризонтално)
    s += MIR ? `<g transform="translate(${W},0) scale(-1,1)">` : '<g>';
    s += `<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="#4a2a14"/>`;
    s += `<rect x="${L}" y="${TOP}" width="360" height="600" fill="url(#wood${UID})"/>`;
    s += `<rect x="${RX}" y="${TOP}" width="360" height="600" fill="url(#wood${UID})"/>`;
    s += `<rect x="${BARX}" y="${TOP}" width="${BARW}" height="600" fill="#5c3519"/>`;
    s += `<rect x="${TRAYX}" y="${TOP}" width="${TRAYW}" height="${PH + 20}" rx="6" fill="#2e1a0c" class="${view.offDest ? 'tray-dest' : ''}"/>`;
    s += `<rect x="${TRAYX}" y="${BOT - PH - 20}" width="${TRAYW}" height="${PH + 20}" rx="6" fill="#2e1a0c" class="${view.offDest ? 'tray-dest' : ''}" ${view.offDest ? `stroke="${view.offDest}" stroke-width="5"` : ''}/>`;
    // точки
    for (let h = 0; h < 24; h++) {
      const x = pointX(h), col = h % 2 === 0 ? COL_A : COL_B;
      const pts = isTop(h) ? `${x - 29},${TOP} ${x + 29},${TOP} ${x},${TOP + PH}` : `${x - 29},${BOT} ${x + 29},${BOT} ${x},${BOT - PH}`;
      s += `<polygon points="${pts}" fill="${col}" stroke="#00000022"/>`;
    }
    // зони
    if (view.zones) {
      const z = (x, y, t) => `<text x="${mx(x)}" y="${y}" class="zone-label" text-anchor="middle">${t}</text>`;
      T += z(630, MID + 26, 'ВАШИЯТ ДОМ (1–6)') + z(210, MID + 26, 'ВЪНШНО ПОЛЕ (7–12)') + z(210, MID - 16, 'ВЪНШНО ПОЛЕ НА ПРОТИВНИКА (13–18)') + z(630, MID - 16, 'ДОМ НА ПРОТИВНИКА (19–24)');
    }
    // номера
    for (let h = 0; h < 24; h++) {
      const x = pointX(h), y = isTop(h) ? 20 : H - 10;
      T += `<text x="${mx(x)}" y="${y}" class="pt-num" text-anchor="middle">${h + 1}</text>`;
    }
    T += `<text x="${mx(TRAYX + TRAYW / 2)}" y="${H - 10}" class="pt-num" text-anchor="middle">вън</text>`;
    // дестинации
    for (const d of view.dests || []) {
      if (d.i < 0) continue;
      const x = pointX(d.i);
      const pts = isTop(d.i) ? `${x - 29},${TOP} ${x + 29},${TOP} ${x},${TOP + PH}` : `${x - 29},${BOT} ${x + 29},${BOT} ${x},${BOT - PH}`;
      s += `<polygon points="${pts}" fill="${d.color}" fill-opacity="0.45" stroke="${d.color}" stroke-width="3" class="dest-poly"/>`;
      const k = b[0][d.i] + (b[1][23 - d.i] === 1 ? 0 : 0);
      const pos = stackPos(d.i, b[1][23 - d.i] === 1 ? 0 : k, k + 1);
      s += `<circle cx="${pos.x}" cy="${pos.y}" r="${R - 4}" fill="none" stroke="${d.color}" stroke-width="4" stroke-dasharray="6 4" class="dest-ring"/>`;
    }
    // пулове по точките
    for (const p of [0, 1]) {
      for (let i = 0; i < 24; i++) {
        const c = b[p][i];
        if (!c) continue;
        const h = toH(p, i);
        for (let k = 0; k < c; k++) {
          const pos = stackPos(h, k, c);
          s += checkerSvg(pos.x, pos.y, p);
        }
        if (c > 5) {
          const pos = stackPos(h, c - 1, c);
          T += `<text x="${mx(pos.x)}" y="${pos.y + 6}" text-anchor="middle" class="stack-num ${isW(p) ? '' : 'dark'}">${c}</text>`;
        }
      }
      for (let k = 0; k < b[p][24]; k++) { const pos = barPos(p, Math.min(k, 5)); s += checkerSvg(pos.x, pos.y, p); }
      if (b[p][24] > 1) { const pos = barPos(p, Math.min(b[p][24] - 1, 5)); T += `<text x="${mx(pos.x)}" y="${pos.y + 6}" text-anchor="middle" class="stack-num ${isW(p) ? '' : 'dark'}">${b[p][24]}</text>`; }
      const off = offCount(b, p);
      for (let k = 0; k < off; k++) {
        const pos = offPos(p, k);
        s += `<rect x="${pos.x - 26}" y="${pos.y - 6}" width="52" height="12" rx="4" fill="${isW(p) ? '#f3ead2' : '#2a2a2a'}" stroke="${isW(p) ? '#9c8a5c' : '#000'}"/>`;
      }
    }
    // източници (пулове, които могат да се местят)
    for (const i of view.sources || []) {
      const pos = topPos(b, 0, i);
      const sel = view.selected === i;
      s += `<circle cx="${pos.x}" cy="${pos.y}" r="${R + 2}" fill="none" stroke="${sel ? '#1e88e5' : '#f5b301'}" stroke-width="${sel ? 5 : 3.5}" class="${sel ? 'sel-ring' : 'src-ring'}"/>`;
    }
    // призрак (предварителен преглед)
    if (view.ghost) {
      const g = view.ghost;
      let pos;
      if (g.i < 0) pos = offPos(0, offCount(b, 0));
      else pos = stackPos(g.i, b[1][23 - g.i] === 1 ? 0 : b[0][g.i], b[0][g.i] + 1);
      s += `<g opacity="0.55">${checkerSvg(pos.x, pos.y, 0)}</g>`;
    }
    // стрелки
    const allArrows = (view.lastArrows || []).map((a) => Object.assign({ faded: true }, a)).concat(view.arrows || []);
    const palette = ['#f5b301', '#2e9e4f', '#7cb342', '#f0a020', '#e06020', '#d32f2f', '#5aa0ff', '#9aa0a6'];
    for (const a of allArrows) {
      const mx = (a.from.x + a.to.x) / 2, my = (a.from.y + a.to.y) / 2;
      const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(60, len * 0.25);
      const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
      const mi = Math.max(0, palette.indexOf(a.color));
      s += `<path d="M${a.from.x},${a.from.y} Q${cx},${cy} ${a.to.x},${a.to.y}" fill="none" stroke="${a.color}" stroke-width="${a.faded ? 4 : 6}" stroke-linecap="round" ${a.faded ? 'stroke-dasharray="8 7" opacity="0.75"' : 'opacity="0.95"'} marker-end="url(#ah${mi}${UID})" class="arrow"/>`;
    }
    s += '</g>';
    // зарове
    if (view.dice && view.dice.length) {
      // d.side позволява зарове от двете страни (хвърлянето за начало: всеки зар в своята половина)
      for (const side of ['left', 'right']) {
        const ds = view.dice.filter((d) => (d.side || view.diceSide || 'right') === side);
        const n = ds.length, size = n > 2 ? 40 : 50, gap = size + 12;
        const cx = side === 'left' ? 210 : 630;
        ds.forEach((d, k) => {
          const x = cx + (k - (n - 1) / 2) * gap;
          T += dieSvg(mx(x), MID, d.v, isW(d.p), d.used, size);
        });
      }
    }
    if (view.centerText) T += `<text x="${mx(view.diceSide === 'left' ? 630 : 210)}" y="${MID + 7}" text-anchor="middle" class="center-text">${view.centerText}</text>`;
    s += T;
    // зони за кликване
    if (view.interactive) {
      s += MIR ? `<g transform="translate(${W},0) scale(-1,1)">` : '<g>';
      for (let h = 0; h < 24; h++) {
        const x = pointX(h);
        const y = isTop(h) ? TOP : MID;
        s += `<rect x="${x - 30}" y="${y}" width="60" height="300" fill="transparent" data-t="${h}" class="hit"/>`;
      }
      s += `<rect x="${BARX}" y="${TOP}" width="${BARW}" height="600" fill="transparent" data-t="24" class="hit"/>`;
      s += `<rect x="${TRAYX - 10}" y="${TOP}" width="${TRAYW + 20}" height="600" fill="transparent" data-t="-1" class="hit"/>`;
      s += '</g>';
    }
    return s + '</svg>';
  }

  /** Вариант за PNG картинки: без преливания (PNG файлът става в пъти по-малък). */
  function svgFlat(view) {
    return svg(Object.assign({}, view, { standalone: true }))
      .replace(/url(#woodw+)/g, '#d9b378')
      .replace(/url(#chkWw+)/g, '#f6efdc')
      .replace(/url(#chkBw+)/g, '#2b2b2b');
  }

  const api = { svg, svgFlat, arrowsForPlay, toH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TablaBoard = api;
})(typeof window !== 'undefined' ? window : globalThis);
