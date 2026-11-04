import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSupabase } from '../fake-supabase.mjs';
import { CloudClient, friendlyError, type Session } from '../../src/services/cloud/client';
import { SyncEngine, type LocalAssets, type LocalBooks, type SyncState } from '../../src/services/cloud/sync';
import { bookHash, canonicalJson, classify } from '../../src/services/cloud/sync-core';
import { createBlock, createBook, createChapter, type Book } from '../../src/models/book';
import { makePng } from './fixtures';

const URL_ = 'https://test.supabase.co';

/** One simulated device: its own IndexedDB-like stores, session and engine. */
function device(fake: ReturnType<typeof createFakeSupabase>, name: string) {
  const books = new Map<string, Book>();
  const blobs = new Map<string, { blob: Blob; mime: string; name: string; size: number }>();
  let session: Session | null = null;
  let syncState: SyncState | null = null;
  const local: LocalBooks = {
    async list() { return [...books.values()].map((b) => structuredClone(b)); },
    async get(id) { const b = books.get(id); return b ? structuredClone(b) : null; },
    async save(b, opts = {}) { const next = opts.touch === false ? b : { ...b, updatedAt: Date.now() }; books.set(b.id, structuredClone(next)); return next; },
  };
  const assets: LocalAssets = {
    async get(id) { return blobs.get(id) ?? null; },
    async put(blob, n, id) { blobs.set(id, { blob, mime: blob.type, name: n, size: blob.size }); },
  };
  const client = new CloudClient(URL_, 'sb_publishable_test', { load: () => session, save: (s) => { session = s; } }, fake.fetch as typeof fetch);
  const engine = new SyncEngine(client, local, assets, { load: async () => syncState, save: async (s) => { syncState = structuredClone(s); } }, `dev_${name}`, name);
  return { books, blobs, local, assets, client, engine, get session() { return session; } };
}

function sampleBook(title = 'Mening kitobim') {
  return createBook({ title, chapters: [
    createChapter('Kirish', [createBlock('paragraph', { html: 'Birinchi <b>matn</b>' }), createBlock('image', { assetId: 'ast_img', caption: 'Rasm' })]),
    createChapter('Davomi', [createBlock('paragraph', { html: 'Ikkinchi bob' })]),
  ] });
}

test('auth: sign up, sign in, wrong password, sign out, password reset and update', async () => {
  const fake = createFakeSupabase();
  const d = device(fake, 'phone');
  const r = await d.client.signUp('ali@example.com', 'parol12345', 'Ali');
  assert.equal(r.needsConfirmation, false);
  assert.equal(d.client.user?.email, 'ali@example.com');
  await d.client.signOut();
  assert.equal(d.client.user, null);
  assert.equal(d.session, null, 'session removed from storage on logout');
  await assert.rejects(d.client.signIn('ali@example.com', 'xato'), (e) => friendlyError(e) === 'Email yoki parol noto‘g‘ri.');
  await d.client.signIn('ali@example.com', 'parol12345');
  assert.ok(d.session?.access_token, 'session persisted');
  await d.client.requestPasswordReset('ali@example.com');
  await d.client.updatePassword('yangiParol987');
  await d.client.signOut();
  await d.client.signIn('ali@example.com', 'yangiParol987');
  await assert.rejects(d.client.signUp('ali@example.com', 'parol12345', 'Ali'), (e) => /allaqachon mavjud/.test(friendlyError(e)));
  await assert.rejects(d.client.signUp('b@example.com', '123', 'B'), (e) => /kamida 8/.test(friendlyError(e)));
});

test('auth: email confirmation flow and expired-session refresh', async () => {
  const fake = createFakeSupabase({ requireConfirmation: true });
  const d = device(fake, 'phone');
  const r = await d.client.signUp('vali@example.com', 'parol12345', 'Vali');
  assert.equal(r.needsConfirmation, true);
  await assert.rejects(d.client.signIn('vali@example.com', 'parol12345'), (e) => /tasdiqlanmagan/.test(friendlyError(e)));
  fake.confirm('vali@example.com');
  await d.client.signIn('vali@example.com', 'parol12345');
  // force expiry: the client must refresh transparently before the next request
  const s = d.session!;
  (d.client as unknown as { session: Session }).session = { ...s, expires_at: Math.floor(Date.now() / 1000) - 10 };
  const before = d.session!.access_token;
  await d.client.select('books', 'select=id');
  assert.notEqual(d.session!.access_token, before, 'access token refreshed');
});

test('content hash ignores volatile fields and detects real edits', async () => {
  const b = sampleBook();
  const h1 = await bookHash(b);
  assert.equal(h1, await bookHash({ ...b, lastOpenedAt: Date.now(), reading: { chapterId: 'x', ratio: 0.5 }, updatedAt: 1 }));
  assert.notEqual(h1, await bookHash({ ...b, title: 'Boshqa' }));
  assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
});

