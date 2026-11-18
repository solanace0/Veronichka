// Підказки адрес (вулиця + номер будинку) для Кривого Рогу, Дніпра та Кам’янського.
// Джерело: OpenStreetMap через Photon (комфортний для автодоповнення), запасний варіант — Nominatim.
// Сервер приймає ввід українською і російською: нормалізує «проспект/просп./пр-т», «улица/ул.» тощо,
// додає український варіант назви (металургов → металургів) і шукає лише в межах вибраного міста.
// Якщо номер будинку введено, а його немає в OSM, вулиця все одно підтверджується, і номер додається до підказки.
const UA_HDR = { 'user-agent': 'TrebaSvitlo/2.4 (+mailto:ssssssifo@gmail.com)', 'accept-language': 'uk' };
const CITY = {
  kr: { name: 'Кривий Ріг', bbox: [33.18, 47.80, 33.65, 48.04], alias: ['кривийріг', 'кривойрог'] },
  dp: { name: 'Дніпро', bbox: [34.70, 48.32, 35.25, 48.60], alias: ['дніпро', 'днепр'] },
  kz: { name: 'Кам’янське', bbox: [34.45, 48.42, 34.80, 48.60], alias: ['камянське', 'каменское', 'дніпродзержинськ'] }
};
const L = '\\p{L}\\d';

// ---------- нормалізація ----------
const FULL = {
  проспект: 'проспект', улица: 'вулиця', вулиця: 'вулиця', переулок: 'провулок', провулок: 'провулок', площадь: 'площа', площа: 'площа',
  бульвар: 'бульвар', шоссе: 'шосе', шосе: 'шосе', набережная: 'набережна', набережна: 'набережна', проезд: 'проїзд', проїзд: 'проїзд',
  микрорайон: 'мікрорайон', мікрорайон: 'мікрорайон', спуск: 'узвіз', узвіз: 'узвіз', тупик: 'тупик'
};
const ABBR = { просп: 'проспект', пр: 'проспект', 'пр-т': 'проспект', 'пр-кт': 'проспект', ул: 'вулиця', вул: 'вулиця', пер: 'провулок', пров: 'провулок', пл: 'площа', бул: 'бульвар', 'б-р': 'бульвар', наб: 'набережна', мкр: 'мікрорайон', мкрн: 'мікрорайон' };
const RU2UA = { мира: 'миру', победы: 'перемоги', свободы: 'свободи', независимости: 'незалежності', героев: 'героїв', соборная: 'соборна', центральная: 'центральна', космонавтов: 'космонавтів' };

export function normalize(raw) {
  let t = String(raw || '').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(new RegExp(`(?<![${L}])(?:дом|буд|будинок|д)\\.?\\s*(?=\\d)`, 'giu'), '');
  t = t.replace(new RegExp(`(?<![${L}-])(${Object.keys(FULL).join('|')})(?![${L}])`, 'giu'), (m) => FULL[m.toLowerCase()]);
  t = t.replace(new RegExp(`(?<![${L}-])(${Object.keys(ABBR).join('|')})(?:\\.(?=\\s|$)|(?=\\s+\\S))`, 'giu'), (m) => ABBR[m.toLowerCase().replace(/\.$/, '')] || m);
  return t.replace(/\s+/g, ' ').trim();
}

// український варіант назви (спрощено: літери та типові закінчення)
export function ukVariant(t) {
  return t.split(' ').map((w) => {
    let x = w.toLowerCase();
    if (RU2UA[x]) return RU2UA[x];
    if (/^\d/.test(x)) return w;
    x = x.replace(/лл/g, 'л').replace(/ы/g, 'и').replace(/э/g, 'е').replace(/ё/g, 'о').replace(/ъ/g, '')
      .replace(/ская$/, 'ська').replace(/цкая$/, 'цька').replace(/ая$/, 'а').replace(/ов$/, 'ів');
    return x;
  }).join(' ');
}

// відокремлюємо номер будинку: «проспект металургів 12», «вул. Соборна, 10а», «Соборна д. 5/2»
export function parseQuery(raw) {
  const t = normalize(raw);
  if (!/\p{L}/u.test(t)) return null;
  const m = t.match(/^(.*\p{L}.*?)\s+(\d{1,4}(?:\s?\p{L})?(?:\s?\/\s?\d{1,3})?)$/u);
  if (m && m[1].replace(/[^\p{L}]/gu, '').length >= 3) return { street: m[1], number: m[2].replace(/\s/g, '').toUpperCase(), text: t };
  return { street: t, number: null, text: t };
}

