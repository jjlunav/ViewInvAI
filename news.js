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
 function rowHtml(item,hs,cat,i){
  const cited=citedStocks(item,hs),mine=cited.some(s=>s.held);
  const lead=cited[0]?String(cited[0].ticker||cited[0].clean||'').slice(0,5):'';
  return '<li class="news-row'+(mine?' is-mine':'')+'">'+
   '<button type="button" class="news-main" data-news-read="'+esc(cat)+'|'+i+'" aria-label="Leer en la app: '+esc(item.title)+'">'+
    '<span class="news-tile" data-topic="'+esc(item.topic||'')+'" aria-hidden="true">'+(lead?esc(lead):TOPIC_ICON[item.topic]||'✦')+'</span>'+
    '<span class="news-text"><small>'+esc([item.publisher,ago(item.time)].filter(Boolean).join(' · '))+'</small><b data-i18n-content>'+esc(item.title)+'</b></span>'+
   '</button>'+
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
  return '<ul class="news-list">'+items.map((it,i)=>rowHtml(it,hs,cat,i)).join('')+'</ul>';
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
 // Lector dentro de la app: titular y extracto del medio traducidos (data-i18n-content), los valores
 // citados y la lectura de la IA. El artículo completo sigue en su medio (tiene derechos de autor).
 const reader={item:null,ai:null,loading:false};
 function readerEl(){
  let el=document.getElementById('newsReader');if(el)return el;
  const bd=document.createElement('div');bd.id='newsReaderBackdrop';bd.className='ai-ask-backdrop';
  el=document.createElement('section');el.id='newsReader';el.className='ai-ask-sheet news-reader';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Noticia');el.setAttribute('aria-hidden','true');
  document.body.append(bd,el);bd.addEventListener('click',()=>closeReader());
  return el;
 }
 function paintReader(){
  const it=reader.item,el=readerEl();if(!it)return;
  const cited=citedStocks(it,holdings()),mine=cited.some(s=>s.held);
  const ai=reader.loading?'<p class="ai-brief-muted">Analizando la noticia…</p>':reader.ai?(reader.ai.error?'<p class="ai-brief-muted">'+esc(reader.ai.error)+'</p>':'<p>'+esc(reader.ai.answer)+'</p>'+(reader.ai.keyPoints&&reader.ai.keyPoints.length?'<ul>'+reader.ai.keyPoints.map(k=>'<li>'+esc(k)+'</li>').join('')+'</ul>':'')):'<button type="button" class="btn small" data-news-ai>✦ ¿Qué significa para mi cartera?</button>';
  el.innerHTML='<div class="ai-ask-handle" aria-hidden="true"></div>'+
   '<header class="news-reader-head"><small>'+esc([it.publisher,ago(it.time)].filter(Boolean).join(' · '))+'</small><button type="button" data-news-close aria-label="Cerrar">×</button></header>'+
   '<div class="news-reader-body">'+
    '<h2 data-i18n-content>'+esc(it.title)+'</h2>'+
    (cited.length?'<div class="news-meta">'+cited.map(stockChip).join('')+(mine?'<span class="news-mine">✦ En tu cartera</span>':'')+'</div>':'')+
    (it.snippet?'<p class="news-reader-snippet" data-i18n-content>'+esc(it.snippet)+'</p>':'<p class="news-reader-snippet muted">El medio no publica extracto: abajo tienes la lectura de la IA y el enlace al artículo completo.</p>')+
    '<section class="news-reader-ai"><div class="ai-brief-head"><span>✦ Lectura AI</span></div>'+ai+'</section>'+
    '<a class="btn news-reader-source" href="'+esc(it.url)+'" target="_blank" rel="noopener noreferrer">Leer el artículo completo en '+esc(it.publisher||'el medio')+' ↗</a>'+
    '<p class="ai-ask-note">Resumen orientativo con el titular y el extracto: no es asesoramiento financiero.</p>'+
   '</div>';
 }
 function openReader(it){
  reader.item=it;reader.ai=null;reader.loading=false;
  const el=readerEl();paintReader();
  el.classList.add('open');el.setAttribute('aria-hidden','false');document.getElementById('newsReaderBackdrop').classList.add('open');
  document.body.classList.add('ai-ask-open');
 }
 function closeReader(){
  const el=document.getElementById('newsReader');if(!el)return;
  el.classList.remove('open');el.setAttribute('aria-hidden','true');
  const bd=document.getElementById('newsReaderBackdrop');if(bd)bd.classList.remove('open');
  document.body.classList.remove('ai-ask-open');
 }
 async function explain(){
  const it=reader.item;if(!it||reader.loading)return;
  reader.loading=true;paintReader();
  const cited=citedStocks(it,holdings()).map(s=>(s.ticker||s.clean)+(s.held?' (en cartera)':'')).join(', ');
  const q=('Explícame en español esta noticia y si afecta a mi cartera. Usa solo el titular y el extracto; si no basta, dilo. Titular: «'+it.title+'».'+(it.snippet?' Extracto: «'+it.snippet+'».':'')+(cited?' Valores citados: '+cited+'.':'')+' Medio: '+(it.publisher||'—')+'.').slice(0,1150);
  try{
   const res=await auth().apiFetch('/api/ai/ask',{method:'POST',body:JSON.stringify({mode:'ask',question:q,view:'news'})});
   const d=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(d.error||'La IA no está disponible ahora.');
   reader.ai={answer:d.answer||'Sin respuesta.',keyPoints:d.keyPoints||[]};
  }catch(e){reader.ai={error:e.message||'La IA no está disponible ahora.'}}
  finally{reader.loading=false;if(reader.item===it)paintReader()}
 }
 // Bloque compacto para Mi día: las 3 últimas de tus valores.
 function miniHtml(){
  if(!signedIn())return'';
  load('mine');
  const d=S.data.mine;if(!d||!d.items.length)return'';
  return '<section class="d-group"><header><h3>Noticias de lo tuyo</h3><button type="button" class="d-more-link" data-news-open="mine" aria-label="Abrir Noticias">›</button></header>'+listHtml('mine',3)+'</section>';
 }
 document.addEventListener('click',e=>{
  const rd=e.target.closest&&e.target.closest('[data-news-read]');
  if(rd){const [cat,i]=rd.dataset.newsRead.split('|'),it=S.data[cat]&&S.data[cat].items[Number(i)];if(it){e.preventDefault();if(document.documentElement.dataset.design==='d')openReader(it);else window.open(it.url,'_blank','noopener')}return}
  if(e.target.closest&&e.target.closest('[data-news-close]')){closeReader();return}
  if(e.target.closest&&e.target.closest('#newsReader [data-open-stock]'))setTimeout(closeReader,0);
  if(e.target.closest&&e.target.closest('[data-news-ai]')){explain();return}
  const c=e.target.closest&&e.target.closest('[data-news-cat]');
  if(c){S.cat=c.dataset.newsCat;try{localStorage.setItem('viewinvai:news-cat',S.cat)}catch(_){}render();return}
  if(e.target.closest&&e.target.closest('[data-news-retry]')){load(S.cat,true);return}
  const o=e.target.closest&&e.target.closest('[data-news-open]');
  if(o){S.cat=o.dataset.newsOpen;if(typeof show==='function')show('news');return}
 });
 window.addEventListener('viewinvai:view-changed',e=>{if(e.detail&&e.detail.view==='news')render()});
 ['viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>{S.data={};if(isActive())setTimeout(render,300)}));
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeReader()});
 window.ViewInvAINews={render,load,miniHtml,closeReader,isReaderOpen:()=>!!document.querySelector('#newsReader.open')};
})();
