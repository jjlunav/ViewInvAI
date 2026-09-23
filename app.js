const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const STORAGE_DATA = 'entrypointtrade:data:v1';
const STORAGE_FILTERS = 'entrypointtrade:filters:v1';

const emptyData = { stocks: [], events: [], updatedAt: null };
let data = loadData();
let state = {
  view: 'entry',
  entryMarket: 'tr',
  radarMarket: 'tr',
  session: 'regular',
  filters: getPreset('intraday')
};

const viewNames = {
  entry: '01 Potencial de entrada', future: '02 Potencial futuro', radar: '03 Radar de acciones',
  calendar: '04 Calendario y noticias', catalog: '05 Catálogo Trade Republic', sources: '06 Fuentes y cobertura'
};

function loadData(){
  try { return JSON.parse(localStorage.getItem(STORAGE_DATA)) || structuredClone(emptyData); }
  catch { return structuredClone(emptyData); }
}
function saveData(){ localStorage.setItem(STORAGE_DATA, JSON.stringify(data)); }

function getPreset(name){
  const presets = {
    short:{minChange:1,maxChange:0,minRelVolume:1.2,minAdx:18,minRsi:38,maxRsi:70,explosionThreshold:25,minVolume:0,prioritizeCatalysts:true,adjustFromOpen:true,requireTrend:false,excludeIlliquid:true},
    medium:{minChange:0,maxChange:0,minRelVolume:1,minAdx:15,minRsi:35,maxRsi:75,explosionThreshold:30,minVolume:0,prioritizeCatalysts:true,adjustFromOpen:false,requireTrend:true,excludeIlliquid:true},
    broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,explosionThreshold:20,minVolume:0,prioritizeCatalysts:true,adjustFromOpen:false,requireTrend:false,excludeIlliquid:false},
    intraday:{minChange:2,maxChange:0,minRelVolume:1.5,minAdx:20,minRsi:40,maxRsi:65,explosionThreshold:20,minVolume:0,prioritizeCatalysts:true,adjustFromOpen:true,requireTrend:false,excludeIlliquid:true},
    exploded:{minChange:20,maxChange:0,minRelVolume:2,minAdx:0,minRsi:0,maxRsi:100,explosionThreshold:20,minVolume:0,prioritizeCatalysts:true,adjustFromOpen:true,requireTrend:false,excludeIlliquid:true},
    strict:{minChange:1,maxChange:0,minRelVolume:1.3,minAdx:22,minRsi:42,maxRsi:68,explosionThreshold:25,minVolume:0,prioritizeCatalysts:true,adjustFromOpen:true,requireTrend:true,excludeIlliquid:true}
  };
  if(name==='saved'){
    try{return JSON.parse(localStorage.getItem(STORAGE_FILTERS)) || presets.intraday;}catch{return presets.intraday;}
  }
  return structuredClone(presets[name] || presets.intraday);
}

function showView(name){
  state.view = name;
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  $('#breadcrumbView').textContent = viewNames[name];
  $('#sidebar').classList.remove('open');
  renderAll();
}

