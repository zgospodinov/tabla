/* Табла онлайн — входна точка на Worker-а.
 * Статичните файлове идват от assets; тук са само /api маршрутите. */
import { Room, cleanName } from './room.js';

export { Room };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O и 1/I
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(r, (x) => ALPHABET[x % ALPHABET.length]).join('');
}
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const stub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));

// Ограничение на заявките: ключът е IP адресът на клиента. Без настроен лимит (напр. в тестове) пропуска.
async function limited(limiter, req) {
  if (!limiter) return false;
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  try { const { success } = await limiter.limit({ key: ip }); return !success; } catch (e) { return false; }
}
const tooMany = () => json({ error: 'Твърде много заявки. Опитайте отново след минута.' }, 429);

// Браузърът винаги изпраща Origin при WebSocket; приемаме само собствения адрес.
function foreignOrigin(req, url) {
  const o = req.headers.get('Origin');
  if (!o) return false;
  try { return new URL(o).host !== url.host; } catch (e) { return true; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/api/rooms' && req.method === 'POST') {
      if (foreignOrigin(req, url)) return json({ error: 'Забранено.' }, 403);
      if (await limited(env.LIMIT_CREATE, req)) return tooMany();
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'Невалидна заявка.' }, 400); }
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = await stub(env, code).fetch('https://room/init', {
          method: 'POST',
          body: JSON.stringify({ code, token: body.token, name: cleanName(body.name), moveTime: body.moveTime, record: body.record, color: body.color, side: body.side }),
        });
        if (r.status === 409) continue;
        if (r.status === 400 && !cleanName(body.name)) return json({ error: 'Въведете вашето име.' }, 400);
        if (!r.ok) return json({ error: 'Стаята не можа да бъде създадена.' }, r.status);
        return json({ code });
      }
      return json({ error: 'Опитайте отново.' }, 503);
    }

    const m = p.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/(info|ws)$/);
    if (m) {
      if (m[2] === 'ws' && foreignOrigin(req, url)) return new Response('Forbidden', { status: 403 });
      if (await limited(env.LIMIT_ROOM, req)) return m[2] === 'info' ? tooMany() : new Response('Too many requests', { status: 429 });
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return m[2] === 'info' ? json({ exists: false }) : new Response('Bad code', { status: 400 });
      return stub(env, code).fetch(new Request('https://room/' + m[2] + url.search, req));
    }

    // Картинки от писмата с анализ (R2). Имената са случайни; съдържат само позиции от играта.
    const img = p.match(/^\/img\/(a\/[0-9a-f]{32}\/\d{1,3}-(?:played|best)\.png)$/);
    if (img && (req.method === 'GET' || req.method === 'HEAD')) {
      const obj = env.IMAGES && (await env.IMAGES.get(img[1]));
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(req.method === 'HEAD' ? null : obj.body, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    if (p.startsWith('/img/')) return new Response('Not found', { status: 404 });

    if (p.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
