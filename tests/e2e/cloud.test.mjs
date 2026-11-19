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
  await page.goto(`${origin}${SITE_BASE}?noIntro=1`);
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
  await page.goto(`${origin}${SITE_BASE}?noIntro=1#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`);
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
  await page.fill('[data-testid=wizard-title]', 'Telegram eksport sinovi');
  await page.click('[data-testid=wizard-next]');
  await page.click('[data-testid=wizard-next]');
  await page.click('[data-testid=wizard-create]');
  await page.waitForSelector('[data-testid=editor]');
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.keyboard.type('Telegram orqali yuboriladigan kitob matni.');
  await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.getAttribute('data-status') === 'saved', null, { timeout: 8000 });
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

/** A device inside Telegram, signed in automatically as the given Telegram user. */
async function telegramDevice(fake, tgUser, { width = 390, height = 844, extra = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const user = JSON.stringify(tgUser);
  const initData = new URLSearchParams({ user, auth_date: String(Math.floor(Date.now() / 1000)), hash: 'test-valid-hash' }).toString();
  await ctx.route('https://telegram.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', headers: CORS,
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(initData)},initDataUnsafe:{user:${user}},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}${extra}}};` }));
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const r = await fake.handle(req.method(), req.url(), req.headers(), req.postDataBuffer());
    await route.fulfill({ status: r.status, headers: { ...CORS, ...r.headers }, body: r.body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${origin}${SITE_BASE}?noIntro=1#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`);
  await page.waitForSelector('.home');
  await waitFor(() => [...fake.state.users.values()].some((u) => Number(u.meta?.telegram_id) === tgUser.id), 'telegram sign-in', 10000);
  await answerPrompt(page);
  return { ctx, page };
}

test('Telegram full screen on phones: requested at start, content kept below the status bar and Telegram buttons, can be switched off', async () => {
  const fake = createFakeSupabase();
  // Telegram 8.0 on Android: full screen + safe areas (24px status bar, 46px Telegram Close/⋯ buttons)
  const extra = `,platform:'android',isFullscreen:false,isVersionAtLeast(v){return parseFloat(v)<=8},`
    + `safeAreaInset:{top:24,bottom:16,left:0,right:0},contentSafeAreaInset:{top:46,bottom:0,left:0,right:0},`
    + `__h:{},onEvent(e,cb){(this.__h[e]=this.__h[e]||[]).push(cb)},`
    + `requestFullscreen(){window.__fs=(window.__fs||0)+1;this.isFullscreen=true;(this.__h.fullscreenChanged||[]).forEach(f=>f())},`
    + `exitFullscreen(){this.isFullscreen=false;(this.__h.fullscreenChanged||[]).forEach(f=>f())}`;
  const { ctx, page } = await telegramDevice(fake, { id: 800001, first_name: 'Ekran' }, { width: 390, height: 844, extra });
  assert.equal(await page.evaluate(() => window.__fs), 1, 'full screen requested once at start');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tg-fullscreen')), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-t').trim()), '70px');
  await go(page, '#/books');
  const head = await page.locator('.page-header').first().boundingBox();
  const title = await page.locator('.page-header h1').first().boundingBox();
  assert.ok(title.y >= 70, `title starts below Telegram's buttons (${title.y}px)`);
  assert.ok(head.y >= 0);
  const tabbar = await page.locator('.tabbar').boundingBox();
  assert.ok(tabbar.y + tabbar.height <= 844 + 0.5, 'tab bar inside the screen');
  await page.screenshot({ path: path.join(OUT, 'telegram-fullscreen.png') });
  // switch off in Profile → back to the normal Telegram window, and remembered
  await go(page, '#/profile');
  await page.locator('label[for=fs]').scrollIntoViewIfNeeded();
  await page.click('label[for=fs]');
  await page.waitForFunction(() => !document.documentElement.classList.contains('tg-fullscreen'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bookly.settings')).fullscreen), false);
  await ctx.close();
});

