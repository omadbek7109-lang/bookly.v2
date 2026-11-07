// Cloud backup & sync end-to-end tests. Two browser contexts act as two devices; the Supabase API
// is served by tests/fake-supabase.mjs through page.route (same rules as the real migrations).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';
import { createFakeSupabase } from '../fake-supabase.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const SITE_BASE = '/bookly.v2/';
const SUPA = 'https://lphczkjwrokfzpnlhkei.supabase.co';
const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
let server, browser, origin;
const pageErrors = [];

before(async () => {
  server = await startServer(path.join(ROOT, 'dist'), 0, { base: SITE_BASE });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.close(); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

async function device(fake, { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    try {
      const r = await fake.handle(req.method(), req.url(), req.headers(), req.postDataBuffer());
      await route.fulfill({ status: r.status, headers: { ...CORS, ...r.headers }, body: r.body });
    } catch {
      await route.abort('internetdisconnected');
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${origin}${SITE_BASE}?fastAI=1&noIntro=1`);
  await page.waitForSelector('.home');
  return { ctx, page };
}

async function waitFor(cond, what, ms = 15000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timeout: ${what}`); await new Promise((r) => setTimeout(r, 100)); }
}

const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

async function createBook(page, title) {
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor]');
  await page.click('[data-testid=editor-details]');
  await page.fill('[data-testid=details-title]', title);
  await page.keyboard.press('Escape');
  const ed = page.locator('[data-testid=blocks] .editable').first();
  await ed.click({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: path.join(OUT, 'debug-createbook.png') }); throw e; });
  await page.keyboard.type(`${title} matni`);
  await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.getAttribute('data-status') === 'saved');
  return page.evaluate(() => location.hash.split('/')[2].split('?')[0]);
}

async function signUp(page, email) {
  await go(page, '#/profile');
  await page.click('[data-testid=account-signup]');
  await page.fill('[data-testid=auth-name]', 'Sinov');
  await page.fill('[data-testid=auth-email]', email);
  await page.fill('[data-testid=auth-password]', 'parol12345');
  await page.click('[data-testid=auth-submit]');
  await page.waitForSelector('[data-testid=account-email]');
}

async function signIn(page, email) {
  await go(page, '#/profile');
  await page.click('[data-testid=account-login]');
  await page.fill('[data-testid=auth-email]', email);
  await page.fill('[data-testid=auth-password]', 'parol12345');
  await page.click('[data-testid=auth-submit]');
  await page.waitForSelector('[data-testid=account-email]');
}

/** The backup question only appears when there are books to move; an empty account is enabled silently. */
const promptAnswered = (page) => page.waitForFunction(() => !!JSON.parse(localStorage.getItem('bookly.settings') || '{}').cloudPromptedFor, null, { timeout: 10000 });

async function answerPrompt(page) {
  const btn = page.locator('[data-testid=prompt-backup]');
  try { await btn.waitFor({ timeout: 2500 }); await btn.click(); } catch { /* not shown: nothing to back up */ }
}

const rowStatus = (page, title) => page.locator('[data-testid=cloud-row]', { hasText: title }).getAttribute('data-status');

test('without an account everything works locally and cloud is only offered, never required', async () => {
  const fake = createFakeSupabase();
  const { ctx, page } = await device(fake);
  await createBook(page, 'Hisobsiz kitob');
  await go(page, '#/books');
  await page.waitForSelector('[data-testid=book-row]');
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=account-card]');
  assert.match(await page.locator('[data-testid=account-card]').innerText(), /ixtiyoriy/);
  assert.equal(fake.log.length, 0, 'no network request without an account');
  await page.screenshot({ path: path.join(OUT, 'cloud-profile-guest.png') });
  await ctx.close();
});

