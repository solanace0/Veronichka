// Джерело 1 (основне): YASNO / ДТЕК — публічний API, дані ДТЕК Дніпровські електромережі.
// Джерело 2 (резервне): kolybude.com. Сайт ДТЕК закритий захистом Incapsula, його не обходимо.
const GROUP = '4.2';
const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages';
const KOLY = 'https://kolybude.com/dnipro/kryvyi-rih';
const MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' };
const kyivDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d);

function fmtUpdated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour12: false, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(d).forEach(x => (p[x.type] = x.value));
  return `${+p.day} ${MONTHS[+p.month - 1]} о ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

function daySlots(day) {
  const slots = Array(48).fill(1);
  for (const s of day.slots || []) {
    if (/not|no/i.test(String(s.type || '')) && !/definite|possible/i.test(String(s.type))) continue;
    const a = Math.floor(s.start / 30), b = Math.ceil(s.end / 30);
    for (let i = a; i < Math.min(b, 48); i++) slots[i] = 0;
  }
  return slots;
}

async function fromYasno() {
  const r = await fetch(YASNO, { headers: UA });
  if (!r.ok) throw new Error('YASNO відповів HTTP ' + r.status);
  const j = await r.json();
  const g = j[GROUP] || (j.groups && j.groups[GROUP]) || (j.data && j.data[GROUP]);
  if (!g) throw new Error('У відповіді YASNO немає черги ' + GROUP + '. Є: ' + Object.keys(j).slice(0, 15).join(', '));
  const days = {};
  const statuses = {};
  for (const k of ['today', 'tomorrow']) {
    const d = g[k];
    if (!d || !d.date) continue;
    statuses[k] = d.status || null;
    if (/wait|not.?publ|unknown/i.test(String(d.status || ''))) continue; // графік ще не опубліковано
    const date = String(d.date).slice(0, 10);
    days[date] = { date, slots: daySlots(d), confirmed: true };
  }
  const upd = g.updatedOn || j.updatedOn || (g.today && g.today.updatedOn) || null;
  return { source: 'YASNO / ДТЕК (офіційний API)', updated: upd ? fmtUpdated(upd) : null, days, statuses };
}

function fromKolybude(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const dm = text.match(/на сьогодні,?\s*(\d{1,2})\s+([а-яіїєʼ’']+)/i);
  if (!dm) throw new Error('Не знайдено дату на сторінці kolybude.com');
  const mo = MONTHS.indexOf(dm[2].toLowerCase());
  if (mo < 0) throw new Error('Невідомий місяць: ' + dm[2]);
  const date = `${kyivDate().slice(0, 4)}-${String(mo + 1).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  const start = text.indexOf('ДТЕК'), cek = text.indexOf('ЦЕК', start + 4);
  const part = text.slice(start < 0 ? 0 : start, cek < 0 ? undefined : cek);
  const g = part.match(new RegExp('Черга\\s*' + GROUP.replace('.', '\\.') + '([\\s\\S]*?)(?=Черга\\s*\\d|$)'));
  if (!g) throw new Error('Не знайдено чергу ' + GROUP + ' на kolybude.com');
  const slots = Array(48).fill(1), re = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/g;
  let m, found = 0;
  while ((m = re.exec(g[1]))) {
    found++;
    const a = Math.round((+m[1] * 60 + +m[2]) / 30), b = Math.round((+m[3] * 60 + +m[4]) / 30);
    for (let i = a; i < Math.min(b, 48); i++) slots[i] = 0;
  }
  if (!found && !/не передбачено|не заплановано/i.test(g[1])) throw new Error('Не вдалося розібрати чергу ' + GROUP);
  const um = text.match(/Оновлено\s+(\d{1,2}\s+[а-яіїє]+\s+о\s+\d{2}:\d{2})/i);
  return { source: 'kolybude.com (резервне, дані ДТЕК)', updated: um ? um[1] : null, days: { [date]: { date, slots, confirmed: found > 0 } } };
}

async function fromKolyFetch() {
  const r = await fetch(KOLY, { headers: UA });
  if (!r.ok) throw new Error('kolybude.com відповів HTTP ' + r.status);
  return fromKolybude(await r.text());
}

export default async function handler(req, res) {
  const q = req.query || {};
  const errors = [];
  let out = null;
  const order = q.src === 'kolybude' ? [fromKolyFetch] : [fromYasno, fromKolyFetch];
  for (const fn of order) {
    try { out = await fn(); break; } catch (e) { errors.push(String(e.message || e)); }
  }
  if (!out) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: errors.join(' | ') });
  }
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
  res.status(200).json({ ok: true, group: GROUP, fetchedAt: Date.now(), fallbackErrors: errors, ...out });
}
