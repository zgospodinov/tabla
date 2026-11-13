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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/api/rooms' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'Невалидна заявка.' }, 400); }
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = await stub(env, code).fetch('https://room/init', {
          method: 'POST',
          body: JSON.stringify({ code, token: body.token, name: cleanName(body.name, 'Играч 1'), moveTime: body.moveTime, record: body.record }),
        });
        if (r.status === 409) continue;
        if (!r.ok) return json({ error: 'Стаята не можа да бъде създадена.' }, r.status);
        return json({ code });
      }
      return json({ error: 'Опитайте отново.' }, 503);
    }

    const m = p.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/(info|ws)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return m[2] === 'info' ? json({ exists: false }) : new Response('Bad code', { status: 400 });
      return stub(env, code).fetch(new Request('https://room/' + m[2] + url.search, req));
    }

    if (p.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
