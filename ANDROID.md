# ViewInvAI Android

ViewInvAI Android usa Capacitor 8 como contenedor nativo, pero no reutiliza la presentación responsive de la web.

## Arquitectura

La aplicación se divide en tres capas:

1. **Datos y lógica compartidos**
   - `app.js`: estado, mercado, filtros y render de vistas generales;
   - `stock-charts.js`: gráficos TradingView e histórico LSX;
   - `stock-profile.js`: ficha de acción y acciones IA;
   - `navigation.js`: navegación, historial y botón Atrás;
   - `bootstrap.js`: único punto de arranque y API pública;
   - mismo backend de producción, APIs, WebSocket, scoring, carteras, autenticación, noticias y catalizadores.

2. **Interfaz web**
   - `styles.css`: estilos compartidos y escritorio/tablet;
   - `web-mobile.css`: presentación responsive del navegador en pantallas estrechas.

3. **Interfaz Android**
   - `mobile-app.css`: geometría y diseño exclusivos de la APK;
   - `mobile-app.js`: métricas de viewport, safe areas, cabecera de acción y comportamiento visual nativo.

La APK empaqueta el frontend en `mobile-shell` y lo carga localmente. El proceso `npm run mobile:build` activa `data-native-app="1"` y evita cargar `web-mobile.css`; las APIs y datos online usan el backend de producción. Los recursos visuales nuevos requieren compilar e instalar una APK nueva.

Web y Android comparten información y lógica. Las tarjetas de los menús comparten además `asset-card.js` y `asset-card.css`, que se empaquetan sin duplicar código. La navegación y el resto del layout nativo siguen en `mobile-app.css`.

## Regla de desarrollo

Los cambios exclusivamente visuales de Android deben hacerse en `mobile-app.css` o `mobile-app.js`.

No se deben añadir excepciones para la APK dentro de `styles.css` ni `web-mobile.css`.

La lógica de mercado, scoring, carteras, autenticación y llamadas al backend debe seguir siendo compartida.

## Compilación local

Requisitos:

- Node.js 22+
- Java 21
- Android Studio / Android SDK

Comandos:

```bash
npm install
npx cap add android
cd android
./gradlew assembleDebug
```

APK generado:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## GitHub Actions

El workflow `.github/workflows/build-android.yml` genera una APK instalable al cambiar código en `main`, o mediante ejecución manual. El artefacto incluye versión y número de compilación, y el `versionCode` aumenta en cada ejecución. Conserva la firma estable de Firebase. La APK se descarga desde el artefacto `ViewInvAI-Android-debug` de GitHub Actions y debe instalarse en el dispositivo; no se instala silenciosamente.

El workflow de frontend prueba por separado:

- navegador de escritorio;
- responsive web;
- modo nativo Android en 360, 390 y 412 px;
- ausencia de overflow horizontal;
- geometría de cabecera y navegación;
- solapes entre cabecera, pestañas, acciones y barra inferior.

## Sincronización

Android recibe del mismo servicio que la web:

- precios y datos publicados;
- APIs y WebSocket de mercado;
- noticias, eventos y catalizadores;
- histórico y gráficos;
- carteras y posiciones sincronizadas;
- análisis y señales;
- cambios del backend compartido.

Los cambios de la tarjeta compartida se aplican en ambas plataformas. Los cambios específicos de navegación o disposición nativa siguen aislados en sus archivos Android.
