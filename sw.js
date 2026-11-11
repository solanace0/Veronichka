const C='trebasvitlo-v12',F='trebasvitlo-fonts',S=['/','/index.html','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest','/legal.css','/privacy.html','/terms.html','/about.html'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.allSettled(S.map(u=>c.add(u)))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!==F).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);
/* шрифт Nunito: кешуємо, щоб працював офлайн */
if(u.host==='fonts.googleapis.com'||u.host==='fonts.gstatic.com'){e.respondWith(caches.open(F).then(c=>c.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r}))));return}
if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('/index.html'))))});
/* клік по сповіщенню: відкриваємо або повертаємо застосунок */
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>l.length?l[0].focus():self.clients.openWindow('/')))});