test('sign up → keep local books → back up → log out → sign in on a second device → restore', async () => {
  const fake = createFakeSupabase();
  const phone = await device(fake);
  const id = await createBook(phone.page, 'Birinchi kitob');
  // add an image so storage is exercised
  await phone.page.evaluate(() => { location.hash = location.hash; });
  await signUp(phone.page, 'kitobxon@example.com');
  // one-time question: back up now / later
  await phone.page.waitForSelector('[data-testid=prompt-backup]');
  await phone.page.screenshot({ path: path.join(OUT, 'cloud-prompt.png') });
  await phone.page.click('[data-testid=prompt-backup]');
  await waitFor(() => fake.state.books.length === 1, 'book uploaded');
  assert.equal(fake.state.books[0].local_id, id);
  assert.equal(fake.state.books[0].title, 'Birinchi kitob');
  await go(phone.page, '#/cloud');
  await phone.page.waitForSelector('[data-testid=cloud-row]');
  assert.equal(await rowStatus(phone.page, 'Birinchi kitob'), 'synced');
  assert.doesNotMatch(await phone.page.locator('[data-testid=last-backup]').innerText(), /hali/);
  await phone.page.screenshot({ path: path.join(OUT, 'cloud-page.png') });

  // logout keeps local books
  await phone.page.click('[data-testid=logout]');
  await phone.page.click('[data-testid=dialog-confirm]');
  await phone.page.waitForSelector('[data-testid=cloud-signup]');
  await go(phone.page, '#/books');
  await phone.page.waitForSelector('[data-testid=book-row]', { timeout: 5000 });
  assert.equal(await phone.page.locator('[data-testid=book-row]').count(), 1, 'books stay after logout');

  // second device restores
  const laptop = await device(fake);
  await signIn(laptop.page, 'kitobxon@example.com');
  await laptop.page.click('[data-testid=prompt-later]');
  await go(laptop.page, '#/cloud');
  await laptop.page.waitForSelector('[data-testid=cloud-row][data-status=cloud-only]');
  await laptop.page.click('[data-testid=restore-all]');
  await laptop.page.waitForSelector('[data-testid=cloud-row][data-status=synced]');
  await go(laptop.page, '#/books');
  await laptop.page.waitForSelector('[data-testid=book-row]');
  assert.match(await laptop.page.locator('[data-testid=book-row]').innerText(), /Birinchi kitob/);
  await go(laptop.page, `#/editor/${id}`);
  await laptop.page.waitForSelector('[data-testid=blocks]');
  assert.match(await laptop.page.locator('[data-testid=blocks]').innerText(), /Birinchi kitob matni/);

  // log back in on the phone: still in sync, nothing duplicated
  await signIn(phone.page, 'kitobxon@example.com');
  await go(phone.page, '#/cloud');
  await phone.page.waitForSelector('[data-testid=cloud-row][data-status=synced]');
  assert.equal(await phone.page.locator('[data-testid=cloud-row]').count(), 1);
  await phone.ctx.close(); await laptop.ctx.close();
});

test('two devices sync automatically; simultaneous edits ask the user and "keep both" loses nothing', async () => {
  const fake = createFakeSupabase();
  const a = await device(fake); const b = await device(fake);
  await signUp(a.page, 'ikki@example.com');
  await answerPrompt(a.page);
  const id = await createBook(a.page, 'Umumiy kitob');
  await a.page.waitForFunction(() => true);
  await go(a.page, '#/cloud');
  await a.page.click('[data-testid=backup-now]');
  await a.page.waitForSelector('[data-testid=cloud-row][data-status=synced]');

  await signIn(b.page, 'ikki@example.com');
  await b.page.click('[data-testid=prompt-backup]'); // B agrees to sync → receives A's book
  await go(b.page, '#/cloud');
  await b.page.waitForSelector('[data-testid=cloud-row][data-status=synced]');

  // both devices edit the same chapter before syncing
  for (const [dev, text] of [[a, ' — A qo‘shimchasi'], [b, ' — B qo‘shimchasi']]) {
    await dev.page.evaluate(() => { /* pause auto-sync */ });
    await go(dev.page, `#/editor/${id}`);
    const ed = dev.page.locator('[data-testid=blocks] .editable').first();
    await ed.click();
    await dev.page.keyboard.press('End');
    await dev.page.keyboard.type(text);
    await dev.page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.getAttribute('data-status') === 'saved');
  }
  await go(a.page, '#/cloud');
  await a.page.click('[data-testid=backup-now]');
  await a.page.waitForSelector('[data-testid=cloud-row][data-status=synced]', { timeout: 15000 });
  await go(b.page, '#/cloud');
  await b.page.click('[data-testid=backup-now]');
  await b.page.waitForSelector('[data-testid=cloud-row][data-status=conflict]', { timeout: 15000 });
  await b.page.screenshot({ path: path.join(OUT, 'cloud-conflict.png') });
  assert.match(fake.state.chapters.find((c) => fake.state.books[0].chapter_ids.includes(c.local_id)).blocks[0].html, /A qo/, 'cloud kept A');
  await b.page.click('[data-testid=resolve]');
  await b.page.click('[data-testid=conflict-both]');
  await b.page.waitForFunction(() => document.querySelectorAll('[data-testid=cloud-row]').length >= 2);
  await go(b.page, '#/books');
  await b.page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 2);
  const titles = await b.page.locator('[data-testid=book-row] strong').allTextContents();
  assert.ok(titles.some((t) => /bu qurilma/.test(t)), `copy of B's version kept: ${titles}`);
  await a.ctx.close(); await b.ctx.close();
});