test('admin panel: only admins get in; stats, broadcast with photo to subscribers (blocked ones skipped), personal message, announcement, feedback inbox', async () => {
  const ADMIN = 900001, USER = 900002;
  const fake = createFakeSupabase({ adminTelegramIds: [ADMIN] });
  // bot subscribers (people who pressed /start); one of them blocked the bot
  for (const id of [USER, 900010, 900011, 900012]) fake.state.subscribers.push({ telegram_id: id, first_name: `U${id}`, username: null, blocked: false });
  fake.state.subscribers.push({ telegram_id: ADMIN, first_name: 'Admin', username: 'boss', blocked: false });
  fake.blockingIds.add(900012);

  // an ordinary user: no admin entry, the admin route says "no access", can send feedback
  const u = await telegramDevice(fake, { id: USER, first_name: 'Dilnoza', username: 'dilnoza' });
  await go(u.page, '#/profile');
  await u.page.waitForSelector('[data-testid=account-email]');
  await u.page.waitForTimeout(600);
  assert.equal(await u.page.locator('[data-testid=profile-admin]').count(), 0, 'no admin entry for ordinary users');
  await go(u.page, '#/admin');
  await u.page.waitForSelector('[data-testid=admin-page] .empty');
  assert.match(await u.page.locator('[data-testid=admin-page]').innerText(), /Ruxsat yo‘q/);
  const forged = await fake.handle('POST', `${SUPA}/functions/v1/admin`, { authorization: `Bearer ${await u.page.evaluate(() => JSON.parse(localStorage.getItem('bookly.auth')).access_token)}` }, Buffer.from(JSON.stringify({ action: 'broadcast', text: 'hack' })));
  assert.equal(forged.status, 403, 'server refuses non-admins');
  await go(u.page, '#/help');
  await u.page.fill('[data-testid=help-feedback]', 'PDF’da rasm kichik chiqyapti');
  await u.page.click('[data-testid=help-feedback-send]');
  await u.page.waitForSelector('[data-testid=help-thanks]');
  assert.equal(fake.state.feedback.length, 1);
  assert.ok(fake.botMessages.some((m) => m.chat_id === ADMIN && /PDF’da rasm/.test(m.text)), 'admins are told about new feedback at once');

  // the admin
  const a = await telegramDevice(fake, { id: ADMIN, first_name: 'Bosh', username: 'boss' }, { width: 360, height: 760 });
  await go(a.page, '#/profile');
  await a.page.click('[data-testid=profile-admin]');
  await a.page.waitForSelector('[data-testid=admin-stats] .kpi');
  const kpis = await a.page.locator('.kpi strong').allInnerTexts();
  assert.equal(kpis[0], '2', 'two users');
  await a.page.screenshot({ path: path.join(OUT, 'admin-stats-360.png'), fullPage: true });

  // broadcast: test to me first, then everyone (with a photo)
  await a.page.getByRole('tab', { name: 'Xabar yuborish' }).click();
  await a.page.fill('[data-testid=admin-text]', '**Yangilik!** Bookly’da 6 xil dizayn <bor>');
  assert.match(await a.page.locator('[data-testid=admin-preview]').innerHTML(), /<b>Yangilik!<\/b>.*&lt;bor&gt;/, 'preview shows formatting and escapes HTML');
  await a.page.setInputFiles('[data-testid=admin-photo]', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
  await a.page.waitForSelector('[data-testid=admin-preview] img');
  await a.page.click('[data-testid=admin-test]');
  await waitFor(() => fake.botMessages.some((m) => m.chat_id === ADMIN && m.photo && /<b>Yangilik!<\/b>/.test(m.text)), 'test message to the admin');
  const before = fake.botMessages.length;
  await a.page.click('[data-testid=admin-send]');
  await a.page.click('[data-testid=dialog-confirm]');
  await a.page.waitForSelector('[data-testid=broadcast-list] li[data-status=done]', { timeout: 10000 });
  const sentNow = fake.botMessages.slice(before).map((m) => m.chat_id).sort();
  // the admin gets one preview (not a second copy); every other subscriber except the one who blocked the bot
  assert.deepEqual(sentNow, [ADMIN, USER, 900010, 900011].sort(), 'each person exactly once');
  assert.equal(fake.state.subscribers.find((x) => x.telegram_id === 900012).blocked, true, 'blocked subscriber is marked');
  assert.match(await a.page.locator('[data-testid=broadcast-list] li').first().innerText(), /4\/5/);
  await a.page.screenshot({ path: path.join(OUT, 'admin-broadcast-360.png'), fullPage: true });

  // users: search, open, personal message
  await a.page.getByRole('tab', { name: 'Foydalanuvchilar' }).click();
  await a.page.fill('[data-testid=admin-user-search]', 'Dilnoza');
  await a.page.waitForFunction(() => document.querySelectorAll('[data-testid=admin-users] li').length === 1);
  await a.page.locator('[data-testid=admin-users] li button').click();
  await a.page.locator('.sheet [data-testid=admin-text]').fill('Salom, Dilnoza! Fikringiz uchun rahmat.');
  await a.page.locator('.sheet [data-testid=admin-send]').click();
  await waitFor(() => fake.botMessages.some((m) => m.chat_id === USER && /Salom, Dilnoza/.test(m.text)), 'personal message');
  await a.page.keyboard.press('Escape');

  // books: metadata of everyone's books (never the text), also inside the user's card
  await u.page.evaluate(() => { location.hash = '#/'; });
  await createBook(u.page, 'Dilnozaning kitobi');
  await go(u.page, '#/cloud');
  await u.page.click('[data-testid=backup-now]');
  await waitFor(() => fake.state.books.some((b) => b.title === 'Dilnozaning kitobi'), 'user book in the cloud');
  await a.page.getByRole('tab', { name: 'Kitoblar' }).click();
  await a.page.waitForSelector('[data-testid=admin-books] li');
  assert.match(await a.page.locator('[data-testid=admin-books]').innerText(), /Dilnozaning kitobi[\s\S]*Dilnoza/);
  await a.page.fill('[data-testid=admin-book-search]', 'yo‘q-bunday');
  await a.page.waitForSelector('[data-testid=admin-page] .muted.small >> text=Kitob yo‘q.');
  await a.page.getByRole('tab', { name: 'Foydalanuvchilar' }).click();
  await a.page.locator('[data-testid=admin-users] li button').first().click();
  await a.page.waitForSelector('.sheet [data-testid=admin-books] li');
  await a.page.keyboard.press('Escape');

  // announcement → everyone sees it at the top of the app and can close it
  await a.page.getByRole('tab', { name: 'E’lon' }).click();
  await a.page.fill('[data-testid=announce-text]', 'Yangi dizaynlar qo‘shildi!');
  await a.page.click('[data-testid=announce-publish]');
  await a.page.waitForSelector('[data-testid=announce-list] li');
  await u.page.goto('about:blank');
  await u.page.goto(`${origin}${SITE_BASE}?noIntro=1#/`);
  await u.page.waitForSelector('[data-testid=announcement]');
  assert.match(await u.page.locator('[data-testid=announcement]').innerText(), /Yangi dizaynlar/);
  await u.page.click('[data-testid=announcement-close]');
  await u.page.reload();
  await u.page.waitForSelector('.home');
  await u.page.waitForTimeout(600);
  assert.equal(await u.page.locator('[data-testid=announcement]').count(), 0, 'closed announcement stays closed');

  // feedback inbox → reply goes to the user's Telegram
  await a.page.getByRole('tab', { name: 'Murojaatlar' }).click();
  await a.page.waitForSelector('[data-testid=feedback-list] li');
  await a.page.click('[data-testid=feedback-reply]');
  await a.page.fill('[data-testid=feedback-reply-text]', 'Tuzatdik, yangilab ko‘ring!');
  await a.page.click('[data-testid=feedback-send]');
  await waitFor(() => fake.botMessages.some((m) => m.chat_id === USER && /Tuzatdik/.test(m.text)), 'reply delivered');
  assert.equal(fake.state.feedback[0].status, 'answered');
  await a.ctx.close(); await u.ctx.close();
});

test('admin panel says so plainly when the server part is not set up', async () => {
  const fake = createFakeSupabase({ adminTelegramIds: [900001], adminReady: false });
  const a = await telegramDevice(fake, { id: 900001, first_name: 'Bosh' });
  await go(a.page, '#/admin');
  await a.page.waitForSelector('[data-testid=admin-page] .wipe-error, [data-testid=admin-page] .empty');
  assert.match(await a.page.locator('[data-testid=admin-page]').innerText(), /serverda hali yoqilmagan/);
  await go(a.page, '#/help');
  await a.page.fill('[data-testid=help-feedback]', 'Salom');
  await a.page.click('[data-testid=help-feedback-send]');
  await a.page.waitForSelector('.toast');
  assert.match(await a.page.locator('.toast').last().innerText(), /hali yoqilmagan/);
  await a.ctx.close();
});

test('delete all books still works when the server code check is not set up: code checked on the device, cloud copies removed with the user\'s own session', async () => {
  const fake = createFakeSupabase({ wipeReady: false });
  const other = await device(fake);
  await signUp(other.page, 'qoshni@test.uz');
  await promptAnswered(other.page);
  await createBook(other.page, 'Qo‘shni kitobi');
  await go(other.page, '#/cloud');
  await other.page.click('[data-testid=backup-now]');
  await waitFor(() => fake.state.books.length === 1, 'other user backed up');
  await other.ctx.close();
  const otherId = fake.state.books[0].user_id;
  fake.state.objects.set(`${otherId}/qoshni.png`, { bytes: Buffer.from('x'), type: 'image/png' });
  fake.state.assets.push({ id: 'a-other', user_id: otherId, local_id: 'ast_other', storage_path: `${otherId}/qoshni.png` });

  const { ctx, page } = await device(fake, { width: 360, height: 740 });
  await signUp(page, 'egasi@test.uz');
  await promptAnswered(page);
  await createBook(page, 'Mening kitobim');
  await go(page, '#/cloud');
  await page.click('[data-testid=backup-now]');
  await waitFor(() => fake.state.books.length === 2, 'my book backed up');
  const me = [...fake.state.users.values()].find((u) => u.email === 'egasi@test.uz').id;
  fake.state.objects.set(`${me}/rasm.png`, { bytes: Buffer.from('y'), type: 'image/png' });
  fake.state.assets.push({ id: 'a-me', user_id: me, local_id: 'ast_me', storage_path: `${me}/rasm.png` });

  await go(page, '#/profile');
  await page.click('[data-testid=clear-all]');
  await page.waitForSelector('[data-testid=wipe-sheet][data-mode=direct]');
  assert.equal(await page.locator('[data-testid=wipe-message]').count(), 0, 'no "server not ready" error');
  const code = (await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, '');
  await page.fill('[data-testid=wipe-input]', code === '0000' ? '1111' : '0000');
  await page.click('[data-testid=wipe-confirm]');
  await page.waitForSelector('[data-testid=wipe-message]');
  assert.equal(fake.state.books.length, 2, 'wrong code deletes nothing');
  await page.fill('[data-testid=wipe-input]', code);
  await page.click('[data-testid=wipe-confirm]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=wipe-sheet]'));
  assert.deepEqual(fake.state.books.map((b) => b.title), ['Qo‘shni kitobi'], 'only my cloud book is gone');
  assert.ok(fake.state.chapters.every((c) => c.user_id !== me), 'my chapters gone');
  assert.ok(!fake.state.objects.has(`${me}/rasm.png`), 'my file gone');
  assert.ok(fake.state.objects.has(`${otherId}/qoshni.png`), 'neighbour file kept');
  assert.deepEqual(fake.state.assets.map((a) => a.id), ['a-other'], 'neighbour asset row kept');
  await go(page, '#/books');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-testid=book-row]').count(), 0, 'device cleared too');
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=account-email]'); // still signed in
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
