'use client';
import{useEffect,useState}from'react';
import{Bell,BellOff,X}from'lucide-react';
import{api}from'@/lib/api';

const DISMISSED='pulse_push_prompt_dismissed';
const PUBLIC_KEY=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY??'';
function applicationServerKey(value:string){const padding='='.repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes}
function deviceLabel(){const ua=navigator.userAgent;const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Браузер';return`${browser} · ${navigator.platform||'устройство'}`}

export function PushNotifications({onError}:{onError:(message:string)=>void}){
  const[supported,setSupported]=useState(false);const[enabled,setEnabled]=useState(false);const[hidePreview,setHidePreview]=useState(false);const[banner,setBanner]=useState(false);const[settings,setSettings]=useState(false);const[busy,setBusy]=useState(false);const[permission,setPermission]=useState<NotificationPermission>('default');
  useEffect(()=>{
    const token=localStorage.getItem('pulse_token');const available=Boolean(token&&PUBLIC_KEY&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window);setSupported(available);if(!available)return;
    setPermission(Notification.permission);
    navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(async registration=>{
      const subscription=await registration.pushManager.getSubscription();setEnabled(Boolean(subscription));
      if(subscription)await sync(subscription).catch(error=>onError((error as Error).message));
    }).catch(error=>onError((error as Error).message));
    api<{hidePushPreview:boolean}>('/push/settings').then(value=>setHidePreview(value.hidePushPreview)).catch(()=>{});
    if(Notification.permission==='default'&&!localStorage.getItem(DISMISSED)){const timer=setTimeout(()=>setBanner(true),6000);return()=>clearTimeout(timer)}
  },[]);
  async function sync(subscription:PushSubscription){const json=subscription.toJSON();if(!json.keys?.p256dh||!json.keys.auth)throw new Error('Браузер не вернул ключи push-подписки');await api('/push/subscribe',{method:'POST',body:JSON.stringify({endpoint:subscription.endpoint,keys:json.keys,userAgent:navigator.userAgent,deviceLabel:deviceLabel()})})}
  async function enable(){setBusy(true);try{const result=await Notification.requestPermission();setPermission(result);if(result!=='granted'){localStorage.setItem(DISMISSED,result);setBanner(false);return}const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey(PUBLIC_KEY)});await sync(subscription);setEnabled(true);setBanner(false);localStorage.removeItem(DISMISSED)}catch(error){onError((error as Error).message)}finally{setBusy(false)}}
  async function disable(){setBusy(true);try{const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();if(subscription){await api('/push/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:subscription.endpoint})}).catch(()=>{});await subscription.unsubscribe()}setEnabled(false)}catch(error){onError((error as Error).message)}finally{setBusy(false)}}
  async function updatePreview(show:boolean){const hide=!show;setHidePreview(hide);try{await api('/push/settings',{method:'PATCH',body:JSON.stringify({hidePushPreview:hide})})}catch(error){setHidePreview(!hide);onError((error as Error).message)}}
  function dismiss(){localStorage.setItem(DISMISSED,'dismissed');setBanner(false)}
  if(!supported)return null;
  return <><button onClick={()=>setSettings(true)} className="ml-auto rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Настройки уведомлений">{enabled?<Bell size={20}/>:<BellOff size={20}/>}</button>
  {banner&&<div className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-2xl bg-slate-950 p-4 text-white shadow-2xl dark:bg-white dark:text-slate-950"><Bell className="shrink-0 text-indigo-400"/><div className="min-w-0 flex-1"><b>Включить уведомления?</b><p className="text-sm opacity-75">Сообщим о новых сообщениях, когда этот чат не открыт.</p></div><button onClick={enable} disabled={busy} className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Включить</button><button onClick={dismiss} aria-label="Не показывать снова"><X/></button></div>}
  {settings&&<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={event=>event.currentTarget===event.target&&setSettings(false)}><section role="dialog" aria-modal="true" aria-label="Настройки уведомлений" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900"><header className="flex items-center"><div><h2 className="text-lg font-bold">Уведомления</h2><p className="text-sm text-slate-500">Настройки этого браузера</p></div><button onClick={()=>setSettings(false)} className="ml-auto rounded-xl p-2" aria-label="Закрыть настройки"><X/></button></header><div className="mt-5 space-y-3"><label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 dark:bg-slate-800"><span><b className="block">Новые сообщения</b><small className="text-slate-500">{permission==='denied'?'Разрешение заблокировано в браузере':enabled?'Уведомления включены':'Уведомления выключены'}</small></span><input type="checkbox" checked={enabled} disabled={busy||permission==='denied'} onChange={event=>event.target.checked?enable():disable()} className="h-5 w-5 accent-indigo-500"/></label><label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 dark:bg-slate-800"><span><b className="block">Показывать текст сообщения</b><small className="text-slate-500">Можно скрыть превью для приватности</small></span><input type="checkbox" checked={!hidePreview} disabled={busy} onChange={event=>updatePreview(event.target.checked)} className="h-5 w-5 accent-indigo-500"/></label></div></section></div>}</>;
}
