// Автоматичне визначення черги за адресою (вулиця + номер будинку) через відкритий API YASNO:
//   regions → streets?query= → houses?query= → group  →  {group, subgroup}  →  «група.підгрупа» (напр. 8.1)
// Той самий ланцюжок використовує офіційний сайт YASNO. Кожен запит має свій таймаут, помилки не валять відповідь:
// якщо щось не так, повертаємо зрозуміле «чому» (unsupported / street / house / unavailable), а застосунок
// переходить на запасний шлях (підбір за годинами відключень + посилання на сайт оператора).
// Покриття: лише там, де YASNO має адресний довідник (Київ, Дніпро й ДнЕМ). Інші області: unsupported + офіційне посилання.
const BASE = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/addresses/v2';
const UA = { 'user-agent': 'TrebaSvitlo/2.9 (+mailto:ssssssifo@gmail.com)', accept: 'application/json', 'accept-language': 'uk' };

// Відомі пари (regionId, dsoId). Решту додаємо динамічно зі списку регіонів YASNO, тож нові оператори підхоплюються самі.
//   Київ: 25 / 902 (ДТЕК Київські електромережі). Дніпропетровщина: 3 / 301 (ДТЕК Дніпровські електромережі, ті самі, що в графіку).
const KNOWN = {
  ky: [{ region: 25, dso: 902, ours: true }],
  kr: [{ region: 3, dso: 301, ours: true }],
  dp: [{ region: 3, dso: 301, ours: true }],
  kz: [{ region: 3, dso: 301, ours: true }],
  dn: [{ region: 3, dso: 301, ours: true }]
};
// Ключові слова назви регіону в довіднику YASNO (для динамічного пошуку інших dso)
const REGION_WORDS = {
  ky: ['київ', 'kyiv', 'kiev'], kr: ['дніпро', 'dnipro', 'дніпропетров'], dp: ['дніпро', 'dnipro', 'дніпропетров'], kz: ['дніпро', 'dnipro', 'дніпропетров'], dn: ['дніпро', 'dnipro', 'дніпропетров'],
  od: ['одес', 'odes']
};
export const AUTO_CITIES = [...new Set([...Object.keys(KNOWN), ...Object.keys(REGION_WORDS)])];
// Хто визначає чергу за адресою на офіційному сайті (для зон, де автопідбір недоступний)
export const OFFICIAL = {
  kr: 'https://www.dtek-dnem.com.ua/ua/shutdowns', dp: 'https://www.dtek-dnem.com.ua/ua/shutdowns', kz: 'https://www.dtek-dnem.com.ua/ua/shutdowns', dn: 'https://www.dtek-dnem.com.ua/ua/shutdowns',
  ky: 'https://www.dtek-kem.com.ua/ua/shutdowns', kv: 'https://www.dtek-krem.com.ua/ua/shutdowns', od: 'https://www.dtek-oem.com.ua/ua/shutdowns',
  lv: 'https://poweron.loe.lviv.ua/', pl: 'https://www.poe.pl.ua/', kh: 'https://www.oblenergo.kharkov.ua/', zp: 'https://www.zoe.com.ua/', ck: 'https://www.ck.energy/',
  cn: 'https://www.oblenergo.cn.ua/', zt: 'https://www.ztoe.com.ua/', rv: 'https://www.roe.vsei.ua/', tp: 'https://www.toe.com.ua/', km: 'https://hoe.com.ua/', fr: 'https://oe.if.ua/uk', zk: 'https://zakarpattya.energy/'
};

async function getJson(path, params) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(6000) });
  if (r.status === 404) { const e = new Error('not found'); e.status = 404; throw e; }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

