// Перевірка цілісності перед викладанням: node scripts/check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const bad = [];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.type !== 'module') bad.push('package.json: потрібно "type":"module" (api/ — ESM)');
if (!pkg.dependencies || !pkg.dependencies['web-push']) bad.push('package.json: немає залежності web-push (без неї не працюють сповіщення). Це корінь, не Electron-маніфест із desktop/');
if (pkg.main || (pkg.devDependencies && pkg.devDependencies.electron)) bad.push('package.json: схоже на Electron-маніфест; його місце в desktop/package.json');
for (const f of readdirSync('api').filter((f) => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', 'api/' + f], { stdio: 'pipe' }); } catch (e) { bad.push('api/' + f + ': синтаксична помилка'); }
}
// Усі валідатори черг мають приймати і 6×2, і 12×1
const rx = /\/\^([^\/]*\\d\{1,2\}[^\/]*)\$\//;
for (const f of ['api/schedule.js', 'api/push.js', 'api/outages.js']) {
  const t = readFileSync(f, 'utf8');
  if (/\[1-6\]\\\.\[12\]/.test(t)) bad.push(f + ': жорстко зашита схема черг 1.1–6.2');
}
// Автопідбір черги за адресою: модуль, підключення в address.js і поле адреси в інтерфейсі
const ya = readFileSync('api/_yasno-addr.js', 'utf8'), ad = readFileSync('api/address.js', 'utf8'), ix = readFileSync('index.html', 'utf8');
if (!/addresses\/v2/.test(ya) || !/export async function resolveQueue/.test(ya)) bad.push('api/_yasno-addr.js: немає адресного ланцюжка YASNO');
if (!/resolveQueue/.test(ad) || !/q\.resolve/.test(ad)) bad.push('api/address.js: не підключено ?resolve=1');
if (!/qaResolve/.test(ix) || !/id="ob-qa"/.test(ix) || !/id="st-qa"/.test(ix)) bad.push('index.html: немає автопідбору черги за адресою');
const wf = readFileSync('.github/workflows/push-cron.yml', 'utf8');
if (!/continue-on-error/.test(wf)) bad.push('push-cron.yml: без continue-on-error GitHub шле листи «Run failed»');
if (bad.length) { console.error('ПОМИЛКИ:\n- ' + bad.join('\n- ')); process.exit(1); }
console.log('OK');