function updateNyTime(){
  const parts = new Intl.DateTimeFormat('es-ES',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  $('#nyTime').textContent = `${parts} · Nueva York`;
}
setInterval(updateNyTime, 30000); updateNyTime();

function fmtNum(n, digits=2){ return Number.isFinite(Number(n)) ? Number(n).toLocaleString('es-ES',{maximumFractionDigits:digits}) : '—'; }
function fmtPrice(n){ return Number.isFinite(Number(n)) ? `${Number(n).toLocaleString('es-ES',{maximumFractionDigits:6})}` : '—'; }
function fmtPct(n){ return Number.isFinite(Number(n)) ? `${Number(n)>=0?'+':''}${fmtNum(n,2)}%` : '—'; }
function safe(s){ return String(s ?? '').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function currentFiltersFromUi(){
  return {
    minChange:+$('#minChange').value||0,maxChange:+$('#maxChange').value||0,minRelVolume:+$('#minRelVolume').value||0,
    minAdx:+$('#minAdx').value||0,minRsi:+$('#minRsi').value||0,maxRsi:+$('#maxRsi').value||100,
    explosionThreshold:+$('#explosionThreshold').value||0,minVolume:+$('#minVolume').value||0,
    prioritizeCatalysts:$('#prioritizeCatalysts').checked,adjustFromOpen:$('#adjustFromOpen').checked,
    requireTrend:$('#requireTrend').checked,excludeIlliquid:$('#excludeIlliquid').checked
  };
}
function filtersToUi(f){
  for(const k of ['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','explosionThreshold','minVolume']) $(`#${k}`).value=f[k];
  for(const k of ['prioritizeCatalysts','adjustFromOpen','requireTrend','excludeIlliquid']) $(`#${k}`).checked=!!f[k];
}

function normalizeStock(s){
  return {
    ticker:String(s.ticker||'').toUpperCase(), name:s.name||'', isin:s.isin||'', market:s.market||'',
    tradeRepublicVerified:!!s.tradeRepublicVerified, price:Number(s.price), session:s.session||'regular',
    changePct:Number(s.changePct), volume:Number(s.volume), avgVolume:Number(s.avgVolume), relVolume:Number(s.relVolume),
    adx:Number(s.adx), rsi:Number(s.rsi), score:Number(s.score), trendOk:s.trendOk!==false,
    liquidityRisk:!!s.liquidityRisk, catalyst:s.catalyst||'', catalystConfirmed:!!s.catalystConfirmed,
    why:s.why||'', risk:s.risk||'', updatedAt:s.updatedAt||''
  };
}
function filteredStocks(){
  const f=state.filters;
  return data.stocks.map(normalizeStock).filter(s=>{
    if(state.entryMarket==='tr' && !s.tradeRepublicVerified) return false;
    if(state.entryMarket==='us' && s.market && !/NASDAQ|NYSE|AMEX|NYSE ARCA/i.test(s.market)) return false;
    if(state.session!=='previous' && s.session && s.session!==state.session) return false;
    // Deliberately no minimum-price condition anywhere in this function.
    if(Number.isFinite(s.changePct) && s.changePct < f.minChange) return false;
    if(f.maxChange>0 && Number.isFinite(s.changePct) && s.changePct > f.maxChange) return false;
    if(f.minRelVolume>0 && Number.isFinite(s.relVolume) && s.relVolume < f.minRelVolume) return false;
    if(f.minAdx>0 && Number.isFinite(s.adx) && s.adx < f.minAdx) return false;
    if(Number.isFinite(s.rsi) && (s.rsi < f.minRsi || s.rsi > f.maxRsi)) return false;
    if(f.minVolume>0 && Number.isFinite(s.volume) && s.volume < f.minVolume) return false;
    if(f.requireTrend && !s.trendOk) return false;
    if(f.excludeIlliquid && s.liquidityRisk) return false;
    return true;
  }).sort((a,b)=>(b.score||0)-(a.score||0));
}

function renderEntry(){
  const list=filteredStocks();
  const sessionNames={regular:'Sesión regular',premarket:'Premarket',previous:'Sesión anterior'};
  $('#entrySessionText').textContent=`${state.entryMarket==='tr'?'Trade Republic':'Resto del mercado · EEUU'} · ${sessionNames[state.session]}`;
  $('#entryCount').textContent=`${list.length} candidatas`;
  $('#analyzedCount').textContent=data.stocks.length;
  $('#pendingCount').textContent='0';
  const root=$('#entryResults');
  if(!list.length){root.innerHTML='<div class="empty-state">Sin candidatas con los datos actuales. Importa datos en <strong>Fuentes y cobertura</strong> o conecta una fuente real. El filtro de precio mínimo ya no existe.</div>';return;}
  root.innerHTML=list.map((s,i)=>`
    <article class="candidate-card">
      <div class="candidate-top"><div><div class="candidate-title"><span class="rank">${i+1}.</span><span class="ticker">${safe(s.ticker)}</span><span class="name">${safe(s.name)}</span></div><div class="event-meta">${safe(s.market)} ${s.tradeRepublicVerified?'<span class="pill ok">TR verificada</span>':''}</div></div><div class="score">${fmtNum(s.score,1)} pts</div></div>
      <div class="metrics">
        <div class="metric"><div class="k">Precio</div><div class="v">${fmtPrice(s.price)}</div></div>
        <div class="metric"><div class="k">Variación</div><div class="v ${s.changePct>=0?'pos':'neg'}">${fmtPct(s.changePct)}</div></div>
        <div class="metric"><div class="k">Volumen</div><div class="v">${fmtNum(s.volume,0)}</div></div>
        <div class="metric"><div class="k">Volumen rel.</div><div class="v">${fmtNum(s.relVolume,2)}x</div></div>
        <div class="metric"><div class="k">ADX</div><div class="v">${fmtNum(s.adx,1)}</div></div>
        <div class="metric"><div class="k">RSI</div><div class="v">${fmtNum(s.rsi,1)}</div></div>
      </div>
      <div class="why"><strong>Por qué aparece:</strong> ${safe(s.why || buildWhy(s))}${s.catalyst?`<br><strong>Catalizador:</strong> ${safe(s.catalyst)} ${s.catalystConfirmed?'(confirmado)':'(sin confirmar)'}`:''}${s.risk?`<br><strong>Riesgo:</strong> ${safe(s.risk)}`:''}</div>
    </article>`).join('');
}
function buildWhy(s){
  const bits=[]; if(Number.isFinite(s.changePct)) bits.push(`variación ${fmtPct(s.changePct)}`); if(Number.isFinite(s.relVolume)) bits.push(`volumen relativo ${fmtNum(s.relVolume,2)}x`); if(Number.isFinite(s.adx)) bits.push(`ADX ${fmtNum(s.adx,1)}`); if(Number.isFinite(s.rsi)) bits.push(`RSI ${fmtNum(s.rsi,1)}`); return bits.length?bits.join(' · '):'Cumple los filtros activos.';
}

function renderFuture(){
  const horizon=+$('#futureHorizon').value; const type=$('#futureType').value; const trOnly=$('#futureTrOnly').checked;
  const now=new Date(); const cutoff=new Date(now.getTime()+horizon*86400000);
  const list=(data.events||[]).filter(e=>{
    const d=new Date(e.date); if(isNaN(d)) return false; if(d<now||d>cutoff) return false;
    if(type!=='all' && e.type!==type) return false; if(trOnly && !e.tradeRepublicVerified) return false; return true;
  }).sort((a,b)=>(b.potentialScore||0)-(a.potentialScore||0));
  const root=$('#futureResults');
  if(!list.length){root.innerHTML='<div class="empty-state">No hay eventos próximos cargados con estos filtros. Importa un JSON con eventos fechados para alimentar esta sección.</div>';return;}
  root.innerHTML=list.map(e=>`
    <article class="future-card"><div class="event-line"><div><div class="candidate-title"><span class="ticker">${safe(e.ticker)}</span><span class="name">${safe(e.name||'')}</span></div><div class="event-meta">${new Date(e.date).toLocaleDateString('es-ES')} · ${safe(e.source||'Fuente no indicada')} ${e.tradeRepublicVerified?'<span class="pill ok">TR verificada</span>':''}</div></div><span class="event-badge">${safe(eventTypeName(e.type))}</span></div>
    <div class="metrics"><div class="metric"><div class="k">Potencial evento</div><div class="v">${fmtNum(e.potentialScore,1)}/100</div></div><div class="metric"><div class="k">Días</div><div class="v">${Math.ceil((new Date(e.date)-now)/86400000)}</div></div><div class="metric"><div class="k">Confirmación</div><div class="v">${e.confirmed?'Confirmado':'Pendiente'}</div></div></div>
    <div class="fact-hypothesis"><div><h4>Hecho comprobado</h4><p>${safe(e.fact||'Sin descripción.')}</p></div><div><h4>Hipótesis de impacto</h4><p>${safe(e.hypothesis||'Sin hipótesis.')}</p></div></div></article>`).join('');
}
function eventTypeName(t){return ({medical:'Médico / regulatorio',earnings:'Resultados',contract:'Contrato / adjudicación',corporate:'Operación corporativa',other:'Otro'})[t]||'Evento';}

function radarStocks(){
  return data.stocks.map(normalizeStock).filter(s=>state.radarMarket==='all'||(state.radarMarket==='tr'?s.tradeRepublicVerified:/NASDAQ|NYSE|AMEX|NYSE ARCA/i.test(s.market||'')));
}
function renderRadar(){
  const rows=radarStocks(); $('#radarBody').innerHTML=rows.length?rows.map(s=>`<tr><td><strong>${safe(s.ticker)}</strong></td><td>${safe(s.name)}</td><td>${fmtPrice(s.price)}</td><td>${safe(s.session)}</td><td class="${s.changePct>=0?'positive':'negative'}">${fmtPct(s.changePct)}</td><td>${fmtNum(s.relVolume,2)}x</td><td>${s.tradeRepublicVerified?'<span class="pill ok">Sí</span>':'<span class="muted">No verificada</span>'}</td></tr>`).join(''):'<tr><td colspan="7" class="muted">Sin datos cargados.</td></tr>';
}
function renderCalendar(){
  const list=[...(data.events||[])].sort((a,b)=>new Date(a.date)-new Date(b.date)); const root=$('#calendarResults');
  root.innerHTML=list.length?list.map(e=>`<article class="future-card"><div class="event-line"><div><strong>${safe(e.ticker)}</strong> · ${safe(e.name||'')}</div><span class="event-badge">${new Date(e.date).toLocaleDateString('es-ES')}</span></div><div class="why"><strong>${safe(eventTypeName(e.type))}:</strong> ${safe(e.fact||'')}</div></article>`).join(''):'<div class="empty-state">Sin eventos cargados.</div>';
}
function renderCatalog(){
  const q=$('#catalogSearch').value.trim().toLowerCase(); const list=data.stocks.map(normalizeStock).filter(s=>s.tradeRepublicVerified).filter(s=>!q||[s.ticker,s.name,s.isin].some(v=>String(v).toLowerCase().includes(q)));
  $('#catalogCount').textContent=`${list.length} valores`; $('#catalogBody').innerHTML=list.length?list.map(s=>`<tr><td><strong>${safe(s.ticker)}</strong></td><td>${safe(s.name)}</td><td>${safe(s.isin||'—')}</td><td>${safe(s.market||'—')}</td><td><span class="pill ok">Verificada</span></td></tr>`).join(''):'<tr><td colspan="5" class="muted">Sin valores verificados cargados.</td></tr>';
}
function renderSources(){ $('#sourceSummary').textContent=`${data.stocks.length} acciones · ${(data.events||[]).length} eventos cargados${data.updatedAt?` · actualizado ${new Date(data.updatedAt).toLocaleString('es-ES')}`:''}.`; $('#providerState').textContent=data.stocks.length||data.events.length?'Datos importados':'Datos locales'; }
function renderAll(){ renderEntry(); renderFuture(); renderRadar(); renderCalendar(); renderCatalog(); renderSources(); }

$$('.nav-item').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry();});
$('#toggleFilters').addEventListener('click',()=>$('#filterPanel').classList.toggle('collapsed'));
$('#presetSelect').addEventListener('change',e=>{state.filters=getPreset(e.target.value);filtersToUi(state.filters);});
$('#applyFilters').addEventListener('click',()=>{state.filters=currentFiltersFromUi();renderEntry();});
$('#resetFilters').addEventListener('click',()=>{state.filters=getPreset($('#presetSelect').value);filtersToUi(state.filters);renderEntry();});
$('#saveFilters').addEventListener('click',()=>{const f=currentFiltersFromUi(); localStorage.setItem(STORAGE_FILTERS,JSON.stringify(f)); state.filters=f; $('#presetSelect').value='saved'; alert('Criterio personalizado guardado en este navegador.');});

$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry();}));
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar();}));

['futureHorizon','futureType','futureTrOnly'].forEach(id=>$(`#${id}`).addEventListener('change',renderFuture));
$('#catalogSearch').addEventListener('input',renderCatalog);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$(`#${id}`).addEventListener('click',renderAll));

$('#jsonImport').addEventListener('change', async (e)=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const parsed=JSON.parse(await file.text());
    if(!Array.isArray(parsed.stocks) || !Array.isArray(parsed.events)) throw new Error('El JSON debe contener arrays stocks y events.');
    data={stocks:parsed.stocks,events:parsed.events,updatedAt:new Date().toISOString()}; saveData(); renderAll(); alert('Datos importados correctamente.');
  }catch(err){alert(`No se pudo importar: ${err.message}`);} finally{e.target.value='';}
});
$('#clearData').addEventListener('click',()=>{if(confirm('¿Vaciar todos los datos importados?')){data=structuredClone(emptyData);saveData();renderAll();}});

filtersToUi(state.filters); renderAll();
