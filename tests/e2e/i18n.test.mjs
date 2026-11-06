// Interface in three languages at 360 px: every screen and dialog is translated, nothing overflows,
// and the Telegram Mini App flavour of the app works the same in each language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'test-results', 'i18n');
fs.mkdirSync(OUT, { recursive: true });
const SITE_BASE = process.env.BASE_PATH || '/bookly.v2/';
const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
let server, browser, origin;
const errors = [];

before(async () => {
  server = await startServer(path.join(ROOT, 'dist'), 0, { base: SITE_BASE });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.close(); });

/** Text that would betray an untranslated Uzbek string in a ru/en interface. */
const UZ_MARKERS = /o‘|g‘|O‘|G‘|\b(va|uchun|kitob|Kitob|bob|Bob|yoki|Saqlash|Saqlandi|Yangi|Qo‘shish|Yuklab|Zaxira|Profil|Sozlamalar|Ixtiyoriy|Bekor|Orqaga|Tayyor)\b/;
const CYR = /[А-Яа-яЁё]/;

async function langPage(locale, { width = 360, height = 740, telegram = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, colorScheme: 'dark', acceptDownloads: true });
  await ctx.addInitScript((l) => {
    try { if (!localStorage.getItem('bookly.settings')) localStorage.setItem('bookly.settings', JSON.stringify({ locale: l, introSeen: true })); } catch { /* ignore */ }
  }, locale);
  if (telegram) {
    await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Telegram={WebApp:{initData:"",initDataUnsafe:{},ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};' }));
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${locale}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`${locale} console: ${m.text()}`); });
  const hash = telegram ? '#tgWebAppData=x&tgWebAppVersion=8.0&tgWebAppPlatform=android' : '';
  await page.goto(`${origin}${SITE_BASE}?noIntro=1&fastAI=1${hash}`);
  await page.waitForSelector('.home');
  return { ctx, page };
}

const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(450); };

async function checkScreen(page, locale, name) {
  const info = await page.evaluate(() => {
    const w = document.documentElement.scrollWidth - innerWidth;
    // visible interface text only — user content (editor blocks, book titles in covers) is excluded
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[data-testid=blocks], .book-cover, .cover-preview, .book-content, script, style, noscript, [data-user-content]').forEach((n) => n.remove());
    // language names are deliberately written in their own language (O‘zbekcha / Русский / English)
    return { overflow: w, text: clone.innerText.replace(/O‘zbekcha|Русский|English/g, '') };
  });
  assert.ok(info.overflow <= 1, `${locale} ${name}: horizontal overflow ${info.overflow}px`);
  if (locale !== 'uz') {
    const hit = info.text.match(UZ_MARKERS);
    assert.equal(hit, null, `${locale} ${name}: untranslated Uzbek text "${hit?.[0]}" in: ${info.text.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 60)}`);
  }
  if (locale === 'en') assert.ok(!CYR.test(info.text), `en ${name}: Cyrillic text in the English interface: ${info.text.match(/.{0,40}[А-Яа-яЁё].{0,40}/)?.[0]}`);
  if (locale === 'ru') assert.ok(CYR.test(info.text), `ru ${name}: Russian text expected`);
  await page.screenshot({ path: path.join(OUT, `${locale}-${name}.png`) });
}

