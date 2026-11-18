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

function summary(slots) {
  const off = periods(slots).filter(p => !p.on);
  if (!off.length) return 'Відключень не заплановано 🎉';
  const total = off.reduce((a, p) => a + (p.to - p.from), 0);
  const list = off.slice(0, 3).map(p => `${hm(p.from)}–${hmE(p.to)}`).join(', ') + (off.length > 3 ? ` +ще ${off.length - 3}` : '');
  return `Без світла: ${list} · разом ${dh(total)}`;
}

// sub: { city, group, lead, ev:{pre,chg,nw,emg}, st }, J: відповідь /api/schedule, now: мс
// Повертає { msgs:[{title,body,tag,kind}], st } — нова версія стану підписки.
export function plan(sub, J, now = Date.now()) {
  const k = kyivNow(now), tdate = k.date, mdate = addDay(tdate, 1);
  const today = dayOf(J, tdate), tom = dayOf(J, mdate);
  const old = sub.st || null;
  const st = { d: { ...(old && old.d || {}) }, sent: [...(old && old.sent || [])], em: old ? !!old.em : !!(J && J.emergency) };
  const msgs = [];
  const ev = sub.ev || {};
  const first = !old; // перший запуск: лише запам’ятовуємо стан, без повідомлень

  // 1) графік змінився / з’явився
  for (const [date, slots, label] of [[tdate, today, 'сьогодні'], [mdate, tom, 'завтра']]) {
    if (!slots) continue;
    const h = hash(slots.join('')), prev = st.d[date];
    if (!first && prev === undefined && date === mdate && ev.nw) {
      msgs.push({ kind: 'nw', tag: 'new-' + date, title: '📅 З’явився графік на завтра', body: summary(slots) });
    } else if (!first && prev !== undefined && prev !== h && ev.chg) {
      msgs.push({ kind: 'chg', tag: 'chg-' + date, title: `🔄 Графік на ${label} змінився`, body: summary(slots), renotify: true });
    }
    st.d[date] = h;
  }
  for (const d of Object.keys(st.d)) if (d < addDay(tdate, -2)) delete st.d[d];

  // 2) екстрені відключення
  const em = !!(J && J.emergency);
  if (!first && em && !st.em && ev.emg) msgs.push({ kind: 'emg', tag: 'emg', title: '🚨 Екстрені відключення', body: 'Планові графіки зараз не діють, світло може зникати без попередження.', renotify: true });
  st.em = em;

  // 3) скоро зміна світла
  if (today && ev.pre) {
    let tl = periods(today);
    if (tom) { const t2 = periods(tom, 1440); if (tl[tl.length - 1].on === t2[0].on) { tl[tl.length - 1].to = t2[0].to; t2.shift(); } tl = tl.concat(t2); }
    const nm = k.sec / 60, cur = tl.find(p => nm >= p.from && nm < p.to);
    if (cur) {
      const end = cur.to, known = end < 1440 || (tom && end < 2880);
      const left = (end * 60 - k.sec) / 60, lead = +sub.lead || 15;
      const key = `pre|${tdate}|${end}|${cur.on ? 'off' : 'on'}`;
      if (!first && known && left > 0 && left <= lead && !st.sent.includes(key)) {
        const n = Math.max(1, Math.ceil(left)), nx = tl.find(p => p.from === end);
        const span = nx ? (nx.to >= 2880 ? '' : ` (${dh(nx.to - nx.from)})`) : '';
        if (cur.on) msgs.push({ kind: 'pre', tag: 'pre', title: `🌙 Світло вимкнеться через ${n} хв`, body: `О ${hm(end)}${nx ? ` · без світла до ${hmE(nx.to % 1440 === 0 ? 1440 : nx.to % 1440)}${span}` : ''}`, renotify: true });
        else msgs.push({ kind: 'pre', tag: 'pre', title: `💡 Світло з’явиться через ${n} хв`, body: `О ${hm(end)}${nx ? ` · світло буде до ${hmE(nx.to % 1440 === 0 ? 1440 : nx.to % 1440)}${span}` : ''}`, renotify: true });
        st.sent.push(key);
      }
      // ключ ставимо і при першому запуску, щоб не слати пізнє «через N хв» одразу після підписки
      if (first && known && left > 0 && left <= lead) st.sent.push(key);
    }
  }
  st.sent = st.sent.slice(-24);
  return { msgs, st };
}
