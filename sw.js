const C='trebasvitlo-v22',F='trebasvitlo-fonts',S=['/','/index.html','/games.html','/icon.svg','/icon-192.png','/icon-512.png','/badge-96.png','/avatar.png','/intro-girl.png','/intro-bulb.png','/intro-bulb-dim.png','/apple-touch-icon.png','/manifest.webmanifest','/legal.css','/privacy.html','/terms.html','/about.html','/install.html'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.allSettled(S.map(u=>c.add(u)))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!==F).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);
/* шрифт Nunito: кешуємо, щоб працював офлайн */
if(u.host==='fonts.googleapis.com'||u.host==='fonts.gstatic.com'){e.respondWith(caches.open(F).then(c=>c.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r}))));return}
if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('/index.html'))))});
/* push: сповіщення приходять навіть коли застосунок закрито */
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}
const o={body:d.body||'',icon:'/icon-192.png',badge:'/badge-96.png',tag:d.tag||'svitlo',renotify:!!d.renotify,timestamp:d.ts||Date.now(),vibrate:[110,60,110],data:{url:d.url||'/'}};
e.waitUntil(self.registration.showNotification(d.title||'ТребаСвітло?',o))});
/* клік по сповіщенню: відкриваємо або повертаємо застосунок */
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/';e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>l.length?l[0].focus():self.clients.openWindow(u)))});
/* підписку браузер міг скинути — застосунок підпише знову при наступному відкритті */
self.addEventListener('pushsubscriptionchange',e=>{e.waitUntil(self.clients.matchAll({includeUncontrolled:true}).then(l=>l.forEach(c=>c.postMessage({type:'resub'}))))});
