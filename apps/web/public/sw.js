const CACHE='pulse-v2';
const CORE=['/','/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener('fetch',event=>{
  if(event.request.method==='GET'&&new URL(event.request.url).origin===location.origin){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
    }).catch(()=>caches.match(event.request)));
  }
});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json()??{}}catch{payload={body:event.data?.text()??'Новое сообщение'}}
  event.waitUntil(self.registration.showNotification(payload.title??'Pulse',{
    body:payload.body??'Новое сообщение',
    icon:payload.icon??'/icon.svg',
    badge:'/icon.svg',
    tag:payload.chatId?`chat-${payload.chatId}`:'pulse-message',
    data:{chatId:payload.chatId,url:payload.url??'/'},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const data=event.notification.data??{};
  const target=new URL(data.url??'/',self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const client=windows.find(item=>new URL(item.url).origin===self.location.origin);
    if(client){
      const destination='navigate'in client?(await client.navigate(target)??client):client;
      await destination.focus();
      destination.postMessage({type:'OPEN_CHAT',chatId:data.chatId});
      return;
    }
    await self.clients.openWindow(target);
  }));
});
