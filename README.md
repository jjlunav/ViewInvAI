# ViewInvAI

**AI-powered stock scanner, market insights & opportunities.**

ViewInvAI es una plataforma de observación y análisis de acciones orientada a localizar, ordenar y revisar oportunidades mediante datos de mercado, filtros técnicos, señales y eventos próximos. No ejecuta operaciones ni actúa como bróker.

## Arquitectura de interfaz

ViewInvAI comparte una única capa de datos y lógica entre web y Android, pero mantiene presentaciones independientes. `styles.css` contiene la base web, `web-mobile.css` el responsive del navegador y `mobile-app.css` / `mobile-app.js` la interfaz exclusiva de la APK. Los cambios visuales de Android no deben implementarse como parches responsive dentro del CSS web.

## Cinta de movimiento EEUU

En la parte superior de la aplicación aparece una cinta compacta con las acciones estadounidenses que presentan mayor movimiento en la sesión activa. La selección combina la magnitud de la variación con actividad de volumen, muestra ticker, precio y porcentaje, e incluye tanto subidas como bajadas.

La cinta se desplaza automáticamente de forma horizontal cuando hay muchos valores. Al colocar el ratón encima se pausa, y al pulsar una acción se abre su gráfico en TradingView. La sesión utilizada cambia automáticamente entre premarket, sesión regular y postmarket.

## Radar de entrada

### Orden del ranking

Cada acción del ranking explica por qué ocupa su posición. En los criterios basados en score se muestran el score total y sus componentes: movimiento de precio, volumen relativo, ADX, RSI y estructura respecto a EMA20/EMA50. La comparación indica qué factores aportan la ventaja frente a la acción situada inmediatamente debajo.

En los filtros de “Explosión en la sesión” y “Más suben tras cierre EEUU”, el orden se explica directamente por la variación porcentual utilizada por ese criterio.



Esta pantalla muestra acciones que cumplen el criterio seleccionado. La lista puede limitarse a valores verificados en Trade Republic o ampliarse al resto del mercado estadounidense.

### Sesiones

- Sesión automática: cambia la lectura principal según la hora de Nueva York.
- Premarket: utiliza precio, variación y volumen anteriores a la apertura regular.
- Sesión regular: utiliza la cotización de la sesión principal de Estados Unidos.
- Postmarket · tras cierre EEUU: utiliza la negociación posterior al cierre.

### Criterios

- Corto plazo · 1–5 sesiones: prioriza impulso, volumen y situación técnica para un horizonte corto.
- Medio plazo · 2–6 semanas: da más importancia a la tendencia y reduce el peso del movimiento intradía.
- Exploración amplia: aplica condiciones poco restrictivas para revisar un universo mayor.
- Impulso intradía: busca acciones con movimiento y volumen relativo durante la sesión.
- Explosión en la sesión: destaca acciones que ya han registrado una subida fuerte en la sesión actual.
- Más suben tras cierre EEUU: ordena las acciones por su subida en postmarket después del cierre regular estadounidense.
- Histórico y tendencia estrictos: exige condiciones de tendencia más restrictivas.

No existe un precio mínimo. Una acción puede aparecer independientemente de su cotización si cumple el resto de condiciones.

### Filtros configurables

El desplegable Configurar criterio muestra variación mínima y máxima, volumen relativo, volumen absoluto, ADX y RSI. Los campos numéricos están bloqueados por defecto; cada parámetro tiene su propio botón de candado para desbloquearlo individualmente antes de modificarlo. Los filtros activos son estrictos: si un dato necesario no está disponible, el valor no supera ese filtro.

El porcentaje mostrado en cada candidato de Radar de entrada es el mismo que utiliza la lógica de filtrado. En sesión regular se prioriza la cotización actual de EEUU cuando está disponible; premarket y postmarket usan sus métricas específicas. El volumen relativo de premarket/postmarket se calcula frente al volumen medio diario y no debe interpretarse como equivalente exacto al volumen relativo de la sesión regular.

La opción de tendencia exige precio ≥ EMA20 ≥ EMA50. La opción de liquidez excluye valores con menos de 10.000 títulos negociados o, cuando existe BID/ASK válido, con un spread superior al 8 %. El botón Guardar personalizado almacena el criterio en el navegador y lo recupera desde Personalizado guardado.

## Detalle de una acción

Cada acción aparece en una fila compacta con ticker, nombre, precio, variación y estado de Trade Republic. Al pulsar directamente sobre la fila de la acción se despliega o se oculta su información. Al situar el cursor sobre cada métrica se muestra una explicación de qué representa; en móvil la misma ayuda puede abrirse al tocar/focalizar el dato:

