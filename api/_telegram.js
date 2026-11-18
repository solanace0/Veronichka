// Оголошення про екстрені/аварійні відключення з ОФІЦІЙНИХ публічних Telegram-каналів.
// Публічні канали мають веб-вітрину https://t.me/s/<канал> (без входу й ключів) — читаємо її на сервері.
// Тільки перевірені канали з білого списку: у Telegram багато фейкових «каналів ДТЕК», довіряти їм не можна.
//   dtek_ua            — офіційний канал ДТЕК (синя галочка)
//   ukrenergo          — НЕК «Укренерго» (оголошує екстрені відключення по областях)
//   dnipropetrovskaODA — Дніпропетровська обласна військова адміністрація
//   vilkul             — Рада оборони Кривого Рогу (Олександр Вілкул)
// Інші канали можна додати змінною середовища TG_CHANNELS (через кому) у налаштуваннях Vercel.
export const CHANNELS = (process.env.TG_CHANNELS || 'dtek_ua,ukrenergo,dnipropetrovskaODA,vilkul').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_]{4,40}$/.test(s));
const LABEL = { ukrenergo: 'Укренерго', dtek_ua: 'ДТЕК', dnipropetrovskaoda: 'Дніпропетровська ОВА', vilkul: 'Рада оборони Кривого Рогу' };
export const label = (ch) => LABEL[String(ch).toLowerCase()] || '@' + ch;
const MAX_AGE_H = 30;    // стан «діє/скасовано» рахуємо за повідомленнями не старшими за 30 год
const FEED_AGE_H = 36;   // стрічка свіжих повідомлень — за 36 год
const PAGES = 3;         // скільки сторінок вітрини читаємо (у каналі ДТЕК багато постів про інші області)
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'uk-UA,uk;q=0.9' };

const dec = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();

export function parseChannel(html, channel) {
  const out = [];
  for (const part of String(html || '').split('data-post="').slice(1)) {
    const post = part.slice(0, part.indexOf('"'));
    const t = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(part);
    const d = /<time[^>]*datetime="([^"]+)"/.exec(part);
    if (!t || !d) continue;
    const ts = Date.parse(d[1]);
    if (isNaN(ts)) continue;
    out.push({ channel, post, link: 'https://t.me/' + post, ts, text: dec(t[1]) });
  }
  return out;
}

const L = '[а-яіїєґ]*';
// Канали, чиї оголошення можуть запускати статус «оголошено». Усі інші (ОВА, Рада оборони) — лише стрічка новин.
const OPERATORS = new Set(['dtek_ua', 'ukrenergo']);
// Канал про одне місто: його пости стосуються цього міста, навіть якщо слово «Кривий Ріг» у тексті не згадано.
const HOME = { vilkul: ['kr'] };
const ANN_AGE_H = 8; // оголошення оператора вважаємо актуальним 8 годин, якщо його не скасовано

