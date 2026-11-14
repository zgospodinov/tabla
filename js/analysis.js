/* Табла — личен анализ на изиграна игра.
 * Сравнява всеки ход на играча с най-добрия ход според двигателя и събира
 * обобщение, най-големите грешки и съвети. Работи и в браузъра, и в Worker-а.
 *
 * record: [{ game, seat, dice:[a,b], before:board, moves:[{from,to,die,hit}], auto }]
 * Дъската е в номерацията на сървъра (board[seat] — пуловете на играча seat).
 */
(function (root) {
  'use strict';

  const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const r1 = (x) => Math.round(x * 10) / 10;

  // Категории според загубата спрямо най-добрия ход (същите прагове като в тренировката).
  const CATS = [
    { key: 'best', max: 0.3, text: 'Най-добър' },
    { key: 'good', max: 2.5, text: 'Много добър' },
    { key: 'ok', max: 6, text: 'Приемлив' },
    { key: 'weak', max: 12, text: 'Слаб' },
    { key: 'bad', max: Infinity, text: 'Грешка' },
  ];
  const catOf = (loss) => CATS.find((c) => loss < c.max);

  // Повтарящи се слабости → общ съвет.
  const PATTERNS = [
    { re: /^Оставяте/, tip: 'Пазете единичните пулове: преди да потвърдите хода, проверете колко хвърляния на противника ги удрят.' },
    { re: /^Разваляте/, tip: 'Не разваляйте затворени точки без нужда — те са опората на позицията ви.' },
    { re: /^Трупате/, tip: 'Не трупайте много пулове на една точка — разпределени, те затварят повече точки.' },
  ];

  function analyzeGame(E, record, seat, game) {
    // game: номер на игра, списък от номера (цял мач) или null за всички
    const games = game == null ? null : Array.isArray(game) ? game : [game];
    const turns = record.filter((r) => r.seat === seat && (!games || games.includes(r.game)));
    const perGame = {}; // пореден ход на играча в съответната игра
    const counts = { best: 0, good: 0, ok: 0, weak: 0, bad: 0 };
    const items = [];
    let scored = 0, lossSum = 0, forced = 0, auto = 0, hits = 0;
    const patternHits = PATTERNS.map(() => 0);

    turns.forEach((r) => {
      const n = (perGame[r.game] = (perGame[r.game] || 0) + 1);
      const gameNo = games ? games.indexOf(r.game) + 1 : r.game;
      // анализираният играч винаги е 0 — така текстовете на двигателя са „вие“
      const before = [r.before[seat], r.before[1 - seat]];
      const dice = r.dice;
      hits += r.moves.filter((m) => m.hit).length;
      if (r.auto) { auto++; return; }
      const plays = E.rankPlays(before, 0, E.remFromDice(dice));
      if (plays.length <= 1) { forced++; return; }
      const after = E.applyMoves(before, 0, r.moves);
      const best = plays[0];
      const loss = Math.max(0, best.score - E.evaluate(after, 0));
      const cat = catOf(loss);
      counts[cat.key]++;
      scored++; lossSum += loss;
      if (loss >= 2.5) {
        const mine = E.explainPlay(before, 0, r.moves, after);
        const theirs = E.explainPlay(before, 0, best.moves, best.board);
        mine.cons.forEach((c) => PATTERNS.forEach((p, k) => { if (p.re.test(strip(c))) patternHits[k]++; }));
        items.push({
          n, game: gameNo,
          dice: `${dice[0]}–${dice[1]}`,
          played: E.playText(0, r.moves),
          best: E.playText(0, best.moves),
          loss: r1(loss),
          label: cat.text,
          why: strip(mine.cons[0] || ''),
          bestWhy: strip(theirs.pros[0] || ''),
          // за картинките: позиция преди хода (анализираният играч е 0) и двата варианта
          before, diceArr: dice.slice(), playedMoves: r.moves, bestMoves: best.moves,
        });
      }
    });

    items.sort((a, b) => b.loss - a.loss);
    const mistakes = items.slice(0, 5).sort((a, b) => a.game - b.game || a.n - b.n);
    const accuracy = scored ? Math.round(((counts.best + counts.good) * 100) / scored) : 100;

    const strengths = [];
    if (counts.best) strengths.push(`${counts.best} от ${scored} хода изиграхте точно като най-добрия ход.`);
    if (counts.good) strengths.push(counts.good === 1 ? 'Още един ход беше много близо до най-добрия.' : `Още ${counts.good} хода бяха много близо до най-добрия.`);
    if (hits) strengths.push(`Ударихте пул на противника ${hits === 1 ? 'веднъж' : hits + ' пъти'}.`);

    const tips = [];
    PATTERNS.forEach((p, k) => { if (patternHits[k] >= 2) tips.push(p.tip); });
    if (counts.bad + counts.weak >= 3) tips.push('Пробвайте режим „Тренировка“: там виждате оценка на всеки възможен ход, преди да го изиграете.');
    if (auto) tips.push(`${auto === 1 ? 'Един ход беше изигран' : auto + ' хода бяха изиграни'} автоматично, защото времето изтече — изберете по-дълго време за ход.`);
    if (!tips.length) tips.push(accuracy >= 80 ? 'Играете стабилно. Следващата стъпка: стратегиите в раздел „Стратегии“.' : 'Разгледайте раздел „Стратегии“ — там са основните планове за игра.');

    let summary;
    if (!scored) summary = 'В тази игра нямаше ходове с избор, които да оценим.';
    else if (accuracy >= 85) summary = 'Отлична игра — почти всички ходове са сред най-добрите.';
    else if (accuracy >= 65) summary = 'Добра игра с няколко неточности.';
    else if (accuracy >= 45) summary = 'Средна игра — има ходове, от които можете да научите много.';
    else summary = 'Трудна игра — вижте по-долу кои ходове струваха най-много.';

    return {
      turns: turns.length, scored, forced, auto, counts, accuracy,
      avgLoss: scored ? r1(lossSum / scored) : 0,
      summary, mistakes, strengths, tips,
    };
  }

  const api = { analyzeGame, CATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TablaAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
