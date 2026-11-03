// Bundles tests/unit/*.test.ts with esbuild for Node, then runs them with the built-in node:test runner.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './build-config.mjs';

const out = path.join(root, '.test-build');
fs.rmSync(out, { recursive: true, force: true });
const entries = fs.readdirSync(path.join(root, 'tests/unit')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/unit/${f}`);
await esbuild.build({
  absWorkingDir: root,
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  alias: { '@': path.join(root, 'src') },
  define: { __DEV__: 'false', __BOOKLY_VERSION__: '"test"' },
  logLevel: 'warning',
});
const files = fs.readdirSync(out).filter((f) => f.endsWith('.mjs')).map((f) => path.join(out, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
