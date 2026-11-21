// Підписка на push-сповіщення. GET ?a=key → публічний VAPID-ключ. POST {a:'subscribe'|'unsubscribe'|'test', ...}.
import { storeEnabled, subId, getSub, putSub, delSub } from './_store.js';
import { sendPush, vapidReady } from './_send.js';
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)\//i;
import { AREAS_WITH_DATA } from './_regions.js';
const CITIES = AREAS_WITH_DATA, LEADS = [5, 10, 15, 30, 60];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!vapidReady() || !storeEnabled()) return res.status(503).json({ ok: false, error: 'Сервер сповіщень ще не налаштований' });
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, key: process.env.VAPID_PUBLIC_KEY });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    b = b || {};
    const endpoint = b.sub && b.sub.endpoint || b.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 600 || !PUSH_HOST.test(endpoint)) return res.status(400).json({ ok: false, error: 'Невірна підписка' });
    const id = subId(endpoint);
    if (b.a === 'unsubscribe') { await delSub(id); return res.status(200).json({ ok: true }); }
    if (b.a === 'test') {
      const rec = await getSub(id);
      if (!rec) return res.status(404).json({ ok: false, error: 'Підписку не знайдено' });
      const r = await sendPush(rec.sub, { title: '✨ ТребаСвітло?', body: 'Сповіщення працюють. Так виглядатимуть попередження про світло.', tag: 'test', url: '/' });
      if (r === 'gone') await delSub(id);
      return res.status(r === 'ok' ? 200 : 502).json({ ok: r === 'ok' });
    }
    if (b.a !== 'subscribe') return res.status(400).json({ ok: false, error: 'Невідома дія' });
    const s = b.sub, keys = s && s.keys;
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return res.status(400).json({ ok: false, error: 'Невірні ключі' });
    if (!CITIES.includes(b.city) || !/^[1-6]\.[12]$/.test(String(b.group))) return res.status(400).json({ ok: false, error: 'Невірне місто або черга' });
    const prev = await getSub(id);
    const ev = b.ev || {};
    const keepSt = prev && prev.city === b.city && prev.group === b.group ? prev.st : undefined; // змінилась черга → новий «чистий» старт без шквалу повідомлень
    await putSub(id, {
      sub: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, city: b.city, group: String(b.group),
      lead: LEADS.includes(+b.lead) ? +b.lead : 15, ev: { pre: !!ev.pre, chg: !!ev.chg, nw: !!ev.nw, emg: !!ev.emg },
      st: keepSt, at: prev && prev.at || Date.now(), upd: Date.now()
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Помилка сервера' });
  }
}
