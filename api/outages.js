// Статус екстрених відключень для Кривого Рогу, Дніпра й Кам’янського (ДТЕК Дніпровські електромережі).
//
// Джерела за надійністю:
//  1. Прапорець emergency на сайті ДТЕК (через відкрите дзеркало) — дані самого оператора, окремо по містах/районах.   → «Діють екстрені» (підтверджено)
//  2. YASNO API, статус черги EmergencyShutdowns — лише для міста Дніпро.                                                → «Діють екстрені» (підтверджено)
//  3. Оголошення оператора: сторінка YASNO та Telegram ДТЕК/Укренерго (суворий розбір, лише з дієсловом введення).      → «Оголошено» (ще не підтверджено)
//  4. Telegram ОВА та Ради оборони Кривого Рогу — лише стрічка повідомлень «як є», без автоматичних висновків.
// Адресних даних (вулиця, причина, час відновлення) відкриті джерела не дають, тому нічого не вигадуємо.
import { fetchTelegram, isStart, isCancel, queuesOf } from './_telegram.js';
import { fetchFlags, cityStatus } from './_dtek.js';

const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
const ANNOUNCE = 'https://static.yasno.ua/dnipro/outages';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' };
const GROUP_RE = /^[1-6]\.[12]$/;
const CITIES = ['kr', 'dp', 'kz'];
const kyivYmd = (s) => { const d = new Date(s); return isNaN(d) ? String(s).slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d); };

