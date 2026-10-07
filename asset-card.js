/* One compact asset card for every menu, on the web and packaged Android. */
(() => {
 'use strict';

 const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const content=cell=>cell&&cell.html!==undefined?String(cell.html):escape(cell&&cell.value!==undefined?cell.value:'—');

 function cellHtml(cell,extraClass=''){
  if(!cell)return '<div class="asset-card-cell '+extraClass+' asset-card-cell-empty" aria-hidden="true"></div>';
  const body=cell.html!==undefined
   ?'<div class="asset-card-cell-content">'+String(cell.html)+'</div>'
   :'<span class="asset-card-cell-value">'+escape(cell.value??'—')+'</span>';
  return '<div class="asset-card-cell '+extraClass+' '+escape(cell.tone||'')+'">'+
   (cell.label?'<small class="asset-card-label">'+escape(cell.label)+'</small>':'')+
   body+'</div>';
 }

 function contextHtml(cells=[]){
  const rows=Array.isArray(cells)?cells.filter(Boolean):[];
  return '<div class="asset-card-context-grid" data-context-items="'+rows.length+'">'+
   rows.map(cell=>cellHtml(cell,'asset-card-context-cell')).join('')+
  '</div>';
 }

 const FICHA_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="8.5" cy="10.5" r="2"/><path d="M5.8 16c.6-1.6 1.6-2.4 2.7-2.4s2.1.8 2.7 2.4M13.5 9.5h4.5M13.5 12.5h4.5M13.5 15.5h3"/></svg>';
 function render(options={}){
  const cells=Array.isArray(options.cells)?options.cells.filter(Boolean):[];
  const quoteCell=options.quoteCell||cells[0]||null;
  const contextual=Array.isArray(options.contextCells)?options.contextCells:cells.slice(1);
  const interactive=!!options.openAttrs;
  const chevronOnly=!options.rowActionsHtml&&!(options.openLabel&&interactive);
  const identifier=options.isin&&options.isin!=='—'
   ?'<span class="list-copy-isin '+(options.context==='catalog'?'catalog-row-isin':options.context==='portfolio'?'portfolio-row-isin':'')+'">'+escape(options.isin)+'</span>'
   :'';

  return '<article class="asset-card'+(options.className?' '+escape(options.className):'')+'" data-card-context="'+escape(options.context||'stock')+'"'+(options.cardAttrs||'')+'>
   '<div class="asset-card-row'+(interactive?' stock-open-row':'')+'" data-card-template="compact-slots"'+(chevronOnly?' data-end="chevron"':'')+(options.openAttrs||'')+'>'+
    '<div class="asset-card-marker">'+(options.leadingHtml||'')+'</div>'+
    '<div class="asset-card-identity'+(options.sparkHtml?' has-spark':'')+'"><div class="asset-card-copy"><strong>'+(options.rank?'<em>'+escape(options.rank)+'</em>':'')+escape(options.title||'—')+'</strong>'+identifier+(options.subtitle?'<small>'+escape(options.subtitle)+'</small>':'')+(options.sparkHtml||'')+'</div></div>'+
    '<div class="asset-card-quote-slot">'+cellHtml(quoteCell,'asset-card-quote-cell')+'</div>'+
    '<div class="asset-card-context-slot">'+contextHtml(contextual)+'</div>'+
    '<div class="asset-card-end-actions">'+
      (options.rowActionsHtml?'<div class="asset-card-row-actions">'+options.rowActionsHtml+'</div>':'')+
      (options.openLabel&&interactive
        ?(options.openIcon
          // Icon-only variant: the caller's openActionAttrs carry the aria-label/title.
          ?'<button type="button" class="asset-card-open asset-card-open-button asset-card-open-icon"'+(options.openActionAttrs||'')+'>'+FICHA_ICON+'</button>'
          :'<button type="button" class="asset-card-open asset-card-open-button"'+(options.openActionAttrs||'')+'>'+escape(options.openLabel)+' <b aria-hidden="true">›</b></button>')
        :'')+
    '</div>'+
   '</div>'+
   (options.metaHtml?'<div class="asset-card-meta" data-card-template="compact-slots"><span class="asset-card-meta-marker" aria-hidden="true"></span><div class="asset-card-meta-content">'+options.metaHtml+'</div><span class="asset-card-meta-action" aria-hidden="true"></span></div>':'')+
   (options.detailsHtml?'<details class="asset-card-details '+escape(options.detailsClass||'')+'"><summary><span>'+escape(options.detailsLabel||'Más datos')+'</span><i aria-hidden="true">＋</i></summary><div class="asset-card-detail-body">'+options.detailsHtml+'</div></details>':'')+
   (options.actionsHtml?'<div class="asset-card-actions">'+options.actionsHtml+'</div>':'')+
  '</article>';
 }

 function head(columns,options={}){
  const rows=Array.isArray(columns)?columns:[];
  const quote=rows[0];
  const contextual=rows.slice(1);
  // The shell is a compact-card container so the head switches layout at the same widths as the rows.
  return '<div class="asset-list-head-shell"><div class="asset-list-head" data-card-template="compact-slots" data-end="chevron">'+
   '<span class="asset-list-head-marker" aria-hidden="true"></span>'+
   '<span class="asset-list-head-identity">'+(options.firstHtml||escape(options.firstLabel||'Valor / ISIN'))+'</span>'+
   '<span class="asset-list-head-quote">'+(quote?content(typeof quote==='string'?{value:quote}:quote):'')+'</span>'+
   '<span class="asset-list-head-context">'+contextual.map(cell=>'<span>'+content(typeof cell==='string'?{value:cell}:cell)+'</span>').join('')+'</span>'+
   '<span class="asset-list-head-actions" aria-hidden="true"></span>'+
  '</div></div>';
 }

 window.ViewInvAICards=Object.freeze({render,head});
})();
