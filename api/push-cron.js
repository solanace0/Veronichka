// Викликається кожні ~5 хвилин (GitHub Actions / cron-job.org): перевіряє графіки й розсилає push.
// Захист: заголовок Authorization: Bearer <CRON_SECRET> (Vercel Cron додає його сам) або ?key=<CRON_SECRET>.
import { allSubs, putSub, delSub, storeEnabled } from './_store.js';
import { sendPush, vapidReady } from './_send.js';
import { plan } from './_notify.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization === 'Bearer ' + secret || (req.query && req.query.key === secret);
  if (!secret || !auth) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!vapidReady() || !storeEnabled()) return res.status(503).json({ ok: false, error: 'not configured' });
  const origin = (process.env.APP_ORIGIN || '').replace(/\/$/, '') || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try {
    const subs = await allSubs();
    const groups = [...new Set(subs.map(s => s.city + '|' + s.group))];
    const sched = {};
    await Promise.all(groups.map(async g => {
      const [city, group] = g.split('|');
      try { const r = await fetch(`${origin}/api/schedule?group=${group}&city=${city}&t=${Math.floor(Date.now() / 6e4)}`, { signal: AbortSignal.timeout(9000) }); const j = await r.json(); if (j && j.ok) sched[g] = j; } catch { /* група пропускається цього разу */ }
    }));
    let sent = 0, gone = 0, failed = 0;
    const work = subs.filter(s => sched[s.city + '|' + s.group]);
    for (let i = 0; i < work.length; i += 15) {
      await Promise.all(work.slice(i, i + 15).map(async s => {
        const { msgs, st } = plan(s, sched[s.city + '|' + s.group]);
        let dead = false;
        for (const m of msgs) {
          const r = await sendPush(s.sub, { title: m.title, body: m.body, tag: m.tag, renotify: !!m.renotify, kind: m.kind, url: '/', ts: Date.now() }, m.kind === 'pre' ? 600 : 3600);
          if (r === 'ok') sent++; else if (r === 'gone') { dead = true; gone++; break; } else failed++;
        }
        if (dead) await delSub(s.id); else await putSub(s.id, { ...s, id: undefined, st });
      }));
    }
    return res.status(200).json({ ok: true, subs: subs.length, groups: groups.length, sent, gone, failed });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
