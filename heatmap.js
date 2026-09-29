/*
 * ViewInvAI heatmap
 * -----------------
 * Official TradingView Stock Heatmap embed.
 */
let heatmapRenderToken=0;
function tradingViewHeatmapTheme(){
 return document.documentElement.dataset.theme==='light'?'light':'dark';
}
function renderHeatmap(){
 const box=document.querySelector('#heatmapResults');if(!box)return;
 const token=String(++heatmapRenderToken);box.dataset.heatmapToken=token;
 box.innerHTML='';
 const wrap=document.createElement('div');wrap.className='tradingview-widget-container viewinvai-tv-heatmap';
 const widget=document.createElement('div');widget.className='tradingview-widget-container__widget';wrap.appendChild(widget);
 const credit=document.createElement('div');credit.className='tradingview-widget-copyright';
 credit.innerHTML='<a href="https://www.tradingview.com/heatmap/stock/" rel="noopener nofollow" target="_blank"><span class="blue-text">Stock Heatmap</span></a><span class="trademark"> by TradingView</span>';
 wrap.appendChild(credit);box.appendChild(wrap);
 const script=document.createElement('script');
 script.type='text/javascript';script.async=true;
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
 script.innerHTML=JSON.stringify({
  exchanges:[],
  dataSource:'SPX500',
  grouping:'sector',
  blockSize:'market_cap_basic',
  blockColor:'change',
  locale:'es',
  symbolUrl:'',
  colorTheme:tradingViewHeatmapTheme(),
  hasTopBar:false,
  isDataSetEnabled:false,
  isZoomEnabled:true,
  hasSymbolTooltip:true,
  isMonoSize:false,
  width:'100%',
  height:'100%'
 });
 script.onerror=()=>{
  if(box.dataset.heatmapToken!==token)return;
  box.innerHTML='<div class="empty-state"><strong>No se pudo cargar TradingView.</strong><span>Comprueba la conexión y pulsa recargar.</span></div>';
 };
 wrap.appendChild(script);
}
function initHeatmapInteractions(){
 document.querySelector('#refreshHeatmap')?.addEventListener('click',renderHeatmap);
 window.addEventListener('viewinvai:theme-changed',()=>{if(state.currentView==='heatmap')renderHeatmap()});
}
