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
 // Un valor solo se marca si el titular o el extracto lo nombran de verdad (nombre o ticker escrito
 // como ticker), y «en tu cartera» solo si hay una posición abierta ahora mismo. Nunca se fía de la
 // búsqueda: Google devuelve también noticias de competidoras.
 const fold=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function mentions(text,name,ticker){
  const t=' '+fold(text)+' ',n=fold(String(name||'').replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE|Holdings?|Group)\.?$/i,'')).trim();
  // Nombre de una sola palabra: solo cuenta con mayúscula inicial (en estonio «taskus» es «en el bolsillo», no TaskUs).
  if(n.length>=3){const re=new RegExp('[^\\p{L}\\p{N}]('+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')[^\\p{L}\\p{N}]','giu');
   const orig=' '+String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')+' ';
   if(/\s/.test(n)?re.test(t):[...orig.matchAll(re)].some(m=>/^\p{Lu}/u.test(m[1])))return true}
  const tk=String(ticker||'').toUpperCase();
  return tk.length>=2&&new RegExp('(\\('+tk.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\)|:'+tk.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b)').test(String(text||''));
 }
 // Índice del catálogo para encontrar todas las empresas que nombra una noticia, no solo las tuyas.
 const SUFFIX=/(,?\s+(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|s\.?a|n\.?v|ag|se|asa|holdings?|group|class [ab]|adr|ads|ordinary shares|common stock)\.?)+$/i;
 const COMMON=new Set(['the','energy','power','global','first','general','united','american','national','international','bank','capital','group','technologies','solutions','systems','pharma','therapeutics','gold','silver','oil','gas','health','care','digital','data','cloud','china','europe','target','block','shell','visa','gap','meta','box','match','snap','square','lucid','sea','ring','compass','genius','trade','republic','federal','reserve','bitcoin','ethereum','market','stock','stocks','index','fund','funds','growth','value','energy','action','actions','cours','bourse','acciones','mercado','precio','oferta','alpha','beta','delta','nova','core','prime','pure','next','open','real','north','south','west','east','smart','life','home','free','best','well','clear','bright','vital','mobile','media','news','network','green']);
 const US_EX=/^(NASDAQ|NYSE|AMEX|NYSE ARCA|BATS)$/i;
 let idx=null;
 function catalogIndex(){
  const all=(typeof db!=='undefined'&&db&&db.stocks)||[];
  if(idx&&idx.n===all.length)return idx;
  const multi=new Map(),single=new Map(),tick=new Map();
  const better=(a,b)=>!a||(!US_EX.test(String(a.exchange||''))&&US_EX.test(String(b.exchange||'')));
  for(const st of all){
   if(!st||!st.name)continue;
   let clean=String(st.name).replace(/\s*\(the\)$/i,'').replace(/^the\s+/i,'').replace(SUFFIX,'').replace(/\.com$/i,'').replace(/[,.]+$/,'').trim();
   if(clean.length<3)continue;
   const words=clean.split(/\s+/);
   if(words.length>=2){const k=fold(clean);if(better(multi.get(k),st))multi.set(k,st)}
   // Un nombre de una sola palabra puede ser una palabra corriente («Action», «Target»): solo cuenta si la
   // empresa es grande (≥ 2.000 M de capitalización), así se descartan homónimos pequeños de otros países.
   else if(clean.length>=4&&!COMMON.has(clean.toLowerCase())&&Number(st.marketCap)>=2e9){if(better(single.get(clean),st))single.set(clean,st)}
   // Marcas con mayúscula interna (FuelCell, PayPal): la primera palabra basta.
   if(words.length>=2&&/^[A-Z][a-z]+[A-Z][A-Za-z]+$/.test(words[0])&&!single.has(words[0]))single.set(words[0],st);
   if(US_EX.test(String(st.exchange||''))&&st.ticker)tick.set(String(st.ticker).toUpperCase(),st);
  }
  idx={n:all.length,multi,single,tick};
  return idx;
 }
 function catalogMentions(text){
  const I=catalogIndex(),found=[];
  const add=st=>{if(st&&!found.includes(st))found.push(st)};
  const words=String(text||'').split(/[^\p{L}\p{N}&'’-]+/u).filter(Boolean);
  for(let i=0;i<words.length;i++){
   for(let n=4;n>=2;n--){if(i+n>words.length)continue;const st=I.multi.get(fold(words.slice(i,i+n).join(' ')));if(st){add(st);break}}
   const w=words[i].replace(/['’]s$/,'');const st=I.single.get(w);if(st)add(st);
  }
  for(const m of String(text||'').matchAll(/(?:\(|\b(?:NASDAQ|NYSE|AMEX)\s*:\s*)([A-Z]{1,5})\)?/g))add(I.tick.get(m[1]));
  return found;
 }
 function citedStocks(item,hs){
  const text=item.title+' '+(item.snippet||''),list=[];
  for(const s of item.stocks||[]){
   const h=hs.find(x=>x.key===s.key),st=typeof stockByKey==='function'?stockByKey(s.key):null;
   const names=[s.name,h&&h.name,st&&st.name].filter(Boolean),tickers=[s.ticker,st&&st.ticker,st&&st.trTicker].filter(Boolean);
   if(!names.some(n=>mentions(text,n,''))&&!tickers.some(t=>mentions(text,'',t)))continue;
   list.push({...s,held:!!(h&&h.held),preferTr:h?h.preferTr:false});
  }
  for(const h of hs){if(list.some(s=>s.key===h.key))continue;if(mentions(text,h.name,h.ticker))list.push(h)}
  // El resto de empresas que nombra la noticia (catálogo completo); si una es tuya, va con tu mercado.
  for(const st of catalogMentions(text)){
   const key=typeof stockKey==='function'?stockKey(st):'';if(!key)continue;
   const name=fold(String(st.name||'').replace(SUFFIX,''));
   if(list.some(x=>x.key===key||fold(String(x.name||'').replace(SUFFIX,''))===name))continue;
   const h=hs.find(x=>fold(String(x.name||'').replace(SUFFIX,''))===name);
   list.push(h?{...h}:{key,ticker:st.ticker,name:st.name,held:false,preferTr:false});
  }
  // Primero lo que tienes, después favoritos y el resto en el orden en que aparecen.
  return list.sort((a,b)=>(b.held?2:hs.some(h=>h.key===b.key)?1:0)-(a.held?2:hs.some(h=>h.key===a.key)?1:0)).slice(0,6);
 }
 // Icono de la noticia: tu valor si la noticia lo cita; si no, el primero que nombra el titular
 // (nunca un favorito que solo sale de pasada en el extracto).
 function leadTicker(item,cited){
  const held=cited.find(s=>s.held);if(held)return String(held.ticker||held.clean||'').slice(0,5);
  let best=null,at=Infinity;const title=String(item.title||''),ft=fold(title);
  for(const s of cited){
   const st=typeof stockByKey==='function'?stockByKey(s.key):null;
   const names=[s.name,st&&st.name].filter(Boolean).map(n=>fold(String(n).replace(SUFFIX,'')).trim()).filter(n=>n.length>=3);
   let i=Math.min(...names.map(n=>{const k=ft.indexOf(n);return k<0?Infinity:k}),Infinity);
   const tk=String(s.ticker||'');if(tk){const k=title.indexOf(tk);if(k>=0&&k<i)i=k}
   if(i<at){at=i;best=s}
  }
  return best?String(best.ticker||best.clean||'').slice(0,5):'';
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
  try{if(stock){const q=canonicalQuote(stock,!!s.preferTr)||{};ch=s.preferTr?Number(q.change):marketChange(stock,currentMarketSession(),false);if(!Number.isFinite(ch))ch=Number(stock.changePct);if(!Number.isFinite(ch))ch=null}}catch(_){}
  const cls=ch===null?'flat':ch>0?'up':ch<0?'down':'flat';
  const label=String(s.ticker||s.clean||s.name||'').slice(0,12);
  return '<button type="button" class="news-stock d-chip '+cls+'" data-open-stock="'+esc(s.key)+'" data-stock-prefer-tr="'+(s.preferTr?'1':'0')+'">'+esc(label)+(ch===null?'':' '+(ch>0?'▲':ch<0?'▼':'')+' '+Math.abs(ch).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' %')+'</button>';
 }
 function rowHtml(item,hs,cat,i){
  const cited=citedStocks(item,hs),mine=cited.some(s=>s.held);
  const lead=leadTicker(item,cited);
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
  const title=mine.length?(mine.length===1?'1 noticia cita tus valores':mine.length+' noticias citan tus valores'):'Ninguna noticia cita tus valores';
  // Lectura: qué valores tuyos salen y cuántas veces (sin repetir titulares).
  const count=new Map();
  for(const it of mine)for(const s of citedStocks(it,hs).filter(x=>x.held)){const k=s.name||s.ticker;count.set(k,(count.get(k)||0)+1)}
  const names=[...count].map(([n,c])=>String(n).replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE)\.?$/i,'')+(c>1?' ('+c+')':''));
  const preview=mine.length?'De tu cartera: '+names.join(', ')+'. Pregunta a la IA qué significa para ti.':'Hoy ninguna noticia nombra tus valores. Pide a la IA el resumen del mercado.';
  const body='<div class="d-reading"><p><span aria-hidden="true">✦</span> '+esc(preview)+'</p><div class="ai-chips">'+(mine.length?'<button type="button" data-news-ask="mine">¿Cómo me afectan?</button>':'')+'<button type="button" data-news-ask="day">Resúmeme el día</button></div></div>';
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
  box.innerHTML=tabs+headHtml()+listHtml(S.cat)+(d?'<p class="tax-hint news-foot">Google News y Bing News · actualizado '+esc(new Date(d.at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}))+'. Toca una noticia para leerla traducida y con la lectura de la IA.</p>':'');
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
  const ai=reader.loading?'<p class="ai-brief-muted">Analizando la noticia…</p>':reader.ai?(reader.ai.error?'<p class="ai-brief-muted">'+esc(reader.ai.error)+'</p>':'<p>'+esc(reader.ai.answer)+'</p>'+(reader.ai.keyPoints&&reader.ai.keyPoints.length?'<ul>'+reader.ai.keyPoints.map(k=>'<li>'+esc(k)+'</li>').join('')+'</ul>':'')+(typeof window.ViewInvAIVerifyHtml==='function'?window.ViewInvAIVerifyHtml(reader.ai.verification):'')):'<button type="button" class="btn small" data-news-ai>✦ ¿Qué significa para mi cartera?</button>';
  el.innerHTML='<div class="ai-ask-handle" aria-hidden="true"></div>'+
   '<header class="news-reader-head"><small>'+esc([srcName(it),ago(it.time)].filter(Boolean).join(' · '))+'</small><button type="button" data-news-close aria-label="Cerrar">×</button></header>'+
   '<div class="news-reader-body">'+
    // Titular: el que escribe la IA en español al leer la noticia; mientras, el del medio traducido.
    (fullOk()&&reader.full.title?'<h2>'+esc(reader.full.title)+'</h2>':'<h2 data-i18n-content>'+esc(it.title)+'</h2>')+
    (cited.length?'<div class="news-meta">'+cited.map(stockChip).join('')+(mine?'<span class="news-mine">✦ En tu cartera</span>':'')+'</div>':'')+
    fullHtml(it)+
    '<section class="news-reader-ai"><div class="ai-brief-head"><span>✦ Lectura AI</span></div>'+ai+'</section>'+
    // Al final, la noticia real: medio, titular original y enlace.
    '<section class="news-reader-origin"><small>NOTICIA ORIGINAL</small><b translate="no" data-no-i18n>'+esc(it.title)+'</b><span>'+esc([srcName(it),it.time?new Date(it.time).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''].filter(Boolean).join(' · '))+'</span></section>'+
    '<a class="btn news-reader-source" href="'+esc(it.url)+'" target="_blank" rel="noopener noreferrer">Leer la noticia original en '+esc(srcName(it)||'el medio')+' ↗</a>'+
    '<p class="ai-ask-note">'+(fullOk()?(reader.full.basis==='snippet'?'Resumen hecho por IA con el titular y el extracto del medio (no deja leer el artículo entero)':'Resumen hecho por IA con el artículo completo del medio'):'Titular y extracto del medio traducidos')+': no es asesoramiento financiero.</p>'+
   '</div>';
 }
 // La noticia la cuenta la IA en español leyendo el medio (el artículo entero si se deja; si no, el titular y el
 // extracto), en vez de traducirla tal cual: las traducciones literales salían cortadas y con cifras mal leídas.
 // Si la IA no puede, se enseña el extracto traducido y se dice.
 const fullOk=()=>!!(reader.full&&reader.full.ok);
 const srcName=it=>{const f=reader.item===it&&fullOk()?reader.full.source:'';const p=String(it.publisher||'');return f&&f.toLowerCase()!==p.toLowerCase()&&!/^[\x00-\x7f\u00c0-\u024f\s.&'-]+$/.test(p)?f+' ('+p+')':p||f};
 function fullHtml(it){
  const f=reader.full;
  if(f&&f.ok)return '<div class="news-reader-full"><small class="news-full-tag">✦ '+(f.basis==='snippet'?'Resumen IA del extracto':'Resumen IA de la noticia')+(f.verified?' · cifras comprobadas':'')+'</small><p>'+esc(f.summary)+'</p>'+
   (f.keyFacts&&f.keyFacts.length?'<ul>'+f.keyFacts.map(k=>'<li>'+esc(k)+'</li>').join('')+'</ul>':'')+
   (f.verified===false?'<p class="ai-brief-muted">⚠ Algunas cifras no se han podido contrastar con la noticia: '+esc((f.unverified||[]).join(', '))+'.</p>':'')+'</div>';
  if(reader.fullLoading||!f)return '<p class="ai-brief-muted news-reader-reading">✦ Leyendo la noticia y preparando el resumen en español…</p>';
  const snip=it.snippet?'<p class="news-reader-snippet" data-i18n-content>'+esc(it.snippet)+'</p>':'';
  return snip+'<p class="ai-brief-muted">'+esc(f.reason||'No se ha podido resumir la noticia.')+(f.retry?' <button type="button" class="d-chip" data-news-full-retry>Reintentar</button>':'')+'</p>';
 }
 async function loadFull(it){
  const A=auth();
  if(!it.url||!A||typeof A.apiFetch!=='function'){reader.full={ok:false,reason:'Inicia sesión para leer el resumen.'};return}
  reader.fullLoading=true;paintReader();
  // Como mucho 50 s esperando: si el medio o la IA tardan más, se dice y se puede reintentar.
  const slow=new Promise((_,no)=>setTimeout(()=>no(new Error('slow')),50000));
  try{const r=await Promise.race([A.apiFetch('/api/ai/article',{method:'POST',body:JSON.stringify({url:it.url,title:it.title,snippet:it.snippet||'',publisher:it.publisher})}),slow]);
   const d=await Promise.race([r.json().catch(()=>({})),slow]);if(reader.item===it)reader.full=r.ok?d:{ok:false,reason:d.error||'',retry:true}}
  catch(e){if(reader.item===it)reader.full={ok:false,retry:true,reason:e&&e.message==='slow'?'La noticia está tardando demasiado en leerse.':'No se ha podido leer la noticia ahora.'}}
  finally{if(reader.item===it){reader.fullLoading=false;paintReader()}}
 }
 function openReader(it){
  reader.item=it;reader.ai=null;reader.loading=false;reader.full=null;reader.fullLoading=false;loadFull(it);
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
  const q=('Explícame en español esta noticia y si afecta a mi cartera. Usa solo el titular y el texto que te doy; si no basta, dilo. Titular: «'+it.title+'».'+(reader.full&&reader.full.ok?(reader.full.basis==='snippet'?' Resumen del extracto del medio (no del artículo completo): «':' Resumen del artículo completo: «')+reader.full.summary+'».':it.snippet?' Extracto: «'+it.snippet+'».':'')+(cited?' Valores citados: '+cited+'.':'')+' Medio: '+(it.publisher||'—')+'.').slice(0,1150);
  try{
   const res=await auth().apiFetch('/api/ai/ask',{method:'POST',body:JSON.stringify({mode:'ask',question:q,view:'news',news:newsForAi([it]),focus:citedStocks(it,holdings()).map(s=>s.key).filter(Boolean).slice(0,4)})});
   const d=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(d.error||'La IA no está disponible ahora.');
   reader.ai={answer:d.answer||'Sin respuesta.',keyPoints:d.keyPoints||[],verification:d.verification};
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
  if(e.target.closest&&e.target.closest('[data-news-full-retry]')){const it=reader.item;if(it){reader.full=null;loadFull(it)}return}
  if(e.target.closest&&e.target.closest('#newsReader [data-open-stock]'))setTimeout(closeReader,0);
  if(e.target.closest&&e.target.closest('[data-news-ai]')){explain();return}
  const na=e.target.closest&&e.target.closest('[data-news-ask]');
  if(na&&window.ViewInvAIAsk){
   const d=S.data[S.cat];if(!d)return;
   const hs=holdings(),mine=d.items.filter(i=>citedStocks(i,hs).some(s=>s.held));
   if(na.dataset.newsAsk==='mine')window.ViewInvAIAsk.ask('¿Cómo afectan a mi cartera las noticias de hoy sobre mis valores?',{news:newsForAi(mine.slice(0,6))});
   else window.ViewInvAIAsk.ask('Resúmeme en tres puntos las noticias de mercado más importantes de hoy y si me afectan.',{news:newsForAi(d.items.slice(0,6))});
   return;
  }
  const c=e.target.closest&&e.target.closest('[data-news-cat]');
  if(c){S.cat=c.dataset.newsCat;try{localStorage.setItem('viewinvai:news-cat',S.cat)}catch(_){}render();return}
  if(e.target.closest&&e.target.closest('[data-news-retry]')){load(S.cat,true);return}
  const o=e.target.closest&&e.target.closest('[data-news-open]');
  if(o){S.cat=o.dataset.newsOpen;if(typeof show==='function')show('news');return}
 });
 window.addEventListener('viewinvai:view-changed',e=>{if(e.detail&&e.detail.view==='news')render()});
 ['viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>{S.data={};if(isActive())setTimeout(render,300)}));
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeReader()});
 // Para «Pregunta a AI»: valores que nombra el texto del usuario (nombre, «(TICK)» o un ticker de
 // EE. UU. escrito en mayúsculas, como «PLUG»), más los tuyos que cite por nombre.
 let firstIdx=null;
 function mentionKeys(text){
  const t=String(text||''),out=[];
  const add=k=>{if(k&&!out.includes(k))out.push(k)};
  // Tus valores también por su primera palabra («Spero», «TaskUs»): en una pregunta es lo habitual.
  const ft=' '+fold(t).replace(/[^\p{L}\p{N}]+/gu,' ')+' ';
  for(const h of holdings()){
   const w=fold(String(h.clean||'').split(/\s+/)[0]||'');
   if(mentions(t,h.name,h.ticker)||(h.ticker&&new RegExp('\\b'+String(h.ticker).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(t))||(w.length>=4&&!COMMON.has(w)&&ft.includes(' '+w+' ')))add(h.key);
  }
  for(const st of catalogMentions(t))add(typeof stockKey==='function'?stockKey(st):'');
  const I=catalogIndex(),SKIP=new Set(['IA','AI','ETF','EE','UU','TR','LSX','BCE','FED','IPC','PIB','PER','RSI','USD','EUR','OPA','DCA','TER','CEO','IRPF','UE','EEUU','S','A']);
  for(const m of t.matchAll(/\b[A-Z]{2,5}\b/g))if(!SKIP.has(m[0])&&I.tick.has(m[0]))add(stockKey(I.tick.get(m[0])));
  // Y empresas del catálogo por su primera palabra con mayúscula («Ballard», «Nvidia»), la de más capitalización.
  if(!firstIdx||firstIdx.n!==I.n){
   const m=new Map();
   for(const st of (typeof db!=='undefined'&&db.stocks)||[]){
    const w=String(st&&st.name||'').replace(/^the\s+/i,'').split(/\s+/)[0]||'';const k=fold(w);
    if(k.length<5||COMMON.has(k))continue;const cur=m.get(k);
    if(!cur||(Number(st.marketCap)||0)>(Number(cur.marketCap)||0))m.set(k,st);
   }
   firstIdx={n:I.n,m};
  }
  for(const w of t.match(/\b\p{Lu}[\p{L}\p{N}&-]{4,}/gu)||[]){const st=firstIdx.m.get(fold(w));if(st)add(stockKey(st))}
  return out.filter(Boolean).slice(0,4);
 }
 // Noticias tal cual las ve el usuario, para pasárselas a la IA.
 function newsForAi(list){
  const hs=holdings();
  return list.map(it=>({time:it.time,publisher:it.publisher,title:it.title,snippet:it.snippet||'',stocks:citedStocks(it,hs).map(s=>(s.ticker||s.name)+(s.held?' (en cartera)':''))}));
 }
 window.ViewInvAINews={mentionKeys,citedFor:(title,snippet)=>citedStocks({title,snippet},holdings()).map(x=>(x.ticker||x.name)+(x.held?'*':'')),render,load,miniHtml,closeReader,isReaderOpen:()=>!!document.querySelector('#newsReader.open')};
})();
