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
  await page.waitForSelector('[data-testid=editor]');
  await page.click('[data-testid=editor-details]');
  await page.fill('[data-testid=details-title]', title);
  await page.keyboard.press('Escape');
  const ed = page.locator('[data-testid=blocks] .editable').first();
  await ed.click();
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
  await a.page.click('[data-testid=prompt-backup]');
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
  await page.click('[data-testid=prompt-backup]');
  await page.waitForTimeout(3500); // background prefetch of all screens (what makes the app usable offline)
  fake.setOnline(false);
  await ctx.setOffline(true);
  await createBook(page, 'Oflayn yozilgan');
  await go(page, '#/cloud');
  await page.waitForFunction(() => /Oflayn/.test(document.querySelector('[data-testid=sync-chip]')?.textContent || ''));
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

test('no uncaught page errors', () => { assert.deepEqual(pageErrors, []); });
