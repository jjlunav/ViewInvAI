# EntryPointTrade

EntryPointTrade es un radar de mercado orientado a localizar, ordenar y revisar acciones según su comportamiento de precio, volumen, tendencia y catalizadores. La aplicación separa las señales técnicas de las noticias y de los eventos para que cada dato pueda revisarse por separado.

## Potencial de entrada

Es la pantalla principal del escáner. Muestra las acciones que superan el criterio seleccionado y las ordena por puntuación.

La cabecera permite elegir **Sesión regular**, **Premarket** o **Sesión anterior**. La opción **Cambiar automáticamente entre premarket y sesión regular** adapta la sesión a la hora de Nueva York.

Los botones **Trade Republic** y **Resto del mercado · EEUU** separan las acciones incluidas en el catálogo oficial de Trade Republic de las acciones de NASDAQ, NYSE y AMEX que no coinciden con ese catálogo por ISIN.

La opción **Dar prioridad a catalizadores y riesgos** incorpora el contexto disponible a la ordenación sin sustituir los filtros técnicos.

Cada candidata muestra cierre previo, precio de la sesión, variación, volumen, media de volumen de diez sesiones, volumen relativo y puntuación. La ficha explica por qué aparece, indica el retraso de referencia y permite desplegar indicadores adicionales, el gráfico de TradingView, la investigación disponible y el acceso a SEC EDGAR.

### Criterios

**Desde apertura** aplica mínimos que crecen con los minutos transcurridos desde la apertura de Nueva York. El retraso declarado se descuenta antes de calcular el umbral.

**Corto plazo · 1–5 sesiones** busca continuidad de impulso durante las próximas sesiones combinando variación, volumen relativo e indicadores técnicos.

**Medio plazo · 2–6 semanas** da más peso a tendencia, medias móviles e histórico semanal y mensual.

**Exploración amplia** reduce los descartes para mostrar un universo mayor de acciones que después puede revisarse con otros criterios.

**Impulso intradía** prioriza subida de la sesión, volumen anormal y fuerza técnica.

**Explosión en la sesión** localiza acciones que ya han registrado una subida anormal durante la sesión. El porcentaje a partir del cual se considera una explosión es modificable.

**Personalizado guardado** recupera los valores guardados por el usuario en ese navegador.

**Histórico y tendencia estrictos** exige que la acción supere también los filtros de tendencia e histórico; si no existe ninguna candidata, no se fuerzan resultados.

El botón **Restablecer este criterio** devuelve el preajuste a sus valores originales. **Aplicar** utiliza los valores visibles en ese momento. **Guardar personalizado** guarda esos valores como criterio personalizado.

Los filtros permiten ajustar subida mínima y máxima, volumen relativo, volumen mínimo, volumen creciente desde apertura, precio × volumen por minuto, ADX, RSI, umbral de explosión y requisitos de tendencia. No existe un filtro de precio mínimo de la acción.

El bloque **Datos de hoy · Ver desglose** muestra cuántas acciones forman el universo, cuántas tienen datos para la sesión, cuántas superan los filtros y cuáles son los motivos de descarte más frecuentes.

## Potencial futuro

Busca acciones que tienen un evento próximo capaz de generar una variación fuera de lo normal antes de que el evento ocurra.

Puede limitarse el horizonte a 7, 14, 30 o 60 días y filtrar por resultados, eventos médicos o regulatorios, contratos, operaciones corporativas, filings SEC u otros eventos. También puede restringirse a instrumentos de Trade Republic.

Cada evento mantiene separados **Hecho comprobado** e **Hipótesis de impacto**. La existencia del evento no se interpreta como una predicción de subida.

## Radar de acciones

Es la tabla general de seguimiento de mercado. Utiliza datos de TradingView y se actualiza automáticamente mientras la página permanece abierta.

La pestaña **Trade Republic** muestra acciones cuyo ISIN coincide con el catálogo oficial. **Resto del mercado** muestra acciones estadounidenses sin esa coincidencia.

El buscador acepta nombre, ticker o ISIN. El selector **Movimiento** permite revisar premarket o sesión regular. Los botones **Todas**, **Subidas** y **Bajadas** filtran por dirección. También pueden aplicarse filtros de volumen, variación y divisa.

Las cabeceras de la tabla permiten ordenar los resultados. La paginación permite elegir 25, 50 o 100 filas.

Al pulsar una acción se abre **Acción seleccionada**, con sus principales datos de sesión, indicadores y un gráfico de TradingView.

## Calendario y noticias

Reúne eventos con fecha conocida, como resultados previstos y filings recientes. Puede filtrarse por intervalo de fechas, ticker o empresa.

Cada elemento identifica el tipo de evento, el hecho almacenado y la fuente. Cuando existe un enlace original se puede abrir directamente desde la ficha.

Los titulares relacionados se tratan como contexto y no como confirmaciones independientes del mismo hecho.

## Catálogo Trade Republic

Muestra el universo oficial de instrumentos publicado para Trade Republic España. La identidad del instrumento se comprueba mediante **ISIN**, no únicamente mediante ticker o nombre.

El buscador acepta nombre, ticker o ISIN. Cuando existe una cotización estadounidense asociada, la tabla muestra ticker, precio, variación y mercado.

Que un instrumento figure en el catálogo confirma su identidad dentro de la lista, pero no garantiza que exista liquidez o negociación disponible en ese instante.

## Fuentes y cobertura

Explica las fuentes utilizadas por cada parte de la aplicación y el estado de la última actualización.

**TradingView** aporta cotizaciones, variación, volumen, indicadores técnicos, premarket y calendario de resultados cuando esos campos están disponibles.

**Trade Republic España** aporta el catálogo oficial de instrumentos por ISIN.

**SEC EDGAR** y los titulares asociados se utilizan como contexto documental para las fichas investigadas. La aplicación diferencia los documentos oficiales de los titulares de terceros.

Las cotizaciones pueden estar retrasadas. El precio mostrado para una acción estadounidense no debe interpretarse como el precio de ejecución disponible en Trade Republic.