const EM = `(?:екстрен${L}|аварійн${L})`;
const OUTW = `(?:відключен${L}|знеструмлен${L}|вимкнен${L})`;
const VERB = `(?:введен${L}|запровадж${L}|застосован${L}|застосовуєтьс${L}|застосовуютьс${L}|діють|діятимуть|розпочал${L}|почал${L})`;
const RE = {
  region: /Дніпропетровськ[а-яіїєґ]*|Дніпропетровщин[а-яіїєґ]*/i,
  dp: /Дніпр(?:о|і|а|у|ом|ові)(?![а-яіїєґ])/i,
  kz: /Кам[’'ʼ`]?янськ(?:е|ого|ому|им)?(?![а-яіїєґ])(?!\s+(?:район|р-н))/i,
  // конкретні райони/міста області: якщо названо їх, а не наше місто, оголошення нашого міста НЕ стосується
  dist: /Павлоград|Синельників|Нікопол|Марганец|Марганц|Новомосковськ|Підгородн|Петропавлів|Томаківк|Широків|Апостолов|Зеленодольськ|Жовт[а-яіїєґ]*\s+Вод|Верхньодніпровськ|Дніпровськ[а-яіїєґ]*\s+(?:район|р-н)|Кам[’'ʼ`]?янськ[а-яіїєґ]*\s+(?:район|р-н)|Криворізьк[а-яіїєґ]*\s+(?:район|р-н)|[а-яіїєґ]+ськ[а-яіїєґ]*\s+район|прилег|громад[аиу]/i,
  allq: /(?:усі|всі|усіх|всіх)\s+черг|по\s+всіх\s+чергах|без\s+розподілу\s+за\s+чергами/i,
  kr: /Крив(ий|ого|ому)\s+Р(іг|огу|озі)|Криворіж[а-яіїєґ]*/i,
  // ЗАПРОВАДЖЕННЯ: потрібне дієслово введення поряд зі словосполученням «екстрені відключення» або «графіки не діють»
  start: new RegExp(`${VERB}[^.!?]{0,40}${EM}\\s+${OUTW}|${EM}\\s+${OUTW}[^.!?]{0,40}${VERB}|(?:графік${L}|стабілізаційн${L})[^.!?]{0,50}не\\s+(?:діють|діятимуть|застосовуються|застосовуватимуться)|відключен${L}\\s+(?:поза|без)\\s+графік${L}`, 'i'),
  // Заперечення: пост говорить, що екстрених немає / вони оминули / не вводилися
  neg: /оминул|не\s+(?:вводил|вводят|запроваджувал|запроваджуютьс|застосовувал)|відсутн|без\s+екстрен|без\s+аварійн|не\s+було|не\s+плану/i,
  cancel: new RegExp(`(скасован${L}|припинен${L}|завершен${L}|більше\\s+не\\s+діють)[^.!?]{0,60}${EM}|${EM}\\s+${OUTW}[^.!?]{0,50}(скасован${L}|припинен${L}|завершен${L}|не\\s+діють\\s+більше)|повернул${L}\\s+до\\s+(графік|стабілізац)${L}|відновлен${L}\\s+(дію\\s+)?(графік|стабілізац)${L}|повертаємось\\s+до\\s+графік${L}|екстрен${L}\\s+(відключен|вимкнен)${L}\\s+(скасов|припин|завершен)`, 'i'),
  // Будь-яка інформація про світло (для стрічки). Окремі «війна»-пости без слів про світло відсікаємо.
  feed: /(?:без|немає|нема|зникл[оа])\s+(?:світл|електр)|знеструм|відключен|вимкнен|екстрен[а-яіїєґ]*\s+(?:відключ|заход)|аварійн|стабілізаційн|електропостач|енергосистем|енергетичн|графік[а-яіїєґ]*\s+(?:відключ|погодин)|генератор/i
};
const ALL = ['kr', 'dp', 'kz'];
function explicitCities(t) {
  const c = [];
  if (RE.dp.test(t)) c.push('dp');
  if (RE.kz.test(t)) c.push('kz');
  if (RE.kr.test(t)) c.push('kr');
  return c;
}
// «По всій області»: названа область, але не названо жодного міста чи району
export const regionWide = (t) => RE.region.test(t) && !RE.dist.test(t) && !explicitCities(t).length;
export function citiesOf(t, channel) {
  const c = explicitCities(t);
  const home = HOME[String(channel || '').toLowerCase()];
  if (home) c.push(...home);
  if (regionWide(t)) c.push(...ALL);
  return [...new Set(c)];
}
// Черги, названі в тексті (1.1–6.2). Рахуємо лише якщо в тексті є слово «черг», щоб не плутати з датами й часом.
export function queuesOf(t) {
  if (!/черг/i.test(t)) return { queues: [], allQueues: RE.allq.test(t) };
  const q = new Set();
  for (const m of t.matchAll(/(?<![\d.,:])([1-6])\.([12])(?![\d])/g)) q.add(m[1] + '.' + m[2]);
  return { queues: [...q].sort(), allQueues: RE.allq.test(t) };
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const isStart = (t) => RE.start.test(t) && !RE.neg.test(t);
export const isCancel = (t) => RE.cancel.test(t);

// Оголошення ОПЕРАТОРІВ (ДТЕК, Укренерго): для кожного міста вирішує останнє релевантне повідомлення.
// Це лише рівень «оголошено, дані ще не підтверджено»: підтверджений статус дає прапорець на сайті ДТЕК.
export function analyze(posts, now = Date.now()) {
  const items = [];
  const recent = posts
    .filter((p) => OPERATORS.has(String(p.channel).toLowerCase()) && now - p.ts <= ANN_AGE_H * 36e5 && p.ts <= now + 5 * 6e4)
    .sort((a, b) => a.ts - b.ts);
  const last = {};
  for (const p of recent) {
    const t = p.text, st = isStart(t), ca = isCancel(t);
    if (!st && !ca) continue;
    const cancelled = ca && !(st && !isCancel(t.replace(RE.start, '')));
    // «Діють» без явного міста/області нікому не приписуємо
    for (const c of citiesOf(t, p.channel)) last[c] = { p, cancelled };
  }
  for (const c of Object.keys(last)) {
    const { p, cancelled } = last[c];
    const ex = items.find((i) => i.post === p.post && i.cancelled === cancelled);
    if (ex) { ex.cities.push(c); continue; }
    items.push({ text: clip(p.text, 300), cities: [c], cancelled, ...queuesOf(p.text), source: label(p.channel) + ' (Telegram)', ts: p.ts, link: p.link, post: p.post });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

// Стрічка: свіжі повідомлення офіційних каналів про світло для міст. Показуємо як є, без висновків «діє/не діє».
export function buildFeed(posts, now = Date.now()) {
  const out = [];
  for (const p of [...posts].sort((a, b) => b.ts - a.ts)) {
    if (now - p.ts > FEED_AGE_H * 36e5 || p.ts > now + 5 * 6e4 || !RE.feed.test(p.text)) continue;
    const cities = citiesOf(p.text, p.channel);
    if (!cities.length) continue;
    const kind = isCancel(p.text) ? 'cancel' : isStart(p.text) ? 'start' : 'info';
    out.push({ text: clip(p.text, 420), cities, kind, ...queuesOf(p.text), source: label(p.channel), ts: p.ts, link: p.link, post: p.post });
    if (out.length >= 24) break;
  }
  return out;
}

async function fetchChannel(ch) {
  let posts = [], before = null;
  for (let i = 0; i < PAGES; i++) {
    let page;
    try {
      const r = await fetch('https://t.me/s/' + ch + (before ? '?before=' + before : ''), { headers: UA, signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      page = parseChannel(await r.text(), ch);
    } catch (e) { if (i === 0) throw e; break; }
    if (!page.length) break;
    const seen = new Set(posts.map((p) => p.post));
    posts = posts.concat(page.filter((p) => !seen.has(p.post)));
    const ids = page.map((p) => +p.post.split('/')[1]).filter(Number.isFinite);
    if (!ids.length || Date.now() - Math.min(...page.map((p) => p.ts)) > FEED_AGE_H * 36e5) break;
    before = Math.min(...ids);
  }
  return posts;
}

export async function fetchTelegram() {
  const results = await Promise.all(CHANNELS.map(async (ch) => {
    try { const posts = await fetchChannel(ch); return { ch, ok: posts.length > 0, posts }; }
    catch (e) { return { ch, ok: false, posts: [] }; }
  }));
  const all = results.flatMap((x) => x.posts);
  return { items: analyze(all), feed: buildFeed(all), channels: results.map((x) => ({ channel: x.ch, ok: x.ok, posts: x.posts.length, newest: x.posts.length ? Math.max(...x.posts.map((p) => p.ts)) : null })), ok: results.some((x) => x.ok) };
}
