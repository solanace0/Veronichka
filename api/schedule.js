// Серверний адаптер ДТЕК: читає офіційну сторінку і дістає DisconSchedule.fact
const URL_ = 'https://www.dtek-dnem.com.ua/ua/shutdowns';
const GROUP = 'GPV4.2';
const kyivDate = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date(ts * 1000));
const MAP = { yes: [1, 1], no: [0, 0], first: [0, 1], second: [1, 0], maybe: [1, 1], mfirst: [1, 1], msecond: [1, 1] };

function extractJson(html, name) {
  const i = html.indexOf(name);
  if (i < 0) return null;
  const s = html.indexOf('{', i);
  let d = 0, inStr = false, q = '';
  for (let j = s; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (c === '\\') j++; else if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; } else if (c === '{') d++; else if (c === '}' && --d === 0) return JSON.parse(html.slice(s, j + 1));
  }
  return null;
}
const toSlots = g => { const out = []; for (let h = 1; h <= 24; h++) out.push(...(MAP[g?.[h]] || [null, null])); return out; };

export default async function handler(req, res) {
  try {
    const r = await fetch(URL_, { headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'upgrade-insecure-requests': '1', referer: 'https://www.dtek-dnem.com.ua/' } });
    const html = await r.text();
    if (req.query && req.query.debug) {
      const i = html.indexOf('DisconSchedule');
      return res.status(200).json({ status: r.status, length: html.length, hasDisconSchedule: i >= 0, incapsula: /incapsula|imperva|captcha/i.test(html), head: html.slice(0, 400), around: i >= 0 ? html.slice(i, i + 300) : null });
    }
    if (!r.ok) throw new Error('ДТЕК відповів HTTP ' + r.status);
    if (/incapsula|imperva/i.test(html) && html.indexOf('DisconSchedule') < 0) throw new Error('ДТЕК показав сторінку захисту (Incapsula) замість графіка');
    const fact = extractJson(html, 'DisconSchedule.fact');
    if (!fact || !fact.data) throw new Error('Не знайдено дані графіка на сторінці ДТЕК (можливий захист або зміна структури)');
    const days = {};
    for (const [ts, groups] of Object.entries(fact.data)) {
      if (!groups[GROUP]) continue;
      days[kyivDate(+ts)] = { date: kyivDate(+ts), slots: toSlots(groups[GROUP]) };
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    res.status(200).json({ ok: true, group: GROUP, updated: fact.update || null, fetchedAt: Date.now(), days });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