test('classify: local-only, cloud-only, synced, local-changed, remote-changed, conflict', () => {
  const a = sampleBook('A'), b = sampleBook('B'), c = sampleBook('C'), d = sampleBook('D'), e = sampleBook('E');
  const r = (id: string, rev: number, hash: string) => ({ id: 'x', local_id: id, title: id, revision: rev, content_hash: hash, updated_at: '', deleted_at: null, chapter_count: 1, word_count: 1, device_id: '' });
  const entries = classify([a, b, c, d, e], { [a.id]: 'ha', [b.id]: 'hb', [c.id]: 'hc2', [d.id]: 'hd', [e.id]: 'he2' },
    [r(b.id, 1, 'hb'), r(c.id, 1, 'hc'), r(d.id, 2, 'hd2'), r(e.id, 3, 'he3'), r('book_cloud', 1, 'hz')],
    { [b.id]: { revision: 1, hash: 'hb', syncedAt: 0 }, [c.id]: { revision: 1, hash: 'hc', syncedAt: 0 }, [d.id]: { revision: 1, hash: 'hd', syncedAt: 0 }, [e.id]: { revision: 1, hash: 'he', syncedAt: 0 } });
  const by = Object.fromEntries(entries.map((x) => [x.localId, x.status]));
  assert.deepEqual(by, { [a.id]: 'local-only', [b.id]: 'synced', [c.id]: 'local-changed', [d.id]: 'remote-changed', [e.id]: 'conflict', book_cloud: 'cloud-only' });
});

test('backup → logout → login on a second device → restore, with images', async () => {
  const fake = createFakeSupabase();
  const phone = device(fake, 'phone');
  await phone.client.signUp('kitob@example.com', 'parol12345', 'Kitobxon');
  const book = sampleBook();
  await phone.local.save(book, { touch: false });
  await phone.assets.put(new Blob([makePng(20, 10) as BlobPart], { type: 'image/png' }), 'rasm.png', 'ast_img');

  let entries = await phone.engine.refreshStatus();
  assert.equal(entries[0].status, 'local-only', 'nothing uploaded before the user asks');
  const rep = await phone.engine.sync('backup');
  assert.deepEqual([rep.uploaded, rep.downloaded, rep.conflicts], [1, 0, 0]);
  assert.equal(fake.state.objects.size, 1, 'image uploaded to storage');
  assert.ok([...fake.state.objects.keys()][0].startsWith(`${phone.client.user!.id}/`), 'stored in the user folder');
  entries = await phone.engine.refreshStatus();
  assert.equal(entries[0].status, 'synced');
  assert.ok(phone.engine.current.lastBackupAt, 'last backup time recorded');
  const usage = await phone.engine.usage();
  assert.equal(usage?.books, 1); assert.equal(usage?.assets, 1);

  await phone.client.signOut();
  assert.equal(phone.books.size, 1, 'logout keeps local books');

  const laptop = device(fake, 'laptop');
  await laptop.client.signIn('kitob@example.com', 'parol12345');
  entries = await laptop.engine.refreshStatus();
  assert.equal(entries[0].status, 'cloud-only');
  const rr = await laptop.engine.sync('restore');
  assert.equal(rr.downloaded, 1);
  const restored = (await laptop.local.list())[0];
  assert.equal(restored.title, book.title);
  assert.deepEqual(restored.chapters.map((c) => c.title), ['Kirish', 'Davomi']);
  assert.equal(restored.chapters[0].blocks[0].type, 'paragraph');
  assert.ok(laptop.blobs.get('ast_img'), 'image restored');
  assert.equal(laptop.blobs.get('ast_img')!.blob.size, makePng(20, 10).length);
});

test('two devices: edits propagate, simultaneous edits become a conflict and every choice keeps data', async () => {
  const fake = createFakeSupabase();
  const a = device(fake, 'a'); const b = device(fake, 'b');
  await a.client.signUp('ikki@example.com', 'parol12345', 'Ikki');
  await b.client.signIn('ikki@example.com', 'parol12345');
  const book = sampleBook('Umumiy');
  await a.local.save(book, { touch: false });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal((await b.local.get(book.id))?.title, 'Umumiy', 'new book appears on device B');

  // A edits, B untouched → B receives A's edit
  await a.local.save({ ...(await a.local.get(book.id))!, title: 'A tahriri' });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal((await b.local.get(book.id))?.title, 'A tahriri');

  // both edit before syncing → conflict, nothing overwritten
  await a.local.save({ ...(await a.local.get(book.id))!, title: 'A versiyasi' });
  await b.local.save({ ...(await b.local.get(book.id))!, title: 'B versiyasi' });
  await a.engine.sync();
  const rep = await b.engine.sync();
  assert.equal(rep.conflicts, 1);
  assert.equal((await b.local.get(book.id))?.title, 'B versiyasi', 'local edit kept');
  assert.equal(fake.state.books[0].title, 'A versiyasi', 'cloud copy kept');
  assert.equal(b.engine.current.entries.find((e) => e.localId === book.id)?.status, 'conflict');

  // "keep both": B keeps its text as a separate book and takes the cloud copy
  await b.engine.resolve(book.id, 'both');
  const titles = (await b.local.list()).map((x) => x.title).sort();
  assert.deepEqual(titles, ['A versiyasi', 'B versiyasi (bu qurilma)']);

  // new conflict, resolved with "this device" → cloud gets B's version
  await a.local.save({ ...(await a.local.get(book.id))!, title: 'A2' });
  await b.local.save({ ...(await b.local.get(book.id))!, title: 'B2' });
  await a.engine.sync();
  await b.engine.sync();
  await b.engine.resolve(book.id, 'device');
  assert.equal(fake.state.books.find((x) => x.local_id === book.id)?.title, 'B2');
  // A had already uploaded A2 and has not edited since → it safely receives B's chosen version
  await a.engine.sync();
  assert.equal((await a.local.get(book.id))?.title, 'B2');
  assert.equal(a.engine.current.entries.find((e) => e.localId === book.id)?.status, 'synced');

  // "cloud" choice: B edits again while the cloud moved on → B picks the cloud copy
  await a.local.save({ ...(await a.local.get(book.id))!, title: 'A3' });
  await b.local.save({ ...(await b.local.get(book.id))!, title: 'B3' });
  await a.engine.sync();
  await b.engine.sync();
  await b.engine.resolve(book.id, 'cloud');
  assert.equal((await b.local.get(book.id))?.title, 'A3');
});

