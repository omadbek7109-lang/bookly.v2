// Bundles tests/live/live-check.ts and runs it against the real Supabase project.
import * as esbuild from 'esbuild';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './build-config.mjs';

for (const k of ['BOOKLY_TEST_EMAIL_A', 'BOOKLY_TEST_PASSWORD_A', 'BOOKLY_TEST_EMAIL_B', 'BOOKLY_TEST_PASSWORD_B']) {
  if (!process.env[k]) { console.log(`Skipping live check: ${k} is not set (add it as a GitHub Actions secret).`); process.exit(0); }
}
const out = path.join(root, '.test-build/live-check.mjs');
await esbuild.build({
  absWorkingDir: root, entryPoints: ['tests/live/live-check.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: out, packages: 'external', logLevel: 'warning',
  define: { __DEV__: 'false', __BOOKLY_VERSION__: '"live"', __SUPABASE_URL__: '""', __SUPABASE_KEY__: '""' },
});
const r = spawnSync(process.execPath, [out], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
