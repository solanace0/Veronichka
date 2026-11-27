// Графік відключень для вибраної черги (ДТЕК Дніпровські електромережі: Кривий Ріг, Дніпро, Кам’янське).
// Джерела опитуються паралельно, для кожного дня береться те, що оновлено найпізніше:
//  1. Дзеркало сайту ДТЕК (Baskerville42/outage-data-ua) — копія графіка з сайту ДТЕК, ~кожні 5 хв.
//  2. YASNO API (app.yasno.ua) — зазвичай відстає від сайту ДТЕК на 10–30 хв.
//  3. kolybude.com — розбір сторінки, лише на сьогодні.
// Сайт ДТЕК закритий захистом Incapsula, його не обходимо.
// Якщо жодне джерело не дало підтвердженого графіка на день, цей день не повертається
// (інтерфейс не має малювати «24 години світла» без даних).
import { fetchFlags, cityStatus } from './_dtek.js';
import { AREAS, MIRROR_BASE, OE_BASE } from './_regions.js';
const kyivYmd = (s) => { const d = new Date(s); return isNaN(d) ? String(s).slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d); };
const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
const KOLY = 'https://kolybude.com/dnipro/kryvyi-rih';
const MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' };
const TZ = 'Europe/Kyiv';

const kyivDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

