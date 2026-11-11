// Оголошення про екстрені/аварійні відключення з ОФІЦІЙНИХ публічних Telegram-каналів.
// Публічні канали мають веб-вітрину https://t.me/s/<канал> (без входу й ключів) — читаємо її на сервері.
// Тільки перевірені канали з білого списку: у Telegram багато фейкових «каналів ДТЕК», довіряти їм не можна.
//   dtek_ua   — офіційний канал ДТЕК (синя галочка), пише і про Дніпропетровщину
//   ukrenergo — офіційний канал НЕК «Укренерго» (оголошує аварійні відключення по областях)
// Інші канали можна додати змінною середовища TG_CHANNELS (через кому) у налаштуваннях Vercel.
export const CHANNELS = (process.env.TG_CHANNELS || 'dtek_ua,ukrenergo').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_]{4,40}$/.test(s));
const MAX_AGE_H = 14;   // старіші за 14 год повідомлення вважаємо неактуальними
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

const RE = {
  region: /Дніпропетровськ[а-яіїєґ]*|Дніпропетровщин[а-яіїєґ]*/i,
  dp: /Дніпр(?:о|і|а|у|ом|ові)(?![а-яіїєґ])|Дніпровськ[а-яіїєґ]*\s+(район|міськ)/i,
  kz: /Кам[’'ʼ`]?янськ/i,
  kr: /Крив(ий|ого|ому)\s+Р(іг|огу|озі)|Криворіж[а-яіїєґ]*/i,
  start: /(екстрен[а-яіїєґ]*|аварійн[а-яіїєґ]*)\s+(відключен[а-яіїєґ]*|знеструмлен[а-яіїєґ]*|вимкнен[а-яіїєґ]*)/i,
  cancel: /(скасован[а-яіїєґ]*|припинен[а-яіїєґ]*|завершен[а-яіїєґ]*|не\s+застосовуютьс[а-яіїєґ]*|більше\s+не\s+діють)[^.!]{0,60}(екстрен[а-яіїєґ]*|аварійн[а-яіїєґ]*)|(екстрен[а-яіїєґ]*|аварійн[а-яіїєґ]*)\s+(відключен[а-яіїєґ]*|знеструмлен[а-яіїєґ]*)[^.!]{0,50}(скасован[а-яіїєґ]*|припинен[а-яіїєґ]*|завершен[а-яіїєґ]*|не\s+діють\s+більше)|повернул[а-яіїєґ]*\s+до\s+(графік|стабілізац)[а-яіїєґ]*|відновлен[а-яіїєґ]*\s+(дію\s+)?(графік|стабілізац)[а-яіїєґ]*|повертаємось\s+до\s+графік[а-яіїєґ]*/i
};

// Повертає оголошення для міст ('dp','kz','kr'). Для кожного міста вирішує ОСТАННЄ релевантне повідомлення:
// якщо воно про введення — «діє», якщо про скасування — «скасовано».
export function analyze(posts, now = Date.now()) {
  const items = [];
  const recent = posts.filter((p) => now - p.ts <= MAX_AGE_H * 36e5 && p.ts <= now + 5 * 6e4).sort((a, b) => a.ts - b.ts);
  const last = {};
  for (const p of recent) {
    const t = p.text;
    const isCancel = RE.cancel.test(t), isStart = RE.start.test(t);
    if (!isCancel && !isStart) continue;
    const cities = [];
    if (RE.dp.test(t)) cities.push('dp');
    if (RE.kz.test(t)) cities.push('kz');
    if (RE.kr.test(t)) cities.push('kr');
    if (RE.region.test(t)) cities.push('dp', 'kz', 'kr');
    if (!cities.length) continue;
    for (const c of new Set(cities)) last[c] = { p, cancelled: isCancel && !(isStart && !RE.cancel.test(t.replace(RE.start, ''))) };
  }
  for (const c of Object.keys(last)) {
    const { p, cancelled } = last[c];
    const ex = items.find((i) => i.post === p.post && i.cancelled === cancelled);
    if (ex) { ex.cities.push(c); continue; }
    items.push({ text: p.text.length > 260 ? p.text.slice(0, 257) + '…' : p.text, cities: [c], cancelled, source: (p.channel === 'ukrenergo' ? 'Укренерго' : p.channel === 'dtek_ua' ? 'ДТЕК' : '@' + p.channel) + ' (Telegram)', ts: p.ts, link: p.link, post: p.post });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

export async function fetchTelegram() {
  const results = await Promise.all(CHANNELS.map(async (ch) => {
    try {
      const r = await fetch('https://t.me/s/' + ch, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const posts = parseChannel(await r.text(), ch);
      return { ch, ok: posts.length > 0, posts };
    } catch (e) { return { ch, ok: false, posts: [] }; }
  }));
  const items = analyze(results.flatMap((x) => x.posts));
  return { items, channels: results.map((x) => ({ channel: x.ch, ok: x.ok, posts: x.posts.length })), ok: results.some((x) => x.ok) };
}
