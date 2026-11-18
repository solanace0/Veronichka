// Сховище підписок на push — Upstash Redis через REST (Vercel Marketplace → Upstash Redis / колишній Vercel KV).
// Змінні середовища: KV_REST_API_URL + KV_REST_API_TOKEN (або UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
import { createHash } from 'node:crypto';
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
export const storeEnabled = () => !!(URL_ && TOKEN);
export const subId = (endpoint) => createHash('sha1').update(String(endpoint)).digest('hex').slice(0, 24);

async function call(path, body) {
  const r = await fetch(URL_ + path, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('store: ' + (j.error || r.status));
  return j;
}
const cmd = async (args) => (await call('', args)).result;
const pipe = async (cmds) => (await call('/pipeline', cmds)).map(x => { if (x.error) throw new Error('store: ' + x.error); return x.result; });

export async function getSub(id) {
  const v = await cmd(['GET', 'sub:' + id]);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function putSub(id, rec) { await pipe([['SET', 'sub:' + id, JSON.stringify(rec)], ['SADD', 'subs', id]]); }
export async function delSub(id) { await pipe([['DEL', 'sub:' + id], ['SREM', 'subs', id]]); }
export async function allSubs() {
  const ids = (await cmd(['SMEMBERS', 'subs'])) || [];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const vals = await cmd(['MGET', ...part.map(x => 'sub:' + x)]);
    part.forEach((id, j) => { try { if (vals[j]) out.push({ id, ...JSON.parse(vals[j]) }); } catch { /* пошкоджений запис пропускаємо */ } });
  }
  return out;
}
