# EntryPointTrade

EntryPointTrade es un radar de mercado orientado a localizar, ordenar y revisar acciones mediante datos de mercado, filtros técnicos y eventos próximos.

## Potencial de entrada

Esta pantalla muestra acciones que cumplen el criterio seleccionado. La lista puede limitarse a valores verificados en Trade Republic o ampliarse al resto del mercado estadounidense.

### Sesiones

- Sesión automática: cambia la lectura principal según la hora de Nueva York.
- Premarket: utiliza precio, variación y volumen anteriores a la apertura regular.
- Sesión regular: utiliza la cotización de la sesión principal de Estados Unidos.
- Postmarket · tras cierre EEUU: utiliza la negociación posterior al cierre.
- Sesión anterior: mantiene como referencia los datos de la última sesión regular.

### Criterios

- Corto plazo · 1–5 sesiones: prioriza impulso, volumen y situación técnica para un horizonte corto.
- Medio plazo · 2–6 semanas: da más importancia a la tendencia y reduce el peso del movimiento intradía.
- Exploración amplia: aplica condiciones poco restrictivas para revisar un universo mayor.
- Impulso intradía: busca acciones con movimiento y volumen relativo durante la sesión.
- Explosión en la sesión: destaca acciones que ya han registrado una subida fuerte en la sesión actual.
- Más suben tras cierre EEUU: ordena las acciones por su subida en postmarket después del cierre regular estadounidense.
- Personalizado guardado: recupera el último criterio personalizado guardado en el navegador.
- Histórico y tendencia estrictos: exige condiciones de tendencia más restrictivas.

No existe un precio mínimo. Una acción puede aparecer independientemente de su cotización si cumple el resto de condiciones.

### Filtros configurables

El desplegable Configurar criterio permite modificar subida mínima y máxima, volumen relativo, volumen absoluto, ADX y RSI. También permite exigir tendencia y penalizar valores con liquidez reducida.

## Detalle de una acción

Cada acción aparece en una fila compacta con ticker, nombre, precio, variación y estado de Trade Republic. Al abrir Detalles se muestran:

- Precio y variación regular.
- Precio y variación de premarket.
- Precio y variación de postmarket.
- Volumen y volumen relativo.
- RSI y ADX.
- EMA de 20 sesiones.
- Rendimiento semanal y mensual.
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

Para noticias, la ventana seleccionada representa antigüedad máxima; para eventos programados, representa cuánto falta hasta el evento. Cada elemento muestra la fuente cuando está disponible y distingue el hecho de su posible relevancia. La aparición de un catalizador no implica que la acción vaya a subir o bajar.

## Radar de acciones

Permite explorar el universo de mercado con búsqueda por ticker o empresa. Puede filtrarse por sesión, por dirección del movimiento y por cobertura:

- Trade Republic.
- Catálogo completo.
- Resto del mercado estadounidense.

Cada resultado utiliza el mismo desplegable compacto de detalles y los mismos enlaces externos que Potencial de entrada.

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
