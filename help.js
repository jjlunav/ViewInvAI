/*
 * ViewInvAI contextual help
 * -------------------------
 * Filter explanations, section help and contextual help banner behavior.
 */

function presetHelpText(value){
 const help={
  short:'Pensado para operaciones de pocos días. Busca acciones que ya muestran movimiento suficiente y que mantienen una liquidez razonable, pero sin exigir una tendencia técnica perfecta. Sirve para localizar movimientos que podrían tener continuidad durante las próximas 1–5 sesiones.',
  medium:'Busca movimientos más sostenidos que un simple pico intradía. Da prioridad a acciones cuya estructura técnica mantiene una tendencia ordenada y suficiente liquidez, pensando en recorridos de varias semanas y no en perseguir una explosión puntual.',
  broad:'Abre el abanico al máximo y aplica muy pocas restricciones. Es útil para explorar el mercado y no perder candidatos, a cambio de mostrar más ruido y valores de peor calidad. El listado se ordena por los que más están subiendo en la sesión elegida.',
  intraday:'Busca acciones que están ganando fuerza durante la sesión actual. Exige que ya exista movimiento positivo y evita los valores con liquidez demasiado pobre. Es un filtro de impulso en curso, no una predicción previa al movimiento.',
  exploded:'Busca acciones que ya han realizado una subida muy fuerte en la sesión seleccionada. Está pensado para localizar explosiones que ya se han producido, no para anticiparlas.',
  postmarketExplosion:'Fuerza el análisis al Postmarket y muestra primero las acciones que más están subiendo después del cierre regular de EEUU. No exige una subida mínima artificial: ordena el mercado por la variación real de Postmarket.',
  premarketExplosion:'Fuerza el análisis al Premarket y muestra primero las acciones que más están subiendo antes de la apertura regular de EEUU. No exige una subida mínima artificial: ordena el mercado por la variación real de Premarket.',
  emerging:'Busca un movimiento que esté empezando ahora, no uno que ya haya explotado. Compara el último snapshot con el anterior y exige aceleración positiva reciente; además necesita una señal de actividad que la respalde, como entrada rápida de volumen, volumen relativo elevado o una noticia recién publicada. Descarta movimientos ya demasiado extendidos. Es un detector temprano de aceleración, no una garantía de subida.',
  strict:'Busca señales con más confirmación técnica y menos ruido. Exige tendencia ordenada, fuerza de tendencia, volumen relativo y una zona de RSI razonable, además de evitar mala liquidez. Suele devolver menos acciones, pero con más condiciones técnicas cumplidas.',
  custom:'Carga exactamente el criterio personalizado que guardaste en este navegador. Sirve para reutilizar tus propios umbrales sin modificar ninguno de los filtros predefinidos.'
 };
 return help[value]||'Selecciona este criterio para aplicar su lógica al mercado y ordenar las candidatas que la cumplen.';
}
function helpTextFor(el){
 if(!el)return null;
 if(el.dataset.help)return{title:el.dataset.helpTitle||'Qué hace',text:el.dataset.help};
 let key=el.dataset.helpKey||'',num=id=>N($('#'+id)?.value);
 if(key==='preset')return{title:el.textContent.trim(),text:presetHelpText(el.dataset.value)};
 if(key==='session')return{title:'Sesión usada por los filtros',text:'Selecciona qué tramo de EEUU alimenta variación y volumen: Premarket 04:00–09:30, Regular 09:30–16:00 y Postmarket 16:00–20:00, hora de Nueva York. Automática cambia según la hora. En la pestaña TR, técnicos y variación de sesión proceden del valor EEUU vinculado; precio, BID y ASK son LSX.'};
 if(key==='presetTrigger')return{title:'Criterio preconfigurado',text:'Elige el tipo de búsqueda que quieres hacer. Al pasar por cada opción verás una explicación clara de qué intenta localizar, para qué horizonte sirve y cómo se comporta, sin limitarse a repetir sus valores internos.'};
 if(key==='apply')return{title:'Aplicar filtros',text:'Lee los valores actuales de Configurar criterio y vuelve a calcular el listado. Un candado sólo impide editar un campo: no desactiva ese filtro.'};
 if(key==='filters')return{title:'Configurar criterio',text:'Abre los umbrales que deciden qué acciones pueden aparecer: variación, volumen relativo, volumen mínimo, ADX, RSI, tendencia EMA y liquidez.'};
 if(key==='marketTr')return{title:'Trade Republic',text:'Muestra sólo instrumentos cuya negociación en Trade Republic/LSX está confirmada: ISIN TR conocido, ticker LSX resuelto y mercado activo. Los candidatos sin confirmación quedan en EEUU.'};
 if(key==='marketUs')return{title:'Resto EEUU',text:'Muestra acciones de Nasdaq/NYSE/AMEX/NYSE Arca que no están confirmadas como negociables en Trade Republic/LSX. Aquí quedan también los candidatos TR aún sin ticker LSX resuelto.'};
 if(key==='minChange'){let v=num('minChange')??0;return{title:'Variación mínima',text:'Sólo aparecen acciones con variación ≥ '+F(v,1)+'% en la sesión elegida. Regular prioriza la variación actual Nasdaq; Pre/Post usan la de ese tramo. En TR se evalúa la referencia EEUU vinculada.'}}
 if(key==='maxChange'){let v=num('maxChange')??0;return{title:'Variación máxima',text:v>0?'Excluye acciones con variación superior a '+F(v,1)+'% para evitar movimientos ya demasiado extendidos.':'Vale 0, por tanto está desactivado: no hay límite superior de variación.'}}
 if(key==='minRelVolume'){let v=num('minRelVolume')??0;return{title:'Volumen relativo mínimo',text:v>0?'Exige ≥ '+F(v,2)+'× el volumen medio. 1,50× significa un 50% más actividad que la referencia. Si falta el dato, la acción se excluye mientras este filtro esté activo.':'Vale 0, por tanto no se exige volumen relativo mínimo.'}}
 if(key==='minVolume'){let v=num('minVolume')??0;return{title:'Volumen mínimo',text:v>0?'Exige al menos '+I(v)+' títulos negociados en la sesión seleccionada. Si falta el dato, la acción no supera este filtro.':'Vale 0, por tanto no se exige un número mínimo de títulos.'}}
 if(key==='minAdx'){let v=num('minAdx')??0;return{title:'ADX mínimo',text:v>0?'Exige ADX ≥ '+F(v,0)+'. ADX mide fuerza de tendencia, no dirección. Si falta ADX, la acción se excluye.':'Vale 0, por tanto no se exige fuerza mínima de tendencia por ADX.'}}
 if(key==='minRsi'){let v=num('minRsi')??0;return{title:'RSI mínimo',text:'Exige RSI ≥ '+F(v,0)+'. El RSI va de 0 a 100 y este límite evita momentum inferior al umbral. Se combina con el RSI máximo.'}}
 if(key==='maxRsi'){let v=num('maxRsi')??100;return{title:'RSI máximo',text:'Exige RSI ≤ '+F(v,0)+'. Permite evitar acciones sobreextendidas. Si el rango está restringido y falta RSI, la acción se excluye.'}}
 if(key==='trend')return{title:'Exigir tendencia EMA20/EMA50',text:'Sólo pasan acciones con precio ≥ EMA20 ≥ EMA50. Si falta precio, EMA20 o EMA50, la acción no supera este criterio.'};
 if(key==='illiquid')return{title:'Excluir liquidez baja',text:'Descarta valores con menos de 10.000 títulos en la sesión o spread BID/ASK >8% cuando hay spread. En TR el spread se toma de LSX; en EEUU, de Nasdaq.'};
 if(key==='lock')return{title:'Candado del parámetro',text:'Bloquea o desbloquea únicamente la edición del número. El criterio sigue activo aunque el candado esté cerrado.'};
 if(key==='reset')return{title:'Restablecer',text:'Recupera exactamente los valores originales del preset seleccionado y vuelve a bloquear los campos numéricos.'};
 if(key==='saveCustom')return{title:'Guardar personalizado',text:'Guarda en este navegador los valores actuales como “Personalizado guardado”. No modifica los presets originales.'};
 if(key==='futureHorizon')return{title:'Horizonte del catalizador',text:'Limita los eventos previstos a los próximos N días. Las noticias recientes del día pueden acompañar el análisis aunque no sean eventos futuros.'};
 if(key==='futureType')return{title:'Tipo de catalizador',text:'Restringe a resultados, clínico/FDA, contratos, operaciones corporativas, financiación/dilución, analistas, eventos o regulatorio/legal.'};
 if(key==='futureTrOnly')return{title:'Sólo Trade Republic',text:'Sólo deja eventos de acciones confirmadas como negociables y activas en Trade Republic/LSX. No incluye candidatos pendientes.'};
 if(key==='catalogSearchTr')return{title:'Buscar en Catálogo TR',text:'Busca por ticker LSX, ticker EEUU relacionado, empresa, ISIN, WKN o mercado dentro de los instrumentos confirmados como negociables en Trade Republic.'};
 if(key==='catalogSearchUs')return{title:'Buscar en Catálogo EEUU',text:'Busca por ticker, empresa, ISIN, mercado y demás campos del universo EEUU cargado.'};
 if(key==='catalogReset')return{title:'Restablecer columnas',text:'Devuelve las columnas a su orden original, borra filtros de columna y restablece el orden inicial.'};
 if(key==='catalogClear')return{title:'Limpiar filtros de columnas',text:'Borra todos los filtros de la segunda fila sin cambiar el orden de las columnas.'};
 if(key==='refresh')return{title:'Actualizar datos',text:'Solicita de nuevo el snapshot de mercado y recalcula la vista con los datos disponibles más recientes.'};
 return null;
}
let activeHelpTarget=null,helpDismissTimer=null;
function positionHelpBanner(target){
 let banner=$('#hoverHelpBanner');if(!banner||!target)return;
 let r=target.getBoundingClientRect(),pad=10,w=Math.min(520,Math.max(280,window.innerWidth-24));
 banner.style.width=w+'px';
 banner.style.left=Math.max(12,Math.min(r.left,window.innerWidth-w-12))+'px';
 banner.style.top='0px';
 let h=banner.offsetHeight||80,below=r.bottom+pad,above=r.top-h-pad;
 banner.style.top=(below+h<window.innerHeight?below:Math.max(12,above))+'px';
}
function showHelpBanner(target){
 let info=helpTextFor(target),banner=$('#hoverHelpBanner');if(!info||!banner)return;
 if(helpDismissTimer)clearTimeout(helpDismissTimer);
 activeHelpTarget=target;$('#hoverHelpTitle').textContent=info.title;$('#hoverHelpText').textContent=info.text;
 banner.classList.add('visible');banner.setAttribute('aria-hidden','false');requestAnimationFrame(()=>positionHelpBanner(target));
 helpDismissTimer=setTimeout(()=>hideHelpBanner(),12000);
}
function hideHelpBanner(){
 if(helpDismissTimer){clearTimeout(helpDismissTimer);helpDismissTimer=null}
 let banner=$('#hoverHelpBanner');if(!banner)return;
 banner.classList.remove('visible');banner.setAttribute('aria-hidden','true');activeHelpTarget=null;
}
function initHelpSystem(){
 const mark=(selector,key)=>{let el=$(selector);if(el)el.dataset.helpKey=key},markAll=(selector,key)=>$$(selector).forEach(el=>el.dataset.helpKey=key);
 const sectionHelp={
  entry:{title:'Radar de entrada',text:'Escanea acciones que cumplen el criterio seleccionado. Puedes cambiar sesión, mercado y filtros técnicos. La lista se recalcula con los datos disponibles y no aplica ningún precio mínimo.'},
  recommendation:{title:'Ideas IA',text:'Selecciona oportunidades mediante análisis multifactor de momentum, volumen, tendencia, RSI, ADX, liquidez y catalizadores.'},
  portfolios:{title:'Carteras',text:'Organiza posiciones por bróker. Cada posición y cada favorito sincronizado puede analizarse de forma recurrente para detectar mantenimiento, revisión o posible salida.'},
  heatmap:{title:'Mapa de calor',text:'Agrupa visualmente el mercado por sectores. El tamaño representa capitalización cuando está disponible y el color muestra la variación de la sesión elegida.'},
  future:{title:'Potencial futuro',text:'Busca noticias y eventos próximos que pueden aumentar la volatilidad antes de que ocurra el movimiento: resultados, FDA, contratos, financiación, operaciones corporativas y otros catalizadores.'},
  alerts:{title:'Avisos',text:'Solo avisa cuando una recomendación alcanza un nivel de convicción alto. Exige confirmación de gráfico, tendencia, volumen, RSI/ADX, liquidez y ausencia de señales negativas relevantes en noticias o eventos.'},
  calendar:{title:'Calendario y noticias',text:'Ordena cronológicamente noticias y eventos corporativos, clínicos, regulatorios y de resultados asociados al universo de acciones cargado.'},
  catalog:{title:'Catálogo Trade Republic',text:'Tabla de instrumentos cuya negociación en Trade Republic/LSX está confirmada. Permite buscar, ordenar, filtrar y reorganizar columnas.'},
  catalogUS:{title:'Catálogo EEUU',text:'Tabla del universo estadounidense cargado, con búsqueda, ordenación, filtros por columna y acceso a la ficha detallada de cada acción.'},
  settings:{title:'Settings',text:'Preferencias de la aplicación y del dispositivo. Por ahora permite mantener la pantalla del móvil activa mientras ViewInvAI está abierta; más adelante incorporará cuenta, sincronización, notificaciones y otras opciones.'}
 };
 $$('.section-help').forEach(el=>{let x=sectionHelp[el.dataset.helpSection];if(x){el.dataset.help=x.text;el.dataset.helpTitle=x.title}});
 $$('.criterion-field').forEach(field=>{let input=field.querySelector('input');if(input)field.dataset.helpKey=input.id});
 let trendLabel=$('#requireTrend')?.closest('.filter-toggle');if(trendLabel)trendLabel.dataset.helpKey='trend';
 let liqLabel=$('#excludeIlliquid')?.closest('.filter-toggle');if(liqLabel)liqLabel.dataset.helpKey='illiquid';
 markAll('.field-lock','lock');
 // El panel detallado sólo se abre mediante un icono de ayuda. Nunca por hover, focus o al cargar la página.
 $$('[data-help],[data-help-key]').forEach(el=>{
  if(el.hasAttribute('title')){
   if(!el.hasAttribute('aria-label'))el.setAttribute('aria-label',el.getAttribute('title')||'Ayuda');
   el.removeAttribute('title');
  }
 });
document.addEventListener('click',e=>{
  let trigger=e.target.closest&&e.target.closest('.section-help,.param-info');
  if(trigger){
   let target=trigger.matches('.section-help')?trigger:trigger.closest('[data-help],[data-help-key]');
   if(target){
    e.preventDefault();e.stopPropagation();
    if(activeHelpTarget===target)hideHelpBanner();else{hideHelpBanner();showHelpBanner(target)}
    return;
   }
  }
  if(activeHelpTarget&&!e.target.closest('#hoverHelpBanner'))hideHelpBanner();
 },true);
 window.addEventListener('scroll',()=>{if(activeHelpTarget)hideHelpBanner()},{passive:true});
 window.addEventListener('resize',()=>{if(activeHelpTarget)positionHelpBanner(activeHelpTarget)});
}
