// Графік відключень для вибраної черги (ДТЕК Дніпровські електромережі: Кривий Ріг, Дніпро, Кам’янське).
// Джерела опитуються паралельно, для кожного дня береться те, що оновлено найпізніше:
//  1. Дзеркало сайту ДТЕК (Baskerville42/outage-data-ua) — копія графіка з сайту ДТЕК, ~кожні 5 хв.
//  2. YASNO API (app.yasno.ua) — зазвичай відстає від сайту ДТЕК на 10–30 хв.
//  3. kolybude.com — розбір сторінки, лише на сьогодні.
// Сайт ДТЕК закритий захистом Incapsula, його не обходимо.
// Якщо жодне джерело не дало підтвердженого графіка на день, цей день не повертається
// (інтерфейс не має малювати «24 години світла» без даних).
const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
const MIRROR_BASE = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
const MIRROR_FILES = ['dnipro.json', 'dnipro-oblast.json'];
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
    const date = String(d.date).slice(0, 10);
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

async function fromMirror(GROUP) {
  let j = null, lastErr = null;
  for (const f of MIRROR_FILES) {
    try { j = await getJson(MIRROR_BASE + f); break; } catch (e) { lastErr = e; }
  }
  if (!j) throw lastErr || new Error('Дзеркало ДТЕК недоступне');
  const fact = j.fact || (j.data && j.data.fact) || (j.data && j.data.data ? j.data : null) || j;
  const map = fact && fact.data;
  if (!map || typeof map !== 'object') throw new Error('Дзеркало ДТЕК: немає fact.data');
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
  if (!Object.keys(days).length) throw new Error('Дзеркало ДТЕК: немає даних для черги ' + GROUP);
  return { source: 'сайт ДТЕК (дзеркало)', ts, days, statuses: {} };
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
const PRIORITY = { 'сайт ДТЕК (дзеркало)': 0, 'YASNO / ДТЕК': 1, 'kolybude.com': 2 };

export function merge(results) {
  const best = {}; // date -> {day, source}
  for (const r of results) {
    for (const [date, d] of Object.entries(r.days)) {
      const cur = best[date];
      const a = d.ts || 0, b = cur ? cur.day.ts || 0 : -1;
      if (!cur || a > b || (a === b && PRIORITY[r.source] < PRIORITY[cur.source])) best[date] = { day: d, source: r.source };
    }
  }
  const days = {}, used = new Set();
  let ts = 0;
  for (const [date, { day, source }] of Object.entries(best)) {
    days[date] = { date, slots: day.slots, confirmed: true, source };
    used.add(source);
    if (day.ts && day.ts > ts) ts = day.ts;
  }
  return { days, sources: [...used], ts: ts || null };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const GROUP = String(q.group || '4.2');
  if (!/^[1-6]\.[12]$/.test(GROUP)) return res.status(400).json({ ok: false, error: 'Невірна черга' });
  const city = String(q.city || 'kr');
  const fns = { mirror: () => fromMirror(GROUP), yasno: () => fromYasno(GROUP), kolybude: () => fromKoly(GROUP) };
  // kolybude.com використовуємо лише для Кривого Рогу (сторінка міста)
  const all = city === 'kr' ? ['mirror', 'yasno', 'kolybude'] : ['mirror', 'yasno'];
  const names = q.src && fns[q.src] ? [q.src] : all;
  const settled = await Promise.allSettled(names.map(n => fns[n]()));
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
  if (!Object.keys(m.days).length) {
    ok.forEach(r => errors.push(r.source + ': немає підтвердженого графіка (статуси: ' + (JSON.stringify(r.statuses) || '{}') + ')'));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: errors.join(' | ') || 'Жодне джерело не віддало підтверджений графік', ...(q.debug ? { report } : {}) });
  }
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.status(200).json({
    ok: true, group: GROUP, fetchedAt: Date.now(),
    source: m.sources.join(' + '), updated: fmtUpdated(m.ts), updatedTs: m.ts,
    days: m.days, statuses: Object.assign({}, ...ok.map(r => r.statuses)), fallbackErrors: errors,
    ...(q.debug ? { report } : {})
  });
}
