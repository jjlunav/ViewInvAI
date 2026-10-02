/* ViewInvAI · Avisos: historial de los avisos push que envía el servidor (precio,
 * niveles, Radar AI, noticias y eventos, carteras y Objetivo IA), con leído / no leído.
 * Se refresca al abrir la vista y cada 2 minutos con la app visible; el contador sale en
 * la navegación (escritorio y «Más»). */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const CATS=[
  ['all','Todos'],['unread','Sin leer'],['price','Precio'],['radar','Radar AI'],['news','Eventos'],['portfolio','Cartera']
 ];
 const ICON={price:'€',radar:'✹',news:'✦',portfolio:'▣',system:'⚙'};
 let rows=[],unread=0,loadedAt=0,loading=null,filter='all',error='';
 const auth=()=>window.ViewInvAIAuth;
 const signedIn=()=>!!(auth()&&typeof auth().getUser==='function'&&auth().getUser());
 function category(type){
  const t=String(type||'');
  if(/^price-/.test(t))return'price';
  if(/^(radar|pulse)/.test(t))return'radar';
  if(/event|news|catalyst/.test(t))return'news';
  if(/^(portfolio|position)|goal/.test(t))return'portfolio';
  return'system';
 }
 async function load(force=false){
  if(!signedIn())return;
  if(loading)return loading;
  if(!force&&Date.now()-loadedAt<60e3)return;
  loading=(async()=>{
   try{
    const res=await auth().apiFetch('/api/alerts');
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'No se pudieron cargar los avisos.');
    rows=Array.isArray(data.alerts)?data.alerts:[];
    unread=Number(data.unread)||rows.filter(r=>!r.read_at).length;
    error='';loadedAt=Date.now();
   }catch(e){error=e.message||'No se pudieron cargar los avisos.'}
   finally{loading=null;paintBadges();if(isActive())render();window.dispatchEvent(new CustomEvent('viewinvai:inbox-updated'))}
  })();
  return loading;
 }
 function isActive(){return typeof state!=='undefined'&&state.currentView==='inbox'}
 function paintBadges(){
  const n=signedIn()?unread:0,label=n>99?'99+':String(n);
  document.querySelectorAll('[data-view="inbox"],[data-mobile-view="inbox"]').forEach(el=>{
   let b=el.querySelector('.nav-badge');
   if(!n){if(b)b.remove();return}
   if(!b){b=document.createElement('i');b.className='nav-badge';el.appendChild(b)}
   b.textContent=label;
  });
  const more=document.querySelector('.mobile-nav-item[data-mobile-more]');
  if(more)more.classList.toggle('has-unread',n>0);
  const bellBadge=document.getElementById('notificationBadge');
  if(bellBadge&&signedIn()){bellBadge.textContent=label;bellBadge.classList.toggle('is-hidden',!n)}
 }
 // The desktop bell used to show only alerts detected in this browser: when signed in it
 // opens Avisos and counts the server ones.
 document.addEventListener('click',e=>{
  const bell=e.target.closest&&e.target.closest('#notificationBell');
  if(!bell||!signedIn()||typeof show!=='function')return;
  e.preventDefault();e.stopImmediatePropagation();show('inbox');
 },true);
 function dayLabel(iso){
  const d=new Date(iso),today=new Date();
  const k=x=>x.getFullYear()+'-'+x.getMonth()+'-'+x.getDate();
  if(k(d)===k(today))return'Hoy';
  const y=new Date(today);y.setDate(y.getDate()-1);
  if(k(d)===k(y))return'Ayer';
  return d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
 }
 function visible(){
  return rows.filter(r=>filter==='all'||(filter==='unread'?!r.read_at:category(r.alert_type)===filter));
 }
 function rowHtml(r){
  const cat=category(r.alert_type),time=new Date(r.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
  const sev=String(r.severity||'info');
  return '<button type="button" class="inbox-row'+(r.read_at?'':' unread')+' sev-'+esc(sev)+'" data-inbox-id="'+esc(r.id)+'"'+(r.stock_key?' data-inbox-stock="'+esc(r.stock_key)+'"':'')+'>'+
   '<span class="inbox-icon cat-'+cat+'" aria-hidden="true">'+ICON[cat]+'</span>'+
   '<span class="inbox-main"><b>'+esc(r.title||'Aviso')+'</b><small>'+esc(r.message||'')+'</small></span>'+
   '<span class="inbox-time">'+esc(time)+(r.read_at?'':'<i class="inbox-dot" aria-label="Sin leer"></i>')+'</span></button>';
 }
 function render(){
  const box=document.getElementById('inboxResults');if(!box)return;
  if(!signedIn()){
   box.innerHTML='<section class="tax-card today-signin"><div><small>AVISOS</small><strong>Inicia sesión para ver tus avisos</strong><span>Precio, niveles, Radar AI, noticias y carteras: todo lo que te llega al móvil, guardado aquí.</span></div><button type="button" class="btn portfolio-google-login">Entrar con Google</button></section>';
   return;
  }
  if(!loadedAt&&!error){box.innerHTML='<div class="today-loading">Cargando avisos…</div>';load();return}
  const counts={all:rows.length,unread:rows.filter(r=>!r.read_at).length};
  rows.forEach(r=>{const c=category(r.alert_type);counts[c]=(counts[c]||0)+1});
  const chips='<nav class="inbox-filters" aria-label="Filtrar avisos">'+CATS.filter(([k])=>k==='all'||k==='unread'||counts[k]).map(([k,l])=>'<button type="button" class="tab'+(k===filter?' active':'')+'" data-inbox-filter="'+k+'" aria-pressed="'+(k===filter)+'">'+l+(counts[k]?' <em>'+counts[k]+'</em>':'')+'</button>').join('')+'</nav>';
  const list=visible();
  let html='',last='';
  for(const r of list){
   const lbl=dayLabel(r.created_at);
   if(lbl!==last){html+='<h3 class="inbox-day">'+esc(lbl)+'</h3>';last=lbl}
   html+=rowHtml(r);
  }
  const empty=rows.length
   ?'<div class="today-empty">Nada en este filtro.</div>'
   :'<div class="today-empty">Todavía no has recibido avisos. Actívalos con la 🔔 de cada valor o en Configuración.</div>';
  box.innerHTML=(error?'<p class="tax-warn">'+esc(error)+'</p>':'')+chips+(list.length?'<div class="inbox-list">'+html+'</div>':empty)+
   '<p class="tax-hint inbox-foot">Se guardan los últimos 150 avisos; los leídos se borran a los 6 meses.</p>';
  const mark=document.querySelector('[data-inbox-read-all]');if(mark)mark.disabled=!counts.unread;
 }
 async function markRead(ids,all=false){
  const now=new Date().toISOString();
  rows.forEach(r=>{if((all||ids.includes(r.id))&&!r.read_at){r.read_at=now;unread=Math.max(0,unread-1)}});
  if(all)unread=0;
  paintBadges();if(isActive())render();
  try{await auth().apiFetch('/api/alerts/read',{method:'POST',body:JSON.stringify(all?{all:true}:{ids})})}catch(_){}
  window.dispatchEvent(new CustomEvent('viewinvai:inbox-updated'));
 }
 document.addEventListener('click',e=>{
  const f=e.target.closest&&e.target.closest('[data-inbox-filter]');
  if(f){filter=f.dataset.inboxFilter;render();return}
  if(e.target.closest&&e.target.closest('[data-inbox-read-all]')){markRead([],true);return}
  if(e.target.closest&&e.target.closest('[data-inbox-refresh]')){load(true);return}
  const r=e.target.closest&&e.target.closest('[data-inbox-id]');
  if(r){
   markRead([r.dataset.inboxId]);
   const key=r.dataset.inboxStock;
   if(key&&window.ViewInvAI&&window.ViewInvAI.openStockByKey)window.ViewInvAI.openStockByKey(key,'Aviso',null,'inbox');
  }
 });
 window.addEventListener('viewinvai:view-changed',e=>{paintBadges();if(e.detail&&e.detail.view==='inbox'){render();load(true)}});
 ['viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>{loadedAt=0;rows=[];unread=0;setTimeout(()=>{load(true);paintBadges()},400)}));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
 setInterval(()=>{if(!document.hidden)load(true)},120e3);
 window.ViewInvAIInbox={render,load,recent:(n=3)=>rows.slice(0,n),unread:()=>unread,category};
})();