- Precio y variación regular.
- Precio y variación de premarket.
- Precio y variación de postmarket.
- Volumen y volumen relativo.
- RSI y ADX.
- EMA de 20 sesiones.
- Rendimiento semanal y mensual.
- Gráfico intradía de TradingView con velas japonesas de 1 minuto, fondo negro, volumen y horario extendido cuando el símbolo lo soporta. Se carga solo al desplegar la acción.
- Motivos objetivos por los que la acción aparece en el filtro.
- Mercado, divisa, ISIN cuando está disponible y próxima fecha de resultados cuando existe.

Cada detalle incluye accesos directos a TradingView, Investing.com, StockMarketWatch y StockTwits.

## Potencial futuro

Agrupa catalizadores capaces de aumentar la volatilidad de una acción. El selector temporal ofrece ventanas de 1, 2, 3, 4, 5, 6, 7, 14, 30 y 60 días.

La sección combina eventos previstos con noticias recientes. Incluye, entre otros:

- Resultados y cambios de guidance.
- Estudios clínicos, ensayos, FDA y noticias sanitarias.
- Contratos, adjudicaciones, acuerdos y licencias.
- Fusiones, adquisiciones, splits, reestructuraciones y otras operaciones corporativas.
- Financiación, ampliaciones, ofertas, convertibles, warrants y posibles situaciones de dilución.
- Cambios de rating y precio objetivo de analistas.
- Conferencias, presentaciones, investor days y otros eventos.
- Noticias regulatorias, legales o relacionadas con la cotización.
- Otras noticias de actualidad vinculadas a la empresa.

La ventana de Potencial futuro mira hacia delante desde el momento actual: 1, 2, 3, 4, 5, 6, 7, 14, 30 o 60 días. Las noticias publicadas durante el día actual pueden acompañar a los eventos previstos cuando sean relevantes.

Cada acción aparece una sola vez. Si existen varios catalizadores o noticias asociados al mismo valor dentro de la ventana seleccionada, todos se agrupan dentro del desplegable de esa acción.

Cuando el proveedor facilita una hora concreta, se muestra junto a la fecha en hora de Nueva York. Si la hora no está disponible, no se inventa.

Las noticias duplicadas procedentes de distintos medios se agrupan por hecho y se conservan sus fuentes como contraste. Solo se publican noticias procedentes de fuentes financieras reputadas o fuentes primarias disponibles; cuando varias fuentes independientes cubren el mismo hecho, la interfaz lo indica. La aparición de un catalizador no implica que la acción vaya a subir o bajar.

Para ensayos clínicos, el actualizador puede consultar directamente ClinicalTrials.gov. Solo acepta coincidencias validadas con el lead sponsor de la empresa y, para no inventar precisión, únicamente publica como evento fechado los registros que incluyen día exacto. Una fecha de finalización primaria o del estudio se identifica como tal y no se presenta como una fecha garantizada de publicación de resultados.

## Carteras

Las carteras sincronizadas permiten separar posiciones por bróker, registrar compras, ventas y ajustes manuales, y conservar un historial de operaciones. El coste medio y el P&L realizado se calculan a partir del ledger de transacciones.

El resumen de cada cartera muestra, cuando las divisas permiten una comparación válida:

- Valor actual de las posiciones abiertas.
- P&L abierto.
- P&L realizado de operaciones cerradas.
- Resultado total abierto + realizado.
- Cobertura del seguimiento IA.

Los importes realizados y las comisiones se mantienen separados por divisa. Si una corrección manual cambia la moneda de una posición, ViewInvAI no suma monedas distintas como si fueran equivalentes.

## Radar de acciones

Permite explorar el universo de mercado con búsqueda por ticker o empresa. Puede filtrarse por sesión, por dirección del movimiento y por cobertura:

- Trade Republic.
- Catálogo completo.
- Resto del mercado estadounidense.

Cada resultado se abre pulsando sobre la propia fila y utiliza los mismos enlaces externos que Radar de entrada.

## Calendario y noticias

Agrupa los eventos fechados asociados a las acciones. Cada elemento puede desplegarse para consultar su descripción y abrir la acción en las fuentes externas disponibles.

## Catálogo Trade Republic

Muestra las acciones cuya disponibilidad ha podido contrastarse con el universo oficial de instrumentos de Trade Republic. Se puede buscar por ticker, empresa o ISIN. El contador indica tanto las coincidencias con cotización como el tamaño del universo oficial procesado.

## Actualización de datos

La barra superior muestra el proveedor y la antigüedad aproximada de los datos. Los botones de actualización vuelven a cargar el conjunto publicado más reciente. La aplicación comprueba periódicamente si existe una actualización nueva.

## Uso en móvil

La interfaz está diseñada para mostrar mucha información en poco espacio:

- Navegación compacta.
- Filas de acciones reducidas.
- Detalles plegables.
- Indicadores reorganizados en cuadrícula.
- Filtros plegables.
- Enlaces externos visibles solo al abrir una acción.
