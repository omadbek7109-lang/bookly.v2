// Static server that mimics GitHub Pages for a project site:
//  - the site lives under a base path (default /bookly.v2/), "/" redirects there,
//  - "/bookly.v2" (no slash) redirects to "/bookly.v2/",
//  - directories serve index.html, unknown paths return 404.html with HTTP 404.
// Used by `npm run preview` and the end-to-end tests, so they exercise the same URL layout
// as https://<user>.github.io/bookly.v2/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

export function startServer(dir, port = 0, { base = '/bookly.v2/' } = {}) {
  const root = path.resolve(dir);
  const send = (res, code, file) => {
    res.writeHead(code, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  };
  const notFound = (res) => {
    const f = path.join(root, '404.html');
    if (fs.existsSync(f)) send(res, 404, f); else { res.writeHead(404); res.end('Not found'); }
  };
  const server = http.createServer((req, res) => {
    const [rawPath, query = ''] = (req.url || '/').split('?');
    const url = decodeURIComponent(rawPath);
    if (base !== '/' && (url === '/' || url === base.slice(0, -1))) {
      res.writeHead(301, { Location: base + (query ? `?${query}` : '') });
      return res.end();
    }
    if (!url.startsWith(base)) return notFound(res);
    let file = path.join(root, url.slice(base.length));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return notFound(res);
    send(res, 200, file);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = 'dist', port = '5173', base = process.env.BASE_PATH || '/bookly.v2/'] = process.argv.slice(2);
  const s = await startServer(dir, Number(port), { base });
  console.log(`Serving ${dir} at http://127.0.0.1:${s.address().port}${base}`);
}
