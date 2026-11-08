// Адаптер: kolybude.com (неофіційний агрегатор, який бере дані з сайту ДТЕК; сам сайт ДТЕК блокує сервери захистом Incapsula)
const SRC = 'https://kolybude.com/dnipro/kryvyi-rih';
const GROUP = '4.2';
const MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const kyiv = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());

function parse(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const dm = text.match(/на сьогодні,?\s*(\d{1,2})\s+([а-яіїєʼ']+)/i);
  if (!dm) throw new Error('Не знайдено дату графіка на сторінці-джерелі');
  const mo = MONTHS.indexOf(dm[2].toLowerCase());
  if (mo < 0) throw new Error('Невідомий місяць: ' + dm[2]);
  let year = +kyiv().slice(0, 4);
  const date = `${year}-${String(mo + 1).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  const start = text.indexOf('ДТЕК');
  const cek = text.indexOf('ЦЕК', start + 4);
  const dtekPart = text.slice(start < 0 ? 0 : start, cek < 0 ? undefined : cek);
  const g = dtekPart.match(new RegExp('Черга\\s*' + GROUP.replace('.', '\\.') + '([\\s\\S]*?)(?=Черга\\s*\\d|$)'));
  if (!g) throw new Error('Не знайдено чергу ' + GROUP + ' у ДТЕК');
  const slots = Array(48).fill(1);
  const re = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/g;
  let m, found = 0;
  while ((m = re.exec(g[1]))) {
    found++;
    const a = Math.round((+m[1] * 60 + +m[2]) / 30), b = Math.round((+m[3] * 60 + +m[4]) / 30);
    for (let i = a; i < Math.min(b, 48); i++) slots[i] = 0;
  }
  if (!found && !/не передбачено|не заплановано/i.test(g[1])) throw new Error('Не вдалося розібрати графік черги ' + GROUP);
  const um = text.match(/Оновлено\s+(\d{1,2}\s+[а-яіїє]+\s+о\s+\d{2}:\d{2})/i);
  return { date, slots, updated: um ? um[1] : null, noOutages: !found };
}

export default async function handler(req, res) {
  try {
    const r = await fetch(SRC, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' } });
    const html = await r.text();
    if (req.query && req.query.debug) return res.status(200).json({ status: r.status, length: html.length, head: html.slice(0, 300) });
    if (!r.ok) throw new Error('Джерело відповіло HTTP ' + r.status);
    const p = parse(html);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    res.status(200).json({ ok: true, group: GROUP, source: 'kolybude.com (дані ДТЕК)', updated: p.updated, fetchedAt: Date.now(), days: { [p.date]: { date: p.date, slots: p.slots } } });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