// ---------- провайдери ----------
async function getJson(url) {
  const r = await fetch(url, { headers: UA_HDR, signal: AbortSignal.timeout(4500) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function photon(q, c) {
  const b = CITY[c].bbox.join(',');
  const base = 'https://photon.komoot.io/api/?limit=8&bbox=' + b + '&q=' + encodeURIComponent(q);
  try { return (await getJson(base + '&layer=street&layer=house')).features || []; }
  catch (e) { return (await getJson(base)).features || []; }
}
async function nominatim(q, c) {
  const [x1, y1, x2, y2] = CITY[c].bbox;
  const j = await getJson('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=uk&countrycodes=ua&bounded=1&viewbox=' + [x1, y2, x2, y1].join(',') + '&q=' + encodeURIComponent(q));
  return j.map((o) => ({ properties: {
    street: o.address && o.address.road, housenumber: o.address && o.address.house_number, type: o.address && o.address.house_number ? 'house' : (o.category === 'highway' ? 'street' : 'other'),
    name: o.name, city: o.address && (o.address.city || o.address.town || o.address.village), district: o.address && (o.address.city_district || o.address.suburb)
  } }));
}

// ---------- перетворення в підказки ----------
const strip = (s) => String(s || '').toLowerCase().replace(/[^\p{L}]/gu, '');
const sameCity = (pc, c) => !pc || CITY[c].alias.some((a) => strip(pc).includes(a) || a.includes(strip(pc)));
export function toItem(f, c) {
  const p = (f && f.properties) || {};
  if (!sameCity(p.city, c)) return null;
  const isStreet = p.type === 'street' || p.osm_key === 'highway';
  const street = p.street || (isStreet ? p.name : null);
  if (!street) return null;
  const district = p.district || p.suburb || p.locality;
  const sub = CITY[c].name + (district && strip(district) !== strip(CITY[c].name) ? ', ' + district : '');
  if (p.housenumber) return { label: street + ', ' + p.housenumber, sub, kind: 'house', street, house: String(p.housenumber) };
  if (isStreet) return { label: street, sub, kind: 'street', street };
  return null;
}
const hn = (h) => String(h || '').toLowerCase().replace(/\s+/g, '');

export function buildItems(features, pq, c) {
  const all = features.map((f) => toItem(f, c)).filter(Boolean);
  const seen = new Set();
  const uniq = all.filter((i) => { const k = i.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const streets = [];
  const sk = new Set();
  uniq.forEach((i) => { const k = i.street.toLowerCase(); if (!sk.has(k)) { sk.add(k); streets.push({ label: i.street, sub: i.sub, kind: 'street', street: i.street }); } });
  if (!pq.number) return streets.slice(0, 6);
  const n = hn(pq.number);
  const houses = uniq.filter((i) => i.kind === 'house');
  const exact = houses.filter((i) => hn(i.house) === n);
  const pref = houses.filter((i) => hn(i.house) !== n && hn(i.house).startsWith(n)).slice(0, 3);
  const have = new Set(exact.map((i) => i.street.toLowerCase()));
  // вулиця є, а такого номера в OSM немає — все одно пропонуємо «вулиця, номер»
  const synth = streets.filter((s) => !have.has(s.street.toLowerCase())).slice(0, 3)
    .map((s) => ({ label: s.street + ', ' + pq.number, sub: s.sub, kind: 'house', street: s.street, house: pq.number }));
  return [...exact, ...synth, ...pref].slice(0, 6);
}

const memo = new Map();
export async function suggest(raw, c) {
  const pq = parseQuery(raw);
  if (!pq) return [];
  const key = c + '|' + pq.text.toLowerCase();
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < 6 * 3600e3) return hit.v;
  const vars = [pq.street];
  const uk = ukVariant(pq.street);
  if (uk !== pq.street.toLowerCase()) vars.push(uk);
  const qs = [];
  vars.forEach((v) => { if (pq.number) qs.push(v + ' ' + pq.number); qs.push(v); });
  let feats = [], okAny = false;
  const res = await Promise.allSettled(qs.map((q) => photon(q, c)));
  res.forEach((r) => { if (r.status === 'fulfilled') { okAny = true; feats = feats.concat(r.value); } });
  let items = buildItems(feats, pq, c);
  if (!items.length) {
    try { feats = await nominatim(pq.number ? pq.street + ' ' + pq.number : pq.street, c); okAny = true; items = buildItems(feats, pq, c); } catch (e) { /* запасний провайдер недоступний */ }
  }
  if (!okAny) throw new Error('geocoder unavailable');
  memo.set(key, { t: Date.now(), v: items });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  const city = CITY[String(q.city)] ? String(q.city) : 'kr';
  const text = String(q.q || '').slice(0, 80);
  if (text.trim().length < 3) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: true, items: [] }); }
  try {
    const items = await suggest(text, city);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: 'Сервіс адрес тимчасово недоступний' });
  }
}