test('offline: sync reports offline, local work continues, retry succeeds when back online', async () => {
  const fake = createFakeSupabase();
  const d = device(fake, 'phone');
  await d.client.signUp('net@example.com', 'parol12345', 'Net');
  fake.setOnline(false);
  await d.local.save(sampleBook('Oflayn kitob'), { touch: false });
  await assert.rejects(d.engine.sync(), (e) => /Internet/.test(friendlyError(e)));
  assert.equal(d.engine.current.phase, 'offline');
  assert.equal(d.client.user?.email, 'net@example.com', 'still signed in while offline');
  assert.equal((await d.local.list()).length, 1, 'local book untouched');
  fake.setOnline(true);
  const rep = await d.engine.sync();
  assert.equal(rep.uploaded, 1);
  assert.equal(d.engine.current.phase, 'idle');
});

test('storage: identical images upload once, disallowed files are skipped, orphans can be cleaned', async () => {
  const fake = createFakeSupabase();
  const d = device(fake, 'phone');
  await d.client.signUp('rasm@example.com', 'parol12345', 'Rasm');
  const png = makePng(16, 16);
  const b1 = createBook({ title: 'Bir', chapters: [createChapter('1', [createBlock('image', { assetId: 'ast_1' }), createBlock('image', { assetId: 'ast_svg' })])] });
  const b2 = createBook({ title: 'Ikki', chapters: [createChapter('1', [createBlock('image', { assetId: 'ast_2' })])] });
  await d.local.save(b1, { touch: false }); await d.local.save(b2, { touch: false });
  await d.assets.put(new Blob([png as BlobPart], { type: 'image/png' }), 'a.png', 'ast_1');
  await d.assets.put(new Blob([png as BlobPart], { type: 'image/png' }), 'b.png', 'ast_2');
  await d.assets.put(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg', 'ast_svg');
  const rep = await d.engine.sync('backup');
  assert.equal(fake.state.objects.size, 1, 'same bytes stored once');
  assert.equal(fake.state.assets.length, 2, 'both references recorded');
  assert.deepEqual(rep.skippedAssets, ['ast_svg'], 'svg not uploaded');
  // the second book drops its image → its asset row becomes an orphan
  await d.local.save({ ...(await d.local.get(b2.id))!, chapters: [createChapter('1', [createBlock('paragraph', { html: 'rasmsiz' })])] });
  await d.engine.sync();
  const orphans = await d.engine.orphanAssets();
  assert.deepEqual(orphans.map((o) => o.local_id), ['ast_2']);
  await d.engine.cleanOrphans(orphans);
  assert.equal(fake.state.assets.length, 1);
  assert.equal(fake.state.objects.size, 1, 'shared file kept because ast_1 still uses it');
});

test('isolation: another account never sees or receives the first account’s books', async () => {
  const fake = createFakeSupabase();
  const a = device(fake, 'a'); const b = device(fake, 'b');
  await a.client.signUp('a@example.com', 'parol12345', 'A');
  await b.client.signUp('b@example.com', 'parol12345', 'B');
  await a.local.save(sampleBook('Maxfiy'), { touch: false });
  await a.engine.sync('backup');
  const entries = await b.engine.refreshStatus();
  assert.equal(entries.length, 0);
  await assert.rejects(b.client.downloadObject(`${a.client.user!.id}/x.png`));
});

test('removing a book from the cloud keeps it on the device', async () => {
  const fake = createFakeSupabase();
  const d = device(fake, 'phone');
  await d.client.signUp('rm@example.com', 'parol12345', 'Rm');
  const b = sampleBook('Saqlanadi');
  await d.local.save(b, { touch: false });
  await d.engine.sync('backup');
  await d.engine.removeFromCloud(b.id);
  assert.equal(fake.state.books.length, 0);
  assert.equal(fake.state.chapters.length, 0);
  assert.ok(await d.local.get(b.id));
  assert.equal(d.engine.current.entries[0].status, 'local-only');
});
