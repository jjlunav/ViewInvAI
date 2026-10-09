/* ViewInvAI · listas de favoritos con nombre («Biotech», «Dividendos»…).
 * Se guardan en las preferencias de la cuenta (scope favorite-lists), así que se
 * sincronizan entre dispositivos. Una lista agrupa favoritos ya guardados: acciones por
 * stock_key y fondos/ETF como FUND:<ISIN>. */
(function(){
 'use strict';
 const SCOPE='favorite-lists',ACTIVE_KEY='viewinvai:fav-list';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const prefs=()=>window.ViewInvAIUiPreferences;
 const P=()=>window.ViewInvAIPortfolios||{};
 let active='';try{active=localStorage.getItem(ACTIVE_KEY)||''}catch(_){}
 let loaded=false;
 function lists(){
  const v=prefs()?prefs().get(SCOPE,{lists:[]}):{lists:[]};
  const out=(Array.isArray(v.lists)?v.lists:[]).filter(l=>l&&l.id&&l.name).map(l=>({id:String(l.id),name:String(l.name).slice(0,40),keys:Array.isArray(l.keys)?l.keys.map(String):[]}));
  // Nombres puestos por el usuario: nunca se envían a traducir.
  try{window.ViewInvAII18n&&window.ViewInvAII18n.protect(out.map(l=>l.name))}catch(_){}
  return out;
 }
 function save(next){
  if(prefs())prefs().save(SCOPE,{lists:next});
  window.dispatchEvent(new CustomEvent('viewinvai:favorite-lists-changed'));
 }
 function setActive(id){active=id||'';try{localStorage.setItem(ACTIVE_KEY,active)}catch(_){}}
 function activeList(){const l=lists().find(x=>x.id===active);if(!l&&active)setActive('');return l||null}
 function ensureLoaded(){
  if(loaded||!prefs())return;loaded=true;
  prefs().load(SCOPE,{lists:[]}).then(()=>window.dispatchEvent(new CustomEvent('viewinvai:favorite-lists-changed'))).catch(()=>{});
 }
 // Items currently saved as favourites (what a list can contain).
 function favoriteItems(){
  const watch=(P().getWatchlist&&P().getWatchlist())||[];
  const stocks=watch.map(w=>{const s=window.ViewInvAI&&window.ViewInvAI.getStockByKey?window.ViewInvAI.getStockByKey(w.stock_key):null;return{key:String(w.stock_key),label:(s&&s.name)||w.name||w.ticker,sub:(Number(w.prefer_tr)===1?'TR · ':'')+(w.ticker||'')}});
  const funds=(window.ViewInvAIFunds&&window.ViewInvAIFunds.getFavoriteProducts?window.ViewInvAIFunds.getFavoriteProducts():[]).map(p=>({key:'FUND:'+p.isin,label:p.name||p.isin,sub:p.isin}));
  const seen=new Set();
  return stocks.concat(funds).filter(x=>!seen.has(x.key)&&seen.add(x.key));
 }
 function chipsHtml(){
  ensureLoaded();
  const all=lists(),cur=activeList(),fav=new Set(favoriteItems().map(x=>x.key));
  const chip=(id,label,n)=>'<button type="button" class="tab'+((cur?cur.id:'')===id?' active':'')+'" data-fav-list="'+esc(id)+'" aria-pressed="'+((cur?cur.id:'')===id)+'">'+esc(label)+(n!==null?' <b>'+n+'</b>':'')+'</button>';
  return '<div class="fav-lists" role="group" aria-label="Listas de favoritos"><span>Listas</span>'+
   chip('','Todas',null)+all.map(l=>chip(l.id,l.name,l.keys.filter(k=>fav.has(k)).length)).join('')+
   (cur?'<button type="button" class="tab fav-list-edit" data-fav-list-edit="'+esc(cur.id)+'" aria-label="Editar la lista '+esc(cur.name)+'">✎</button>':'')+
   '<button type="button" class="tab fav-list-new" data-fav-list-new>＋ Lista</button></div>';
 }
 // Filter for the dashboard: null = no list selected.
 function activeKeys(){const l=activeList();return l?new Set(l.keys):null}
 function editor(list){
  const items=favoriteItems(),inList=new Set(list?list.keys:[]);
  const rows=items.length?items.map(it=>'<label class="fav-list-item"><input type="checkbox" name="k" value="'+esc(it.key)+'"'+(inList.has(it.key)?' checked':'')+'><span><b>'+esc(it.label)+'</b><small>'+esc(it.sub)+'</small></span></label>').join(''):'<p class="tax-hint">Todavía no tienes favoritos: guarda valores con la estrella ☆ y luego agrúpalos aquí.</p>';
  const open=P().openModal;if(typeof open!=='function')return;
  open(list?'Lista · '+list.name:'Nueva lista',
   '<form class="fav-list-form" data-fav-list-form="'+esc(list?list.id:'')+'">'+
    '<label class="broker-import-field"><span>Nombre</span><input name="name" required maxlength="40" value="'+esc(list?list.name:'')+'" placeholder="Biotech, Dividendos, Para vigilar…"></label>'+
    '<div class="fav-list-items">'+rows+'</div>'+
    '<div class="fav-list-actions">'+(list?'<button type="button" class="btn ghost" data-fav-list-delete="'+esc(list.id)+'">Borrar lista</button>':'<span></span>')+'<button type="submit" class="btn">Guardar</button></div>'+
   '</form>');
 }
 document.addEventListener('click',e=>{
  const t=e.target;
  const pick=t.closest&&t.closest('[data-fav-list]');
  if(pick){setActive(pick.dataset.favList);window.dispatchEvent(new CustomEvent('viewinvai:favorite-lists-changed'));return}
  if(t.closest&&t.closest('[data-fav-list-new]')){editor(null);return}
  const ed=t.closest&&t.closest('[data-fav-list-edit]');
  if(ed){const l=lists().find(x=>x.id===ed.dataset.favListEdit);if(l)editor(l);return}
  const del=t.closest&&t.closest('[data-fav-list-delete]');
  if(del){
   const l=lists().find(x=>x.id===del.dataset.favListDelete);
   if(!l||!confirm('¿Borrar la lista «'+l.name+'»? Los favoritos no se borran.'))return;
   save(lists().filter(x=>x.id!==l.id));if(active===l.id)setActive('');
   P().closeModal&&P().closeModal();
  }
 });
 document.addEventListener('submit',e=>{
  const f=e.target.closest&&e.target.closest('[data-fav-list-form]');if(!f)return;
  e.preventDefault();
  const name=String(new FormData(f).get('name')||'').trim().slice(0,40);if(!name)return;
  const keys=[...f.querySelectorAll('input[name=k]:checked')].map(i=>i.value);
  const all=lists(),id=f.dataset.favListForm;
  if(id){const l=all.find(x=>x.id===id);if(l){l.name=name;l.keys=keys}}
  else{const nid='l'+Date.now().toString(36);all.push({id:nid,name,keys});setActive(nid)}
  save(all.slice(0,20));
  P().closeModal&&P().closeModal();
 });
 window.addEventListener('viewinvai:ui-preferences',e=>{if(e.detail&&e.detail.scope===SCOPE)window.dispatchEvent(new CustomEvent('viewinvai:favorite-lists-changed'))});
 window.ViewInvAIFavLists={chipsHtml,activeKeys,lists};
})();