// ---------- Оголошення на сторінці YASNO (м. Дніпро) ----------
export function parseAnnouncements(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const seen = new Set(), out = [];
  for (const raw of text.replace(/(^|\s)(м|смт|с|вул|просп|обл)\.\s+/gi, '$1$2§ ').split(/(?<=[.!?])\s+/)) {
    const t = raw.replace(/§/g, '.').trim();
    if (t.length < 20 || t.length > 260 || /[?]/.test(t) || seen.has(t)) continue;
    if (!/(екстрен|аварійн|графіки не діють|графік не діє)/i.test(t)) continue;
    const cancelled = isCancel(t);
    if (!isStart(t) && !cancelled) continue;
    // Сторінка YASNO стосується міста Дніпро; інше місто — лише якщо названо прямо
    const cities = [];
    if (/Дніпр(?:о|і|а|у|ом|ові)(?![а-яіїєґ])/i.test(t)) cities.push('dp');
    if (/Кам[’'ʼ`]?янськ(?![а-яіїєґ]*\s+район)/i.test(t)) cities.push('kz');
    if (/Крив(ий|ого|ому)\s+Р(іг|огу|озі)/i.test(t)) cities.push('kr');
    if (!cities.length) continue;
    seen.add(t);
    out.push({ text: t, cities, cancelled, ...queuesOf(t), source: 'YASNO', ts: null });
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

// ---------- YASNO статуси черг (лише Дніпро) ----------
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
    const day = (d) => (d && typeof d === 'object' ? { date: d.date ? kyivYmd(d.date) : null, status: d.status || null, state: stateOf(d.status) } : null);
    const ts = Date.parse(g.updatedOn || (j && j.updatedOn) || '');
    if (!isNaN(ts) && (newest === null || ts > newest)) newest = ts;
    groups[k] = { today: day(g.today), tomorrow: day(g.tomorrow), updatedOn: isNaN(ts) ? null : ts };
  }
  return { groups, updatedTs: newest };
}
async function fetchYasno() {
  const r = await fetch(YASNO, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('YASNO HTTP ' + r.status);
  const out = parse(await r.json());
  if (!Object.keys(out.groups).length) throw new Error('YASNO: порожня відповідь');
  return out;
}

// ---------- Підсумок по місту ----------
// level: emergency (підтверджено) | announced (оголошено, не підтверджено) | none | unknown
export function buildCity(city, { dtek, yasno, annYasno, tgItems }) {
  const reasons = [];
  let level = 'none', queues = [], allQueues = false;
  const checked = [];

  // 1. Сайт ДТЕК
  if (dtek && dtek.known) {
    checked.push({ name: 'Сайт ДТЕК (дзеркало)', ok: true, ts: dtek.updatedTs || null, stale: !!dtek.stale });
    if (dtek.emergency) {
      level = 'emergency'; allQueues = true;
      reasons.push({ src: 'Сайт ДТЕК', ts: dtek.updatedTs || null, text: dtek.districts ? 'ДТЕК оголосив екстрені відключення: ' + dtek.districts + '.' : 'ДТЕК оголосив екстрені відключення на своєму сайті.' });
    }
  } else checked.push({ name: 'Сайт ДТЕК (дзеркало)', ok: false });

  // 2. YASNO (лише Дніпро)
  if (city === 'dp') {
    if (yasno) {
      checked.push({ name: 'YASNO (статус черг)', ok: true, ts: yasno.updatedTs || null });
      const total = Object.keys(yasno.groups).length;
      const em = Object.entries(yasno.groups).filter(([, g]) => g.today && g.today.state === 'emergency').map(([k]) => k);
      if (em.length) {
        level = 'emergency';
        if (em.length === total) allQueues = true; else queues = [...new Set([...queues, ...em])];
        reasons.push({ src: 'YASNO', ts: yasno.updatedTs || null, text: em.length === total ? 'YASNO: екстрені відключення діють для всіх черг.' : 'YASNO: екстрені відключення діють для черг ' + em.join(', ') + '.' });
      }
    } else checked.push({ name: 'YASNO (статус черг)', ok: false });
  }

  // 3. Оголошення операторів (лише рівень «оголошено»)
  if (level !== 'emergency') {
    // Якщо свіжий знімок сайту ДТЕК каже «немає», то оголошення, старіші за цей знімок, у банер не беремо (вони лишаються в стрічці)
    const freshDtekTs = dtek && dtek.known && !dtek.stale && !dtek.emergency ? dtek.updatedTs || 0 : 0;
    const anns = [...tgItems.filter((a) => a.cities.includes(city)), ...annYasno.filter((a) => a.cities.includes(city))].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const active = anns.filter((a) => !a.cancelled && (a.ts == null || a.ts > freshDtekTs - 10 * 6e4));
    if (active.length) {
      level = 'announced';
      for (const a of active.slice(0, 3)) {
        reasons.push({ src: a.source, ts: a.ts, link: a.link || null, text: a.text });
        if (a.allQueues) allQueues = true; else queues = [...new Set([...queues, ...(a.queues || [])])];
      }
    }
  }
  // «Не заявлено» можна казати лише за свіжими даними ДТЕК (або YASNO для Дніпра); інакше чесно «невідомо»
  const solid = (dtek && dtek.known && !dtek.stale) || (city === 'dp' && !!yasno);
  if (level === 'none' && !solid) level = 'unknown';
  return { level, queues: queues.sort(), allQueues, reasons, checked, stabilizing: !!(dtek && dtek.stabilizing), otherDistricts: (dtek && dtek.otherDistricts) || null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const debug = !!(req.query && req.query.debug);
    const [ys, ann, tg, fl] = await Promise.allSettled([fetchYasno(), fetchAnnouncements(), fetchTelegram(), fetchFlags()]);
    const yasno = ys.status === 'fulfilled' ? ys.value : null;
    const A = ann.status === 'fulfilled' ? ann.value : { ok: false, items: [] };
    const T = tg.status === 'fulfilled' ? tg.value : { ok: false, items: [], feed: [], channels: [] };
    const F = fl.status === 'fulfilled' ? fl.value : { flags: [], errors: [String(fl.reason && fl.reason.message || fl.reason)] };

    const cities = {};
    for (const c of CITIES) {
      cities[c] = buildCity(c, { dtek: cityStatus(F.flags, c), yasno, annYasno: A.items, tgItems: T.items });
      cities[c].feed = (T.feed || []).filter((a) => a.cities.includes(c)).slice(0, 8);
    }
    if (!(F.flags.length || yasno || T.ok || A.ok)) throw new Error('жодне джерело не відповіло');
    const groups = yasno ? yasno.groups : {};
    const emergencyGroups = Object.values(groups).filter((g) => g.today && g.today.state === 'emergency').length;
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({
      ok: true, fetchedAt: Date.now(), cities, groups, emergencyGroups, updatedTs: yasno ? yasno.updatedTs : null,
      yasnoOk: !!yasno, dtekOk: F.flags.length > 0, telegramOk: T.ok, announceOk: A.ok, telegram: T.channels || [],
      ...(debug ? { dtekFlags: F.flags, dtekErrors: F.errors, yasnoError: ys.status === 'rejected' ? String(ys.reason && ys.reason.message || ys.reason) : null } : {})
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: 'Джерела статусів недоступні (' + (e && e.message || 'помилка') + ')' });
  }
}
