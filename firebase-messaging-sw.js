/* ViewInvAI web push service worker */
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAzv3BLvB9XdFEKznndz3jpCzjEWG4UsUw",
  authDomain: "viewinvai.firebaseapp.com",
  projectId: "viewinvai",
  storageBucket: "viewinvai.firebasestorage.app",
  messagingSenderId: "638735053048",
  appId: "1:638735053048:web:aa48c2a397727854820b0d"
});

const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const notification=payload&&payload.notification||{};
  const data=payload&&payload.data||{};
  const title=String(notification.title||data.title||"ViewInvAI");
  const options={
    body:String(notification.body||data.body||""),
    icon:"/favicon.svg",
    badge:"/favicon.svg",
    data:{...data,url:"/"}
  };
  self.registration.showNotification(title,options);
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const data=event.notification&&event.notification.data||{};
  const url=new URL(data.url||"/",self.location.origin);
  if(data.route)url.searchParams.set("pushRoute",String(data.route));
  if(data.portfolioId)url.searchParams.set("portfolioId",String(data.portfolioId));
  if(data.stockKey)url.searchParams.set("stockKey",String(data.stockKey));
  if(data.preferTr)url.searchParams.set("preferTr",String(data.preferTr));
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if("focus" in client){
        await client.focus();
        if("navigate" in client)await client.navigate(url.href);
        return;
      }
    }
    if(clients.openWindow)await clients.openWindow(url.href);
  })());
});
