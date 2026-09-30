/* One compact asset card for every menu, on the web and packaged Android. */
(() => {
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const content=cell=>cell.html!==undefined?String(cell.html):escape(cell.value??'—');
 function render(options={}){
  const cells=options.cells||[],columns=Math.max(1,cells.length),interactive=!!options.openAttrs;
  const identifier=options.isin&&options.isin!=='—'
   ?(options.context==='catalog'
     ?'<span class="list-copy-isin catalog-row-isin">'+escape(options.isin)+'</span>'
     :'<button type="button" class="list-copy-isin" data-copy-isin="'+escape(options.isin)+'" aria-label="Copiar ISIN '+escape(options.isin)+'">'+escape(options.isin)+'</button>')
   :'';
  return '<article class="asset-card'+(options.className?' '+escape(options.className):'')+'" data-card-context="'+escape(options.context||'stock')+'">'+
   '<div class="asset-card-row'+(interactive?' stock-open-row':'')+'" data-asset-columns="'+columns+'"'+(options.openAttrs||'')+'>'+
    '<div class="asset-card-identity">'+(options.leadingHtml||'')+'<div class="asset-card-copy"><strong>'+(options.rank?'<em>'+escape(options.rank)+'</em>':'')+escape(options.title||'—')+'</strong>'+identifier+(options.subtitle?'<small>'+escape(options.subtitle)+'</small>':'')+'</div></div>'+
    cells.map(cell=>'<div class="asset-card-cell '+escape(cell.tone||'')+'">'+(cell.label?'<small class="asset-card-label">'+escape(cell.label)+'</small>':'')+'<span>'+content(cell)+'</span></div>').join('')+
    (options.openLabel&&interactive?'<button type="button" class="asset-card-open asset-card-open-button"'+(options.openActionAttrs||'')+'>'+escape(options.openLabel)+' <b aria-hidden="true">›</b></button>':'<span class="asset-card-open" aria-hidden="true">'+(interactive?'›':'')+'</span>')+
   '</div>'+
   (options.metaHtml?'<div class="asset-card-meta">'+options.metaHtml+'</div>':'')+
   (options.detailsHtml?'<details class="asset-card-details '+escape(options.detailsClass||'')+'"><summary><span>'+escape(options.detailsLabel||'Más datos')+'</span><i aria-hidden="true">＋</i></summary><div class="asset-card-detail-body">'+options.detailsHtml+'</div></details>':'')+
   (options.actionsHtml?'<div class="asset-card-actions">'+options.actionsHtml+'</div>':'')+
  '</article>';
 }
 function head(columns,options={}){
  return '<div class="asset-list-head" data-asset-columns="'+Math.max(1,columns.length)+'">'+
   (options.firstHtml||'<span>'+escape(options.firstLabel||'Valor / ISIN')+'</span>')+
   columns.map(cell=>'<span>'+content(typeof cell==='string'?{value:cell}:cell)+'</span>').join('')+'<span></span></div>';
 }
 window.ViewInvAICards=Object.freeze({render,head});
})();
