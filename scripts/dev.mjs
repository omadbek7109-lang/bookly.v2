import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { esbuildOptions, outdir, writeHtml } from './build-config.mjs';

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

const ctx = await esbuild.context({
  ...esbuildOptions({ dev: true }),
  plugins: [{
    name: 'html',
    setup(build) {
      build.onEnd((r) => { if (r.metafile) writeHtml(r.metafile, { dev: true }); });
    },
  }],
});
await ctx.watch();
const port = Number(process.env.PORT || 5173);
const { hosts } = await ctx.serve({ servedir: outdir, port, host: '0.0.0.0', fallback: `${outdir}/index.html` });
console.log(`\nBookly dev server: http://localhost:${port}  (${hosts.join(', ')})`);
