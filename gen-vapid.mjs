// node scripts/gen-vapid.mjs — створює пару VAPID-ключів для push (без залежностей).
import { generateKeyPairSync } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' });
const b = x => Buffer.from(x, 'base64url');
const pubRaw = Buffer.concat([Buffer.from([4]), b(pub.x), b(pub.y)]).toString('base64url');
console.log('VAPID_PUBLIC_KEY=' + pubRaw);
console.log('VAPID_PRIVATE_KEY=' + prv.d);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('CRON_SECRET=' + Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url'));
