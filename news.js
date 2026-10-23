/* ViewInvAI · Noticias: por categorías (Para ti, Mis valores, Última hora, Macro, Cripto).
 * Titular, medio y hora, sin fotos de prensa (tienen derechos). Cada noticia marca los valores
 * que cita con su variación de hoy y si están en tu cartera. Datos de /api/news (Google News en
 * español y Bing de respaldo; caché de 20 min en el servidor y de 5 min aquí).
 */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const CATS=[['foryou','Para ti'],['mine','Mis valores'],['latest','Última hora'],['macro','Macro'],['crypto','Cripto']];
 const TOPIC_ICON={latest:'▤',macro:'◎',crypto:'₿',mine:'★'};
 const CLIENT_TTL=5*60000;
 const S={cat:'foryou',data:{},loading:{},error:{}};
 try{const c=localStorage.getItem('viewinvai:news-cat');if(CATS.some(([k])=>k===c))S.cat=c}catch(_){}
 const auth=()=>window.ViewInvAIAuth;
 const signedIn=()=>{try{return!!(auth()&&auth().getUser&&auth().getUser())}catch(_){return false}};
 const isActive=()=>typeof state!=='undefined'&&state.currentView==='news';

 async function load(cat,force=false){
  if(!signedIn()||S.loading[cat])return;
  const hit=S.data[cat];
  if(!force&&hit&&Date.now()-hit.at<CLIENT_TTL)return;
  S.loading[cat]=true;S.error[cat]='';
  if(isActive())render();
  try{
   const res=await auth().apiFetch('/api/news?cat='+encodeURIComponent(cat));
   const d=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(d.error||'No se pudieron cargar las noticias.');
   S.data[cat]={at:Date.now(),items:Array.isArray(d.items)?d.items:[]};
  }catch(e){S.error[cat]=e.message||'No se pudieron cargar las noticias.'}
  finally{S.loading[cat]=false;if(isActive())render();window.dispatchEvent(new CustomEvent('viewinvai:news-updated',{detail:{cat}}))}
 }

 // Valores del usuario (posiciones y favoritos) para marcar los que cita cada titular.
 function holdings(){
  const P=window.ViewInvAIPortfolios,out=[];
  try{(P&&P.getPositionsDetail?P.getPositionsDetail():[]).forEach(p=>out.push({key:p.stockKey,ticker:p.ticker,name:p.name,held:true,preferTr:p.preferTr}))}catch(_){}
  try{(P&&P.getWatchlist?P.getWatchlist():[]).forEach(w=>out.push({key:w.stock_key,ticker:w.ticker,name:w.name,held:false,preferTr:Number(w.prefer_tr)===1}))}catch(_){}
  const seen=new Set();
  return out.filter(h=>{const k=String(h.key||'');if(!k||seen.has(k))return false;seen.add(k);return true}).map(h=>{
   const clean=String(h.name||'').replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE|Holdings?|Group)\.?$/i,'').trim();
   return{...h,clean,re:clean.length>=4?new RegExp('(^|[^\\p{L}])'+clean.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^\\p{L}]|$)','iu'):null};
  });
 }
 function citedStocks(item,hs){
  const list=(item.stocks||[]).map(s=>{const h=hs.find(x=>x.key===s.key);return{...s,held:h?h.held:!!s.held,preferTr:h?h.preferTr:false}});
  for(const h of hs){if(list.some(s=>s.key===h.key))continue;if(h.re&&h.re.test(item.title))list.push(h)}
  return list.slice(0,3);
 }
 function ago(iso){
  const t=Date.parse(iso);if(!Number.isFinite(t))return'';
  const m=Math.max(0,Math.round((Date.now()-t)/60000));
  if(m<60)return'hace '+Math.max(1,m)+' min';
  const h=Math.round(m/60);if(h<24)return'hace '+h+' h';
  return new Date(t).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
 }
 function stockChip(s){
  const stock=typeof stockByKey==='function'?stockByKey(s.key):null;
  let ch=null;
  try{if(stock){const q=canonicalQuote(stock,!!s.preferTr)||{};ch=s.preferTr?Number(q.change):marketChange(stock,currentMarketSession(),false);if(!Number.isFinite(ch))ch=null}}catch(_){}
  const cls=ch===null?'flat':ch>0?'up':ch<0?'down':'flat';
  const label=String(s.ticker||s.clean||s.name||'').slice(0,12);
  return '<button type="button" class="news-stock d-chip '+cls+'" data-open-stock="'+esc(s.key)+'" data-stock-prefer-tr="'+(s.preferTr?'1':'0')+'">'+esc(label)+(ch===null?'':' '+(ch>0?'▲':ch<0?'▼':'')+' '+Math.abs(ch).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' %')+'</button>';
 }
 function rowHtml(item,hs){
  const cited=citedStocks(item,hs),mine=cited.some(s=>s.held);
  const lead=cited[0]?String(cited[0].ticker||cited[0].clean||'').slice(0,5):'';
  return '<li class="news-row'+(mine?' is-mine':'')+'">'+
   '<a class="news-main" href="'+esc(item.url)+'" target="_blank" rel="noopener noreferrer">'+
    '<span class="news-tile" data-topic="'+esc(item.topic||'')+'" aria-hidden="true">'+(lead?esc(lead):TOPIC_ICON[item.topic]||'✦')+'</span>'+
    '<span class="news-text"><small>'+esc([item.publisher,ago(item.time)].filter(Boolean).join(' · '))+'</small><b data-i18n-content>'+esc(item.title)+'</b></span>'+
   '</a>'+
   (cited.length||mine?'<div class="news-meta">'+cited.map(stockChip).join('')+(mine?'<span class="news-mine">✦ En tu cartera</span>':'')+'</div>':'')+
  '</li>';
 }
 function listHtml(cat,limit){
  const d=S.data[cat],hs=holdings();
  if(!d&&S.loading[cat])return'<div class="today-loading">Cargando noticias…</div>';
  if(!d&&S.error[cat])return'<p class="tax-warn">'+esc(S.error[cat])+' <button type="button" class="btn small ghost" data-news-retry>↻ Reintentar</button></p>';
  if(!d)return'';
  const items=limit?d.items.slice(0,limit):d.items;
  if(!items.length)return'<div class="today-empty">'+(cat==='mine'?'Sin noticias recientes de tus valores. Añade posiciones o favoritos para seguirlos aquí.':'Sin noticias ahora mismo.')+'</div>';
  return '<ul class="news-list">'+items.map(i=>rowHtml(i,hs)).join('')+'</ul>';
 }
 function headHtml(){
  const d=S.data[S.cat];if(!d||!d.items.length)return'';
  const hs=holdings(),mine=d.items.filter(i=>citedStocks(i,hs).some(s=>s.held));
  const top=(mine.length?mine:d.items).slice(0,5).map((i,n)=>(n+1)+') '+i.title).join(' ');
  const question=('Resume estas noticias y dime si afectan a mi cartera y cómo: '+top).slice(0,1100);
  const title=mine.length?(mine.length===1?'1 noticia cita tus valores':mine.length+' noticias citan tus valores'):'Ninguna noticia cita tus valores';
  const preview=mine.length?mine.slice(0,2).map(i=>i.title).join(' · '):'Toca para que la IA te resuma lo importante de hoy.';
  const body='<div class="d-reading"><p><span aria-hidden="true">✦</span> '+esc(preview)+'</p><div class="ai-chips"><button type="button" data-ai-ask-q="'+esc(question)+'">¿Cómo me afectan?</button><button type="button" data-ai-ask-q="Resúmeme en tres puntos las noticias de mercado más importantes de hoy.">Resúmeme el día</button></div></div>';
  const F=window.ViewInvAIFold;
  return '<section class="d-pulse news-head"><small>Para tu cartera</small><h2>'+esc(title)+'</h2>'+(typeof F==='function'?F('news-ai','Lectura AI',preview,body):body)+'</section>';
 }
 function render(){
  const box=document.getElementById('newsResults');if(!box)return;
  if(!signedIn()){
   box.innerHTML='<section class="tax-card today-signin"><div><small>NOTICIAS</small><strong>Inicia sesión para ver tus noticias</strong><span>Las de tus valores, el mercado, la macro y las cripto, en español.</span></div><button type="button" class="btn portfolio-google-login">Entrar con Google</button></section>';
   return;
  }
  load(S.cat);
  const tabs='<div class="d-pills news-tabs" role="tablist" aria-label="Categorías de noticias">'+CATS.map(([k,l])=>'<button type="button" role="tab" class="'+(k===S.cat?'active':'')+'" data-news-cat="'+k+'" aria-selected="'+(k===S.cat)+'">'+l+'</button>').join('')+'</div>';
  const d=S.data[S.cat];
  box.innerHTML=tabs+headHtml()+listHtml(S.cat)+(d?'<p class="tax-hint news-foot">Google News y Bing News · actualizado '+esc(new Date(d.at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}))+'. Abre cada noticia en su medio.</p>':'');
 }
 // Bloque compacto para Mi día: las 3 últimas de tus valores.
 function miniHtml(){
  if(!signedIn())return'';
  load('mine');
  const d=S.data.mine;if(!d||!d.items.length)return'';
  return '<section class="d-group"><header><h3>Noticias de lo tuyo</h3><button type="button" class="d-more-link" data-news-open="mine" aria-label="Abrir Noticias">›</button></header>'+listHtml('mine',3)+'</section>';
 }
 document.addEventListener('click',e=>{
  const c=e.target.closest&&e.target.closest('[data-news-cat]');
  if(c){S.cat=c.dataset.newsCat;try{localStorage.setItem('viewinvai:news-cat',S.cat)}catch(_){}render();return}
  if(e.target.closest&&e.target.closest('[data-news-retry]')){load(S.cat,true);return}
  const o=e.target.closest&&e.target.closest('[data-news-open]');
  if(o){S.cat=o.dataset.newsOpen;if(typeof show==='function')show('news');return}
 });
 window.addEventListener('viewinvai:view-changed',e=>{if(e.detail&&e.detail.view==='news')render()});
 ['viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>{S.data={};if(isActive())setTimeout(render,300)}));
 window.ViewInvAINews={render,load,miniHtml};
})();
