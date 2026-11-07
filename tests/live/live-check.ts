/**
 * Live check against the REAL Supabase project (runs in GitHub Actions, which can reach it).
 * Uses the app's own CloudClient + SyncEngine with in-memory device storage.
 * Needs: BOOKLY_TEST_EMAIL_A / BOOKLY_TEST_PASSWORD_A / BOOKLY_TEST_EMAIL_B / BOOKLY_TEST_PASSWORD_B
 * (two confirmed test accounts). Cleans up everything it creates.
 */
import { CloudClient, type Session } from '../../src/services/cloud/client';
import { SyncEngine, type LocalAssets, type LocalBooks, type SyncState } from '../../src/services/cloud/sync';
import { createBlock, createBook, createChapter, type Book } from '../../src/models/book';
import { makePng } from '../unit/fixtures';

const URL_ = process.env.SUPABASE_URL || 'https://lphczkjwrokfzpnlhkei.supabase.co';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_h7GZN0DOMiNYA47Ik0RMuA_DIwaHkbQ';
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing ${k}`); return v; };

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  try { const d = await fn(); results.push({ name, ok: true, detail: d === undefined ? undefined : String(d) }); }
  catch (e) { results.push({ name, ok: false, detail: (e as Error).message }); }
}
const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };

function device(name: string) {
  const books = new Map<string, Book>();
  const blobs = new Map<string, { blob: Blob; mime: string; name: string; size: number }>();
  let session = null as Session | null;
  let st: SyncState | null = null;
  const local: LocalBooks = {
    async list() { return [...books.values()].map((b) => structuredClone(b)); },
    async get(id) { const b = books.get(id); return b ? structuredClone(b) : null; },
    async save(b, o = {}) { const n = o.touch === false ? b : { ...b, updatedAt: Date.now() }; books.set(b.id, structuredClone(n)); return n; },
  };
  const assets: LocalAssets = { async get(id) { return blobs.get(id) ?? null; }, async put(blob, n, id) { blobs.set(id, { blob, mime: blob.type, name: n, size: blob.size }); } };
  const client = new CloudClient(URL_, KEY, { load: () => session, save: (s) => { session = s; } });
  const engine = new SyncEngine(client, local, assets, { load: async () => st, save: async (s) => { st = structuredClone(s); } }, `live_${name}_${Date.now()}`, `CI ${name}`);
  return { books, blobs, local, assets, client, engine };
}

async function main() {
  const a = device('a'); const a2 = device('a2'); const b = device('b');
  const tag = `live_${Date.now()}`;
  const book = createBook({ title: `Live ${tag}`, chapters: [createChapter('Kirish', [createBlock('paragraph', { html: 'Jonli <b>tekshiruv</b>' }), createBlock('image', { assetId: `ast_${tag}` })])] });
  book.id = `book_${tag}`;
  const png = makePng(24, 12);

  await check('anonymous REST read is denied', async () => {
    const r = await fetch(`${URL_}/rest/v1/books?select=id`, { headers: { apikey: KEY } });
    const body = await r.text();
    must(r.status === 401 || r.status === 403 || body === '[]', `status ${r.status} ${body.slice(0, 120)}`);
    return `${r.status} ${body.slice(0, 60)}`;
  });
  await check('sign in A', async () => { await a.client.signIn(env('BOOKLY_TEST_EMAIL_A'), env('BOOKLY_TEST_PASSWORD_A')); return a.client.user?.id; });
  await check('sign in B', async () => { await b.client.signIn(env('BOOKLY_TEST_EMAIL_B'), env('BOOKLY_TEST_PASSWORD_B')); return b.client.user?.id; });
  await check('wrong password rejected', async () => {
    const x = device('x');
    try { await x.client.signIn(env('BOOKLY_TEST_EMAIL_A'), 'definitely-wrong'); } catch (e) { return (e as Error).message; }
    throw new Error('login succeeded with a wrong password');
  });

  await a.local.save(book, { touch: false });
  await a.assets.put(new Blob([png as BlobPart], { type: 'image/png' }), 'live.png', `ast_${tag}`);
  await check('A backs up book + image', async () => {
    const r = await a.engine.sync('backup');
    must(r.uploaded >= 1 && r.skippedAssets.length === 0, JSON.stringify(r));
    const e = (await a.engine.refreshStatus()).find((x) => x.localId === book.id);
    must(e?.status === 'synced', `status ${e?.status}`);
    return JSON.stringify(r);
  });
  await check('usage RPC reports the asset', async () => { const u = await a.engine.usage(); must(u && u.assets >= 1, JSON.stringify(u)); return JSON.stringify(u); });

  await check('B cannot see A’s book', async () => { const rows = await b.client.select<{ local_id: string }>('books', `select=local_id&local_id=eq.${book.id}`); must(rows.length === 0, `${rows.length} rows`); });
  await check('B cannot pull A’s book via RPC', async () => { const r = await b.client.rpc('bookly_pull_book', { p_local_id: book.id }); must(r === null, JSON.stringify(r).slice(0, 80)); });
  await check('B cannot download A’s image', async () => {
    const path = (await a.client.select<{ storage_path: string }>('book_assets', `select=storage_path&local_id=eq.ast_${tag}`))[0].storage_path;
    try { await b.client.downloadObject(path); } catch (e) { return (e as Error).message; }
    throw new Error('download succeeded');
  });
  await check('B cannot upload into A’s folder', async () => {
    try { await b.client.uploadObject(`${a.client.user!.id}/evil-${tag}.png`, new Blob([png as BlobPart], { type: 'image/png' })); } catch (e) { return (e as Error).message; }
    throw new Error('upload succeeded');
  });
  await check('storage rejects disallowed type', async () => {
    try { await a.client.uploadObject(`${a.client.user!.id}/bad-${tag}.html`, new Blob(['<script>'], { type: 'text/html' })); } catch (e) { return (e as Error).message; }
    throw new Error('html upload accepted');
  });

  await check('second device of A restores book and identical image', async () => {
    await a2.client.signIn(env('BOOKLY_TEST_EMAIL_A'), env('BOOKLY_TEST_PASSWORD_A'));
    await a2.engine.sync('restore', [book.id]);
    const got = await a2.local.get(book.id);
    must(got?.title === book.title, 'title');
    must(got?.chapters[0].blocks[0].type === 'paragraph', 'blocks');
    const img = a2.blobs.get(`ast_${tag}`);
    must(img && img.blob.size === png.length, `image ${img?.blob.size}`);
    const same = Buffer.from(await img!.blob.arrayBuffer()).equals(Buffer.from(png));
    must(same, 'image bytes differ');
  });

  await check('simultaneous edits produce a conflict, not an overwrite', async () => {
    await a.local.save({ ...(await a.local.get(book.id))!, title: `A ${tag}` });
    await a2.local.save({ ...(await a2.local.get(book.id))!, title: `A2 ${tag}` });
    await a.engine.sync('backup', [book.id]);
    const r = await a2.engine.sync('backup', [book.id]);
    must(r.conflicts === 1, JSON.stringify(r));
    const cloud = (await a.client.select<{ title: string }>('books', `select=title&local_id=eq.${book.id}`))[0];
    must(cloud.title === `A ${tag}`, cloud.title);
    await a2.engine.resolve(book.id, 'device');
    const after = (await a.client.select<{ title: string }>('books', `select=title&local_id=eq.${book.id}`))[0];
    must(after.title === `A2 ${tag}`, after.title);
  });

  // Delete-all-books with the server 4-digit code. Runs only on the dedicated test accounts (A and B).
  await check('wipe-books: wrong code rejected, right code deletes only A’s books; B untouched', async () => {
    const start = await a.client.invoke<{ request_id?: string; code?: string; error?: string }>('wipe-books', { action: 'start' });
    if (start.status === 503) return 'skipped — migration bookly_book_wipe not applied yet';
    must(start.status === 200 && /^\d{4}$/.test(start.body.code ?? ''), `${start.status} ${JSON.stringify(start.body)}`);
    // B keeps a book in the cloud during A's wipe
    const bBook = createBook({ title: `B keep ${tag}` });
    await b.local.save(bBook);
    await b.engine.sync('backup', [bBook.id]);
    const wrong = start.body.code === '0000' ? '1111' : '0000';
    const w = await a.client.invoke<{ status?: string; attempts_left?: number }>('wipe-books', { action: 'confirm', request_id: start.body.request_id, code: wrong });
    must(w.body.status === 'wrong' && w.body.attempts_left === 4, JSON.stringify(w.body));
    const byB = await b.client.invoke<{ status?: string }>('wipe-books', { action: 'confirm', request_id: start.body.request_id, code: start.body.code });
    must(byB.body.status === 'invalid', `B cannot use A’s code: ${JSON.stringify(byB.body)}`);
    const ok = await a.client.invoke<{ status?: string; books?: number }>('wipe-books', { action: 'confirm', request_id: start.body.request_id, code: start.body.code });
    must(ok.body.status === 'ok', JSON.stringify(ok.body));
    const replay = await a.client.invoke<{ status?: string }>('wipe-books', { action: 'confirm', request_id: start.body.request_id, code: start.body.code });
    must(replay.body.status === 'invalid', `replay: ${JSON.stringify(replay.body)}`);
    const aLeft = await a.client.select('books', 'select=local_id');
    must(aLeft.length === 0, `${aLeft.length} A books left`);
    const bLeft = await b.client.select<{ local_id: string }>('books', `select=local_id&local_id=eq.${bBook.id}`);
    must(bLeft.length === 1, 'B book must stay');
    await b.engine.removeFromCloud(bBook.id);
    return `deleted ${ok.body.books} A book(s)`;
  });

  await check('token refresh works', async () => { const s = await a.client.refresh(); must(s?.access_token, 'no token'); });

  await check('cleanup: remove cloud copy and orphaned image', async () => {
    await a.engine.removeFromCloud(book.id);
    const orphans = (await a.engine.orphanAssets()).filter((o) => o.local_id === `ast_${tag}`);
    await a.engine.cleanOrphans(orphans);
    const left = await a.client.select('book_assets', `select=local_id&local_id=eq.ast_${tag}`);
    must(left.length === 0, 'asset row left');
    await a.client.remove('sync_metadata', `device_id=like.live_*`);
  });
  await a.client.signOut(); await a2.client.signOut(); await b.client.signOut();

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} live checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
