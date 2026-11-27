// Львівобленерго: публічне API сайту poweron.loe.lviv.ua (той самий запит, що робить сама сторінка).
//   https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic  →  hydra:member[0].menuItems[]
// Кожен елемент — графік на одну добу: текст (rawHtml) вигляду «Група 1.1. Електроенергії немає з 04:00 до 07:30, з 14:30 до 18:00»
// плюс зображення з датою у назві. Черги ті самі, що й в ДТЕК: 1.1 … 6.2.
// Правила: група, якої немає в тексті, має світло всю добу; доба без жодної групи — графік ще не опублікований (день не повертаємо);
// дату беремо з тексту, назви чи адреси зображення, нічого не вгадуємо за порядком елементів.
export const LOE_URL = 'https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic';
const SITE = 'https://poweron.loe.lviv.ua/';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9', accept: 'application/ld+json, application/json;q=0.9, */*;q=0.8', referer: SITE, origin: 'https://poweron.loe.lviv.ua' };
const TZ = 'Europe/Kyiv';
const MONTHS = { січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6, липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12 };
const kyivYmd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const pad = (n) => String(n).padStart(2, '0');

export function htmlToText(h) {
  return String(h || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|ul|ol|table|section)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\u200b/g, '')
    .split('\n').map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim()).filter(Boolean).join('\n');
}

const TIME = '(?:(?<!\\d)(\\d{1,2})\\s*:\\s*(\\d{2})|(?<![\\d.])(\\d{1,2})\\.(00|30)(?!\\d|\\.\\d))';
const RANGE_RE = new RegExp(TIME + '\\s*(?:[-–—−]|до|по)\\s*' + TIME, 'gi');
export function extractRanges(seg) {
  const out = [];
  for (const m of String(seg).matchAll(RANGE_RE)) {
    const h1 = +(m[1] ?? m[3]), m1 = +(m[2] ?? m[4]), h2 = +(m[5] ?? m[7]), m2 = +(m[6] ?? m[8]);
    if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) continue;
    const a = h1 * 60 + m1, b = h2 * 60 + m2;
    if (a >= 1440 || b > 1440) continue;
    if (a === 0 && (b === 0 || b === 1440)) out.push([0, 1440]);
    else if (b === 0) out.push([a, 1440]);
    else if (b > a) out.push([a, b]);
    else if (b < a) out.push([a, 1440], [0, b]);
  }
  return out;
}
const TAIL = '(?:\\s*(?:,|;|/|та|і|й)\\s*\\d\\s*[.,]\\s*\\d(?!\\d))*';
const KEY = new RegExp('(?:груп|(?:під)?черг)[а-яіїєґ\']*\\s*№?\\s*(\\d\\s*[.,]\\s*\\d(?!\\d)' + TAIL + ')', 'gi');
const BARE = new RegExp('^\\s*(\\d\\s*[.,]\\s*\\d(?!\\d)' + TAIL + ')\\s*(?=[-–—:]|\\s|$)');
const NOOUT = /(?:електроенергі[яю]|світло)\s+є(?![а-яіїєґ])|відключень\s+(?:немає|нема|не\s+заплановано)|не\s+вимика|без\s+(?:планових\s+)?відключень/i;
const INFO = /станом|оновлен|актуальн|опублік|гаряч[а-яіїєґ]*\s+лін|телефон|call[-\s]?центр|диспетчер|контакт/i;
const groupsOf = (s) => [...new Set([...String(s).matchAll(/(\d{1,2})\s*[.,]\s*(\d)/g)].map((m) => m[1] + '.' + m[2]))].filter((g) => /^\d{1,2}\.[1-9]$/.test(g));
const merge = (arr) => { const r = []; for (const [s, e] of arr.sort((a, b) => a[0] - b[0])) { if (r.length && s <= r[r.length - 1][1]) r[r.length - 1][1] = Math.max(r[r.length - 1][1], e); else r.push([s, e]); } return r; };

// Текст → { '1.1': [[хв_початку, хв_кінця], …], … } (лише групи з відключеннями)
export function parseGroups(text) {
  const lines = String(text || '').split('\n');
  const scan = (useBare) => {
    const sch = {};
    let ctx = [];
    for (const line of lines) {
      let marks = [];
      if (!useBare) for (const m of line.matchAll(KEY)) marks.push({ i: m.index, e: m.index + m[0].length, g: groupsOf(m[1]) });
      else { const m = BARE.exec(line); if (m) marks.push({ i: 0, e: m[0].length, g: groupsOf(m[1]) }); }
      if (!marks.length) {
        if (INFO.test(line)) { ctx = []; continue; }
        const r = extractRanges(line);
        if (!r.length) ctx = [];
        else for (const g of ctx) (sch[g] = sch[g] || []).push(...r);
        continue;
      }
      marks.forEach((mk, k) => {
        const seg = line.slice(mk.e, k + 1 < marks.length ? marks[k + 1].i : undefined);
        const r = extractRanges(seg), none = NOOUT.test(seg);
        if (r.length) for (const g of mk.g) (sch[g] = sch[g] || []).push(...r);
        ctx = none ? [] : mk.g;
      });
    }
    return sch;
  };
  let sch = scan(false);
  if (!Object.keys(sch).length) sch = scan(true);
  const out = {};
  for (const [g, r] of Object.entries(sch)) { const m = merge(r); if (m.length) out[g] = m; }
  return out;
}
// Чи у тексті є явна згадка груп (навіть якщо відключень у них немає)
export const mentionsGroups = (text) => { KEY.lastIndex = 0; return KEY.test(String(text)) || /(?:^|\n)\s*\d\s*[.,]\s*\d\s*[-–—:]/.test(String(text)); };

export function slotsOf(ranges) {
  const slots = Array(48).fill(1);
  for (const [a, b] of ranges || []) for (let i = Math.floor(a / 30); i < Math.min(Math.ceil(b / 30), 48); i++) slots[i] = 0;
  return slots;
}

// ---- дата графіка ----
const ymd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };
export function extractDate(raw, today = kyivYmd()) {
  const t = String(raw || '').toLowerCase();
  const found = [];
  const prio = (pos) => {
    const w = t.slice(Math.max(0, pos - 60), pos).split(/[\n;!?]|\.(?=\s|$)/).pop();
    if (/(станом|оновлен[а-яіїєґ]*|актуальн[а-яіїєґ]*|опублік[а-яіїєґ]*)\s*(на|о|:)?\s*$/.test(w) || /станом\s+на\s*(\d{1,2}[:.]\d{2})?\s*$/.test(w)) return 2;
    if (/(?<![а-яіїєґ])на\s*(?:[а-яіїєґ'’ʼ`]+[\s,(–—-]*)?$/.test(w)) return 0;
    return 1;
  };
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g)) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const d = ymd(y, +m[2], +m[1]); if (d) found.push([prio(m.index), m.index, d]); }
  for (const m of t.matchAll(/(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/g)) { const d = ymd(+m[1], +m[2], +m[3]); if (d) found.push([1, m.index, d]); }
  const yr = +today.slice(0, 4);
  for (const m of t.matchAll(new RegExp('(?<!\\d)(\\d{1,2})\\s+(' + Object.keys(MONTHS).join('|') + ')(?:\\s+(\\d{4}))?', 'g'))) {
    let y = m[3] ? +m[3] : yr; let d = ymd(y, MONTHS[m[2]], +m[1]);
    if (d && !m[3]) { const diff = (Date.parse(d) - Date.parse(today)) / 864e5; if (diff > 200) d = ymd(y - 1, MONTHS[m[2]], +m[1]); else if (diff < -200) d = ymd(y + 1, MONTHS[m[2]], +m[1]); }
    if (d) found.push([prio(m.index), m.index, d]);
  }
  if (!found.length) return null;
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return found[0][2];
}

const strings = (o, depth = 0, acc = []) => {
  if (o == null || depth > 4) return acc;
  if (typeof o === 'string') acc.push(o);
  else if (Array.isArray(o)) o.forEach((x) => strings(x, depth + 1, acc));
  else if (typeof o === 'object') Object.values(o).forEach((x) => strings(x, depth + 1, acc));
  return acc;
};
const EM_RE = /(?:графік[а-яіїєґ]*\s+аварійн[а-яіїєґ]*\s+(?:відключен|вимкнен)|аварійн[а-яіїєґ]*\s+(?:відключен|вимкнен)[а-яіїєґ]*[^.\n]{0,70}(?:введен|діють|діятимуть|застосов|запроваджен)|(?:введен|діють|діятимуть|застосов|запроваджен)[а-яіїєґ]*[^.\n]{0,50}(?:аварійн|екстрен)[а-яіїєґ]*\s+(?:відключен|вимкнен)|(?<![А-ЯІЇЄҐA-Z])ГАВ(?![А-ЯІЇЄҐA-Z])|екстрен[а-яіїєґ]*\s+(?:відключен|вимкнен))/i;
const BOILER = /аварійн[а-яіїєґ]*\s+чи\s+погодинн[а-яіїєґ]*|погодинн[а-яіїєґ]*\s+чи\s+аварійн[а-яіїєґ]*|чергу\s+аварійн/i;
const CANCEL_EM = /(?:скасован[а-яіїєґ]*|припинен[а-яіїєґ]*|завершен[а-яіїєґ]*)[^.\n]{0,50}(?:аварійн|екстрен)/i;
export function isEmergencyText(text) {
  const t = String(text || '').replace(BOILER, ' ');
  return EM_RE.test(t) && !CANCEL_EM.test(t);
}

// menuItems → [{ date, groups, emergency, ts, text }]
export function parseMenu(data, today = kyivYmd()) {
  const members = Array.isArray(data) ? data : (data && (data['hydra:member'] || data.member)) || [];
  if (!members.length) throw new Error('Львівобленерго: порожня відповідь API');
  const items = ((members[0] || {}).menuItems || []).filter((x) => x && typeof x === 'object');
  if (!items.length) throw new Error('Львівобленерго: у відповіді немає menuItems');
  const days = [], skipped = [];
  for (const it of items) {
    const body = [it.rawHtml, it.rawMobileHtml, it.description, it.text, it.content].filter((x) => typeof x === 'string' && x.trim());
    const text = body.length ? htmlToText(body.join('\n')) : '';
    const head = [it.name, it.title, it.label].filter((x) => typeof x === 'string').join(' ');
    const groups = parseGroups(text);
    // дата: текст/назва, потім адреса зображення та решта рядкових полів
    const date = extractDate(head + '\n' + text, today) || extractDate(strings({ ...it, rawHtml: null, rawMobileHtml: null }).join('\n'), today)
      || (/сьогодн/i.test(head + text) ? today : /завтра/i.test(head + text) ? kyivYmd(new Date(Date.parse(today) + 864e5)) : null);
    if (!Object.keys(groups).length && !mentionsGroups(text)) { skipped.push({ name: head.slice(0, 80), why: 'немає груп у тексті', date }); continue; }
    if (!date) { skipped.push({ name: head.slice(0, 80), why: 'не вдалося визначити дату', keys: Object.keys(it) }); continue; }
    const um = text.match(/(?:станом на|оновлено)[^\d]{0,12}(\d{1,2})[:.](\d{2})[^\d]{0,12}(\d{1,2})[./](\d{1,2})[./](\d{4})/i);
    let ts = null;
    if (um) { const guess = Date.UTC(+um[5], +um[4] - 1, +um[3], +um[1], +um[2]); ts = guess - 2 * 36e5; } // запасний варіант: час за Києвом, зимовий зсув
    for (const k of ['updatedAt', 'modifiedAt', 'createdAt', 'updated_at']) { const v = Date.parse(it[k]); if (!isNaN(v)) { ts = v; break; } }
    days.push({ date, groups, emergency: isEmergencyText(head + '\n' + text), ts, text: text.slice(0, 400) });
  }
  return { days, skipped, itemCount: items.length };
}

export async function fetchLoe() {
  const r = await fetch(LOE_URL, { headers: UA, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (api.loe.lviv.ua)');
  const j = await r.json();
  return { ...parseMenu(j), fetchedAt: Date.now() };
}

// Для API: графік однієї черги
export function scheduleFor(parsed, GROUP) {
  const days = {};
  let ts = null, emergency = false;
  for (const d of parsed.days) {
    const cur = days[d.date];
    if (cur && (cur.ts || 0) > (d.ts || 0)) continue;
    days[d.date] = { date: d.date, slots: slotsOf(d.groups[GROUP]), confirmed: true, ts: d.ts || parsed.fetchedAt };
    if (d.ts && d.ts > (ts || 0)) ts = d.ts;
    if (d.emergency && d.date >= kyivYmd()) emergency = true;
  }
  return { source: 'Львівобленерго', ts: ts || parsed.fetchedAt, days, statuses: {}, emergency };
}
// Для статусів: чи оголошено аварійні/екстрені на сайті (сьогодні або пізніше)
export function emergencyOf(parsed) {
  const today = kyivYmd();
  const hit = parsed.days.filter((d) => d.emergency && d.date >= today);
  return { emergency: hit.length > 0, updatedTs: Math.max(0, ...parsed.days.map((d) => d.ts || 0)) || parsed.fetchedAt, text: hit[0] ? hit[0].text : null };
}
