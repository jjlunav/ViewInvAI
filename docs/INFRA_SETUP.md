# Infraestructura opcional de ViewInvAI

La aplicación funciona sin estos recursos gracias a los fallbacks actuales. Esta
configuración activa las mejoras de producción que requieren credenciales o
recursos externos.

## 1. Notificaciones push FCM

El cliente Android ya registra tokens FCM y el backend ya puede enviar alertas
mediante Firebase Cloud Messaging HTTP v1.

Configurar en el Worker de Cloudflare un secreto llamado:

`FCM_SERVICE_ACCOUNT_JSON`

Su valor debe ser el JSON completo de una cuenta de servicio del proyecto
Firebase `viewinvai` con permisos para Firebase Cloud Messaging. No se debe
guardar este JSON en Git ni en archivos públicos.

Después de configurarlo, `/api/backend/status` devolverá `push: true`.

## 2. Cloudflare R2 para datos de mercado

Crear un bucket R2, por ejemplo `viewinvai-market-data`, y enlazarlo al Worker
con el nombre de binding exacto:

`MARKET_DATA_BUCKET`

El Worker ya busca primero:
- `data/market.json`
- `data/market-version.json`

en ese bucket y, si no existen o el binding no está configurado, mantiene los
assets de Git como fallback.

Crear además un secreto del Worker:

`MARKET_PUBLISH_TOKEN`

con un valor aleatorio largo. El endpoint interno
`/api/internal/market-publish` requiere ese token y valida el JSON antes de
escribir en R2.

En GitHub Actions configurar:
- Repository variable `MARKET_PUBLISH_URL` =
  `https://viewinvai.sonarlab.workers.dev/api/internal/market-publish`
- Repository secret `MARKET_PUBLISH_TOKEN` = el mismo valor configurado en el Worker.

Cuando ambos existan, el workflow de mercado publicará automáticamente el
snapshot y el manifiesto de versión en R2.

## 3. Fuente oficial SEC / EDGAR

SEC exige que los clientes automatizados se identifiquen. Configurar en GitHub
Actions una Repository variable:

`SEC_USER_AGENT`

con un identificador de contacto válido, por ejemplo:

`ViewInvAI nombre@dominio.com`

Cuando existe, `scripts/update_market.py`:
- resuelve CIK desde el mapa oficial de tickers de SEC;
- consulta EDGAR directamente para los valores de mayor actividad;
- incorpora filings recientes relevantes como fuente oficial/primaria;
- conserva los datos previos si SEC no está disponible.

Sin esta variable no se hacen peticiones a SEC y la actualización de mercado
continúa normalmente.

## 4. Seguridad

Nunca guardar en el repositorio:
- cuentas de servicio Firebase;
- tokens de publicación R2;
- claves privadas;
- tokens de Cloudflare;
- otros secretos.

El workflow `Auditoria de seguridad` revisa código actual e historial para
detectar credenciales embebidas.
