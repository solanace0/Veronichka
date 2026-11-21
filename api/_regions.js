// Реєстр регіонів: код «зони» → оператор і джерела графіків.
// Графік визначає оператор, а не місто: у межах однієї зони черга 2.2 однакова.
//  mirror — файли дзеркала Baskerville42/outage-data-ua (копія сайту ДТЕК), перший робочий береться;
//  flags  — файли з прапорцями екстрених відключень;
//  yasno  — чи є YASNO-канал (лише ДТЕК Дніпровські електромережі, перевірений регіон 3 / ДСО 301);
//  koly   — чи є сторінка kolybude.com (лише Кривий Ріг);
//  oblast — для міст Дніпровщини, окремих від трьох основних: прапорці районів не розбираємо по назві міста.
// Для зон без джерела (mirror: null) графік не вигадуємо: API відповідає «скоро».
export const MIRROR_BASE = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
const DNIPRO = ['dnipro.json', 'dnipro-oblast.json'];
export const AREAS = {
  kr: { name: 'Кривий Ріг', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true, koly: true },
  dp: { name: 'Дніпро', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true },
  kz: { name: 'Кам’янське', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true },
  dn: { name: 'Дніпропетровська область', operator: 'ДТЕК Дніпровські електромережі', mirror: DNIPRO, flags: ['dnipro-oblast.json', 'dnipro.json'], yasno: true, oblast: true },
  ky: { name: 'Київ', operator: 'ДТЕК Київські електромережі', mirror: ['kyiv.json'], flags: ['kyiv.json'] },
  kv: { name: 'Київська область', operator: 'ДТЕК Київські регіональні електромережі', mirror: ['kyiv-region.json'], flags: ['kyiv-region.json'] },
  od: { name: 'Одеса та Одеська область', operator: 'ДТЕК Одеські електромережі', mirror: ['odesa.json'], flags: ['odesa.json'] },
  lv: { name: 'Львів та Львівська область', operator: 'Львівобленерго', mirror: null, flags: [] }
};
export const AREA_CODES = Object.keys(AREAS);
export const AREAS_WITH_DATA = AREA_CODES.filter((c) => AREAS[c].mirror);
export const ALL_FLAG_FILES = [...new Set(AREA_CODES.flatMap((c) => AREAS[c].flags))];
