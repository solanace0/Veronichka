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
const RE = {
  region: /Дніпропетровськ[а-яіїєґ]*|Дніпропетровщин[а-яіїєґ]*/i,
  dp: /Дніпр(?:о|і|а|у|ом|ові)(?![а-яіїєґ])|Дніпровськ[а-яіїєґ]*\s+(район|міськ)/i,
  kz: /Кам[’'ʼ`]?янськ/i,
  kr: /Крив(ий|ого|ому)\s+Р(іг|огу|озі)|Криворіж[а-яіїєґ]*/i,
  start: new RegExp(`(екстрен${L}|аварійн${L})\\s+(відключен${L}|знеструмлен${L}|вимкнен${L})|(графік${L}|стабілізаційн${L})[^.!]{0,50}не\\s+(діють|діятимуть|застосовуються|застосовуватимуться)|відключен${L}\\s+(поза|без)\\s+графік${L}|екстрен${L}\\s+заход${L}`, 'i'),
  cancel: new RegExp(`(скасован${L}|припинен${L}|завершен${L}|не\\s+застосовуютьс${L}|більше\\s+не\\s+діють)[^.!]{0,60}(екстрен${L}|аварійн${L})|(екстрен${L}|аварійн${L})\\s+(відключен${L}|знеструмлен${L})[^.!]{0,50}(скасован${L}|припинен${L}|завершен${L}|не\\s+діють\\s+більше)|повернул${L}\\s+до\\s+(графік|стабілізац)${L}|відновлен${L}\\s+(дію\\s+)?(графік|стабілізац)${L}|повертаємось\\s+до\\s+графік${L}`, 'i'),
  feed: /екстрен[а-яіїєґ]*\s+(відключ|знеструм|заход)|аварійн|знеструм|без\s+(світл|електро)|відключен[а-яіїєґ]*\s+(світл|електро)|стабілізаційн|графік[а-яіїєґ]*\s+(відключ|стабіл)|енергетичн/i
};
export function citiesOf(t) {
  const c = [];
  if (RE.dp.test(t)) c.push('dp');
  if (RE.kz.test(t)) c.push('kz');
  if (RE.kr.test(t)) c.push('kr');
  if (RE.region.test(t)) c.push('dp', 'kz', 'kr');
  return [...new Set(c)];
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Для кожного міста вирішує ОСТАННЄ релевантне повідомлення: про введення — «діє», про скасування — «скасовано».
export function analyze(posts, now = Date.now()) {
  const items = [];
  const recent = posts.filter((p) => now - p.ts <= MAX_AGE_H * 36e5 && p.ts <= now + 5 * 6e4).sort((a, b) => a.ts - b.ts);
  const last = {};
  for (const p of recent) {
    const t = p.text;
    const isCancel = RE.cancel.test(t), isStart = RE.start.test(t);
    if (!isCancel && !isStart) continue;
    for (const c of citiesOf(t)) last[c] = { p, cancelled: isCancel && !(isStart && !RE.cancel.test(t.replace(RE.start, ''))) };
  }
  for (const c of Object.keys(last)) {
    const { p, cancelled } = last[c];
    const ex = items.find((i) => i.post === p.post && i.cancelled === cancelled);
    if (ex) { ex.cities.push(c); continue; }
    items.push({ text: clip(p.text, 260), cities: [c], cancelled, source: label(p.channel) + ' (Telegram)', ts: p.ts, link: p.link, post: p.post });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

// Стрічка: свіжі повідомлення офіційних каналів про світло для міст — показуємо людині як є, навіть якщо автоматично не вдалося визначити «діє/скасовано».
export function buildFeed(posts, now = Date.now()) {
  const out = [];
  for (const p of [...posts].sort((a, b) => b.ts - a.ts)) {
    if (now - p.ts > FEED_AGE_H * 36e5 || p.ts > now + 5 * 6e4 || !RE.feed.test(p.text)) continue;
    const cities = citiesOf(p.text);
    if (!cities.length) continue;
    out.push({ text: clip(p.text, 320), cities, source: label(p.channel), ts: p.ts, link: p.link, post: p.post });
    if (out.length >= 14) break;
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
    posts = posts.concat(page);
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
  return { items: analyze(all), feed: buildFeed(all), channels: results.map((x) => ({ channel: x.ch, ok: x.ok, posts: x.posts.length })), ok: results.some((x) => x.ok) };
}
