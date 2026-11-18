// Структурований статус екстрених відключень із дзеркала сайту ДТЕК (Baskerville42/outage-data-ua).
// Дзеркало копіює з сайту ДТЕК не лише графіки, а й прапорці:
//   emergency.enabled           — на сайті ДТЕК оголошено екстрені (аварійні) відключення;
//   emergency.enabled_districts — перелік районів, де вони введені (або null, якщо не вказано);
//   stabilizing.enabled         — діють стабілізаційні (погодинні) відключення.
// Це дані самого оператора, а не здогад за текстом новин, тому вони головне джерело статусу.
// Сайт ДТЕК закритий захистом, його напряму не обходимо — лише відкрите дзеркало.
const BASE = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
export const FILES = ['dnipro-oblast.json', 'dnipro.json'];
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' };
const STALE_MS = 3 * 36e5; // дзеркало оновлюється кожні ~5 хв; старше 3 год — вважаємо застарілим

// Назви міст/районів у переліку районів ДТЕК
export const CITY_RE = {
  kr: /Крив(?:ий|ого|ому)\s*Р(?:іг|огу|озі)|Криворіз|Криворіж/i,
  dp: /Дніпр(?:о|і|а|у|ом|ові)(?![а-яіїєґ])|Дніпровськ/i,
  kz: /Кам[’'ʼ`]?янськ/i
};

function toText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(', ');
  if (typeof v === 'object') return Object.values(v).map(toText).filter(Boolean).join(', ');
  return String(v).trim();
}

const parseUpdated = (j) => {
  const t = Date.parse(j && j.lastUpdated);
  return isNaN(t) ? null : t;
};

// Розбір одного JSON дзеркала → нормалізований опис
export function parseFlags(j, file = '') {
  if (!j || typeof j !== 'object') return null;
  const root = j.data && typeof j.data === 'object' && (j.data.emergency || j.data.stabilizing || j.data.fact) ? j.data : j;
  const em = root.emergency;
  if (em === undefined && root.stabilizing === undefined) return null; // у файлі немає прапорців
  const districtsRaw = em && typeof em === 'object' ? em.enabled_districts : null;
  const districts = toText(districtsRaw);
  const aff = String(root.regionAffiliation || j.regionAffiliation || '');
  const oblast = /област/i.test(aff) || /oblast/i.test(file) || (!/(^|\s)м\.\s/i.test(aff));
  const ls = root.lastUpdateStatus || {};
  const updatedTs = parseUpdated(root) || parseUpdated(j);
  return {
    file,
    region: aff || null,
    scope: oblast ? 'oblast' : 'city',
    enabled: !!(em && typeof em === 'object' ? em.enabled : em === true),
    districts: districts || null,
    stabilizing: !!(root.stabilizing && root.stabilizing.enabled),
    updatedTs,
    parseOk: ls.ok !== false && ls.status !== 'error',
    parseMsg: ls.message || null
  };
}

// Чи стосується прапорець міста
export function flagForCity(f, city) {
  if (!f) return null;
  const now = Date.now();
  const stale = !f.updatedTs || now - f.updatedTs > STALE_MS || !f.parseOk;
  let emergency = false, why = null;
  if (f.scope === 'city' && city !== 'dp') {
    return { checked: false, stale, emergency: false, why: null, file: f.file };
  }
  if (f.districts) {
    // ДТЕК назвав райони/міста: стосується міста лише якщо воно там є
    if (CITY_RE[city].test(f.districts)) { emergency = true; why = 'districts'; }
    else if (f.enabled) { emergency = false; why = 'other-districts'; }
  } else if (f.enabled) { emergency = true; why = 'all'; }
  return { checked: true, stale, emergency, why, districts: f.districts, stabilizing: f.stabilizing, updatedTs: f.updatedTs, file: f.file };
}

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Тягнемо всі файли паралельно; повертаємо розібрані прапорці й помилки (для діагностики)
export async function fetchFlags() {
  const settled = await Promise.allSettled(FILES.map(async (f) => parseFlags(await getJson(BASE + f), f)));
  const flags = [], errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) flags.push(s.value);
    else errors.push(FILES[i] + ': ' + (s.status === 'rejected' ? String(s.reason && s.reason.message || s.reason) : 'немає полів emergency/stabilizing'));
  });
  return { flags, errors };
}

// Підсумок для міста: будь-який свіжий файл, що каже «екстрено», перемагає; «немає» — лише якщо є свіжий файл, який міста стосується
export function cityStatus(flags, city) {
  const per = flags.map((f) => flagForCity(f, city)).filter((x) => x && x.checked);
  if (!per.length) return { known: false, emergency: false, stale: true };
  const hit = per.find((x) => x.emergency && !x.stale) || per.find((x) => x.emergency);
  if (hit) return { known: true, emergency: true, stale: hit.stale, districts: hit.districts || null, why: hit.why, updatedTs: hit.updatedTs, file: hit.file };
  const fresh = per.filter((x) => !x.stale);
  const best = (fresh.length ? fresh : per).sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0))[0];
  return { known: true, emergency: false, stale: !fresh.length, stabilizing: per.some((x) => x.stabilizing), otherDistricts: best.why === 'other-districts' ? best.districts : null, updatedTs: best.updatedTs, file: best.file };
}