for (const locale of ['ru', 'en', 'uz']) {
  test(`${locale}: every screen, dialog and message is in ${locale} and fits 360 px`, async () => {
    const { ctx, page } = await langPage(locale);
    await checkScreen(page, locale, 'home');
    // new book dialog (two modes)
    await page.click('[data-testid=fab-create]');
    await checkScreen(page, locale, 'create-menu');
    await page.click('[data-testid=create-blank]');
    await checkScreen(page, locale, 'new-book');
    await page.fill('[data-testid=new-title]', 'Test 2026');
    await page.click('[data-testid=new-create]');
    await page.waitForSelector('[data-testid=editor]');
    await page.locator('[data-testid=blocks] .editable').first().click();
    await page.keyboard.type('Lorem ipsum 123.');
    await checkScreen(page, locale, 'editor');
    await page.click('[data-testid=insert-sheet]');
    await page.click('[data-testid=insert-more]');
    await checkScreen(page, locale, 'insert-menu');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=chapter-picker]');
    await checkScreen(page, locale, 'chapters');
    await page.click('.sheet [data-testid=add-chapter]');
    const autoTitle = await page.locator('[data-testid=chapter-title]').inputValue();
    assert.equal(autoTitle, { uz: '2-bob', ru: 'Глава 2', en: 'Chapter 2' }[locale], 'default chapter name follows the book language');
    await page.locator('[data-testid=blocks] .editable').first().click();
    await page.click('[data-testid=ai-open]');
    await checkScreen(page, locale, 'assistant');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=editor-details]');
    await checkScreen(page, locale, 'details');
    await page.keyboard.press('Escape');
    // delete-chapter confirmation dialog
    await page.click('[data-testid=chapter-picker]');
    await page.locator('.sheet [data-testid=ch-delete]').nth(1).click();
    await checkScreen(page, locale, 'confirm-dialog');
    await page.click('[data-testid=dialog-confirm]');
    await page.keyboard.press('Escape');
    const id = page.url().match(/editor\/([^?/]+)/)[1];

    for (const [name, hash] of [['library', '#/books'], ['studio', '#/studio'], ['templates', '#/templates'], ['import', '#/import'], ['cover', `#/cover/${id}`], ['reader', `#/reader/${id}`], ['creator', '#/create'], ['backup', '#/cloud']]) {
      await go(page, hash);
      await checkScreen(page, locale, name);
    }
    await go(page, `#/export/${id}`);
    await checkScreen(page, locale, 'export');
    await page.click('[data-testid=fmt-pdf]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-run]')]);
    assert.match(dl.suggestedFilename(), /\.pdf$/);
    await page.waitForSelector('[data-testid=export-done]');
    await checkScreen(page, locale, 'export-done');
    await go(page, '#/profile');
    await checkScreen(page, locale, 'profile');
    await page.click('[data-testid=export-defaults]');
    await page.click('[data-testid=profile-edit]');
    await checkScreen(page, locale, 'profile-edit');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=help]');
    await checkScreen(page, locale, 'help');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=clear-all]');
    await checkScreen(page, locale, 'wipe-dialog');
    await page.keyboard.press('Escape');
    // empty states
    await go(page, '#/books');
    await page.locator('.segmented button').last().click().catch(() => {});
    await checkScreen(page, locale, 'library-tab');
    await go(page, '#/not-a-page');
    await checkScreen(page, locale, 'not-found');
    // language switch is saved and applied immediately
    await go(page, '#/profile');
    const target = locale === 'en' ? 'Русский' : 'English';
    await page.getByRole('tab', { name: target }).click();
    await page.reload();
    await page.waitForSelector('.page.profile');
    assert.equal(await page.evaluate(() => document.documentElement.lang), locale === 'en' ? 'ru' : 'en');
    await ctx.close();
  });
}

test('Telegram Mini App mode shows the same translated interface', async () => {
  for (const locale of ['ru', 'en']) {
    const { ctx, page } = await langPage(locale, { telegram: true });
    await go(page, '#/profile');
    await checkScreen(page, locale, 'telegram-profile');
    await ctx.close();
  }
});

test('mobile: toasts never cover an open dialog; dialogs stay above the keyboard; 360 px toolbar has no overlaps', async () => {
  const { ctx, page } = await langPage('uz');
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor]');
  // toolbar buttons do not overlap each other at 360 px
  const boxes = await page.locator('.editor-toolbar > button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].left >= boxes[i - 1].right - 0.5, `toolbar buttons ${i - 1} and ${i} overlap`);
  for (const b of boxes) assert.ok(b.right <= 360 && b.left >= 0, 'toolbar fits the screen');
  // a toast fired while a sheet is open is shown above the sheet, not on top of it
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.keyboard.type('Matn');
  await page.click('[data-testid=ai-open]');
  await page.click('[data-testid=ai-continue]');
  await page.waitForSelector('[data-testid=ai-result]');
  await page.click('[data-testid=ai-copy]');
  const toast = await page.locator('.toast').first().boundingBox();
  const sheet = await page.locator('.sheet').first().boundingBox();
  assert.ok(toast && sheet && toast.y + toast.height <= sheet.y + 1, `toast (${toast?.y}+${toast?.height}) is above the sheet (${sheet?.y})`);
  await page.screenshot({ path: path.join(OUT, 'toast-over-sheet.png') });
  // simulated on-screen keyboard: the sheet moves up by its height
  await page.evaluate(() => document.documentElement.style.setProperty('--kb', '300px'));
  await page.waitForTimeout(250);
  const sheet2 = await page.locator('.sheet').first().boundingBox();
  assert.ok(sheet2.y + sheet2.height <= 740 - 300 + 1, `sheet bottom ${sheet2.y + sheet2.height} stays above the keyboard`);
  await ctx.close();
});

test('no page errors in any language', () => { assert.deepEqual(errors, []); });
