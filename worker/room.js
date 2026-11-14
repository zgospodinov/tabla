/* Табла онлайн — стая за двама играчи (Durable Object).
 * Сървърът е единственият източник на истина: хвърля заровете, проверява ходовете
 * с двигателя от js/engine.js и следи времето за ход. */
import { DurableObject } from 'cloudflare:workers';
import E from '../js/engine.js';
import A from '../js/analysis.js';
import { boardSvg, toPng, PLAYED_COLOR, BEST_COLOR } from './render.js';

const MOVE_TIMES = [0, 30, 60, 120, 300];          // секунди, 0 = без ограничение
const TARGETS = [1, 3, 5, 7];                      // мач до N точки; 1 = една игра
const IDLE_TTL = 48 * 3600 * 1000;                 // празна/неактивна стая се изтрива след 48 часа
const MAX_EVENTS = 120;
const rollDie = () => 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 6);

export function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
}
const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.g = null;
    ctx.blockConcurrencyWhile(async () => { this.g = (await ctx.storage.get('g')) || null; });
  }

  // ---------------- HTTP ----------------
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/init') && req.method === 'POST') return this.init(await req.json());
    if (url.pathname.endsWith('/info')) {
      if (!this.g) return Response.json({ exists: false });
      const g = this.g;
      return Response.json({ exists: true, full: !!(g.seats[0] && g.seats[1]), host: g.seats[0] && g.seats[0].name, settings: g.settings, phase: g.phase });
    }
    if (url.pathname.endsWith('/ws')) return this.connect(req, url);
    return new Response('Not found', { status: 404 });
  }

  async init(body) {
    if (this.g) return new Response('exists', { status: 409 });
    if (!validToken(body.token)) return new Response('bad token', { status: 400 });
    const name = cleanName(body.name);
    if (!name) return new Response('name required', { status: 400 });
    const moveTime = MOVE_TIMES.includes(Number(body.moveTime)) ? Number(body.moveTime) : 0;
    const now = Date.now();
    this.g = {
      code: body.code, created: now, active: now,
      // color и side са за създателя (място 0); вторият играч получава другия цвят и отсрещната страна
      settings: { moveTime, target: TARGETS.includes(Number(body.target)) ? Number(body.target) : 1, record: body.record !== false, color: body.color === 'black' ? 'black' : 'white', side: body.side === 'left' ? 'left' : 'right' },
      seats: [{ token: body.token, name }, null],
      board: E.initialBoard(), phase: 'waiting', turn: null, dice: null, turnId: 0,
      opening: [null, null], deadline: null, events: [], record: [], lastMove: null,
      score: [0, 0], winner: null, pts: 0, mars: false, rematch: [false, false], game: 1,
      // мач: score е резултатът в текущия мач; wins — спечелени мачове в стаята
      match: 1, matchFirst: 1, matchOver: false, matchWinner: null, wins: [0, 0],
    };
    this.event({ k: 'create', seat: 0 });
    await this.save();
    return Response.json({ ok: true });
  }

  connect(req, url) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const g = this.g;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const reject = (code, why) => {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ t: 'error', code, msg: why }));
      server.close(4001, code);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!g) return reject('notfound', 'Няма стая с този код. Проверете кода или създайте нова стая.');
    const token = url.searchParams.get('token');
    if (!validToken(token)) return reject('badtoken', 'Невалидна заявка.');
    let seat = g.seats.findIndex((s) => s && s.token === token);
    if (seat < 0) {
      seat = g.seats.findIndex((s) => !s);
      if (seat < 0) return reject('full', 'Стаята вече е пълна — в нея играят двама.');
      const name = cleanName(url.searchParams.get('name'));
      if (!name) return reject('noname', 'Въведете име, за да влезете в стаята.');
      g.seats[seat] = { token, name };
      this.event({ k: 'join', seat });
      if (g.seats[0] && g.seats[1] && g.phase === 'waiting') g.phase = 'opening';
    }
    // по-стара връзка на същия играч (друг раздел) се затваря
    for (const ws of this.ctx.getWebSockets('s' + seat)) { try { ws.close(4000, 'replaced'); } catch (e) { /* вече е затворена */ } }
    this.ctx.acceptWebSocket(server, ['s' + seat]);
    server.serializeAttachment({ seat });
    g.active = Date.now();
    this.ctx.waitUntil(this.save().then(() => this.broadcast()));
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------- WebSocket ----------------
  async webSocketMessage(ws, raw) {
    const att = ws.deserializeAttachment();
    if (!att || !this.g) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    this.ensureMatch();
    if (msg && msg.t === 'mail') { await this.mail(ws, att.seat, msg); return; }
    if (msg && msg.t === 'analysis') { this.sendAnalysis(ws, att.seat); return; }
    const err = this.handle(att.seat, msg || {});
    if (err) { ws.send(JSON.stringify({ t: 'error', code: 'rule', msg: err })); this.sendState(ws); return; }
    this.g.active = Date.now();
    await this.save();
    this.broadcast();
  }
  async webSocketClose(ws) { this.broadcast(ws); }
  async webSocketError(ws) { this.broadcast(ws); }

  handle(seat, msg) {
    const g = this.g;
    if (msg.t === 'ping') return null;
    if (msg.t === 'roll') {
      if (g.phase === 'opening') {
        if (g.opening[seat] != null) return 'Вече хвърлихте за начало.';
        g.opening[seat] = rollDie();
        this.resolveOpening();
        return null;
      }
      if (g.phase !== 'roll' || g.turn !== seat) return 'Сега не е ваш ред да хвърляте.';
      this.startMove([rollDie(), rollDie()]);
      return null;
    }
    if (msg.t === 'move') {
      if (g.phase !== 'move' || g.turn !== seat) return 'Сега не е ваш ред.';
      if (msg.turnId !== g.turnId) return 'Ходът е изтекъл — получихте новото състояние.';
      const res = this.validate(seat, msg.moves);
      if (!res) return 'Този ход не е позволен по правилата.';
      this.applyPlay(seat, res.moves, res.board, false);
      return null;
    }
    if (msg.t === 'resign') {
      if (g.phase === 'waiting' || g.phase === 'over') return null;
      this.event({ k: 'resign', seat });
      this.finish(1 - seat, true);
      return null;
    }
    if (msg.t === 'rematch') {
      if (g.phase !== 'over') return null;
      g.rematch[seat] = true;
      if (g.rematch[0] && g.rematch[1]) {
        if (g.matchOver) {
          // нов мач: резултатът започва от 0
          g.match++; g.score = [0, 0]; g.matchOver = false; g.matchWinner = null; g.matchFirst = g.game + 1;
        }
        this.newGame();
      }
      return null;
    }
    return null;
  }

  resolveOpening() {
    const g = this.g, [a, b] = g.opening;
    if (a == null || b == null) return;
    this.event({ k: 'open', d: [a, b] });
    if (a === b) { g.opening = [null, null]; return; }
    const first = a > b ? 0 : 1;
    g.turn = first;
    g.deadline = this.newDeadline();
    this.startMove(first === 0 ? [a, b] : [b, a]);
  }

  newDeadline() { return this.g.settings.moveTime ? Date.now() + this.g.settings.moveTime * 1000 : null; }

  /** Начало на хода на g.turn с дадените зарове (крайният срок се задава при началото на реда). */
  startMove(dice) {
    const g = this.g;
    g.dice = dice; g.phase = 'move'; g.turnId++;
    this.event({ k: 'roll', seat: g.turn, dice });
  }

  legalPlays(seat) { return E.generatePlays(this.g.board, seat, E.remFromDice(this.g.dice)); }

  validate(seat, moves) {
    const g = this.g;
    if (!Array.isArray(moves) || moves.length > 4) return null;
    const plays = this.legalPlays(seat);
    const maxLen = plays.length ? plays[0].moves.length : 0;
    if (moves.length !== maxLen) return null;
    let b = g.board, rem = E.remFromDice(g.dice);
    const out = [];
    for (const m of moves) {
      if (!m || !rem.includes(m.die)) return null;
      const sm = E.singleMoves(b, seat, m.die).find((x) => x.from === m.from && x.to === m.to);
      if (!sm) return null;
      out.push(sm);
      b = E.applyMove(b, seat, sm);
      rem = E.removeOne(rem, m.die);
    }
    if (maxLen && !plays.some((p) => E.key(p.board) === E.key(b))) return null;
    return { moves: out, board: b };
  }

  applyPlay(seat, moves, board, auto) {
    const g = this.g;
    const before = g.board;
    g.board = board;
    g.lastMove = { seat, before, moves, dice: g.dice, auto, at: Date.now() };
    this.event({ k: 'move', seat, dice: g.dice, moves, auto });
    if (g.settings.record) g.record.push({ game: g.game, seat, dice: g.dice, before, moves, auto, t: Date.now() });
    if (E.offCount(board, seat) === 15) { this.finish(seat, false); return; }
    g.turn = 1 - seat; g.phase = 'roll'; g.dice = null;
    g.deadline = this.newDeadline();
  }

  finish(w, resigned) {
    const g = this.g;
    const mars = !resigned && E.offCount(g.board, 1 - w) === 0;
    const pts = mars ? 2 : 1;
    g.phase = 'over'; g.winner = w; g.pts = pts; g.mars = mars; g.deadline = null; g.dice = null;
    g.score[w] += pts;
    g.rematch = [false, false];
    this.event({ k: 'over', seat: w, pts, mars, resigned });
    const target = g.settings.target || 1;
    if (g.score[w] >= target) {
      g.matchOver = true; g.matchWinner = w;
      g.wins = g.wins || [0, 0]; g.wins[w]++;
      this.event({ k: 'matchover', seat: w, score: g.score.slice(), target });
    }
  }

  /** Старите стаи (отпреди мачовете) нямат тези полета. */
  ensureMatch() {
    const g = this.g;
    if (!g.settings.target) g.settings.target = 1;
    if (g.match == null) Object.assign(g, { match: 1, matchFirst: g.game, matchOver: g.phase === 'over', matchWinner: g.phase === 'over' ? g.winner : null, wins: [0, 0] });
  }

  /** Номерата на игрите от текущия мач. */
  matchGames() {
    const g = this.g, out = [];
    for (let n = g.matchFirst || 1; n <= g.game; n++) out.push(n);
    return out;
  }

  newGame() {
    const g = this.g;
    g.game++;
    Object.assign(g, { board: E.initialBoard(), phase: 'opening', turn: null, dice: null, opening: [null, null], deadline: null, lastMove: null, winner: null, pts: 0, mars: false, rematch: [false, false] });
    this.event({ k: 'newgame', n: g.game });
  }

  /** Изтекло време: сървърът довършва хода сам със случаен позволен ход. */
  timeout() {
    const g = this.g, seat = g.turn;
    this.event({ k: 'timeout', seat });
    if (g.phase === 'roll') this.startMove([rollDie(), rollDie()]);
    const plays = this.legalPlays(seat);
    const pick = plays.length ? plays[Math.floor(Math.random() * plays.length)] : { moves: [], board: g.board };
    this.applyPlay(seat, pick.moves, pick.board, true);
  }

  async alarm() {
    const g = this.g;
    if (!g) return;
    const now = Date.now();
    if (g.deadline && now >= g.deadline - 50 && (g.phase === 'roll' || g.phase === 'move')) {
      this.timeout();
      g.active = now;
      await this.save();
      this.broadcast();
      return;
    }
    if (now - g.active > IDLE_TTL) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(4002, 'expired'); } catch (e) { /* */ } }
      this.g = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.schedule();
  }

  // ---------------- помощни ----------------
  event(e) {
    const g = this.g;
    e.at = Date.now();
    g.events.push(e);
    if (g.events.length > MAX_EVENTS) g.events.splice(0, g.events.length - MAX_EVENTS);
  }
  async schedule() {
    const g = this.g;
    if (!g) return;
    const when = g.deadline && (g.phase === 'roll' || g.phase === 'move') ? g.deadline : g.active + IDLE_TTL + 1000;
    await this.ctx.storage.setAlarm(when);
  }
  async save() {
    await this.ctx.storage.put('g', this.g);
    await this.schedule();
  }

  view(seat, skip) {
    const g = this.g;
    this.ensureMatch();
    const online = [0, 1].map((s) => this.ctx.getWebSockets('s' + s).some((w) => w !== skip && w.readyState === 1));
    return {
      t: 'state', now: Date.now(), you: seat, code: g.code, settings: g.settings,
      players: g.seats.map((s, i) => (s ? { name: s.name, online: online[i] } : null)),
      board: g.board, phase: g.phase, turn: g.turn, dice: g.dice, turnId: g.turnId,
      opening: g.opening, deadline: g.deadline, lastMove: g.lastMove, events: g.events.slice(-60),
      score: g.score, winner: g.winner, pts: g.pts, mars: g.mars, rematch: g.rematch, game: g.game,
      recorded: g.record.length,
      match: g.match, matchOver: g.matchOver, matchWinner: g.matchWinner, wins: g.wins,
      // анализ: само за своето място и само след края на мача
      canAnalyze: this.canAnalyze(seat),
      canMail: this.mailReady() && this.canAnalyze(seat),
      mailed: !!(g.mailed && g.mailed[this.mailKey(seat)]),
    };
  }

  canAnalyze(seat) {
    const g = this.g, games = this.matchGames();
    return g.phase === 'over' && g.matchOver && g.settings.record && g.record.some((r) => r.seat === seat && games.includes(r.game));
  }
  mailKey(seat) { return 'm' + this.g.match + ':' + seat; }

  /** Анализ на мача за място seat. games — номерата на игрите; при повече от една ходовете носят и номера на играта. */
  matchAnalysis(seat) {
    const g = this.g, games = this.matchGames();
    const a = A.analyzeGame(E, g.record, seat, games);
    const multi = games.length > 1;
    for (const m of a.mistakes) m.where = multi ? `${m.n} в игра ${m.game}` : String(m.n);
    return a;
  }

  /** Изглед на дъската за мястото: цвят на пуловете и страна на дома (както в стаята). */
  lookFor(seat) {
    const g = this.g;
    const other = (c) => (c === 'white' ? 'black' : 'white');
    const c0 = g.settings.color || 'white', side0 = g.settings.side || 'right';
    const mine = seat === 0 ? c0 : other(c0);
    const side = seat === 0 ? side0 : side0 === 'right' ? 'left' : 'right';
    return { colors: [mine, other(mine)], flip: side === 'left' };
  }

  /** Резултатът от мача като изречение (за писмото и за прегледа в приложението). */
  resultText(seat) {
    const g = this.g, opp = g.seats[1 - seat], oppName = opp ? opp.name : 'противникът';
    const sc = `${g.score[seat]}:${g.score[1 - seat]}`;
    const won = g.matchWinner === seat;
    if ((g.settings.target || 1) === 1) return won ? `Спечелихте${g.mars ? ' с марс' : ''} (+${g.pts}).` : `Този път ${oppName} спечели${g.mars ? ' с марс' : ''}.`;
    return won ? `Спечелихте мача до ${g.settings.target} точки с ${sc}.` : `Този път ${oppName} спечели мача до ${g.settings.target} точки (${sc}).`;
  }

  /** Анализът веднага в приложението — само на собственото място. */
  sendAnalysis(ws, seat) {
    const g = this.g;
    let out;
    if (!this.canAnalyze(seat)) out = { t: 'analysis', ok: false, msg: 'Анализът е достъпен след края на мача, ако играта се записва.' };
    else {
      const a = this.matchAnalysis(seat);
      out = { t: 'analysis', ok: true, data: Object.assign(a, { look: this.lookFor(seat), result: this.resultText(seat), opponent: g.seats[1 - seat] ? g.seats[1 - seat].name : '', games: this.matchGames().length }) };
    }
    try { ws.send(JSON.stringify(out)); } catch (e) { /* затворена връзка */ }
  }

  // ---------------- анализ по имейл ----------------
  /** Изпращането е настроено: API ключ (secret) и номер на шаблона в Brevo, или пробен режим локално. */
  mailReady() {
    const env = this.env || {};
    return !!(env.BREVO_DRY_RUN || (env.BREVO_API_KEY && env.BREVO_TEMPLATE_ID));
  }
  /** Рисува „Вашият ход“ и „По-добре“ за всяка грешка, качва ги в R2 и добавя адресите им към параметрите на писмото. */
  async addImages(out, mistakes, seat) {
    const env = this.env || {};
    if (!env.IMAGES || !env.PUBLIC_URL || !mistakes.length) return;
    const look = this.lookFor(seat);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
    const base = env.PUBLIC_URL.replace(/\/+$/, '') + '/img/a/' + id + '/';
    for (let k = 0; k < mistakes.length; k++) {
      const m = mistakes[k];
      for (const [kind, moves, color, field] of [['played', m.playedMoves, PLAYED_COLOR, 'imgPlayed'], ['best', m.bestMoves, BEST_COLOR, 'imgBest']]) {
        const png = await toPng(boardSvg(m.before, m.diceArr, moves, color, look), 640);
        const name = (k + 1) + '-' + kind + '.png'; // поредният номер — ходовете от различни игри може да имат еднакъв номер
        await env.IMAGES.put('a/' + id + '/' + name, png, { httpMetadata: { contentType: 'image/png' } });
        out[k][field] = base + name;
      }
    }
  }

  /** Изпраща личния анализ на играча seat. Адресът не се записва никъде — използва се само за това писмо. */
  async mail(ws, seat, msg) {
    const g = this.g;
    const reply = (ok, text) => { try { ws.send(JSON.stringify({ t: 'mail', ok, msg: text })); } catch (e) { /* затворена връзка */ } };
    const email = String(msg.email || '').trim();
    if (g.phase !== 'over' || !g.matchOver) return reply(false, 'Анализът се изпраща след края на мача.');
    if (!this.canAnalyze(seat)) return reply(false, 'В тази стая играта не се записва, затова няма анализ.');
    if (email.length > 254 || !/^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}$/i.test(email)) return reply(false, 'Въведете валиден имейл адрес.');
    g.mailed = g.mailed || {};
    const key = this.mailKey(seat);
    if (g.mailed[key]) return reply(false, 'Анализът вече е изпратен.');
    const env = this.env || {};
    if (!this.mailReady()) return reply(false, 'Изпращането по имейл още не е настроено.');

    const a = this.matchAnalysis(seat);
    const me = g.seats[seat], opp = g.seats[1 - seat];
    let date;
    // дата без „г.“ — в писмото след нея следва точка
    try {
      const pt = Object.fromEntries(new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      date = `${pt.day} ${pt.month} ${pt.year}`;
    } catch (e) { date = new Date().toISOString().slice(0, 10); }
    const params = {
      name: me ? me.name : '', opponent: opp ? opp.name : '', date,
      result: this.resultText(seat),
      summary: a.summary, accuracy: String(a.accuracy), scored: String(a.scored),
      best: String(a.counts.best), good: String(a.counts.good), ok: String(a.counts.ok), weak: String(a.counts.weak), bad: String(a.counts.bad),
      mistakes: a.mistakes.map((m) => ({ n: m.where, dice: m.dice, played: m.played, best: m.best, label: m.label, why: m.why, bestWhy: m.bestWhy })),
      strengths: a.strengths, tips: a.tips,
    };
    // отбелязваме преди изпращането, за да не тръгнат две писма при двоен клик
    g.mailed[key] = true;
    await this.save();
    try {
      // картинки на дъската за всеки обяснен ход; без тях писмото пак тръгва (текстът остава)
      try { await this.addImages(params.mistakes, a.mistakes, seat); } catch (e) { console.log('images failed', String(e && e.message)); }
      if (env.BREVO_DRY_RUN) {
        console.log('BREVO_DRY_RUN', JSON.stringify(params));
      } else {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ templateId: Number(env.BREVO_TEMPLATE_ID), to: [{ email, name: params.name || undefined }], params, tags: ['tabla-analysis'] }),
        });
        if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()).slice(0, 200));
      }
    } catch (e) {
      console.log('mail failed', String(e && e.message));
      delete g.mailed[key];
      await this.save();
      return reply(false, 'Писмото не можа да бъде изпратено. Опитайте отново след малко.');
    }
    reply(true, 'Изпратихме анализа на ' + email + '.');
    this.broadcast();
  }
  sendState(ws, skip) {
    const att = ws.deserializeAttachment();
    if (!att || !this.g) return;
    try { ws.send(JSON.stringify(this.view(att.seat, skip))); } catch (e) { /* затворена връзка */ }
  }
  broadcast(skip) {
    for (const ws of this.ctx.getWebSockets()) if (ws !== skip) this.sendState(ws, skip);
  }
}