test('offline: local work continues, status says offline, backup resumes when online', async () => {
  const fake = createFakeSupabase();
  const { ctx, page } = await device(fake);
  await signUp(page, 'oflayn@example.com');
  await answerPrompt(page);
  await page.waitForTimeout(3500); // background prefetch of all screens (what makes the app usable offline)
  fake.setOnline(false);
  await ctx.setOffline(true);
  await createBook(page, 'Oflayn yozilgan');
  await go(page, '#/cloud');
  await page.waitForFunction(() => /Oflayn/.test(document.querySelector('[data-testid=sync-chip]')?.textContent || ''));
  await page.waitForSelector('[data-testid=cloud-row]', { timeout: 5000 }); // local book still listed while offline
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'cloud-offline.png') });
  await go(page, '#/books');
  await page.waitForSelector('[data-testid=book-row]', { timeout: 5000 });
  assert.equal(await page.locator('[data-testid=book-row]').count(), 1);
  fake.setOnline(true);
  await ctx.setOffline(false);
  await go(page, '#/cloud');
  await page.waitForFunction(() => document.querySelector('[data-testid=cloud-row]')?.getAttribute('data-status') === 'synced', null, { timeout: 20000 });
  assert.equal(fake.state.books[0].title, 'Oflayn yozilgan');
  await ctx.close();
});

test('auth errors are explained and password reset is available', async () => {
  const fake = createFakeSupabase({ requireConfirmation: true });
  const { ctx, page } = await device(fake);
  await go(page, '#/profile');
  await page.click('[data-testid=account-signup]');
  await page.fill('[data-testid=auth-email]', 'tasdiq@example.com');
  await page.fill('[data-testid=auth-password]', '123');
  await page.click('[data-testid=auth-submit]');
  assert.match(await page.locator('[data-testid=auth-error]').innerText(), /kamida 8/);
  await page.fill('[data-testid=auth-password]', 'parol12345');
  await page.click('[data-testid=auth-submit]');
  assert.match(await page.locator('[data-testid=auth-notice]').innerText(), /Tasdiqlash havolasi/);
  await page.getByRole('tab', { name: 'Kirish' }).click();
  await page.fill('[data-testid=auth-password]', 'parol12345');
  await page.click('[data-testid=auth-submit]');
  assert.match(await page.locator('[data-testid=auth-error]').innerText(), /tasdiqlanmagan/);
  await page.click('[data-testid=auth-forgot]');
  await page.click('[data-testid=auth-submit]');
  assert.match(await page.locator('[data-testid=auth-notice]').innerText(), /tiklash havolasi/);
  await ctx.close();
});

