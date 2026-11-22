// Викликається кожні ~5 хвилин (GitHub Actions / cron-job.org): перевіряє графіки й розсилає push.
// Захист: заголовок Authorization: Bearer <CRON_SECRET> (Vercel Cron додає його сам) або ?key=<CRON_SECRET>.
import { createHash, timingSafeEqual } from 'node:crypto';
import { allSubs, getSub, putSub, delSub, storeEnabled } from './_store.js';
import { sendPush, vapidReady } from './_send.js';
import { plan } from './_notify.js';

const sha = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
const MAX_BAD = 10; // стільки запусків поспіль служба push відхиляє підписку — вважаємо її мертвою
const BUDGET_MS = 45000; // запас до ліміту функції Vercel (див. vercel.json)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = String(process.env.CRON_SECRET || '').trim();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const key = req.query && typeof req.query.key === 'string' ? req.query.key : '';
  if (!secret || !((bearer && same(bearer, secret)) || (key && same(key, secret)))) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!vapidReady() || !storeEnabled()) return res.status(503).json({ ok: false, error: 'not configured' });
  const t0 = Date.now();
  const origin = (process.env.APP_ORIGIN || '').replace(/\/$/, '') || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try {
    const subs = await allSubs();
    const groups = [...new Set(subs.map(s => s.city + '|' + s.group))];
    const sched = {};
    await Promise.all(groups.map(async g => {
      const [city, group] = g.split('|');
      for (let a = 0; a < 2 && !sched[g]; a++) { // одна повторна спроба, якщо джерело на мить не відповіло
        try {
          const r = await fetch(`${origin}/api/schedule?group=${encodeURIComponent(group)}&city=${encodeURIComponent(city)}&t=${Math.floor(Date.now() / 6e4)}`, { signal: AbortSignal.timeout(9000) });
          const j = await r.json();
          if (j && j.ok) sched[g] = j;
        } catch { /* група пропускається цього разу */ }
      }
    }));
    let sent = 0, gone = 0, failed = 0, rejected = 0, skipped = 0, partial = false;
    const work = subs.filter(s => sched[s.city + '|' + s.group]);
    skipped = subs.length - work.length;
    for (let i = 0; i < work.length; i += 15) {
      if (Date.now() - t0 > BUDGET_MS) { partial = true; skipped += work.length - i; break; }
      await Promise.all(work.slice(i, i + 15).map(async s => {
        try {
          const { msgs, st } = plan(s, sched[s.city + '|' + s.group]);
          let dead = false, transient = false, okN = 0, rejN = 0;
          for (const m of msgs) {
            const urgent = m.kind === 'pre' || m.kind === 'emg';
            const r = await sendPush(s.sub, { title: m.title, body: m.body, tag: m.tag, renotify: !!m.renotify, kind: m.kind, url: '/', ts: Date.now() }, { ttl: m.ttl || 3600, urgency: urgent ? 'high' : 'normal', topic: m.kind });
            if (r === 'ok') { sent++; okN++; } else if (r === 'gone') { dead = true; gone++; break; } else if (r === 'reject') { rejected++; rejN++; } else { failed++; transient = true; }
          }
          if (dead) return delSub(s.id);
          // без повідомлень «reject» не рахуємо: перевіряти нічого. Хоч одне ok — лічильник збоїв скидаємо.
          const bad = okN ? 0 : rejN ? (s.bad || 0) + 1 : s.bad || 0;
          if (bad >= MAX_BAD) return delSub(s.id);
          // тимчасова помилка: стан не зберігаємо, щоб наступний запуск повторив відправку
          const nextSt = transient ? s.st : st;
          if (JSON.stringify(nextSt) === JSON.stringify(s.st) && bad === (s.bad || 0)) return;
          const fresh = await getSub(s.id); // користувач міг змінити налаштування за ці секунди
          if (!fresh) return;
          await putSub(s.id, { ...fresh, st: nextSt, bad: bad || undefined });
        } catch { failed++; }
      }));
    }
    return res.status(200).json({ ok: true, subs: subs.length, groups: groups.length, sent, gone, failed, rejected, skipped, partial, ms: Date.now() - t0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
