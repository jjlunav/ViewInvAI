import { cp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'mobile-shell');

const files = [
  'favicon.svg',
  'favicon-light.svg',
  'asset-card.js',
  'asset-card.css',
  'theme-ai.css',
  'ui-shell.js',
  'onboarding.js',
  'tasks.js',
  'decisions.js',
  'security.js',
  'sync-screen.js',
  'i18n.js',
  'broker-import.js',
  'tax.js',
  'search.js',
  'inbox.js',
  'favlists.js',
  'backup.js',
  'today.js',
  'styles.css',
  'web-mobile.css',
  'mobile-app.css',
  'ui-density.css',
  'native-runtime.js',
  'market-session.js',
  'score-engine.js',
  'goal-engine.js',
  'app.js',
  'settings.js',
  'market.js',
  'stock-charts.js',
  'events.js',
  'stock-list.js',
  'recommendation.js',
  'help.js',
  'ai-integrations.js',
  'stock-profile.js',
  'catalog.js',
  'heatmap.js',
  'stock-interactions.js',
  'filter-sheet.js',
  'navigation.js',
  'mobile-app.js',
  'bootstrap.js',
  'alerts.js',
  'stock-notifications.js',
  'funds.js',
  'auth.js',
  'portfolio.js'
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of files) {
  await cp(path.join(root, file), path.join(out, file));
}
// Los catálogos (acciones, fondos) no van dentro de la APK: se descargan del servidor y el
// móvil guarda la última copia para abrir sin conexión (native-runtime.js).

let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(
  "const native = params.get('native') === '1';",
  "const native = true;"
);
html = html.replace(
  '<link rel="stylesheet" href="styles.css',
  '<script src="native-runtime.js?v=20261002o1"></script>\n  <link rel="stylesheet" href="styles.css'
);
html = html.replace(
  /<script src="native-runtime\.js[^>]*><\/script>\s*<script src="native-runtime\.js[^>]*><\/script>/,
  '<script src="native-runtime.js?v=20261002o1"></script>'
);

// app.html: la copia completa que lleva la APK (sin conexión o si la versión publicada falla).
// index.html: el cargador, que abre la versión publicada en el servidor dentro de la propia APK,
// así las pantallas se actualizan con cada publicación sin compilar una APK nueva.
await writeFile(path.join(out, 'app.html'), html, 'utf8');
await cp(path.join(root, 'mobile-loader', 'index.html'), path.join(out, 'index.html'));

const built = await readdir(out);
if (!built.includes('index.html') || !built.includes('app.html') || !built.includes('styles.css') || !built.includes('stock-profile.js')) {
  throw new Error('Packaged mobile shell is incomplete.');
}

console.log('Packaged ViewInvAI mobile shell:', built.length, 'files (catálogos descargados del servidor)');
