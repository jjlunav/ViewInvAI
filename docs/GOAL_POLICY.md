# Objetivo de cartera

El objetivo organiza el plan; Radar y las otras fuentes aportan candidatas. El importe, plazo y perfil se evalúan juntos. Las probabilidades del modelo experimental no certifican que una meta sea viable.

## Plazo y riesgo

El motor comparte con el asistente el cálculo del crecimiento total y su equivalente compuesto cada 30 días. Son requisitos matemáticos sin aportaciones futuras, no una previsión. Se conserva la base de progreso existente: capital invertido y cripto solo si se ha incluido; el efectivo conserva su tratamiento separado.

Acortar el plazo aumenta la rentabilidad necesaria para una misma meta y capital. No autoriza a aumentar el riesgo seleccionado ni a debilitar los filtros por ir retrasado. El asistente muestra juntos esa exigencia, el perfil, su presupuesto por operación y el peso máximo ordinario por posición. No asigna una probabilidad de éxito ni inventa rentabilidades esperadas por perfil. La trayectoria objetivo solo se compara si hay una referencia de valor y fecha válida.

El tamaño de las compras incluye en el presupuesto de riesgo la caída desde la cotización de referencia hasta el stop y las comisiones de entrada y salida. Una acción entera puede superar el reparto entre huecos, pero debe caber en efectivo, peso y presupuesto de riesgo; se elimina la excepción que permitía un 50 % de exceso. Este cálculo al stop no garantiza la pérdida máxima real: pueden variar ejecución, precios y comisiones.

## Al alcanzar la meta

Se propone un siguiente hito editable de +25 % sobre el valor alcanzado, redondeado al euro superior y dentro del máximo admitido por el backend. Es un atajo del formulario, no una predicción ni una meta guardada automáticamente. El usuario revisa el importe y un nuevo plazo antes de guardar. El perfil, los límites de capital, las fracciones y la política de especulativas se conservan.

Hasta que se fije una meta mayor, el plan no propone compras ni rotaciones hacia nuevas entradas para un objetivo actualmente alcanzado. Retira las ideas de compra pendientes de ese objetivo. Los stops, sus ajustes y las salidas protectoras por noticias o deterioro siguen funcionando; no se liquida toda la cartera al llegar al importe. La valoración se sigue recalculando con el mercado.

## Validación

`npm run test:goal` comprueba cálculos de plazo, referencias ausentes, renovación, stops y presupuesto con comisiones en los tres perfiles, varios tamaños y compras enteras/fraccionadas. `node scripts/test-goal-wizard.mjs` ejecuta las funciones reales del asistente con un entorno aislado: verifica que la propuesta no escribe datos, que guardar requiere la acción explícita y que conserva el perfil y el capital.
