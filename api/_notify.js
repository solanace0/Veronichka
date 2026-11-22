// Логіка сповіщень: з графіка та стану підписки формує список повідомлень. Чиста функція, без мережі — легко тестувати.
const TZ = 'Europe/Kyiv';
const p2 = n => String(n).padStart(2, '0');
export const hm = m => `${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}`;
export const hmE = m => (m >= 1440 ? '24:00' : hm(m));
export const dh = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? (mm ? `${h} год ${mm} хв` : `${h} год`) : `${mm} хв`; };

export function kyivNow(ts = Date.now()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).forEach(x => (p[x.type] = x.value));
  const h = +p.hour % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + +p.minute, sec: h * 3600 + +p.minute * 60 + +p.second };
}
export const addDay = (date, n) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// День вважаємо відомим лише з 48 слотів; «усе світло» без підтвердження — це відсутність даних (як у застосунку).
export function dayOf(J, date) {
  const x = J && J.days && J.days[date];
  if (!x || !Array.isArray(x.slots) || x.slots.length !== 48 || x.slots.some(v => v === null || v === undefined)) return null;
  if (x.slots.every(v => v === 1) && !x.confirmed) return null;
  return x.slots.map(v => (v ? 1 : 0));
}
export const periods = (slots, base = 0) => {
  const o = [];
  slots.forEach((v, i) => { const on = !!v, a = base + i * 30; if (o.length && o[o.length - 1].on === on) o[o.length - 1].to = a + 30; else o.push({ from: a, to: a + 30, on }); });
  return o;
};
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

const CITY = { kr: 'Кривий Ріг', dp: 'Дніпро', kz: 'Кам’янське', dn: 'Дніпровщина', ky: 'Київ', kv: 'Київщина', od: 'Одеса', lv: 'Львів' };
const who = (sub) => `Черга ${sub.group}${CITY[sub.city] ? ' · ' + CITY[sub.city] : ''}`;

// Короткий опис дня: перші три відключення + загальний час.
function summary(slots) {
  const off = periods(slots).filter(p => !p.on);
  if (!off.length) return { head: 'Відключень не заплановано 🎉', total: 0 };
  const total = off.reduce((a, p) => a + (p.to - p.from), 0);
  const list = off.slice(0, 3).map(p => `${hm(p.from)}–${hmE(p.to)}`).join(', ') + (off.length > 3 ? ` і ще ${off.length - 3}` : '');
  return { head: `Без світла: ${list}`, total };
}
const dayBody = (slots, sub) => { const s = summary(slots); return `${s.head}\n${s.total ? `Разом ${dh(s.total)} · ` : ''}${who(sub)}`; };

// sub: { city, group, lead, ev:{pre,chg,nw,emg}, st }, J: відповідь /api/schedule, now: мс
// Повертає { msgs:[{title,body,tag,kind,renotify,ttl}], st } — нова версія стану підписки.
export function plan(sub, J, now = Date.now()) {
  const k = kyivNow(now), tdate = k.date, mdate = addDay(tdate, 1);
  const today = dayOf(J, tdate), tom = dayOf(J, mdate);
  const old = sub.st || null;
  const st = { d: { ...(old && old.d || {}) }, p: { ...(old && old.p || {}) }, sent: [...(old && old.sent || [])], em: old ? !!old.em : !!(J && J.emergency) };
  const msgs = [];
  const ev = sub.ev || {};
  const first = !old; // перший запуск: лише запам’ятовуємо стан, без повідомлень

  // 1) графік з’явився / змінився. Зміну підтверджуємо двома запусками поспіль:
  //    якщо джерела даних на мить «моргнули», зайвого повідомлення не буде.
  for (const [date, slots, label] of [[tdate, today, 'сьогодні'], [mdate, tom, 'завтра']]) {
    if (!slots) continue;
    const h = hash(slots.join('')), prev = st.d[date];
    if (prev === undefined) {
      if (!first && date === mdate && ev.nw) msgs.push({ kind: 'nw', tag: 'new-' + date, title: '📅 Вже є графік на завтра', body: dayBody(slots, sub), renotify: true });
      st.d[date] = h; delete st.p[date];
    } else if (prev === h) {
      delete st.p[date];
    } else if (st.p[date] === h) {
      if (ev.chg) msgs.push({ kind: 'chg', tag: 'chg-' + date, title: `🔄 Графік на ${label} змінився`, body: dayBody(slots, sub), renotify: true });
      st.d[date] = h; delete st.p[date];
    } else {
      st.p[date] = h; // перша поява нової версії: чекаємо підтвердження
    }
  }
  for (const d of Object.keys(st.d)) if (d < addDay(tdate, -2)) delete st.d[d];
  for (const d of Object.keys(st.p)) if (d < addDay(tdate, -2)) delete st.p[d];

  // 2) екстрені відключення: початок і кінець
  const em = !!(J && J.emergency);
  if (!first && ev.emg && em && !st.em) msgs.push({ kind: 'emg', tag: 'emg', title: '🚨 Екстрені відключення', body: `Планові графіки зараз не діють, світло може зникнути будь-якої миті.\n${who(sub)}`, renotify: true });
  if (!first && ev.emg && !em && st.em) msgs.push({ kind: 'emgEnd', tag: 'emg', title: '✅ Екстрені відключення скасовано', body: `Знову діє звичайний графік.\n${who(sub)}`, renotify: true });
  st.em = em;

  // 3) скоро зміна світла
  if (today && ev.pre && !em) { // під час екстрених відключень графік не діє — не обіцяємо час
    let tl = periods(today);
    if (tom) { const t2 = periods(tom, 1440); if (tl[tl.length - 1].on === t2[0].on) { tl[tl.length - 1].to = t2[0].to; t2.shift(); } tl = tl.concat(t2); }
    const nm = k.sec / 60, cur = tl.find(p => nm >= p.from && nm < p.to);
    if (cur) {
      const end = cur.to, known = end < 1440 || (tom && end < 2880);
      const left = (end * 60 - k.sec) / 60, lead = +sub.lead || 15;
      const win = left > 0 && left <= lead + 2; // запас +2 хв: таймер GitHub буває нерегулярним
      const key = `pre|${tdate}|${end}|${cur.on ? 'off' : 'on'}`;
      if (!first && known && win && !st.sent.includes(key)) {
        const n = Math.max(1, Math.round(left)), nx = tl.find(p => p.from === end);
        const nxEnd = nx ? hmE(nx.to % 1440 === 0 ? 1440 : nx.to % 1440) : '';
        const span = nx && nx.to < 2880 ? ` (${dh(nx.to - nx.from)})` : '';
        const l2 = who(sub), ttl = Math.max(60, Math.floor(left * 60));
        if (cur.on) msgs.push({ kind: 'pre', tag: 'pre', ttl, renotify: true, title: `🔌 Світло вимкнеться о ${hm(end)}`, body: `Через ${n} хв${nx ? ` · без світла до ${nxEnd}${span}` : ''}\n${l2}` });
        else msgs.push({ kind: 'pre', tag: 'pre', ttl, renotify: true, title: `💡 Світло з’явиться о ${hm(end)}`, body: `Через ${n} хв${nx ? ` · світло буде до ${nxEnd}${span}` : ''}\n${l2}` });
        st.sent.push(key);
      }
      // при першому запуску лише ставимо ключ, щоб не слати пізнє «через N хв» одразу після підписки
      if (first && known && win) st.sent.push(key);
    }
  }
  st.sent = st.sent.slice(-24);
  return { msgs, st };
}
