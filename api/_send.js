// Відправка Web Push (VAPID). Ключі: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: або https://).
import webpush from 'web-push';

const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '');
export const vapidReady = () => !!(clean(process.env.VAPID_PUBLIC_KEY) && clean(process.env.VAPID_PRIVATE_KEY));

// Тема VAPID: якщо вписали просто пошту без «mailto:», web-push падає на КОЖНІЙ відправці — виправляємо самі.
function subject() {
  const s = clean(process.env.VAPID_SUBJECT);
  if (!s) return 'mailto:admin@example.com';
  if (/^(mailto:|https:\/\/)/i.test(s)) return s;
  return s.includes('@') ? 'mailto:' + s : 'https://' + s.replace(/^https?:\/\//i, '');
}
let inited = false;
function init() {
  if (inited) return;
  webpush.setVapidDetails(subject(), clean(process.env.VAPID_PUBLIC_KEY), clean(process.env.VAPID_PRIVATE_KEY));
  inited = true;
}

// Повертає:
//  'ok'     — доставлено службі push
//  'gone'   — підписка померла (404/410), її треба видалити
//  'reject' — служба push відхилила (400/401/403/413): ключі не ті або підписка зіпсована
//  'fail'   — тимчасова помилка (мережа, 5xx, 429): спробуємо ще раз у наступному запуску
// opts: { ttl, urgency, topic } або просто число ttl (старий виклик).
export async function sendPush(sub, payload, opts = {}) {
  init();
  const o = typeof opts === 'number' ? { ttl: opts } : opts || {};
  const options = { TTL: Math.max(30, Math.floor(o.ttl || 900)), urgency: o.urgency || 'normal' };
  if (o.topic && /^[A-Za-z0-9_-]{1,32}$/.test(o.topic)) options.topic = o.topic; // нове замінює старе, якщо пристрій був офлайн
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), options);
    return 'ok';
  } catch (e) {
    const c = e && e.statusCode;
    if (c === 404 || c === 410) return 'gone';
    if (c === 400 || c === 401 || c === 403 || c === 413) return 'reject';
    return 'fail';
  }
}
