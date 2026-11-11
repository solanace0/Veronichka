// Статус екстрених відключень по всіх чергах (ДТЕК Дніпровські електромережі: Кривий Ріг, Дніпро, Кам’янське).
// Джерело — публічний API YASNO (той самий, що й для графіків). Для кожної черги він віддає статус дня:
//   ScheduleApplies — діє звичайний графік; WaitingForSchedule — графік ще не опубліковано;
//   EmergencyShutdowns — діють екстрені відключення, планові графіки не застосовуються.
// Адресних даних про аварійні роботи (вулиця, будинок, причина, час відновлення) відкриті джерела не дають:
// їх показує лише сайт ДТЕК за захистом Incapsula, який ми не обходимо. Тому тут нічого не вигадується.
import { fetchTelegram } from './_telegram.js';
const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' };
const GROUP_RE = /^[1-6]\.[12]$/;
// Другий джерело: оголошення оператора на сайті YASNO (текст на кшталт «У м. Дніпро введені екстрені відключення. Графіки не діють.»).
// Статус у API часто відстає від таких оголошень, тому читаємо й їх. Якщо сторінка недоступна чи змінилась — просто повертаємо порожній список.
const ANNOUNCE = 'https://static.yasno.ua/dnipro/outages';

export function parseAnnouncements(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const seen = new Set(), out = [];
  for (const raw of text.replace(/(^|\s)(м|смт|с|вул|просп|обл)\.\s+/gi, '$1$2§ ').split(/(?<=[.!?])\s+/)) {
    const t = raw.replace(/§/g, '.').trim();
    if (t.length < 20 || t.length > 240 || /[?]/.test(t)) continue;
    if (!/(екстрен|аварійн)/i.test(t) || !/(відключен|знеструм)/i.test(t)) continue;
    if (/(не діють|діють|введен|тривають|сталося|застосован|скасован)/i.test(t) === false) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    const cities = [];
    if (/Дніпр(?:о|і|а|у|ом|ові)(?![а-яіїєґ])/i.test(t)) cities.push('dp');
    if (/Кам[’'ʼ`]?янськ/i.test(t)) cities.push('kz');
    if (/Крив(ий|ого|ому)\s+Р(іг|огу|озі)/i.test(t)) cities.push('kr');
    if (/Дніпропетровщин|області/i.test(t)) cities.push('kr', 'dp', 'kz');
    if (!cities.length) continue;
    out.push({ text: t, cities: [...new Set(cities)], cancelled: /скасован/i.test(t) });
    if (out.length >= 6) break;
  }
  return out;
}
async function fetchAnnouncements() {
  try {
    const r = await fetch(ANNOUNCE, { headers: UA, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { ok: true, items: parseAnnouncements(await r.text()) };
  } catch (e) { return { ok: false, items: [] }; }
}

export function stateOf(st) {
  const s = String(st || '');
  if (!s) return 'unknown';
  if (/emergency/i.test(s)) return 'emergency';
  if (/wait|not.?publ|unknown/i.test(s)) return 'waiting';
  return 'normal';
}

export function parse(j) {
  const src = (j && (j.groups || j.data)) || j || {};
  const groups = {};
  let newest = null;
  for (const k of Object.keys(src).filter((x) => GROUP_RE.test(x)).sort()) {
    const g = src[k] || {};
    const day = (d) => (d && typeof d === 'object' ? { date: d.date ? String(d.date).slice(0, 10) : null, status: d.status || null, state: stateOf(d.status) } : null);
    const ts = Date.parse(g.updatedOn || (j && j.updatedOn) || '');
    if (!isNaN(ts) && (newest === null || ts > newest)) newest = ts;
    groups[k] = { today: day(g.today), tomorrow: day(g.tomorrow), updatedOn: isNaN(ts) ? null : ts };
  }
  return { groups, updatedTs: newest };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const [yr, ann, tg] = await Promise.allSettled([fetch(YASNO, { headers: UA, signal: AbortSignal.timeout(8000) }), fetchAnnouncements(), fetchTelegram()]);
    const A = ann.status === 'fulfilled' ? ann.value : { ok: false, items: [] };
    const T = tg.status === 'fulfilled' ? tg.value : { ok: false, items: [], channels: [] };
    let groups = {}, updatedTs = null, yasnoOk = false;
    try {
      if (yr.status !== 'fulfilled' || !yr.value.ok) throw new Error('YASNO HTTP ' + (yr.value && yr.value.status));
      ({ groups, updatedTs } = parse(await yr.value.json()));
      yasnoOk = Object.keys(groups).length > 0;
    } catch (e) { /* YASNO недоступний — спробуємо вижити на Telegram-оголошеннях */ }
    if (!yasnoOk && !T.items.length && !A.items.length) throw new Error('жодне джерело не відповіло');
    const emergency = Object.values(groups).filter((g) => g.today && g.today.state === 'emergency').length;
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({ ok: true, fetchedAt: Date.now(), source: 'YASNO / ДТЕК / Telegram', updatedTs, emergencyGroups: emergency, announcements: [...T.items, ...A.items.map((a) => ({ ...a, source: 'YASNO' }))], announceOk: A.ok, telegramOk: T.ok, telegram: T.channels, yasnoOk, groups });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: 'Джерело статусів недоступне (' + (e && e.message || 'помилка') + ')' });
  }
}
