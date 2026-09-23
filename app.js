const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', KEY='catalystpulse:filters:v3', FAV_KEY='catalystpulse:favorites:v1', LEADERS_PIN_KEY='catalystpulse:leadersPinned:v1', UI_KEY='catalystpulse:ui:v1';
let db={stocks:[],events:[],meta:{}}, loading=false, lastDataStamp='';
const TR_LIVE_DIRECT='wss://api.traderepublic.com';
function trProxyUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live'}
let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),wanted:new Set(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0};
let usLive={busy:false,lastFetchAt:0};
let uiRestoredScroll=false;
let favorites=readFavorites();
let state={entryMarket:'tr',session:'auto',preset:'intraday',profileKey:null,profileReason:'',currentView:'entry',savedScrollY:0};
const V={entry:'01 Potencial de entrada',future:'02 Potencial futuro',calendar:'03 Calendario y noticias',catalog:'04 Catálogo Trade Republic',catalogUS:'05 Catálogo EEUU'};
const P={
 short:{minChange:1,maxChange:0,minRelVolume:1.2,minAdx:18,minRsi:38,maxRsi:72,minVolume:0,trend:false,illiquid:true,sort:'score'},
 medium:{minChange:0,maxChange:0,minRelVolume:1,minAdx:15,minRsi:35,maxRsi:78,minVolume:0,trend:true,illiquid:true,sort:'score'},
 broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'score'},
 intraday:{minChange:2,maxChange:0,minRelVolume:1.5,minAdx:20,minRsi:40,maxRsi:70,minVolume:0,trend:false,illiquid:true,sort:'score'},
 exploded:{minChange:20,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'change'},
 afterhours:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'afterhours'},
 strict:{minChange:1,maxChange:0,minRelVolume:1.3,minAdx:22,minRsi:42,maxRsi:68,minVolume:0,trend:true,illiquid:true,sort:'score'}
};
function restoreUiState(){
 try{
  let x=JSON.parse(localStorage.getItem(UI_KEY)||'{}');
  if(x&&V[x.view])state.currentView=x.view;
  if(x&&x.profileKey)state.profileKey=x.profileKey;
  if(x&&x.profileReason)state.profileReason=x.profileReason;
  state.savedScrollY=N(x&&x.scrollY)??0;
 }catch(_){}
 document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+state.currentView));
 document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',e=>{
 let b=e.target.closest&&e.target.closest('.fav-star');
 if(b){e.preventDefault();e.stopPropagation();toggleFavorite(b.dataset.favKey);return}
 let back=e.target.closest&&e.target.closest('[data-profile-back]');
 if(back){
  e.preventDefault();e.stopPropagation();state.profileKey=null;state.profileReason='';saveUiState();render();
  requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));return;
 }
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(row){
  if(e.target.closest&&e.target.closest('.external-links,.event-sources,.event-link,.catalog-col-filter'))return;
  e.preventDefault();e.stopPropagation();let s=stockByKey(row.dataset.stockKey);if(s)openStock(s,row.dataset.stockReason||'');
 }
});
document.addEventListener('keydown',e=>{
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(!row||!['Enter',' '].includes(e.key)||e.target.closest('.fav-star,.catalog-col-filter'))return;
 e.preventDefault();let s=stockByKey(row.dataset.stockKey);if(s)openStock(s,row.dataset.stockReason||'');
});
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry()});
function setPreset(value){
 state.preset=value;$('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;$$('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=preset(state.preset);
 if(state.preset==='afterhours'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 toUI(state.filters);lockAllCriteria();renderEntry();
}
$('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
$('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
$$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
$('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry()});
$('#resetFilters').addEventListener('click',()=>{state.filters=preset(state.preset);toUI(state.filters);lockAllCriteria();renderEntry()});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry();setTimeout(pollUsLive,0)}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));
let catalogSearchTimer=null;
$('#catalogSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,160)});
$('#catalogUSSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,160)});
['refreshEntry','refreshFuture'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));

let catalogFilterTimer=null;
document.addEventListener('input',e=>{
 let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
 let mode=f.dataset.mode,col=f.dataset.col;
 if(!catalogState[mode]||!col)return;
 catalogState[mode].filters[col]=f.value;
 clearTimeout(catalogFilterTimer);
 catalogFilterTimer=setTimeout(()=>{
  renderCatalogTable(mode);
  let next=document.querySelector('.catalog-col-filter[data-mode="'+mode+'"][data-col="'+col+'"]');
  if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}
 },160);
});
document.addEventListener('click',e=>{
 let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');
 if(reset){e.preventDefault();resetCatalogColumns(reset.dataset.catalogMode);return}
 let clear=e.target.closest&&e.target.closest('.catalog-clear-filters');
 if(clear){e.preventDefault();let mode=clear.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].filters={};renderCatalogTable(mode)}return}
 let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
 if(!th)return;
 let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];
 if(!st)return;
 if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}
 renderCatalogTable(mode);
});
let draggedCatalogCol=null;
document.addEventListener('dragstart',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
 draggedCatalogCol={mode:th.dataset.mode,id:th.dataset.catalogCol};th.classList.add('dragging');
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',th.dataset.catalogCol)}
});
document.addEventListener('dragend',()=>{
 document.querySelectorAll('.catalog-table th.dragging,.catalog-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedCatalogCol=null;
});
document.addEventListener('dragover',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');
 if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;
 e.preventDefault();th.classList.add('drag-over');
});
document.addEventListener('dragleave',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('drag-over')});
document.addEventListener('drop',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');
 if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;
 e.preventDefault();
 let mode=draggedCatalogCol.mode,order=[...catalogLoadOrder(mode)],from=order.indexOf(draggedCatalogCol.id),to=order.indexOf(th.dataset.catalogCol);
 if(from<0||to<0||from===to)return;
 order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveOrder(mode);renderCatalogTable(mode);
});

restoreUiState();
toUI(state.filters);
lockAllCriteria();
initLeadersDock();
initTrLive();
initUsLive();
clock();
window.addEventListener('scroll',queueUiSave,{passive:true});
window.addEventListener('beforeunload',saveUiState);
setInterval(clock,1000);
setInterval(()=>load(false),15000);
load(true);
