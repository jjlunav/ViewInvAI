/* ViewInvAI · copia de seguridad.
 * Descargar: GET /api/backup + favoritos de este dispositivo → un JSON.
 * Restaurar: crea las carteras que falten (por nombre) e importa operaciones y dividendos
 * con su identificador original, así que restaurar dos veces no duplica nada. Recupera
 * favoritos, listas, avisos por valor y preferencias. Nunca incluye tokens. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const auth=()=>window.ViewInvAIAuth;
 const signedIn=()=>!!(auth()&&typeof auth().getUser==='function'&&auth().getUser());
 function status(html,error=false){const el=document.querySelector('[data-backup-status]');if(el){el.innerHTML=html;el.classList.toggle('error',!!error)}}
 async function api(path,opt){
  const res=await auth().apiFetch(path,opt);
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Error '+res.status);
  return data;
 }
 async function download(btn){
  if(!signedIn()){await auth()?.signIn?.();if(!signedIn())return}
  btn.disabled=true;status('Preparando la copia…');
  try{
   const data=await api('/api/backup');
   data.deviceFavorites=window.ViewInvAI&&window.ViewInvAI.getFavoriteKeys?window.ViewInvAI.getFavoriteKeys():[];
   const blob=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});
   const a=document.createElement('a');a.href=URL.createObjectURL(blob);
   a.download='viewinvai-copia-'+new Date().toISOString().slice(0,10)+'.json';
   document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},800);
   status('Copia descargada: '+data.portfolios.length+' carteras, '+data.transactions.length+' operaciones, '+data.dividends.length+' dividendos.');
  }catch(e){status(esc(e.message),true)}
  finally{btn.disabled=false}
 }
 async function restore(file){
  if(!signedIn()){await auth()?.signIn?.();if(!signedIn())return}
  let b;
  try{b=JSON.parse(await file.text())}catch(_){status('El archivo no es una copia válida.',true);return}
  if(!b||b.app!=='ViewInvAI'||b.kind!=='backup'){status('El archivo no es una copia de ViewInvAI.',true);return}
  const txs=(b.transactions||[]).filter(t=>t.origin!=='position-adjustment');
  const adjustments=(b.transactions||[]).length-txs.length;
  if(!confirm('Restaurar '+(b.portfolios||[]).length+' carteras, '+txs.length+' operaciones y '+(b.dividends||[]).length+' dividendos de la copia del '+new Date(b.exportedAt).toLocaleDateString('es-ES')+'? Lo que ya tengas se mantiene.'))return;
  const out={portfolios:0,tx:0,txSkipped:0,div:0,divSkipped:0,errors:0};
  try{
   status('Restaurando carteras…');
   const current=(await api('/api/portfolios')).portfolios||[];
   const byName=new Map(current.map(p=>[String(p.name).trim().toLowerCase(),p.id]));
   const idMap=new Map();
   for(const p of b.portfolios||[]){
    const key=String(p.name||'').trim().toLowerCase();if(!key)continue;
    let id=byName.get(key);
    if(!id){
     const created=await api('/api/portfolios',{method:'POST',body:JSON.stringify({name:p.name,broker:p.broker||'',baseCurrency:p.base_currency||'EUR',sortOrder:p.sort_order||0})});
     id=created.portfolio&&created.portfolio.id;out.portfolios++;
     if(id)byName.set(key,id);
    }
    if(id)idMap.set(String(p.id),id);
   }
   const groups=new Map();
   for(const t of txs){const pid=idMap.get(String(t.portfolio_id));if(!pid)continue;if(!groups.has(pid))groups.set(pid,[]);groups.get(pid).push(t)}
   let done=0;
   for(const [pid,list] of groups){
    for(let i=0;i<list.length;i+=60){
     status('Restaurando operaciones '+(done+Math.min(60,list.length-i))+'/'+txs.length+'…');
     const rows=list.slice(i,i+60).map(t=>({externalId:t.external_id||('backup:'+t.id),originalId:t.id,side:t.side,quantity:t.quantity,price:t.price,fees:t.fees,currency:t.currency,executedAt:t.executed_at,
      stockKey:t.stock_key,preferTr:Number(t.prefer_tr)===1,ticker:t.ticker,name:t.name,exchange:t.exchange,isin:t.isin,notes:t.notes||'',broker:t.broker||''}));
     const r=await api('/api/transactions/import',{method:'POST',body:JSON.stringify({portfolioId:pid,source:'backup',rows})});
     out.tx+=r.imported||0;out.txSkipped+=r.skipped||0;out.errors+=(r.errors||[]).length;done+=rows.length;
    }
   }
   // Congelaciones vigentes: se vuelven a aplicar a la posición equivalente (misma acción, bróker y mercado).
   const today=new Date().toLocaleDateString('sv-SE');
   const frozen=(b.positions||[]).filter(p=>Number(p.frozen_qty)>0&&String(p.frozen_until||'').slice(0,10)>=today&&idMap.has(String(p.portfolio_id)));
   if(frozen.length){
    status('Restaurando acciones congeladas…');
    const byPortfolio=new Map();
    for(const p of frozen){
     const pid=idMap.get(String(p.portfolio_id));
     if(!byPortfolio.has(pid))byPortfolio.set(pid,(await api('/api/positions?portfolioId='+encodeURIComponent(pid))).positions||[]);
     const match=byPortfolio.get(pid).find(x=>Number(x.active)!==0&&String(x.stock_key).toUpperCase()===String(p.stock_key).toUpperCase()&&
      String(x.broker||'')===String(p.broker||'')&&Number(x.prefer_tr)===Number(p.prefer_tr));
     if(!match)continue;
     try{await api('/api/positions/'+encodeURIComponent(match.id)+'/freeze',{method:'POST',body:JSON.stringify({quantity:Math.min(Number(p.frozen_qty),Number(match.quantity)||0),until:String(p.frozen_until).slice(0,10)})})}
     catch(_){out.errors++}
    }
   }
   const divs=b.dividends||[];
   for(let i=0;i<divs.length;i+=200){
    status('Restaurando dividendos…');
    const rows=divs.slice(i,i+200).map(d=>({externalId:d.external_id||('backup:'+d.id),originalId:d.id,paidAt:d.paid_at,isin:d.isin,ticker:d.ticker,name:d.name,currency:d.currency,gross:d.gross,withholding:d.withholding,withholdingEs:d.withholding_es}));
    const r=await api('/api/dividends/import',{method:'POST',body:JSON.stringify({source:'backup',rows})});
    out.div+=r.imported||0;out.divSkipped+=r.skipped||0;
   }
   status('Restaurando favoritos y avisos…');
   for(const w of b.watchlist||[]){
    try{await api('/api/watchlist',{method:'POST',body:JSON.stringify({stockKey:w.stock_key,ticker:w.ticker,name:w.name,exchange:w.exchange,isin:w.isin,preferTr:Number(w.prefer_tr)===1,notes:w.notes||''})})}catch(_){out.errors++}
   }
   if(Array.isArray(b.deviceFavorites)&&window.ViewInvAI&&window.ViewInvAI.mergeFavoriteKeys)window.ViewInvAI.mergeFavoriteKeys(b.deviceFavorites);
   for(const n of b.notificationPreferences||[]){
    try{await api('/api/notification-preferences',{method:'POST',body:JSON.stringify({stockKey:n.stock_key,ticker:n.ticker,name:n.name,preferTr:Number(n.prefer_tr)===1,newsEnabled:Number(n.news_enabled)===1,pulseEnabled:Number(n.pulse_enabled)===1,radarEnabled:Number(n.radar_enabled)===1,priceUpEnabled:Number(n.price_up_enabled)===1,priceDownEnabled:Number(n.price_down_enabled)===1,priceUpStep:n.price_up_step,priceDownStep:n.price_down_step,priceAbove:n.price_above,priceBelow:n.price_below})})}catch(_){out.errors++}
   }
   const prefs=b.uiPreferences||{};
   if(window.ViewInvAIUiPreferences)for(const [scope,value] of Object.entries(prefs)){if(value&&typeof value==='object')window.ViewInvAIUiPreferences.save(scope,value)}
   if(window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.reload==='function')await window.ViewInvAIPortfolios.reload();
   if(window.ViewInvAITax)window.ViewInvAITax._invalidate();
   window.dispatchEvent(new CustomEvent('viewinvai:favorite-lists-changed'));
   status('<b>Copia restaurada.</b> '+out.portfolios+' carteras nuevas · '+out.tx+' operaciones'+(out.txSkipped?' ('+out.txSkipped+' ya estaban)':'')+' · '+out.div+' dividendos'+(out.divSkipped?' ('+out.divSkipped+' ya estaban)':'')+'.'+
    (adjustments?' '+adjustments+' ajustes manuales de posición no se restauran: revisa esas posiciones.':'')+(out.errors?' '+out.errors+' elementos no se pudieron restaurar.':''),out.errors>0&&!out.tx);
  }catch(e){status(esc(e.message||'No se pudo restaurar.'),true)}
 }
 document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-backup-download]');if(b)download(b)});
 document.addEventListener('change',e=>{const f=e.target.matches&&e.target.matches('[data-backup-file]')&&e.target.files&&e.target.files[0];if(f){restore(f);e.target.value=''}});
 window.ViewInvAIBackup={download,restore};
})();