// ---------- нормалізація ----------
const TYPES = /^(вулиця|вул|улица|ул|проспект|просп|пр-т|пр-кт|пр|провулок|пров|пер|переулок|площа|пл|площадь|бульвар|бул|б-р|шосе|шоссе|набережна|наб|проїзд|проезд|узвіз|спуск|мікрорайон|микрорайон|мкр|тупик|алея|майдан|в’їзд|селище|смт|село|с|м|місто)\.?$/iu;
const strip = (s) => String(s || '').toLowerCase().replace(/[’ʼ'`"«»]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const LOOK = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', i: 'і' };
const coreOf = (s) => strip(s).replace(/[.,]/g, ' ').split(' ').filter((w) => w && !TYPES.test(w)).join(' ');
const houseKey = (h) => strip(h).replace(/\s+/g, '').replace(/[a-z]/g, (c) => LOOK[c] || c).replace(/\\/g, '/');
const RU2UA = { металургов: 'металургів', героев: 'героїв', мира: 'миру', победы: 'перемоги', свободы: 'свободи', независимости: 'незалежності', космонавтов: 'космонавтів', центральная: 'центральна', соборная: 'соборна' };
function ukWord(w) {
  if (RU2UA[w]) return RU2UA[w];
  return w.replace(/ы/g, 'и').replace(/э/g, 'е').replace(/ъ/g, '').replace(/ская$/, 'ська').replace(/цкая$/, 'цька').replace(/ая$/, 'а').replace(/ов$/, 'ів');
}
export const ukCore = (s) => coreOf(s).split(' ').map(ukWord).join(' ');

// «проспект Металургів, 9», «просп. Металургов 9а», «вул. Соборна д. 5/2» → { street, house }
export function splitAddress(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/(?<![\p{L}\d])(?:дом|буд|будинок|д)\.?\s*(?=\d)/giu, '');
  const m = t.match(/^(.*\p{L}.*?)[\s,]+(\d{1,4}\s?[\p{L}]?(?:\s?[\/\\-]\s?\d{1,3}\s?[\p{L}]?)?)\s*$/u);
  if (!m) return { street: t.replace(/[,\s]+$/, ''), house: '' };
  return { street: m[1].replace(/[,\s]+$/, ''), house: m[2].replace(/\s+/g, '') };
}

// ---------- довідник регіонів YASNO ----------
let regionsCache = null;
async function regions() {
  if (regionsCache && Date.now() - regionsCache.t < 6 * 3600e3) return regionsCache.v;
  const j = await getJson('/regions');
  const list = Array.isArray(j) ? j : (j && (j.regions || j.data)) || [];
  const v = list.map((r) => ({
    id: r.id ?? r.regionId, name: String(r.value || r.name || r.title || ''),
    dsos: (r.dsos || r.services || r.providers || []).map((d) => ({ id: d.id ?? d.dsoId, name: String(d.name || d.value || d.title || '') }))
  })).filter((r) => r.id != null);
  regionsCache = { t: Date.now(), v };
  return v;
}
async function candidates(city) {
  const out = (KNOWN[city] || []).map((c) => ({ ...c }));
  const words = REGION_WORDS[city];
  if (!words) return out;
  try {
    for (const r of await regions()) {
      if (!words.some((w) => strip(r.name).includes(w))) continue;
      for (const d of r.dsos) if (d.id != null && !out.some((c) => c.region === r.id && c.dso === d.id)) out.push({ region: r.id, dso: d.id, dsoName: d.name, ours: false });
    }
  } catch (e) { /* довідник недоступний: працюємо з відомими парами */ }
  return out;
}

// ---------- пошук вулиці / будинку ----------
const idOf = (x) => x && (x.id ?? x.streetId ?? x.houseId);
const valOf = (x) => String((x && (x.value ?? x.name ?? x.title ?? x.label)) || '');
const listOf = (j) => (Array.isArray(j) ? j : (j && (j.items || j.data || j.results)) || []);

