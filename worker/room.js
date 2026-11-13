/* Табла онлайн — стая за двама играчи (Durable Object).
 * Сървърът е единственият източник на истина: хвърля заровете, проверява ходовете
 * с двигателя от js/engine.js и следи времето за ход. */
import { DurableObject } from 'cloudflare:workers';
import E from '../js/engine.js';

const MOVE_TIMES = [0, 30, 60, 120, 300];          // секунди, 0 = без ограничение
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
      settings: { moveTime, record: body.record !== false, color: body.color === 'black' ? 'black' : 'white', side: body.side === 'left' ? 'left' : 'right' },
      seats: [{ token: body.token, name }, null],
      board: E.initialBoard(), phase: 'waiting', turn: null, dice: null, turnId: 0,
      opening: [null, null], deadline: null, events: [], record: [], lastMove: null,
      score: [0, 0], winner: null, pts: 0, mars: false, rematch: [false, false], game: 1,
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
      if (g.rematch[0] && g.rematch[1]) this.newGame();
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
    const online = [0, 1].map((s) => this.ctx.getWebSockets('s' + s).some((w) => w !== skip && w.readyState === 1));
    return {
      t: 'state', now: Date.now(), you: seat, code: g.code, settings: g.settings,
      players: g.seats.map((s, i) => (s ? { name: s.name, online: online[i] } : null)),
      board: g.board, phase: g.phase, turn: g.turn, dice: g.dice, turnId: g.turnId,
      opening: g.opening, deadline: g.deadline, lastMove: g.lastMove, events: g.events.slice(-60),
      score: g.score, winner: g.winner, pts: g.pts, mars: g.mars, rematch: g.rematch, game: g.game,
      recorded: g.record.length,
    };
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
