# ViewInvAI Android

ViewInvAI Android usa Capacitor 8 como contenedor nativo, pero no reutiliza la presentación responsive de la web.

## Arquitectura

La aplicación se divide en tres capas:

1. **Datos y lógica compartidos**
   - mismo backend de producción;
   - mismas APIs y WebSocket;
   - mismo motor de scoring;
   - mismas carteras, autenticación, noticias, catalizadores, gráficos e IA.

2. **Interfaz web**
   - `styles.css`: estilos compartidos y escritorio/tablet;
   - `web-mobile.css`: presentación responsive del navegador en pantallas estrechas.

3. **Interfaz Android**
   - `mobile-app.css`: geometría y diseño exclusivos de la APK;
   - `mobile-app.js`: métricas de viewport, safe areas, cabecera de acción y comportamiento visual nativo.

La APK abre producción con `?native=1`. Ese modo activa `data-native-app="1"` en el elemento `html` y evita cargar `web-mobile.css`.

El objetivo es que web y Android compartan información y comportamiento de negocio, pero no dependan del mismo layout.

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

El workflow `.github/workflows/build-android.yml` genera automáticamente un APK instalable.

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

Los cambios de UI nativa se publican como recursos frontend separados y no modifican la presentación de la web.
