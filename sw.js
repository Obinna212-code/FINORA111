const CACHE='finora-v9';
const ASSETS=['/','/index.html','/manifest.webmanifest','/finora-icon-192.png','/finora-icon-512.png','/finora-icon.png','/finora-lockup.png','/finora-brand-hero.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(x=>{const copy=x.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return x}).catch(()=>caches.match('/index.html'))));});
