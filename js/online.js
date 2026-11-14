/* Табла онлайн — лоби (създаване и влизане в стая) и връзка със сървъра. */
(function (root) {
  'use strict';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const TIMES = [[0, 'Без ограничение'], [30, '30 секунди'], [60, '1 минута'], [120, '2 минути'], [300, '5 минути']];

  // Онлайн играта има нужда от сървъра (Cloudflare Worker); в единичния файл (артефакт) я няма.
  const available = !root.TABLA_OFFLINE && /^https?:$/.test(location.protocol);

  function store(kind) { try { return root[kind]; } catch (e) { return null; } }
  function getJSON(kind, k) { try { const s = store(kind); const v = s && s.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function setJSON(kind, k, v) { try { const s = store(kind); if (s) s.setItem(k, JSON.stringify(v)); } catch (e) { /* няма хранилище */ } }

  const lastName = () => (getJSON('localStorage', 'tabla-name') || {}).name || '';
  const rememberName = (name) => setJSON('localStorage', 'tabla-name', { name });
  // Самоличността в стаята се пази за раздела (sessionStorage): презареждането връща същото място.
  const seatFor = (code) => getJSON('sessionStorage', 'tabla-room-' + code);
  const saveSeat = (code, token, name) => setJSON('sessionStorage', 'tabla-room-' + code, { token, name });
  function newToken() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const roomLink = (code) => location.origin + location.pathname + '#room-' + code;
  const timeText = (s) => (TIMES.find((t) => t[0] === s) || [0, s + ' с'])[1];

  async function createRoom(opts) {
    const token = newToken();
    const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token }, opts)) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.code) throw new Error(data.error || 'Стаята не можа да бъде създадена.');
    saveSeat(data.code, token, opts.name);
    return data.code;
  }
  async function roomInfo(code) {
    const r = await fetch('/api/rooms/' + code + '/info');
    if (!r.ok) throw new Error('Сървърът не отговаря.');
    return r.json();
  }

  /** Връзка към стая. Автоматично се свързва отново при прекъсване. */
  function connect(code, seat, handlers) {
    let ws = null, closed = false, tries = 0, pingT = null, retryT = null;
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const q = new URLSearchParams({ token: seat.token, name: seat.name || '' });
      ws = new WebSocket(`${proto}//${location.host}/api/rooms/${code}/ws?${q}`);
      handlers.status('connecting');
      ws.onopen = () => {
        tries = 0; handlers.status('open');
        clearInterval(pingT);
        pingT = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 25000);
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'state') handlers.state(m);
        else if (m.t === 'error') handlers.error(m);
        else if (m.t === 'mail' && handlers.mail) handlers.mail(m);
      };
      ws.onclose = (ev) => {
        clearInterval(pingT);
        if (closed) return;
        if (ev.code === 4000 || ev.code === 4001 || ev.code === 4002) { closed = true; handlers.status(ev.code === 4000 ? 'replaced' : 'closed'); return; }
        handlers.status('retry');
        const wait = Math.min(10000, 500 * 2 ** tries++);
        retryT = setTimeout(open, wait);
      };
    };
    open();
    return {
      send(obj) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; },
      close() { closed = true; clearInterval(pingT); clearTimeout(retryT); if (ws) ws.close(1000); },
    };
  }

  // ---------------- лоби ----------------
  function lobbyHtml(err) {
    const name = esc(lastName());
    return `<h1>Онлайн игра с приятел</h1>
      <p class="lead">Единият създава стая и изпраща кода (или линка) на другия. Щом двамата влезете, играта започва. Не е нужна регистрация.</p>
      ${err ? `<div class="msg">${esc(err)}</div>` : ''}
      <div class="lobby">
        <form class="card lobby-card" data-form="create">
          <h2>Създай стая</h2>
          <label>Вашето име <input name="name" maxlength="20" autocomplete="nickname" placeholder="напр. Иван" value="${name}" required></label>
          <fieldset class="pick"><legend>Вашите пулове</legend>
            <label><input type="radio" name="color" value="white" checked><i class="chip white"></i> Бели</label>
            <label><input type="radio" name="color" value="black"><i class="chip black"></i> Черни</label>
          </fieldset>
          <fieldset class="pick"><legend>Вашият дом</legend>
            <label><input type="radio" name="side" value="right" checked> Долу вдясно</label>
            <label><input type="radio" name="side" value="left"> Долу вляво</label>
          </fieldset>
          <p class="muted small">Противникът получава другия цвят. Неговата дъска е завъртяна така, както я вижда човек, седнал срещу вас: неговият дом е от другата страна.</p>
          <label>Време за ход <select name="moveTime">${TIMES.map(([v, t]) => `<option value="${v}" ${v === 60 ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <p class="muted small">Времето тече от началото на реда ви (хвърляне и местене). Ако изтече, сървърът изиграва случаен позволен ход вместо вас.</p>
          <label class="check"><input type="checkbox" name="record" checked> Запиши играта</label>
          <p class="muted small">Записът пази всеки ход. Той е основа за личния анализ след играта, който предстои да добавим.</p>
          <button class="btn primary" type="submit">Създай стая</button>
        </form>
        <form class="card lobby-card" data-form="join">
          <h2>Влез със код</h2>
          <label>Вашето име <input name="name" maxlength="20" autocomplete="nickname" placeholder="напр. Мария" value="${name}" required></label>
          <label>Код на стаята <input name="code" class="code-input" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234" required></label>
          <button class="btn primary" type="submit">Влез</button>
        </form>
      </div>`;
  }

  function mountLobby(el, err) {
    if (!available) {
      el.innerHTML = `<h1>Онлайн игра с приятел</h1><div class="card"><p>Онлайн играта работи само в уеб версията на приложението, която има сървър за стаите.</p></div>`;
      return;
    }
    el.innerHTML = lobbyHtml(err);
    el.querySelectorAll('form').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]');
      const fd = new FormData(f);
      const name = String(fd.get('name') || '').trim().slice(0, 20);
      if (!name) { mountLobby(el, 'Въведете вашето име.'); return; }
      rememberName(name);
      btn.disabled = true;
      try {
        if (f.dataset.form === 'create') {
          const code = await createRoom({ name, moveTime: Number(fd.get('moveTime')), record: fd.get('record') === 'on', color: fd.get('color'), side: fd.get('side') });
          location.hash = 'room-' + code;
        } else {
          const code = normCode(fd.get('code'));
          if (!CODE_RE.test(code)) throw new Error('Кодът е от 6 знака — латински букви и цифри.');
          const info = await roomInfo(code);
          const mine = seatFor(code);
          if (!info.exists) throw new Error('Няма стая с код ' + code + '.');
          if (info.full && !mine) throw new Error('Стаята ' + code + ' вече е пълна.');
          if (!mine) saveSeat(code, newToken(), name);
          else if (!mine.name) saveSeat(code, mine.token, name);
          location.hash = 'room-' + code;
        }
      } catch (ex) {
        mountLobby(el, ex.message || 'Възникна грешка.');
      } finally { btn.disabled = false; }
    }));
    const ci = el.querySelector('.code-input');
    if (ci) ci.addEventListener('input', () => { ci.value = normCode(ci.value); });
  }

  root.TablaOnline = { available, mountLobby, connect, seatFor, saveSeat, newToken, lastName, rememberName, roomLink, roomInfo, timeText, CODE_RE, esc };
})(typeof window !== 'undefined' ? window : globalThis);
