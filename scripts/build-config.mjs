// Shared esbuild configuration for dev and production builds.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outdir = path.join(root, 'dist');

/** @param {{dev?: boolean}} opts */
export function esbuildOptions({ dev = false } = {}) {
  return {
    absWorkingDir: root,
    entryPoints: { app: 'src/main.tsx' },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020', 'chrome87', 'safari14', 'firefox90'],
    outdir: path.join(outdir, 'assets'),
    entryNames: dev ? '[name]' : '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'media/[name]-[hash]',
    publicPath: './assets',
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
}