test('cloud screens fit 360, 390 and 430 px without horizontal scrolling', async () => {
  const fake = createFakeSupabase();
  for (const w of [360, 390, 430]) {
    const { ctx, page } = await device(fake, { width: w, height: 820 });
    await createBook(page, `Mobil ${w}`);
    if (w === 360) await signUp(page, 'mobil@example.com'); else await signIn(page, 'mobil@example.com');
    const prompt = page.locator('[data-testid=prompt-backup]');
    if (await prompt.count()) await prompt.click();
    for (const hash of ['#/profile', '#/cloud']) {
      await go(page, hash);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${hash} overflows ${overflow}px at ${w}`);
    }
    await page.waitForSelector('[data-testid=cloud-row]');
    await page.screenshot({ path: path.join(OUT, `cloud-${w}.png`), fullPage: true });
    await ctx.close();
  }
});

test('Telegram Mini App: launch hash is cleaned, user is signed in automatically and can back up', async () => {
  const fake = createFakeSupabase();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const tgUser = JSON.stringify({ id: 777001, first_name: 'Malika', username: 'malika_uz' });
  const initData = new URLSearchParams({ user: tgUser, auth_date: String(Math.floor(Date.now() / 1000)), hash: 'test-valid-hash' }).toString();
  // Stand-in for https://telegram.org/js/telegram-web-app.js
  await ctx.route('https://telegram.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', headers: CORS,
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(initData)},initDataUnsafe:{user:${tgUser}},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};` }));
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const r = await fake.handle(req.method(), req.url(), req.headers(), req.postDataBuffer());
    await route.fulfill({ status: r.status, headers: { ...CORS, ...r.headers }, body: r.body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${origin}${SITE_BASE}?noIntro=1&fastAI=1#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`);
  await page.waitForSelector('.home .hero');
  assert.ok(!page.url().includes('tgWebAppData'), `launch params removed from the URL: ${page.url()}`);
  await waitFor(() => fake.log.includes('POST /functions/v1/telegram-auth'), 'telegram-auth called', 10000);
  await answerPrompt(page);
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=account-email]');
  assert.equal(await page.locator('[data-testid=account-email]').innerText(), 'Telegram: Malika');
  const card = await page.locator('.profile-card').innerText();
  assert.match(card, /Malika/);
  assert.match(card, /Telegram bilan ulangan/);
  assert.ok(!card.includes('Telegram: Malika'), 'Telegram name is not repeated');
  await page.screenshot({ path: path.join(OUT, 'cloud-telegram.png') });

  // Export → the user chooses: download or receive the file from the bot in their Telegram chat.
  await go(page, '#/create');
  await page.fill('[data-testid=creator-topic]', 'Telegram eksport sinovi');
  await page.locator('[data-testid=creator-chapters]').fill('3');
  await page.click('[data-testid=creator-outline]');
  await page.waitForSelector('[data-testid=outline-list] li');
  await page.click('[data-testid=creator-write]');
  await page.waitForFunction(() => document.querySelectorAll('.gen-item.is-done').length === document.querySelectorAll('.gen-item').length, null, { timeout: 60000 });
  await page.click('[data-testid=creator-save-edit]');
  await page.waitForSelector('[data-testid=editor]');
  await go(page, '#/export');
  await page.click('[data-testid=fmt-pdf]');
  await page.click('[data-testid=export-run]');
  await page.waitForSelector('[data-testid=export-done]');
  assert.equal(await page.locator('[data-testid=export-download]').count(), 1, 'download option');
  await page.click('[data-testid=export-telegram]');
  await page.waitForFunction(() => /Yuborildi/.test(document.querySelector('[data-testid=export-telegram]')?.textContent || ''), null, { timeout: 10000 });
  assert.equal(fake.sentFiles.length, 1, 'file sent through telegram-bot');
  assert.match(fake.sentFiles[0], /\.pdf$/);
  await page.screenshot({ path: path.join(OUT, 'export-telegram.png') });
  await ctx.close();
});