function rank(items, wanted) {
  const w = [strip(wanted), strip(ukCore(wanted))].filter(Boolean).map((x) => coreOf(x) || x);
  return items.map((s) => {
    const c = coreOf(valOf(s));
    let sc = 0;
    for (const x of w) { if (c === x) sc = Math.max(sc, 3); else if (c.startsWith(x + ' ') || c.startsWith(x)) sc = Math.max(sc, 2); else if (c.includes(x)) sc = Math.max(sc, 1); }
    return { s, sc };
  }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
}

async function streetsFor(c, street) {
  const q = coreOf(street) || street;
  const qs = [...new Set([q, ukCore(street)].filter((x) => x && x.length >= 2))];
  let items = [];
  const res = await Promise.allSettled(qs.map((x) => getJson('/streets', { regionId: c.region, dsoId: c.dso, query: x })));
  if (res.every((r) => r.status === 'rejected' && r.reason && r.reason.status !== 404)) throw res[0].reason;
  for (const r of res) if (r.status === 'fulfilled') items = items.concat(listOf(r.value));
  const seen = new Set();
  items = items.filter((s) => { const k = idOf(s); if (k == null || seen.has(k)) return false; seen.add(k); return true; });
  return rank(items, street);
}

async function groupOf(c, streetId, houseId) {
  const j = await getJson('/group', { regionId: c.region, dsoId: c.dso, streetId, houseId });
  const g = j && (j.group ?? j.groupId ?? (j.data && j.data.group));
  const sg = j && (j.subgroup ?? j.subGroup ?? (j.data && j.data.subgroup));
  if (g == null || sg == null) throw new Error('bad group');
  return Number(g) + '.' + Number(sg);
}

// Головна функція: повертає { ok, group, ... } або { ok:false, reason, ... }
export async function resolveQueue(city, rawStreet, rawHouse) {
  const hasAuto = AUTO_CITIES.includes(city);
  const official = OFFICIAL[city] || null;
  if (!hasAuto) return { ok: false, reason: 'unsupported', official };
  let { street, house } = rawHouse ? { street: rawStreet, house: rawHouse } : splitAddress(rawStreet);
  street = String(street || '').trim(); house = String(house || '').trim();
  if (strip(street).length < 3) return { ok: false, reason: 'street', official };
  if (!house) return { ok: false, reason: 'nohouse', official };
  const cands = await candidates(city);
  if (!cands.length) return { ok: false, reason: 'unsupported', official };

  let network = 0, streetFound = false;
  const found = [], nearHouses = [];
  await Promise.all(cands.map(async (c) => {
    try {
      const streets = (await streetsFor(c, street)).slice(0, 4);
      if (streets.length) streetFound = true;
      for (const { s } of streets) {
        let hs;
        try { hs = listOf(await getJson('/houses', { regionId: c.region, dsoId: c.dso, streetId: idOf(s), query: house.replace(/[\p{L}].*$/u, '') || house })); }
        catch (e) { if (e.status === 404) continue; throw e; }
        const hk = houseKey(house);
        const exact = hs.find((h) => houseKey(valOf(h)) === hk);
        hs.slice(0, 8).forEach((h) => nearHouses.push(valOf(h)));
        if (!exact) continue;
        try {
          const g = await groupOf(c, idOf(s), idOf(exact));
          found.push({ group: g, street: valOf(s), house: valOf(exact), region: c.region, dso: c.dso, dsoName: c.dsoName || null, ours: !!c.ours });
        } catch (e) { if (e.status !== 404) throw e; }
      }
    } catch (e) { network++; }
  }));

  if (found.length) {
    // найкращий збіг: «наш» оператор (той, чий графік показуємо) першим
    found.sort((a, b) => (b.ours - a.ours));
    const groups = [...new Set(found.map((f) => f.group))];
    const best = found[0];
    return {
      ok: true, group: best.group, street: best.street, house: best.house, dso: best.dso, region: best.region, dsoName: best.dsoName,
      otherOperator: !best.ours,
      // той самий будинок у кількох записах з різними чергами: покажемо вибір
      alternatives: groups.length > 1 ? found.map((f) => ({ group: f.group, street: f.street, dso: f.dso, dsoName: f.dsoName, ours: f.ours })) : undefined,
      official
    };
  }
  if (network === cands.length) return { ok: false, reason: 'unavailable', official };
  if (!streetFound) return { ok: false, reason: 'street', official };
  return { ok: false, reason: 'house', houses: [...new Set(nearHouses)].slice(0, 8), official };
}

// Діагностика: /api/address?probe=yasno&city=kr  — що реально віддає YASNO (щоб швидко перевірити схему після змін)
export async function probeYasno(city) {
  const out = { city, candidates: await candidates(city) };
  try { out.regions = (await regions()).slice(0, 30); } catch (e) { out.regionsError = String(e && e.message || e); }
  const c = out.candidates[0];
  if (c) {
    try { const s = listOf(await getJson('/streets', { regionId: c.region, dsoId: c.dso, query: 'Соборн' })); out.streetsSample = s.slice(0, 5); const id = idOf(s[0]); if (id != null) { const h = listOf(await getJson('/houses', { regionId: c.region, dsoId: c.dso, streetId: id, query: '1' })); out.housesSample = h.slice(0, 5); if (h[0]) out.groupSample = await getJson('/group', { regionId: c.region, dsoId: c.dso, streetId: id, houseId: idOf(h[0]) }); } }
    catch (e) { out.sampleError = String(e && e.message || e); }
  }
  return out;
}
