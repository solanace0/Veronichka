// Реєстр регіонів: код «зони» → оператор і джерела графіків.
// Графік визначає оператор, а не місто: у межах однієї зони черга 2.2 однакова.
//  mirror — файли дзеркала Baskerville42/outage-data-ua (копія сайту ДТЕК), перший робочий береться;
//  flags  — файли з прапорцями екстрених відключень;
//  yasno  — чи є YASNO-канал (лише ДТЕК Дніпровські електромережі, перевірений регіон 3 / ДСО 301);
//  loe    — офіційний API Львівобленерго (api.loe.lviv.ua), текстовий графік по підчергах 1.1–6.2;
//  koly   — чи є сторінка kolybude.com (лише Кривий Ріг);
//  base/label — свій корінь дзеркала й підпис джерела (для обленерго: репозиторій yaroslav2901/OE_OUTAGE_DATA, копія сайтів обленерго у форматі ДТЕК, оновлюється кожні кілька хвилин);
//  alt — запасне дзеркало того самого оператора (береться свіжіше з двох);
//  oblast — для міст Дніпровщини, окремих від трьох основних: прапорці районів не розбираємо по назві міста.
// Для зон без джерела (mirror: null) графік не вигадуємо: API відповідає «скоро».
export const MIRROR_BASE = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
export const OE_BASE = 'https://raw.githubusercontent.com/yaroslav2901/OE_OUTAGE_DATA/main/data/';
const OE_LABEL = 'OE_OUTAGE_DATA (сайт обленерго)';
// Файли названі за транслітерацією компанії, написання в репозиторії не однакове (oblenergo / oblenerho), тому для частини областей є кілька кандидатів: береться перший робочий.
const oe = (name, operator, files, extra = {}) => ({ name, operator, mirror: files, base: OE_BASE, label: OE_LABEL, flags: [], ...extra });
const DNIPRO = ['dnipro.json', 'dnipro-oblast.json'];
export const AREAS = {
  kr: { name: 'Кривий Ріг', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true, koly: true },
  dp: { name: 'Дніпро', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true },
  kz: { name: 'Кам’янське', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true },
  dn: { name: 'Дніпропетровська область', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true, oblast: true },
  ky: { name: 'Київ', operator: 'ДТЕК Київські електромережі', mirror: ['kyiv.json'], flags: ['kyiv.json'] },
  kv: { name: 'Київська область', operator: 'ДТЕК Київські регіональні електромережі', mirror: ['kyiv-region.json'], flags: ['kyiv-region.json'] },
  od: { name: 'Одеса та Одеська область', operator: 'ДТЕК Одеські електромережі', mirror: ['odesa.json'], flags: ['odesa.json'] },
  lv: { name: 'Львів та Львівська область', operator: 'Львівобленерго', mirror: ['Lvivoblenerho.json', 'Lvivoblenergo.json'], base: OE_BASE, label: OE_LABEL, loe: true, flags: [] },
  // Інші області: відкриті дані самих обленерго (OE_OUTAGE_DATA), той самий формат, що й дзеркало ДТЕК
  pl: oe('Полтавська область', 'Полтаваобленерго', ['Poltavaoblenergo.json'], { alt: { base: 'https://raw.githubusercontent.com/findme88/poltava-outage-data/main/data/', files: ['Poltavaoblenergo.json'], label: 'poltava-outage-data (сайт Полтаваобленерго)' } }),
  kh: oe('Харківська область', 'Харківобленерго', ['Kharkivoblenerho.json', 'Kharkivoblenergo.json']),
  zp: oe('Запорізька область', 'Запоріжжяобленерго', ['Zaporizhzhiaoblenergo.json']),
  ck: oe('Черкаська область', 'Черкасиобленерго', ['Cherkasyoblenergo.json']),
  cn: oe('Чернігівська область', 'Чернігівобленерго', ['Chernihivoblenergo.json']),
  zt: oe('Житомирська область', 'Житомиробленерго', ['Zhytomyroblenergo.json']),
  rv: oe('Рівненська область', 'Рівнеобленерго', ['Rivneoblenergo.json']),
  tp: oe('Тернопільська область', 'Тернопільобленерго', ['Ternopiloblenerho.json', 'Ternopiloblenergo.json']),
  km: oe('Хмельницька область', 'Хмельницькобленерго', ['Khmelnytskoblenerho.json', 'Khmelnytskyioblenerho.json', 'Khmelnytskyioblenergo.json']),
  // Прикарпаттяобленерго: файл у OE_OUTAGE_DATA не оновлюється з 20.10.2026 (issue #7), тому область вимкнена, щоб не показувати застарілий графік
  fr: { name: 'Івано-Франківська область', operator: 'Прикарпаттяобленерго', mirror: null, flags: [] },
  zk: oe('Закарпатська область', 'Закарпаттяобленерго', ['Zakarpattiaoblenerho.json', 'Zakarpattiaoblenergo.json'])
};
export const AREA_CODES = Object.keys(AREAS);
export const AREAS_WITH_DATA = AREA_CODES.filter((c) => AREAS[c].mirror || AREAS[c].loe);
export const ALL_FLAG_FILES = [...new Set(AREA_CODES.flatMap((c) => AREAS[c].flags))];
