import { cp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'mobile-shell');

const files = [
  'favicon.svg',
  'styles.css',
  'web-mobile.css',
  'mobile-app.css',\n  'ui-density.css',
  'native-runtime.js',
  'market-session.js',
  'score-engine.js',
  'app.js',
  'settings.js',
  'market.js',
  'stock-charts.js',
  'events.js',
  'stock-list.js',
  'recommendation.js',
  'help.js',
  'stock-profile.js',
  'catalog.js',
  'heatmap.js',
  'stock-interactions.js',
  'navigation.js',
  'mobile-app.js',
  'bootstrap.js',
  'alerts.js',
  'funds.js',
  'auth.js',
  'portfolio.js'
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await mkdir(path.join(out, 'data'), { recursive: true });

for (const file of files) {
  await cp(path.join(root, file), path.join(out, file));
}
await cp(path.join(root, 'data', 'market.json'), path.join(out, 'data', 'market.json'));
await cp(path.join(root, 'data', 'market-version.json'), path.join(out, 'data', 'market-version.json'));
await cp(path.join(root, 'data', 'funds.json'), path.join(out, 'data', 'funds.json'));

let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(
  "const native = params.get('native') === '1';",
  "const native = true;"
);
html = html.replace(
  '<link rel="stylesheet" href="styles.css',
  '<script src="native-runtime.js?v=20260925r1"></script>\n  <link rel="stylesheet" href="styles.css'
);
html = html.replace(
  /<script src="native-runtime\.js[^>]*><\/script>\s*<script src="native-runtime\.js[^>]*><\/script>/,
  '<script src="native-runtime.js?v=20260925r1"></script>'
);

await writeFile(path.join(out, 'index.html'), html, 'utf8');

const built = await readdir(out);
if (!built.includes('index.html') || !built.includes('styles.css') || !built.includes('stock-profile.js')) {
  throw new Error('Packaged mobile shell is incomplete.');
}

const localMarket = JSON.parse(await readFile(path.join(out, 'data', 'market.json'), 'utf8'));
if (!Array.isArray(localMarket.stocks) || localMarket.stocks.length < 100) {
  throw new Error('Packaged market snapshot is missing or unexpectedly small.');
}
console.log('Packaged ViewInvAI mobile shell:', built.length, 'files ·', localMarket.stocks.length, 'stocks');
