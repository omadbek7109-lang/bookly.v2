// Shared esbuild configuration for dev and production builds.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outdir = path.join(root, 'dist');

/**
 * Public base path of the deployed site. GitHub Pages serves this repository at
 * https://<user>.github.io/bookly.v2/ — override with BASE_PATH=/ for a root domain.
 * Asset URLs stay relative (./assets/...), so the same build also works inside
 * Telegram webviews and on any sub-path; BASE_PATH is used for the 404 fallback.
 */
export const basePath = (() => {
  let b = process.env.BASE_PATH ?? '/bookly.v2/';
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
})();

/** @param {{dev?: boolean}} opts */
export function esbuildOptions({ dev = false } = {}) {
  return {
    absWorkingDir: root,
    entryPoints: { app: 'src/main.tsx' },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    outdir: path.join(outdir, 'assets'),
    entryNames: dev ? '[name]' : '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'media/[name]-[hash]',
    jsx: 'automatic',
    sourcemap: dev ? 'inline' : 'linked',
    minify: !dev,
    metafile: true,
    legalComments: 'linked',
    loader: { '.png': 'file', '.jpg': 'file', '.svg': 'file', '.woff2': 'file' },
    alias: { '@': path.join(root, 'src') },
    define: {
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
      __BOOKLY_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version),
      __DEV__: JSON.stringify(dev),
      global: 'globalThis',
    },
    logLevel: 'info',
  };
}

/** Writes dist/index.html with the hashed entry files injected. */
export function writeHtml(metafile, { dev = false } = {}) {
  const outputs = Object.entries(metafile.outputs);
  const entry = outputs.find(([, o]) => o.entryPoint === 'src/main.tsx');
  if (!entry) throw new Error('Entry output not found in metafile');
  const js = path.relative(outdir, entry[0]).split(path.sep).join('/');
  const css = entry[1].cssBundle ? path.relative(outdir, entry[1].cssBundle).split(path.sep).join('/') : null;
  let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const tags = [
    css ? `<link rel="stylesheet" href="./${css}">` : '',
    `<script type="module" src="./${js}"></script>`,
    dev ? `<script>new EventSource('/esbuild').addEventListener('change',()=>location.reload())</script>` : '',
  ].filter(Boolean).join('\n    ');
  html = html.replace('<!-- BOOKLY:ASSETS -->', tags);
  fs.writeFileSync(path.join(outdir, 'index.html'), html);
  for (const f of fs.readdirSync(path.join(root, 'public'))) {
    if (f === 'index.html') continue;
    fs.cpSync(path.join(root, 'public', f), path.join(outdir, f), { recursive: true });
  }
  if (!dev) writePagesFiles();
}

/**
 * GitHub Pages extras:
 *  - .nojekyll: serve files as-is (no Jekyll processing).
 *  - 404.html: GitHub Pages returns it for unknown paths. The app uses hash routing, so a
 *    path like /bookly.v2/books is redirected to /bookly.v2/#/books instead of a dead page.
 */
export function writePagesFiles() {
  fs.writeFileSync(path.join(outdir, '.nojekyll'), '');
  const html = `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bookly 2.0</title>
<script>
  (function () {
    var base = ${JSON.stringify(basePath)};
    var p = location.pathname;
    var rest = p.indexOf(base) === 0 ? p.slice(base.length) : p.replace(/^\\/+/, '');
    rest = rest.replace(/\\/+$/, '');
    location.replace(base + location.search + (rest ? '#/' + rest : location.hash));
  })();
</script>
</head>
<body style="font-family:system-ui;background:#0d0e2b;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<a href="${basePath}" style="color:#c4b5fd">Bookly 2.0 ochilmoqda…</a>
</body>
</html>
`;
  fs.writeFileSync(path.join(outdir, '404.html'), html);
}
