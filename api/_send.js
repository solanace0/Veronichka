// Відправка Web Push (VAPID). Ключі: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: або https://).
import webpush from 'web-push';
export const vapidReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let inited = false;
function init() {
  if (inited) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  inited = true;
}
// Повертає 'ok' | 'gone' (підписка померла — її треба видалити) | 'fail'
export async function sendPush(sub, payload, ttl = 900) {
  init();
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: ttl, urgency: 'high' });
    return 'ok';
  } catch (e) {
    return e && (e.statusCode === 404 || e.statusCode === 410) ? 'gone' : 'fail';
  }
}
