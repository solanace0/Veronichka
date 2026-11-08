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
    const r = await fetch(URL_, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'accept-language': 'uk-UA,uk;q=0.9', accept: 'text/html' } });
    const html = await r.text();
    if (!r.ok) throw new Error('ДТЕК відповів HTTP ' + r.status);
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