function kyivOffsetMs(ts) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date(ts)).find(p => p.type === 'timeZoneName')?.value || 'GMT+02:00';
  const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 2 * 3600e3;
  return (m[1] === '-' ? -1 : 1) * ((+m[2]) * 60 + (+(m[3] || 0))) * 60e3;
}
// Київський настінний час -> UTC мс
function kyivToTs(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - kyivOffsetMs(guess - 2 * 3600e3);
}
function fmtUpdated(ts) {
  if (!ts) return null;
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ts)).forEach(x => (p[x.type] = x.value));
  return `${+p.day} ${MONTHS[+p.month - 1]} о ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
const tsDate = ts => kyivDate(new Date(ts));
const isoToTs = v => { const t = Date.parse(v); return isNaN(t) ? null : t; };

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + new URL(url).host + ')');
  return r.json();
}

// ---------- YASNO ----------
function yasnoSlots(day) {
  const list = day.slots || [];
  let hours = list.length > 0 && list.every(s => Number(s.end) <= 24);
  const slots = Array(48).fill(1);
  for (const s of list) {
    if (!/definite/i.test(String(s.type || ''))) continue;
    const k = hours ? 60 : 1;
    const a = Math.floor((s.start * k) / 30), b = Math.ceil((s.end * k) / 30);
    for (let i = a; i < Math.min(b, 48); i++) slots[i] = 0;
  }
  return slots;
}

async function fromYasno(GROUP) {
  const j = await getJson(YASNO);
  const g = j[GROUP] || (j.groups && j.groups[GROUP]) || (j.data && j.data[GROUP]);
  if (!g) throw new Error('YASNO: немає черги ' + GROUP + '. Є: ' + Object.keys(j).slice(0, 12).join(', '));
  const groupTs = isoToTs(g.updatedOn || j.updatedOn);
  const days = {}, statuses = {};
  for (const k of ['today', 'tomorrow']) {
    const d = g[k];
    if (!d || !d.date) continue;
    const st = String(d.status || '');
    statuses[k] = st || null;
    const hasSlots = Array.isArray(d.slots) && d.slots.length > 0;
    if (/wait|not.?publ|unknown|emergency/i.test(st)) continue;      // графік не діє / ще не опублікований
    if (!hasSlots && !/no.?outage|not.?planned|nothing/i.test(st)) continue; // порожньо без явного «відключень немає»
    const date = kyivYmd(d.date);
    days[date] = { date, slots: yasnoSlots(d), confirmed: true, ts: isoToTs(d.updatedOn) || groupTs };
  }
  return { source: 'YASNO / ДТЕК', ts: groupTs, days, statuses };
}

// ---------- Дзеркало сайту ДТЕК ----------
function hoursToSlots(hmap) {
  const slots = Array(48).fill(1);
  for (let h = 1; h <= 24; h++) {
    const v = String(hmap[h] ?? hmap[String(h)] ?? 'yes').toLowerCase();
    const i = (h - 1) * 2;
    if (v === 'no') { slots[i] = 0; slots[i + 1] = 0; }
    else if (v === 'first') slots[i] = 0;
    else if (v === 'second') slots[i + 1] = 0;
    // yes / maybe / mfirst / msecond — світло (можливе відключення не рахуємо як певне)
  }
  return slots;
}

async function fromMirror(GROUP, files, base = MIRROR_BASE, source = 'сайт ДТЕК (дзеркало)') {
  let j = null, lastErr = null;
  for (const f of files) {
    try { j = await getJson(base + f); break; } catch (e) { lastErr = e; }
  }
  if (!j) throw lastErr || new Error(source + ' недоступне');
  const fact = j.fact || (j.data && j.data.fact) || (j.data && j.data.data ? j.data : null) || j;
  const map = fact && fact.data;
  if (!map || typeof map !== 'object') throw new Error(source + ': немає fact.data');
  let ts = null;
  const um = String(fact.update || j.lastUpdated || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (um) ts = kyivToTs(+um[3], +um[2], +um[1], +um[4], +um[5]);
  else if (j.lastUpdated) ts = isoToTs(j.lastUpdated);
  const days = {};
  for (const [k, v] of Object.entries(map)) {
    const g = v && (v['GPV' + GROUP] || v[GROUP]);
    if (!g) continue;
    const dayTs = Number(k) * (Number(k) < 1e12 ? 1000 : 1);
    if (!dayTs) continue;
    const date = tsDate(dayTs);
    days[date] = { date, slots: hoursToSlots(g), confirmed: true, ts };
  }
  if (!Object.keys(days).length) throw new Error(source + ': немає даних для черги ' + GROUP);
  // Застарілий файл (оператор чи парсер перестав оновлювати) не показуємо: у ньому немає ні сьогодні, ні завтра
  const today = kyivDate();
  if (!Object.keys(days).some((d) => d >= today)) throw new Error(source + ': дані застаріли (останній день ' + Object.keys(days).sort().pop() + ')');
  return { source, ts, days, statuses: {} };
}

// ---------- kolybude.com ----------
function fromKolybude(html, GROUP) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const dm = text.match(/на сьогодні,?\s*(\d{1,2})\s+([а-яіїєʼ’']+)/i);
  if (!dm) throw new Error('kolybude: не знайдено дату');
  const mo = MONTHS.indexOf(dm[2].toLowerCase());
  if (mo < 0) throw new Error('kolybude: невідомий місяць ' + dm[2]);
  const year = +kyivDate().slice(0, 4);
  const date = `${year}-${String(mo + 1).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  const start = text.indexOf('ДТЕК'), cek = text.indexOf('ЦЕК', start + 4);
  const part = text.slice(start < 0 ? 0 : start, cek < 0 ? undefined : cek);
  const g = part.match(new RegExp('Черга\\s*' + GROUP.replace('.', '\\.') + '([\\s\\S]*?)(?=Черга\\s*\\d|$)'));
  if (!g) throw new Error('kolybude: немає черги ' + GROUP);
  const slots = Array(48).fill(1), re = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/g;
  let m, found = 0;
  while ((m = re.exec(g[1]))) {
    found++;
    const a = Math.round((+m[1] * 60 + +m[2]) / 30), b = Math.round((+m[3] * 60 + +m[4]) / 30);
    for (let i = a; i < Math.min(b, 48); i++) slots[i] = 0;
  }
  if (!found && !/не передбачено|не заплановано/i.test(g[1])) throw new Error('kolybude: не вдалося розібрати чергу');
  let ts = null;
  const um = text.match(/Оновлено\s+(\d{1,2})\s+([а-яіїє]+)\s+о\s+(\d{1,2}):(\d{2})/i);
  if (um && MONTHS.indexOf(um[2].toLowerCase()) >= 0) ts = kyivToTs(year, MONTHS.indexOf(um[2].toLowerCase()) + 1, +um[1], +um[3], +um[4]);
  return { source: 'kolybude.com', ts, days: { [date]: { date, slots, confirmed: true, ts } }, statuses: {} };
}
async function fromKoly(GROUP) {
  const r = await fetch(KOLY, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (kolybude.com)');
  return fromKolybude(await r.text(), GROUP);
}

// ---------- Злиття ----------
// Пріоритет за рівної/невідомої свіжості: дзеркало сайту ДТЕК > YASNO > kolybude.
const PRIORITY = { 'Львівобленерго': 0, 'сайт ДТЕК (дзеркало)': 0, 'OE_OUTAGE_DATA (сайт обленерго)': 1, 'poltava-outage-data (сайт Полтаваобленерго)': 1, 'YASNO / ДТЕК': 1, 'kolybude.com': 2 };
const prio = (s) => (s in PRIORITY ? PRIORITY[s] : 1);

// «Усе світло» від kolybude.com — це часто заглушка «ще не опубліковано», а не справжній графік.
// Такий день слабкий: його не беруть, якщо інше джерело має цю дату, і не вважають підтвердженим.
const weak = (r, d) => r.source === 'kolybude.com' && d.slots.every((v) => v === 1);
export function merge(results) {
  const best = {}; // date -> {day, source, weak}
  for (const r of results) {
    for (const [date, d] of Object.entries(r.days)) {
      const cur = best[date], w = weak(r, d);
      const a = d.ts || 0, b = cur ? cur.day.ts || 0 : -1;
      const better = !cur || (cur.weak && !w) || (!(w && !cur.weak) && (a > b || (a === b && prio(r.source) < prio(cur.source))));
      if (better) best[date] = { day: d, source: r.source, weak: w };
    }
  }
  const days = {}, used = new Set();
  let ts = 0;
  for (const [date, { day, source, weak: w }] of Object.entries(best)) {
    days[date] = { date, slots: day.slots, confirmed: !w, source };
    used.add(source);
    if (day.ts && day.ts > ts) ts = day.ts;
  }
  return { days, sources: [...used], ts: ts || null };
}


// ---------- Львівобленерго (api.loe.lviv.ua — той самий API, що живить poweron.loe.lviv.ua) ----------
const LOE_URLS = ['https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic', 'https://api.loe.lviv.ua/api/menu_items/238', 'https://api.loe.lviv.ua/api/menu_items/256'];
const LOE_H = { ...UA, accept: 'application/json', origin: 'https://poweron.loe.lviv.ua', referer: 'https://poweron.loe.lviv.ua/' };
function loeCollect(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) { node.forEach((x) => loeCollect(x, out, depth + 1)); return; }
  if (typeof node.rawHtml === 'string' && node.rawHtml.trim()) out.push(node);
  for (const v of Object.values(node)) if (v && typeof v === 'object') loeCollect(v, out, depth + 1);
}
function loeText(html) {
  return String(html).replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t\u00a0]+/g, ' ');
}
export function parseLoe(html, GROUP) {
  const text = loeText(html);
  const dm = text.match(/(?:відключен\S*|графік\S*)\s+на\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i) || text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!dm) throw new Error('Львівобленерго: у тексті графіка немає дати');
  const date = `${dm[3]}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  let ts = null;
  const um = text.match(/станом\s+на\s+(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (um) ts = kyivToTs(+um[5], +um[4], +um[3], +um[1], +um[2]);
  const segs = {};
  const re = /Груп[аи]\s*(\d{1,2})\.(\d)\.?([\s\S]*?)(?=Груп[аи]\s*\d{1,2}\.\d|$)/gi;
  let m;
  while ((m = re.exec(text))) segs[m[1] + '.' + m[2]] = m[3];
  if (!Object.keys(segs).length) throw new Error('Львівобленерго: у тексті немає груп (графік не опубліковано або змінився формат)');
  const slots = Array(48).fill(1);
  const seg = segs[GROUP] || '';
  const rr = /з\s*(\d{1,2}):(\d{2})\s*до\s*(\d{1,2}):(\d{2})/gi;
  let r;
  while ((r = rr.exec(seg))) {
    const a = +r[1] * 60 + +r[2];
    let b = +r[3] * 60 + +r[4];
    if (b <= a) b = 24 * 60;
    for (let t = a; t < Math.min(b, 1440); t += 30) slots[Math.floor(t / 30)] = 0;
  }
  return { date, ts, slots, listed: GROUP in segs };
}
async function fromLoe(GROUP) {
  let lastErr = null;
  for (const url of LOE_URLS.slice(0, 1)) {
    try {
      const r = await fetch(url, { headers: LOE_H, signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' (api.loe.lviv.ua)');
      const items = [];
      loeCollect(await r.json(), items);
      const days = {};
      let ts = null, perr = null;
      for (const it of items) {
        try {
          const d = parseLoe(it.rawHtml, GROUP);
          if (!days[d.date] || (d.ts || 0) > (days[d.date].ts || 0)) days[d.date] = { date: d.date, slots: d.slots, confirmed: true, ts: d.ts };
          if (d.ts && d.ts > (ts || 0)) ts = d.ts;
        } catch (e) { perr = e; }
      }
      if (Object.keys(days).length) return { source: 'Львівобленерго', ts, days, statuses: {} };
      throw perr || new Error('Львівобленерго: API не віддав графіків');
    } catch (e) { lastErr = e; }
  }
  // запасний шлях: окремі елементи меню (сьогодні / завтра)
  const days = {};
  let ts = null;
  for (const url of LOE_URLS.slice(1)) {
    try {
      const r = await fetch(url, { headers: LOE_H, signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const items = [];
      loeCollect(await r.json(), items);
      for (const it of items) {
        const d = parseLoe(it.rawHtml, GROUP);
        days[d.date] = { date: d.date, slots: d.slots, confirmed: true, ts: d.ts };
        if (d.ts && d.ts > (ts || 0)) ts = d.ts;
      }
    } catch (e) { lastErr = e; }
  }
  if (Object.keys(days).length) return { source: 'Львівобленерго', ts, days, statuses: {} };
  throw lastErr || new Error('Львівобленерго недоступне');
}
// /api/schedule?probe=lv — діагностика: що реально віддає api.loe.lviv.ua і як ми це розібрали
async function probeLoe(res) {
  const out = [];
  for (const url of LOE_URLS) {
    try {
      const r = await fetch(url, { headers: LOE_H, signal: AbortSignal.timeout(9000) });
      const t = await r.text();
      let items = [], parsed = null;
      try { loeCollect(JSON.parse(t), items); parsed = items.map((it) => { try { const d = parseLoe(it.rawHtml, '1.1'); return { date: d.date, listed: d.listed, off: d.slots.filter((x) => !x).length / 2 }; } catch (e) { return { error: String(e.message) }; } }); } catch (e) { parsed = 'не JSON'; }
      out.push({ url, status: r.status, bytes: t.length, head: t.slice(0, 700), items: items.length, parsed });
    } catch (e) { out.push({ url, error: String(e && e.message || e) }); }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, probe: 'lv', out });
}

// /api/schedule?probe=1 — перевіряє, які області вже є в дзеркалі (щоб додавати лише ті, де є справжні дані)
const PROBE = ['vinnytsia','volyn','zhytomyr','zakarpattia','zaporizhzhia','ivano-frankivsk','kirovohrad','lviv','mykolaiv','poltava','rivne','sumy','ternopil','kharkiv','kherson','khmelnytskyi','cherkasy','chernivtsi','chernihiv','dnipro','dnipro-oblast','kyiv','kyiv-region','odesa'];
async function probe(res) {
  const out = await Promise.all(PROBE.map(async (n) => {
    try {
      const r = await fetch(MIRROR_BASE + n + '.json', { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { file: n + '.json', ok: false, status: r.status };
      const j = await r.json();
      const days = Object.keys((j && j.fact && j.fact.data) || {}).map((t) => kyivYmd(+t * 1000));
      const groups = Object.keys(Object.values((j && j.fact && j.fact.data) || {})[0] || {}).length;
      return { file: n + '.json', ok: !!days.length, days, groups, updated: j && j.fact && j.fact.update };
    } catch (e) { return { file: n + '.json', ok: false, error: String(e && e.message || e) }; }
  }));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, found: out.filter((x) => x.ok).map((x) => x.file), files: out });
}

// /api/schedule?probe=oe — перевіряє, які файли обленерго реально відповідають, у яких є черги 1.1–6.2 і наскільки свіжі
async function probeOe(res) {
  const out = await Promise.all(Object.entries(AREAS).filter(([, a]) => a.base === OE_BASE).map(async ([code, a]) => {
    const tried = [];
    for (const f of a.mirror) {
      try {
        const j = await getJson(OE_BASE + f);
        const fact = j.fact || (j.data && j.data.fact) || j;
        const map = (fact && fact.data) || {};
        const first = Object.values(map)[0] || {};
        const groups = Object.keys(first).filter((k) => /^GPV\d{1,2}\.\d$/.test(k));
        return { code, file: f, ok: !!Object.keys(map).length, days: Object.keys(map).map((t) => kyivYmd(+t * 1000)), groups: groups.length, updated: fact && fact.update || j.lastUpdated || null, tried };
      } catch (e) { tried.push({ file: f, error: String(e && e.message || e) }); }
    }
    return { code, ok: false, tried };
  }));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, working: out.filter((x) => x.ok).map((x) => x.code), out });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    return await run(req, res);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ ok: false, error: 'Внутрішня помилка сервера' });
  }
}

const gSort = (a, b) => { const [x, y] = a.split('.').map(Number), [u, v] = b.split('.').map(Number); return x - u || y - v; };
// Перелік черг, які реально є в джерелах цієї зони (схема може змінитись: 6×2 → 12×1 тощо).
async function groupsList(q, res) {
  const city = AREAS[String(q.city)] ? String(q.city) : 'kr';
  const area = AREAS[city];
  const set = new Set();
  const jobs = [];
  if (area.mirror) jobs.push((async () => {
    for (const f of area.mirror) {
      try {
        const j = await getJson((area.base || MIRROR_BASE) + f);
        const fact = j.fact || (j.data && j.data.fact) || j;
        for (const v of Object.values((fact && fact.data) || {})) for (const k of Object.keys(v || {})) { const m = k.match(/^GPV(\d{1,2}\.\d)$/); if (m) set.add(m[1]); }
        return;
      } catch (e) { /* наступний файл */ }
    }
  })());
  if (area.yasno) jobs.push((async () => {
    const j = await getJson(YASNO);
    const src = (j.groups && typeof j.groups === 'object') ? j.groups : (j.data && typeof j.data === 'object') ? j.data : j;
    for (const k of Object.keys(src)) if (/^\d{1,2}\.\d$/.test(k)) set.add(k);
  })().catch(() => {}));
  if (area.loe) for (let i = 1; i <= 6; i++) for (let j = 1; j <= 2; j++) set.add(i + '.' + j);
  await Promise.all(jobs);
  const groups = [...set].sort(gSort);
  res.setHeader('Cache-Control', groups.length ? 's-maxage=600, stale-while-revalidate=300' : 'no-store');
  return res.status(200).json({ ok: groups.length > 0, city, groups });
}

// Графіки всіх черг зони за кожен день: з них застосунок сам підбирає чергу за 3 запитаннями «світло було?».
// Джерела: дзеркало сайту оператора, а для зон ДТЕК Дніпровські електромережі ще й YASNO (резерв).
// Застарілі файли (без сьогодні/завтра) не віддаємо: за ними не можна питати, що було «сьогодні».
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
async function allFromMirror(area) {
  let j = null;
  for (const f of area.mirror) { try { j = await getJson((area.base || MIRROR_BASE) + f); break; } catch (e) { /* далі */ } }
  if (!j) throw new Error('Джерело недоступне');
  const fact = j.fact || (j.data && j.data.fact) || j;
  const groups = {};
  for (const [k, v] of Object.entries((fact && fact.data) || {})) {
    const dayTs = Number(k) * (Number(k) < 1e12 ? 1000 : 1);
    if (!dayTs) continue;
    const date = tsDate(dayTs);
    for (const [gk, hm] of Object.entries(v || {})) {
      const m = gk.match(/^GPV(\d{1,2}\.\d)$/);
      if (m && hm) (groups[m[1]] = groups[m[1]] || {})[date] = hoursToSlots(hm).join('');
    }
  }
  return groups;
}
async function allFromYasno() {
  const j = await getJson(YASNO);
  const src = (j.groups && typeof j.groups === 'object') ? j.groups : (j.data && typeof j.data === 'object') ? j.data : j;
  const groups = {};
  for (const [gk, g] of Object.entries(src)) {
    if (!/^\d{1,2}\.\d$/.test(gk) || !g) continue;
    for (const k of ['today', 'tomorrow']) {
      const d = g[k];
      if (!d || !d.date) continue;
      const st = String(d.status || '');
      const hasSlots = Array.isArray(d.slots) && d.slots.length > 0;
      if (/wait|not.?publ|unknown|emergency/i.test(st)) continue;
      if (!hasSlots && !/no.?outage|not.?planned|nothing/i.test(st)) continue;
      (groups[gk] = groups[gk] || {})[kyivYmd(d.date)] = yasnoSlots(d).join('');
    }
  }
  return groups;
}
const freshGroups = (groups) => {
  const today = kyivDate(), keep = addDays(today, -1), out = {};
  let hasFresh = false;
  for (const [g, days] of Object.entries(groups)) for (const [d, s] of Object.entries(days)) {
    if (d < keep) continue;
    if (d >= today) hasFresh = true;
    (out[g] = out[g] || {})[d] = s;
  }
  return hasFresh ? out : {};
};
async function allGroups(q, res) {
  const city = AREAS[String(q.city)] ? String(q.city) : 'kr';
  const area = AREAS[city];
  if (!area.mirror) { res.setHeader('Cache-Control', 'no-store'); return res.status(503).json({ ok: false, soon: true, error: 'Джерело не підключене' }); }
  const tries = [() => allFromMirror(area)];
  if (area.yasno) tries.push(() => allFromYasno());
  let groups = {}, lastErr = null;
  for (const t of tries) {
    try { groups = freshGroups(await t()); if (Object.keys(groups).length) break; } catch (e) { lastErr = e; }
  }
  const ok = Object.keys(groups).length > 0;
  res.setHeader('Cache-Control', ok ? 's-maxage=120, stale-while-revalidate=60' : 'no-store');
  return res.status(ok ? 200 : 502).json({ ok, city, groups, fetchedAt: Date.now(), error: ok ? undefined : (lastErr && lastErr.message) || 'Немає свіжих даних' });
}

async function run(req, res) {
  const q = req.query || {};
  if (q.probe === 'lv') return probeLoe(res);
  if (q.probe === 'oe') return probeOe(res);
  if (q.probe) return probe(res);
  if (q.groups) return groupsList(q, res);
  if (q.all) return allGroups(q, res);
  const GROUP = String(q.group || '4.2');
  if (!/^\d{1,2}\.[1-9]$/.test(GROUP)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ ok: false, error: 'Невірна черга' }); }
  const city = AREAS[String(q.city)] ? String(q.city) : 'kr';
  const area = AREAS[city];
  if (!area.mirror && !area.loe) {
    // для цієї зони джерело ще не підключене: чесно кажемо «скоро», а не малюємо «24 години світла»
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ ok: false, soon: true, city, operator: area.operator, error: 'Для зони «' + area.name + '» джерело графіків ще не підключене (' + area.operator + ')' });
  }
  const fns = {};
  const all = [];
  if (area.mirror) { fns.mirror = () => fromMirror(GROUP, area.mirror, area.base || MIRROR_BASE, area.label || 'сайт ДТЕК (дзеркало)'); all.push('mirror'); }
  if (area.alt) { fns.mirror2 = () => fromMirror(GROUP, area.alt.files, area.alt.base, area.alt.label); all.push('mirror2'); }
  if (area.loe) { fns.loe = () => fromLoe(GROUP); all.push('loe'); }
  // YASNO і kolybude.com — лише для ДТЕК Дніпровських електромереж; для інших зон беремо тільки перевірене дзеркало
  if (area.yasno) { fns.yasno = () => fromYasno(GROUP); all.push('yasno'); }
  if (area.koly) { fns.kolybude = () => fromKoly(GROUP); all.push('kolybude'); }
  const names = q.src && fns[q.src] ? [q.src] : all;
  const [settled, flagRes] = await Promise.all([Promise.allSettled(names.map(n => fns[n]())), fetchFlags(area.flags).catch(() => ({ flags: [], errors: [] }))]);
  const ok = [], errors = [], report = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      ok.push(s.value);
      report.push({ src: names[i], ok: true, updated: fmtUpdated(s.value.ts), days: Object.keys(s.value.days), statuses: s.value.statuses });
    } else {
      const msg = String(s.reason && s.reason.message || s.reason);
      errors.push(names[i] + ': ' + msg);
      report.push({ src: names[i], ok: false, error: msg });
    }
  });
  const m = merge(ok);
  // YASNO повідомляє статус «EmergencyShutdowns», коли діють екстрені відключення і планові графіки не застосовуються
  // Екстрені відключення: прапорець сайту ДТЕК для цього міста або статус YASNO (YASNO — лише для Дніпра)
  const dtekSt = cityStatus(flagRes.flags, city);
  const emergency = dtekSt.emergency || (city === 'dp' && ok.some(r => Object.values(r.statuses || {}).some(st => /emergency/i.test(String(st || '')))));
  if (!Object.keys(m.days).length && emergency) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({
      ok: true, group: GROUP, city, fetchedAt: Date.now(), emergency: true,
      source: ok.map(r => r.source).join(' + '), updated: null, updatedTs: null, days: {},
      statuses: Object.assign({}, ...ok.map(r => r.statuses)), fallbackErrors: errors,
      ...(q.debug ? { report } : {})
    });
  }
  if (!Object.keys(m.days).length) {
    ok.forEach(r => errors.push(r.source + ': немає підтвердженого графіка (статуси: ' + (JSON.stringify(r.statuses) || '{}') + ')'));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: errors.join(' | ') || 'Жодне джерело не віддало підтверджений графік', ...(q.debug ? { report } : {}) });
  }
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.status(200).json({
    ok: true, group: GROUP, city, operator: area.operator, fetchedAt: Date.now(), emergency,
    source: m.sources.join(' + '), updated: fmtUpdated(m.ts), updatedTs: m.ts,
    days: m.days, statuses: Object.assign({}, ...ok.map(r => r.statuses)), fallbackErrors: errors,
    ...(q.debug ? { report } : {})
  });
}
