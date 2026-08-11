const CACHE='soils-shell-v11021';
const isCacheable=(request,url)=>request.method==='GET'&&url.origin===self.location.origin&&!url.pathname.startsWith('/api/');

async function precacheShell(){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch('/',{cache:'no-store'});
    if(!response.ok)return;
    const copy=response.clone();
    await cache.put('/',copy);
    const html=await response.text();
    const assets=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match=>match[1])
      .filter(value=>value.startsWith('/')&&!value.startsWith('/api/'));
    await Promise.all([...new Set(assets)].map(asset=>cache.add(asset).catch(()=>{})));
  }catch{}
}

self.addEventListener('install',event=>{
  event.waitUntil(precacheShell().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('soils-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(!isCacheable(request,url))return;

  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('/',copy)).catch(()=>{});return response;
    }).catch(async()=>await caches.match(request)||await caches.match('/')||Response.error()));
    return;
  }

  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}return response;
  })));
});
