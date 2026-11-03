import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { esbuildOptions, outdir, writeHtml } from './build-config.mjs';

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });
const result = await esbuild.build(esbuildOptions({ dev: false }));
writeHtml(result.metafile);

const sizes = Object.entries(result.metafile.outputs)
  .filter(([f]) => !f.endsWith('.map') && !f.endsWith('.txt'))
  .map(([f, o]) => [f.replace(/^.*dist\//, ''), o.bytes])
  .sort((a, b) => b[1] - a[1]);
console.log('\nBuild output:');
for (const [f, b] of sizes.slice(0, 15)) console.log(`  ${(b / 1024).toFixed(1).padStart(8)} kB  ${f}`);
console.log(`\n✔ dist/ ready (${sizes.length} files)`);
