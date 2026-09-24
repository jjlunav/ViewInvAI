# ViewInvAI Android

Esta rama contiene una primera versión Android de ViewInvAI basada en Capacitor.

## Arquitectura

- App nativa Android: Capacitor 8.
- Interfaz y lógica de mercado: la misma instancia web de producción.
- Backend/datos actual durante la transición: https://catalystpulse.sonarlab.workers.dev/\n- Endpoint definitivo previsto tras el corte de Cloudflare: `https://viewinvai.sonarlab.workers.dev/`.
- El APK carga la aplicación publicada para que los cambios del frontend y del backend estén disponibles sin duplicar lógica.

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

El workflow `.github/workflows/build-android.yml` genera automáticamente un APK de depuración instalable.

También puede ejecutarse manualmente desde GitHub Actions mediante **Run workflow**.

## Estado de sincronización

La app Android comparte inmediatamente con la web:

- precios y datos publicados;
- APIs y WebSocket de mercado;
- noticias, eventos y catalizadores;
- mapas, gráficos y vistas;
- cualquier cambio que se despliegue en la instancia de ViewInvAI.

Actualmente los favoritos, filtros personalizados, tema y algunos estados de interfaz se guardan en `localStorage` del dispositivo/navegador. Para que se sincronicen entre web y Android hará falta mover esos datos a la cuenta de usuario/backend.