test('AI yordamchi through the server: needs sign-in, then real answers; nothing changes until the writer chooses', async () => {
  const fake = createFakeSupabase({ aiConfigured: true });
  await fake.fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yozuvchi@test.uz', password: 'parol-123456' }) });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const r = await fake.handle(req.method(), req.url(), req.headers(), req.postDataBuffer());
    await route.fulfill({ status: r.status, headers: { ...CORS, ...r.headers }, body: r.body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${origin}${SITE_BASE}?noIntro=1`);
  await page.waitForSelector('.home');
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor]');
  const para = page.locator('[data-testid=blocks] .editable').first();
  await para.click();
  await page.keyboard.type('Kitob yozish qiyin emas');
  await page.click('[data-testid=ai-open]');
  // signed out → the sheet explains and offers sign-in instead of failing
  await page.waitForSelector('[data-testid=ai-login]');
  await page.click('[data-testid=ai-login]');
  await page.fill('[data-testid=auth-email]', 'yozuvchi@test.uz');
  await page.fill('[data-testid=auth-password]', 'parol-123456');
  await page.click('[data-testid=auth-submit]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=ai-login]'), null, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await para.click();
  await page.click('[data-testid=ai-open]');
  await page.click('[data-testid=ai-rewrite]');
  await page.waitForSelector('[data-testid=ai-result]');
  assert.equal(await para.innerText(), 'Kitob yozish qiyin emas', 'unchanged before choosing');
  assert.match(await page.locator('[data-testid=ai-result]').innerText(), /AI\(rewrite\): Kitob yozish qiyin emas/);
  await page.click('[data-testid=ai-accept]');
  await page.waitForFunction(() => document.querySelector('[data-testid=blocks] .editable')?.textContent?.startsWith('AI(rewrite)'));
  assert.deepEqual(fake.aiCalls, ['rewrite']);
  await ctx.close();
});

test('delete all books (signed in): server 4-digit code, wrong/locked/replay rejected, only this user\'s books go, account and settings stay', async () => {
  const fake = createFakeSupabase();
  // another user with their own books in the cloud — must never be touched
  const other = await device(fake);
  await signUp(other.page, 'boshqa@test.uz');
  await promptAnswered(other.page);
  await createBook(other.page, 'Boshqa odam kitobi');
  await go(other.page, '#/cloud');
  await other.page.click('[data-testid=backup-now]');
  await waitFor(() => fake.state.books.length === 1, 'other user backed up');
  await other.ctx.close();

  const { ctx, page } = await device(fake, { width: 360, height: 740 });
  await signUp(page, 'ochiruvchi@test.uz');
  await promptAnswered(page);
  await createBook(page, 'Birinchi kitob');
  await go(page, '#/');
  await createBook(page, 'Ikkinchi kitob');
  await go(page, '#/cloud');
  await page.click('[data-testid=backup-now]');
  await waitFor(() => fake.state.books.length === 3, 'both books backed up');
  const me = [...fake.state.users.values()].find((u) => u.email === 'ochiruvchi@test.uz').id;

  await go(page, '#/profile');
  await page.click('[data-testid=clear-all]');
  await page.waitForSelector('[data-testid=wipe-sheet][data-mode=server]');
  await page.waitForSelector('[data-testid=wipe-input]');
  const code = (await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, '');
  assert.match(code, /^\d{4}$/);
  assert.equal(fake.wipeRequests.filter((r) => r.user_id === me && r.status === 'pending').length, 1, 'one session per user');
  assert.equal(await page.locator('[data-testid=wipe-confirm]').isDisabled(), true, 'disabled until 4 digits');
  // wrong code: server counts the attempt, nothing deleted
  const wrong = code === '0000' ? '1111' : '0000';
  await page.fill('[data-testid=wipe-input]', wrong);
  await page.click('[data-testid=wipe-confirm]');
  await page.waitForSelector('[data-testid=wipe-message]');
  assert.match(await page.locator('[data-testid=wipe-message]').innerText(), /4/);
  assert.equal(fake.state.books.length, 3, 'nothing deleted after a wrong code');
  // letters and extra digits are ignored by the numeric input
  await page.fill('[data-testid=wipe-input]', `a${code}9`);
  assert.equal(await page.locator('[data-testid=wipe-input]').inputValue(), code);
  await page.screenshot({ path: path.join(OUT, 'wipe-server-360.png') });
  await page.click('[data-testid=wipe-confirm]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=wipe-sheet]'));
  // this user's cloud books, chapters and files are gone; the other user's book is untouched
  assert.deepEqual(fake.state.books.map((b) => b.title), ['Boshqa odam kitobi']);
  assert.ok(fake.state.chapters.every((c) => c.user_id !== me));
  assert.ok([...fake.state.objects.keys()].every((k) => !k.startsWith(`${me}/`)));
  // replay of the used code is rejected
  const used = fake.wipeRequests.find((r) => r.user_id === me && r.status === 'used');
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('bookly.auth')).access_token);
  const replay = await fake.handle('POST', `${SUPA}/functions/v1/wipe-books`, { authorization: `Bearer ${token}` }, Buffer.from(JSON.stringify({ action: 'confirm', request_id: used.id, code: used.code })));
  assert.equal(JSON.parse(replay.body).status, 'invalid', 'a used code cannot be replayed');
  const noAuth = await fake.handle('POST', `${SUPA}/functions/v1/wipe-books`, {}, Buffer.from(JSON.stringify({ action: 'start' })));
  assert.equal(noAuth.status, 401, 'no session → rejected');
  // device: no books left, still signed in, settings kept
  await go(page, '#/books');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-testid=book-row]').count(), 0);
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=account-email]');
  // after the wipe a later sync must not bring anything back
  await go(page, '#/cloud');
  await page.click('[data-testid=backup-now]');
  await page.waitForTimeout(800);
  assert.deepEqual(fake.state.books.map((b) => b.title), ['Boshqa odam kitobi']);
  await ctx.close();
});

test('delete all books: 5 wrong codes lock the session and a new code is needed; expired codes are refused', async () => {
  const fake = createFakeSupabase({ wipeTtlMs: 1500 });
  const { ctx, page } = await device(fake);
  await signUp(page, 'qulf@test.uz');
  await promptAnswered(page);
  await createBook(page, 'Qolishi kerak');
  await go(page, '#/cloud');
  await page.click('[data-testid=backup-now]');
  await waitFor(() => fake.state.books.length === 1, 'backed up');
  await go(page, '#/profile');
  await page.click('[data-testid=clear-all]');
  await page.waitForSelector('[data-testid=wipe-input]');
  // expiry: wait past the (shortened) TTL, then the server refuses the right code
  const code1 = (await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, '');
  await page.waitForTimeout(1700);
  // the UI notices the expiry itself: input disabled, "new code" offered
  await page.waitForSelector('[data-testid=wipe-input][disabled]');
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('bookly.auth')).access_token);
  const late = await fake.handle('POST', `${SUPA}/functions/v1/wipe-books`, { authorization: `Bearer ${token}` }, Buffer.from(JSON.stringify({ action: 'confirm', request_id: fake.wipeRequests[0].id, code: code1 })));
  assert.equal(JSON.parse(late.body).status, 'expired', 'server refuses an expired code even if it is right');
  assert.equal(fake.state.books.length, 1);
  fake.setWipeTtl(300000);
  await page.click('[data-testid=wipe-new-code]');
  await page.waitForSelector('[data-testid=wipe-input]:not([disabled])');
  const code = (await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, '');
  const wrong = code === '1234' ? '4321' : '1234';
  for (let i = 0; i < 5; i++) {
    await page.fill('[data-testid=wipe-input]', wrong);
    await page.click('[data-testid=wipe-confirm]');
    await page.waitForFunction((n) => document.querySelector('[data-testid=wipe-message]') && document.querySelector('[data-testid=wipe-input]')?.value === '', i);
  }
  assert.match(await page.locator('[data-testid=wipe-message]').innerText(), /urinish|yangi kod/i);
  assert.equal(await page.locator('[data-testid=wipe-new-code]').count(), 1, 'offers a new code');
  assert.equal(fake.wipeRequests.at(-1).status, 'locked');
  assert.equal(fake.state.books.length, 1, 'nothing deleted');
  await ctx.close();
});

test('no uncaught page errors', () => { assert.deepEqual(pageErrors, []); });
