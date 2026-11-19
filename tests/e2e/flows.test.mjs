// End-to-end browser tests (Playwright + node:test) against the production build in dist/.
// Run: npm run test:e2e   (set CHROME_PATH to use a specific Chrome/Chromium binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { startServer } from '../../scripts/serve.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const SITE_BASE = process.env.BASE_PATH || '/bookly.v2/';
let server, browser, base, origin;
const consoleErrors = [];

const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));

before(async () => {
  // Served exactly like GitHub Pages: https://<user>.github.io/bookly.v2/
  server = await startServer(path.join(ROOT, 'dist'), 0, { base: SITE_BASE });
  origin = `http://127.0.0.1:${server.address().port}`;
  base = `${origin}${SITE_BASE}?x=1`;
  browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function newPage({ width = 390, height = 844, intro = false, scheme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, hasTouch: width < 800, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
  await page.goto(base + (intro ? '' : '&noIntro=1'));
  await page.waitForSelector('.home', { timeout: 15000 });
  return { ctx, page };
}

const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash);

/** A realistic book text: headings, paragraphs, a list and a quote in every chapter (Markdown-like TXT). */
export function sampleBookText(title, chapters = 3) {
  const para = (c, k) => `${title} haqida ${c}-bobning ${k}-paragrafi. Kitob yozish — fikrni tartibga solish, so‘zlarni tanlash va o‘quvchini bir sahifadan keyingisiga olib o‘tish san’ati. `
    + 'Har bir bob aniq maqsad bilan boshlanadi va amaliy misollar bilan davom etadi; shuning uchun matn qisqa jumlalar, ravon o‘tishlar va tushunarli xulosalarga tayanadi. '
    + 'Yaxshi kitob o‘quvchiga hurmat bilan yoziladi: u savol beradi, javob izlaydi va eng muhim g‘oyani esda qoladigan qilib takrorlaydi.';
  const out = [`# ${title}`, ''];
  for (let c = 1; c <= chapters; c++) {
    out.push(`# ${c}-bob. ${['Kirish', 'Asosiy g‘oya', 'Amaliyot', 'Tajriba', 'Xulosa', 'Qo‘shimcha'][(c - 1) % 6]}`, '');
    out.push(para(c, 1), '', `## Muhim jihatlar`, '', para(c, 2), '', '- Aniq maqsad qo‘ying', '- Har kuni ozgina yozing', '- Natijani qayta o‘qing', '');
    out.push('> Har bir katta ish kichik qadamdan boshlanadi.', '', para(c, 3), '', para(c, 4), '', '## Amaliy misol', '', para(c, 5), '', para(c, 6), '');
  }
  return out.join('\n');
}

/** Creates a book the way a user would bring existing text in: Import → TXT → Save. Returns the book id. */
async function createBookFromText(page, title = 'Moliyaviy savodxonlik', chapters = 3) {
  await go(page, '#/import');
  await page.setInputFiles('[data-testid=import-input]', { name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(sampleBookText(title, chapters)) });
  await page.waitForSelector('[data-testid=import-result]');
  await page.click('[data-testid=import-save]');
  await page.waitForSelector('[data-testid=editor]');
  return page.evaluate(() => location.hash.split('/')[2].split('?')[0]);
}

async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.getAttribute('data-status') === 'saved', null, { timeout: 8000 });
}

test('splash intro plays once, can be skipped and is remembered', async () => {
  const { ctx, page } = await newPage({ intro: true });
  await page.waitForSelector('[data-testid=splash]');
  await page.screenshot({ path: path.join(OUT, 'splash.png') });
  await page.click('[data-testid=splash-skip]');
  await page.waitForSelector('[data-testid=splash]', { state: 'detached' });
  await page.reload();
  await page.waitForSelector('.home');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-testid=splash]').count(), 0, 'intro must not repeat');
  await ctx.close();
});

test('book wizard: validates, plans chapters, applies a design and saves (persists after reload)', async () => {
  const { ctx, page } = await newPage();
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-wizard]');
  await page.waitForSelector('[data-testid=wizard]');
  assert.equal(await page.locator('.tabbar').count(), 0, 'wizard is full-screen (no tab bar over the form)');
  await page.click('[data-testid=wizard-next]');
  assert.ok(await page.locator('.field-error').count() >= 1, 'empty title must be rejected');
  await page.fill('[data-testid=wizard-title]', 'Yoshlar uchun moliyaviy savodxonlik');
  await page.fill('[data-testid=wizard-subtitle]', 'Amaliy qo‘llanma');
  await page.fill('[data-testid=wizard-author]', 'Aziza Karimova');
  await page.click('[data-testid=wizard-category]');
  await page.click('[data-testid=wizard-category-opt-finance]');
  await page.click('[data-testid=wizard-next]');
  await page.click('[data-testid=wizard-plan-guide]');
  assert.equal(await page.locator('[data-testid=wizard-chapters] li').count(), 6);
  await page.locator('[data-testid=wizard-chapters] li input').first().fill('So‘zboshi');
  await page.click('[data-testid=wizard-add-chapter]');
  assert.equal(await page.locator('[data-testid=wizard-chapters] li').count(), 7);
  await page.screenshot({ path: path.join(OUT, 'wizard-structure.png') });
  await page.click('[data-testid=wizard-next]');
  await page.waitForSelector('[data-testid=wizard-tpl-executive] em'); // recommended for finance
  await page.click('[data-testid=wizard-tpl-novel]');
  await page.screenshot({ path: path.join(OUT, 'wizard-design.png') });
  await page.click('[data-testid=wizard-create]');
  await page.waitForSelector('[data-testid=editor]');
  const id = await page.evaluate(() => location.hash.split('/')[2].split('?')[0]);
  const read = () => page.evaluate(async (bid) => {
    const db = await new Promise((r) => { const q = indexedDB.open('bookly'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('books').objectStore('books').get(bid); q.onsuccess = () => r(q.result); });
  }, id);
  const b = await read();
  assert.equal(b.title, 'Yoshlar uchun moliyaviy savodxonlik');
  assert.equal(b.subtitle, 'Amaliy qo‘llanma');
  assert.equal(b.author, 'Aziza Karimova');
  assert.equal(b.category, 'finance');
  assert.equal(b.chapters.length, 7);
  assert.equal(b.chapters[0].title, 'So‘zboshi');
  assert.equal(b.theme.templateId, 'novel');
  assert.equal(b.cover.templateId, 'novel');
  assert.equal(b.cover.subtitle, 'Amaliy qo‘llanma');
  assert.equal(b.metadata.source, 'manual');
  await page.reload();
  await page.waitForSelector('[data-testid=editor]');
  assert.equal((await read()).chapters.length, 7);
  // one continuous text
  await go(page, '#/create');
  await page.fill('[data-testid=wizard-title]', 'Esse');
  await page.click('[data-testid=wizard-next]');
  await page.click('[data-testid=wizard-mode-single]');
  assert.equal(await page.locator('[data-testid=wizard-chapters]').count(), 0);
  await page.click('[data-testid=wizard-next]');
  await page.click('[data-testid=wizard-create]');
  await page.waitForSelector('[data-testid=editor]');
  assert.equal(await page.locator('[data-testid=chapter-title]').count(), 0, 'single text has no chapter title');
  await ctx.close();
});

test('editor: typing, autosave, split, insert blocks, chapters reorder, undo/redo', async () => {
  const { ctx, page } = await newPage();
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.click('[data-testid=mode-chapters]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor]');
  const ed = page.locator('[data-testid=blocks] .editable').first();
  await ed.click();
  await page.keyboard.type('Birinchi gap matni');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ikkinchi paragraf');
  await waitSaved(page);
  assert.equal(await page.locator('[data-testid=blocks] .blk-paragraph').count(), 2, 'Enter splits into a new paragraph');
  // bold via toolbar
  await page.keyboard.down('Shift'); for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
  await page.click('[data-testid=fmt-bold]');
  await waitSaved(page);
  assert.ok((await page.locator('[data-testid=blocks] b').count()) >= 1, 'bold applied');
  // chapter title
  await page.fill('[data-testid=chapter-title]', 'Kirish');
  // insert heading, table, divider, list, page break
  for (const k of ['heading', 'table', 'divider', 'list', 'pagebreak', 'quote']) {
    await page.click('[data-testid=insert-sheet]');
    if (!['heading', 'quote'].includes(k)) await page.click('[data-testid=insert-more]');
    await page.click(`[data-testid=insert-${k}]`);
  }
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.blk-table').count(), 1);
  assert.equal(await page.locator('.blk-divider').count(), 1);
  assert.equal(await page.locator('.blk-pagebreak').count(), 1);
  const before = await page.locator('[data-testid=blocks] .blk-wrap').count();
  await page.click('[data-testid=undo]');
  assert.equal(await page.locator('[data-testid=blocks] .blk-wrap').count(), before - 1, 'undo removes last insert');
  await page.click('[data-testid=redo]');
  assert.equal(await page.locator('[data-testid=blocks] .blk-wrap').count(), before, 'redo restores it');
  // turn into heading via block menu
  // the block menu is hidden until a block is being edited
  assert.equal(await page.locator('.blk-wrap:not(.is-active) [data-testid=block-handle]').first().evaluate((el) => getComputedStyle(el).opacity), '0', 'handle hidden for inactive blocks');
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.locator('.blk-wrap.is-active [data-testid=block-handle]').click();
  await page.click('[data-testid=turn-h2]');
  assert.equal(await page.locator('[data-testid=blocks] .blk-heading').count() >= 2, true);
  // chapters: add & reorder
  await page.click('[data-testid=chapter-picker]');
  await page.click('.sheet [data-testid=add-chapter]');
  await page.fill('[data-testid=chapter-title]', 'Ikkinchi bob');
  await waitSaved(page);
  await page.click('[data-testid=chapter-picker]');
  const sheet = page.locator('.sheet [data-testid=chapter-list]');
  await page.waitForSelector('.sheet [data-testid=chapter-list] li:nth-child(2)');
  await sheet.locator('[data-testid=ch-down]').first().click();
  const titles = await sheet.locator('.ch-text > span').allTextContents();
  assert.deepEqual(titles, ['Ikkinchi bob', 'Kirish'], 'chapter reordered');
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid=editor]');
  await page.click('[data-testid=chapter-picker]');
  await page.waitForSelector('.sheet [data-testid=chapter-list] li:nth-child(2)');
  assert.deepEqual(await page.locator('.sheet [data-testid=chapter-list] .ch-text > span').allTextContents(), ['Ikkinchi bob', 'Kirish'], 'order persisted');
  await page.locator('.sheet .ch-select').nth(1).click();
  assert.ok((await page.locator('[data-testid=blocks]').innerText()).includes('Birinchi gap'), 'content persisted after reload');
  await ctx.close();
});

test('book style: design, fonts, accent and size apply to the preview and are saved', async () => {
  const { ctx, page } = await newPage();
  const id = await createBookFromText(page, 'Vaqtni boshqarish', 3);
  assert.equal(await page.locator('[data-testid=ai-open]').count(), 0, 'no AI button');
  await page.click('[data-testid=style-open]');
  await page.waitForSelector('[data-testid=style-sheet]');
  await page.click('[data-testid=style-tpl-noir]');
  await page.click('[data-testid=style-hfont-elegant]');
  await page.click('[data-testid=style-bfont-sans]');
  await page.click('[data-testid=style-accent-059669]');
  await page.getByRole('tab', { name: 'Katta', exact: true }).click();
  await page.screenshot({ path: path.join(OUT, 'style-sheet.png') });
  await page.keyboard.press('Escape');
  await waitSaved(page);
  const theme = await page.evaluate(async (bid) => {
    const db = await new Promise((r) => { const q = indexedDB.open('bookly'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('books').objectStore('books').get(bid); q.onsuccess = () => r(q.result); });
  }, id);
  assert.equal(theme.theme.templateId, 'noir');
  assert.equal(theme.cover.templateId, 'noir', 'a design also restyles the cover');
  assert.equal(theme.theme.headingFont, 'elegant');
  assert.equal(theme.theme.bodyFont, 'sans');
  assert.equal(theme.theme.accent, '#059669');
  assert.equal(theme.theme.baseSize, 13);
  await page.click('[data-testid=editor-preview]');
  await page.waitForSelector('[data-testid=live-preview] .book-content');
  const css = await page.$eval('[data-testid=live-preview] .book-content', (e) => ({ accent: e.style.getPropertyValue('--accent'), body: getComputedStyle(e).fontFamily }));
  assert.equal(css.accent, '#059669');
  assert.match(css.body, /Inter|Segoe|Roboto|system-ui|sans-serif/);
  await ctx.close();
});

test('library: search, favorite, duplicate, rename, trash and restore', async () => {
  const { ctx, page } = await newPage();
  await createBookFromText(page, 'Sog‘lom turmush tarzi', 3);
  await go(page, '#/books');
  await page.waitForSelector('[data-testid=book-row]');
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-duplicate]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 2);
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-favorite]');
  await go(page, '#/books?tab=favorites');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 1);
  await go(page, '#/books');
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-rename]');
  await page.fill('.sheet input.input', 'Qayta nomlangan kitob');
  await page.click('[data-testid=dialog-confirm]');
  await page.waitForFunction(() => document.body.innerText.includes('Qayta nomlangan kitob'));
  await page.fill('[data-testid=library-search]', 'Qayta nomlangan');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 1);
  await page.fill('[data-testid=library-search]', '');
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-delete]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 1);
  await go(page, '#/books?tab=trash');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 1);
  await page.screenshot({ path: path.join(OUT, 'trash.png') });
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-restore]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 0);
  await go(page, '#/books');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 2);
  await page.screenshot({ path: path.join(OUT, 'library.png') });
  await ctx.close();
});

test('book menu: every action, including delete, is visible without scrolling on a small phone; delete works', async () => {
  const { ctx, page } = await newPage({ width: 320, height: 560 }); // ≈ 360×640 phone with a large system font
  await createBookFromText(page, 'Suniy intellekt talabalar talimida Rustamov Anvarjon kengaytirilgan', 1);
  await go(page, '#/books');
  await page.locator('[data-testid=row-menu]').first().click();
  await page.waitForSelector('.sheet .menu-grid');
  await page.waitForTimeout(400);
  for (const id of ['menu-edit', 'menu-preview', 'menu-cover', 'menu-export', 'menu-favorite', 'menu-rename', 'menu-duplicate', 'menu-status', 'menu-delete']) {
    const b = await page.locator(`[data-testid=${id}]`).boundingBox();
    assert.ok(b && b.y >= 0 && b.y + b.height <= 560 + 0.5 && b.x >= 0 && b.x + b.width <= 320 + 0.5, `${id} is on screen: ${JSON.stringify(b)}`);
  }
  await page.screenshot({ path: path.join(OUT, 'book-menu-320.png') });
  await page.click('[data-testid=menu-delete]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 0);
  await go(page, '#/books?tab=trash');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 1);
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-delete-forever]');
  if (await page.locator('[data-testid=dialog-confirm]').count()) await page.click('[data-testid=dialog-confirm]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-row]').length === 0);
  await ctx.close();
});

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file), file };
}

test('cover designer customises the cover and exports PNG/JPG', async () => {
  const { ctx, page } = await newPage();
  const id = await createBookFromText(page, 'Kosmos sirlari', 3);
  await go(page, `#/cover/${id}`);
  await page.waitForSelector('[data-testid=cover-canvas]');
  await page.fill('[data-testid=cover-title]', 'Kosmos sirlari: yulduzlar');
  await page.getByRole('tab', { name: 'Shablon', exact: true }).click();
  await page.click('[data-testid=cover-tpl-bold]');
  await page.getByRole('tab', { name: 'Ranglar', exact: true }).click();
  await page.click('[data-testid=palette-sunset]');
  await page.getByRole('tab', { name: 'Naqsh', exact: true }).click();
  await page.click('[data-testid=pattern-geometric]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=pattern-again] .spinner'));
  await page.click('[data-testid=pattern-again]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=pattern-again]')?.hasAttribute('disabled'));
  await page.screenshot({ path: path.join(OUT, 'cover.png') });
  const png = await download(page, () => page.click('[data-testid=cover-png]'));
  assert.ok(png.name.endsWith('.png'));
  assert.deepEqual([...png.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const jpg = await download(page, () => page.click('[data-testid=cover-jpg]'));
  assert.ok(jpg.name.endsWith('.jpg'));
  assert.deepEqual([...jpg.bytes.subarray(0, 2)], [0xff, 0xd8]);
  await page.click('[data-testid=cover-save]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(async (bid) => {
    const db = await new Promise((r) => { const q = indexedDB.open('bookly'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('books').objectStore('books').get(bid); q.onsuccess = () => r(q.result.cover); });
  }, id);
  assert.equal(saved.title, 'Kosmos sirlari: yulduzlar');
  assert.equal(saved.templateId, 'bold');
  assert.equal(saved.background.kind, 'image', 'pattern is stored as the cover background image');
  assert.ok(saved.background.imageAssetId, 'pattern image asset saved');
  await ctx.close();
});

test('export center produces valid PDF, EPUB, DOCX and PPTX files; import round-trips', async () => {
  const { ctx, page } = await newPage();
  const id = await createBookFromText(page, 'Raqamli marketing', 3);
  // add an image block so exports include media
  const pngB64 = fs.readFileSync(path.join(OUT, 'cover.png')).toString('base64');
  await page.click('[data-testid=insert-sheet]');
  await page.click('[data-testid=insert-image]');
  await page.setInputFiles('[data-testid=image-input]', { name: 'rasm.png', mimeType: 'image/png', buffer: Buffer.from(pngB64, 'base64') });
  await page.waitForSelector('.blk-image img');
  await waitSaved(page);
  await go(page, `#/export/${id}`);
  await page.waitForSelector('[data-testid=export-run]');
  await page.screenshot({ path: path.join(OUT, 'export.png'), fullPage: true });
  const files = {};
  for (const f of ['pdf', 'epub', 'docx', 'pptx']) {
    await page.click(`[data-testid=fmt-${f}]`);
    const out = await download(page, () => page.click('[data-testid=export-run]'));
    assert.ok(out.name.endsWith(`.${f}`), `${f} extension`);
    assert.ok(out.bytes.length > 2000, `${f} not empty`);
    files[f] = out;
  }
  await page.waitForSelector('[data-testid=export-done]');
  assert.equal(files.pdf.bytes.subarray(0, 5).toString(), '%PDF-');
  const epub = await JSZip.loadAsync(files.epub.bytes);
  assert.equal(await epub.file('mimetype').async('string'), 'application/epub+zip');
  assert.ok(Object.keys(epub.files).some((n) => n.startsWith('OEBPS/images/')), 'epub has images');
  const docx = await JSZip.loadAsync(files.docx.bytes);
  assert.ok((await docx.file('word/document.xml').async('string')).includes('w:drawing'), 'docx has image');
  const pptx = await JSZip.loadAsync(files.pptx.bytes);
  assert.ok(Object.keys(pptx.files).filter((n) => /slides\/slide\d+\.xml$/.test(n)).length >= 6);

  // import the generated DOCX and EPUB back + a TXT file
  for (const [f, mime] of [['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['epub', 'application/epub+zip']]) {
    await go(page, '#/import');
    await page.setInputFiles('[data-testid=import-input]', { name: `kitob.${f}`, mimeType: mime, buffer: files[f].bytes });
    await page.waitForSelector('[data-testid=import-result]');
    const txt = await page.locator('[data-testid=import-result]').innerText();
    assert.match(txt, /3 bob topildi/, `${f} import detects 3 chapters: ${txt.slice(0, 200)}`);
    await page.click('[data-testid=import-save]');
    await page.waitForSelector('[data-testid=editor]');
  }
  await go(page, '#/import');
  await page.setInputFiles('[data-testid=import-input]', { name: 'eslatma.txt', mimeType: 'text/plain', buffer: Buffer.from('# Mening kitobim\n\n# 1-bob Boshlanish\n\nBirinchi paragraf.\n\n- band bir\n- band ikki\n\n# 2-bob Davomi\n\nIkkinchi bob matni.') });
  await page.waitForSelector('[data-testid=import-result]');
  assert.match(await page.locator('[data-testid=import-result]').innerText(), /2 bob topildi/);
  await page.setInputFiles('[data-testid=import-input]', { name: 'rasm.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await page.waitForSelector('[data-testid=import-error]');
  await ctx.close();
});

test('reader shows cover, TOC, chapter navigation, typography and progress', async () => {
  const { ctx, page } = await newPage({ scheme: 'light' });
  const id = await createBookFromText(page, 'Bolalar ertaklari', 3);
  await go(page, `#/reader/${id}`);
  await page.waitForSelector('[data-testid=reader-start]');
  await page.screenshot({ path: path.join(OUT, 'reader-cover.png') });
  await page.click('[data-testid=reader-start]');
  await page.waitForSelector('.book-content');
  await page.click('[data-testid=reader-next]');
  assert.match(await page.locator('.reader-title small').innerText(), /2 \/ 3/);
  await page.click('[data-testid=reader-settings]');
  await page.click('[data-testid=font-inc]');
  await page.click('text=Sepiya');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('.reader.mode-sepia').count());
  await page.click('[data-testid=reader-toc]');
  await page.locator('[data-testid=toc-item]').nth(2).click();
  assert.match(await page.locator('.reader-title small').innerText(), /3 \/ 3/);
  await page.screenshot({ path: path.join(OUT, 'reader.png') });
  await ctx.close();
});

test('two book modes: "Bitta yaxlit matn" has no chapters anywhere, "Boblar bilan" manages chapters', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  // --- one continuous text
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.screenshot({ path: path.join(OUT, 'new-book-modes.png') });
  await page.fill('[data-testid=new-title]', 'Yaxlit hikoya');
  await page.click('[data-testid=mode-single]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor][data-layout=single]');
  assert.equal(await page.locator('[data-testid=chapter-title]').count(), 0, 'no chapter title in single mode');
  assert.equal(await page.locator('[data-testid=chapter-picker]').count(), 0, 'no chapter picker in single mode');
  const ph = await page.locator('[data-testid=blocks] .editable').first().getAttribute('data-placeholder');
  assert.equal(ph, 'Matningizni shu yerga yozing...');
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.keyboard.type('Bir bor ekan, bir yo‘q ekan.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Uzluksiz matn davom etadi.');
  // "+" menu: subheading turns the empty paragraph under the cursor into a heading
  await page.keyboard.press('Enter');
  await page.click('[data-testid=insert-sheet]');
  await page.screenshot({ path: path.join(OUT, 'insert-menu.png') });
  for (const k of ['heading', 'subheading', 'paragraph', 'quote', 'image']) assert.equal(await page.locator(`[data-testid=insert-${k}]`).count(), 1, `+ menu has ${k}`);
  await page.click('[data-testid=insert-subheading]');
  await page.keyboard.type('Ikkinchi qism');
assert.equal(await page.locator('[data-testid=blocks] .blk-heading.lvl-2').count(), 1);
  // image
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAWpBnOQAAAABJRU5ErkJggg==', 'base64');
  await page.click('[data-testid=insert-sheet]');
  await page.click('[data-testid=insert-image]');
  await page.setInputFiles('[data-testid=image-input]', { name: 'r.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.blk-image img');
  await waitSaved(page);
  await page.screenshot({ path: path.join(OUT, 'editor-single-360.png') });
  // no horizontal overflow at 360 px
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fits 360px');
  // persists after reload
  await page.reload();
  await page.waitForSelector('[data-testid=editor][data-layout=single]');
  const txt = await page.locator('[data-testid=blocks]').innerText();
  assert.ok(txt.includes('Bir bor ekan') && txt.includes('Uzluksiz matn') && txt.includes('Ikkinchi qism'), 'text persisted');
  assert.equal(await page.locator('.blk-image img').count(), 1, 'image persisted');
  // export: DOCX has no artificial chapter heading
  const id = page.url().match(/editor\/([^?/]+)/)[1];
  await go(page, `#/export/${id}`);
  await page.click('[data-testid=fmt-docx]');
  const out = await download(page, () => page.click('[data-testid=export-run]'));
  const zip = await (await import('jszip')).default.loadAsync(out.bytes);
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes('Bir bor ekan') && !xml.includes('1-BOB') && !xml.includes('1-bob'), 'no artificial chapters in export');
  // reader: no table of contents
  await go(page, `#/reader/${id}`);
  await page.waitForSelector('[data-testid=reader-start]');
  assert.equal(await page.locator('[data-testid=reader-toc]').count(), 0);

  // --- with chapters: add, rename, reorder, delete, switch, then merge into one text without losing anything
  await go(page, '#/');
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.fill('[data-testid=new-title]', 'Bobli kitob');
  await page.click('[data-testid=new-create]'); // "Boblar bilan" is the default
  await page.waitForSelector('[data-testid=editor][data-layout=chapters]');
  await page.fill('[data-testid=chapter-title]', 'Boshlanish');
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.keyboard.type('Birinchi bob matni.');
  await page.click('[data-testid=chapter-picker]');
  await page.click('.sheet [data-testid=add-chapter]');
  assert.equal(await page.locator('[data-testid=chapter-title]').inputValue(), '2-bob', 'auto name is only a suggestion');
  await page.fill('[data-testid=chapter-title]', 'Davomi');
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.keyboard.type('Ikkinchi bob matni.');
  await page.click('[data-testid=chapter-picker]');
  await page.click('.sheet [data-testid=add-chapter]');
  await page.click('[data-testid=chapter-picker]');
  page.once('dialog', () => {});
  await page.locator('.sheet [data-testid=ch-delete]').nth(2).click();
  await page.click('[data-testid=dialog-confirm]');
  await page.waitForFunction(() => document.querySelectorAll('.sheet [data-testid=chapter-list] li').length === 2);
  await page.keyboard.press('Escape');
  await waitSaved(page);
  // switch to one continuous text: chapter titles become headings, nothing is lost
  await page.click('[data-testid=editor-details]');
  await page.locator('.sheet .segmented button', { hasText: 'Bitta yaxlit matn' }).click();
  await page.click('[data-testid=dialog-confirm]');
  await page.waitForSelector('[data-testid=editor][data-layout=single]');
  await page.keyboard.press('Escape');
  const merged = await page.locator('[data-testid=blocks]').innerText();
  for (const s of ['Boshlanish', 'Birinchi bob matni.', 'Davomi', 'Ikkinchi bob matni.']) assert.ok(merged.includes(s), `merged keeps "${s}"`);
  await ctx.close();
});

test('no AI anywhere: no AI buttons, studio tools and create menu work without any server', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await page.click('[data-testid=fab-create]');
  await page.waitForSelector('[data-testid=create-wizard]');
  for (const id of ['create-wizard', 'create-blank', 'create-template', 'create-import']) assert.equal(await page.locator(`[data-testid=${id}]`).count(), 1, id);
  assert.equal(await page.locator('[data-testid=create-ai]').count(), 0);
  await page.click('[data-testid=create-blank]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor]');
  for (const id of ['fmt-bold', 'fmt-italic', 'fmt-underline', 'insert-sheet', 'style-open']) assert.equal(await page.locator(`[data-testid=${id}]`).count(), 1, id);
  for (const hash of ['#/', '#/studio', '#/books', '#/profile', '#/about', '#/create']) {
    await go(page, hash);
    await page.waitForTimeout(250);
    const txt = await page.evaluate(() => document.body.innerText);
    assert.ok(!/\bAI\b|DEMO|sun’iy intellekt yordamida/.test(txt.replace('Bookly — Your Story, Your Creation.', '')), `${hash} mentions AI: ${txt.match(/.{0,40}\b(AI|DEMO)\b.{0,40}/)?.[0]}`);
  }
  await go(page, '#/studio');
  await page.click('[data-testid=tool-wizard]');
  await page.waitForSelector('[data-testid=wizard]');
  await ctx.close();
});

test('templates: preview and create a book from a template', async () => {
  const { ctx, page } = await newPage();
  await go(page, '#/templates');
  await page.waitForSelector('[data-testid=template-grid] .template-card');
  assert.ok((await page.locator('[data-testid=template-grid] .template-card').count()) >= 8);
  await page.click('[data-testid=tpl-novel]');
  await page.screenshot({ path: path.join(OUT, 'template-preview.png') });
  await page.click('[data-testid=tpl-new-book]');
  await page.waitForSelector('[data-testid=editor]');
  const theme = await page.evaluate(async () => {
    const id = location.hash.split('/')[2];
    const db = await new Promise((r) => { const q = indexedDB.open('bookly'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('books').objectStore('books').get(id); q.onsuccess = () => r(q.result.theme.templateId); });
  });
  assert.equal(theme, 'novel');
  await ctx.close();
});

test('responsive layouts have no horizontal overflow (320 → desktop)', async () => {
  for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [1280, 800]]) {
    const { ctx, page } = await newPage({ width: w, height: h });
    await createBookFromText(page, 'Juda uzun nomli responsive sinov kitobi: boshidan oxirigacha', 3);
    for (const hash of ['#/', '#/books', '#/studio', '#/templates', '#/profile', '#/export', '#/create', '#/import', '#/about']) {
      await go(page, hash);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const culprit = overflow > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.book-rail,.hero-track,.segmented,.table-scroll')).slice(0, 3).map((e) => e.className || e.tagName).join(' | ')) : '';
      assert.ok(overflow <= 1, `${hash} overflows by ${overflow}px at ${w}px: ${culprit}`);
    }
    await page.goBack();
    if (w === 320 || w === 1280) {
      await go(page, '#/');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `home-${w}.png`), fullPage: w !== 1280 });
    }
    await ctx.close();
  }
});

test('custom dropdowns: library sort and category (bottom sheet on phones, popover on desktop, keyboard)', async () => {
  for (const [w, h] of [[360, 740], [390, 844], [430, 932], [1280, 800]]) {
    const { ctx, page } = await newPage({ width: w, height: h });
    await createBookFromText(page, 'Saralash sinovi', 3);
    await go(page, '#/books');
    await page.waitForSelector('[data-testid=book-row]');
    assert.equal(await page.locator('select').count(), 0, 'no native <select> left');
    for (const v of ['created', 'updated', 'words', 'title']) {
      await page.click('[data-testid=library-sort]');
      await page.waitForSelector(`[data-testid=library-sort-opt-${v}]`);
      if (w < 600) {
        await page.waitForTimeout(400); // let the slide-up animation finish
        const sheet = await page.locator('.sheet').last().boundingBox();
        assert.ok(sheet && sheet.height < h * 0.85, `sheet must not cover the whole screen (${sheet?.height} of ${h})`);
        assert.ok(sheet.y + sheet.height <= h + 1 && sheet.x >= -1 && sheet.x + sheet.width <= w + 1, `sheet inside viewport: ${JSON.stringify(sheet)}`);
      } else {
        assert.equal(await page.locator('.select-popover').count(), 1, 'desktop uses a popover');
      }
      await page.click(`[data-testid=library-sort-opt-${v}]`);
      await page.waitForFunction((val) => document.querySelector('[data-testid=library-sort]')?.getAttribute('data-value') === val, v);
      await page.waitForFunction(() => !document.querySelector('.select-popover') && !document.querySelector('.select-sheet'));
    }
    const cats = await (async () => {
      await page.click('[data-testid=library-category]');
      await page.waitForSelector('[data-testid^=library-category-opt-]');
      const ids = await page.$$eval('[data-testid^=library-category-opt-]', (els) => els.map((e) => e.getAttribute('data-testid').replace('library-category-opt-', '')));
      const checked = await page.$$eval('[role=option][aria-selected=true]', (els) => els.length);
      assert.equal(checked, 1, 'exactly one option is marked selected');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.select-popover') && !document.querySelector('.select-sheet'));
      return ids;
    })();
    assert.ok(cats.includes('all') && cats.length >= 8, `categories: ${cats.join(',')}`);
    for (const c of cats) {
      await page.click('[data-testid=library-category]');
      await page.click(`[data-testid=library-category-opt-${c}]`);
      await page.waitForFunction((val) => document.querySelector('[data-testid=library-category]')?.getAttribute('data-value') === val, c);
    }
    // keyboard: open with Enter, move with arrows, pick with Enter
    await page.click('[data-testid=library-category]');
    await page.click('[data-testid=library-category-opt-all]');
    await page.waitForFunction(() => !document.querySelector('.select-popover') && !document.querySelector('.select-sheet'));
    assert.equal(await page.getAttribute('[data-testid=library-sort]', 'data-value'), 'title');
    await page.focus('[data-testid=library-sort]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=listbox]');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option', null, { timeout: 3000 });
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=library-sort]')?.getAttribute('data-value') === 'updated');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const culprit = overflow > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map((e) => `${e.tagName}.${e.className}`).join(' | ')) : '';
    if (overflow > 1) await page.screenshot({ path: path.join(OUT, `select-overflow-${w}.png`) });
    assert.ok(overflow <= 1, `library overflows by ${overflow}px at ${w}px: ${culprit}`);
    if (w === 360 || w === 1280) {
      await page.click('[data-testid=library-sort]');
      await page.waitForSelector('[data-testid=library-sort-opt-title]');
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(OUT, `select-${w}.png`) });
      await page.keyboard.press('Escape');
    }
    await ctx.close();
  }
});

test('interface designs: 6 skins × light/dark, corner styles; saved, applied before first paint, no overflow', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=skin-picker]');
  const skins = await page.$$eval('[data-testid^=skin-]', (els) => els.map((e) => e.getAttribute('data-testid')).filter((x) => x !== 'skin-picker').map((x) => x.replace('skin-', '')));
  assert.deepEqual(skins, ['bookly', 'ocean', 'forest', 'sunset', 'paper', 'graphite']);
  const seen = new Set();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((th) => { const s = JSON.parse(localStorage.getItem('bookly.settings') || '{}'); s.theme = th; localStorage.setItem('bookly.settings', JSON.stringify(s)); }, theme);
    await page.reload(); await page.waitForSelector('[data-testid=skin-picker]');
    for (const sk of skins) {
      await page.click(`[data-testid=skin-${sk}]`);
      await page.waitForFunction((v) => document.documentElement.dataset.skin === v, sk);
      const v = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { primary: cs.getPropertyValue('--primary').trim(), bg: cs.getPropertyValue('--bg').trim(), meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') }; });
      assert.equal(v.meta, v.bg, `${sk}/${theme}: browser/Telegram bar follows the design background`);
      seen.add(`${theme}:${v.primary}:${v.bg}`);
      assert.equal(await page.getAttribute(`[data-testid=skin-${sk}]`, 'aria-checked'), 'true');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${sk}/${theme} overflows by ${overflow}px`);
    }
  }
  assert.equal(seen.size, 12, 'every design looks different in both modes');
  // corners
  await page.getByRole('tab', { name: 'To‘g‘ri', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.corners === 'sharp');
  const r = await page.$eval('.skin-card', (e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
  assert.ok(r < 5, `sharp corners are small (${r}px)`);
  // saved and applied before React starts (no flash of the default design)
  await page.click('[data-testid=skin-forest]');
  await page.goto(page.url().split('#')[0] + '#/', { waitUntil: 'commit' });
  const early = await page.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.corners]);
  assert.deepEqual(early, ['forest', 'sharp']);
  await page.waitForSelector('.home');
  await page.screenshot({ path: path.join(OUT, 'skin-forest-light-360.png') });
  await ctx.close();
});

test('every screen and every sheet follows the chosen interface design (no hard-coded colours)', async () => {
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  const id = await createBookFromText(page, 'Rang sinovi', 2);
  const IGNORE = '.book-cover, canvas, .hero-art, .skin-mini, .style-designs, .swatches, .palette-grid, .wizard-templates, .template-card, .cover-tpl, '
    + '.tone-blue, .tone-rose, .tone-amber, .tone-teal, .fav, .about-status, .format-card, .btn-danger, .danger-link, .wipe-error, .wipe-scope, '
    + '.is-danger, .list-row.danger, .book-tile-done, .progress.is-done, .toast, .splash, .book-content, .preview-paper, .reader, .field-error, .save-chip, '
    + '.style-sample, .req'; // .style-sample shows the BOOK's own colours; .req is the red required-field mark
  const snap = () => page.evaluate((ignore) => {
    const out = {};
    const keyOf = (e) => { const parts = []; for (let n = e; n && n !== document.body; n = n.parentElement) parts.unshift(`${n.tagName}${n.dataset.testid ? `[${n.dataset.testid}]` : ''}:${[...(n.parentElement?.children ?? [])].indexOf(n)}`); return parts.join('>'); };
    for (const e of document.querySelectorAll('body *')) {
      if (e.closest(ignore)) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      out[keyOf(e)] = { bg: cs.backgroundColor, img: cs.backgroundImage, fg: cs.color, cls: String(e.className).slice(0, 60) };
    }
    return out;
  }, IGNORE);
  const chroma = (c) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || '');
    if (!m) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number); const a = m[4] === undefined ? 1 : Number(m[4]);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return a > 0.25 && mx > 40 && (mx - mn) / mx > 0.3 && (mx - mn) > 40;
  };
  const colorsIn = (img) => (img.match(/rgba?\([^)]+\)/g) || []).filter(chroma).join(' ');
  const states = [
    ['home', '#/', null], ['library', '#/books', null],
    ['book-menu', '#/books', async () => { await page.locator('[data-testid=row-menu]').first().click(); await page.waitForSelector('.sheet .menu-grid'); }],
    ['sort-sheet', '#/books', async () => { await page.click('[data-testid=library-sort]'); await page.waitForSelector('.select-sheet, .select-popover'); }],
    ['create-sheet', '#/', async () => { await page.click('[data-testid=fab-create]'); await page.waitForSelector('[data-testid=create-wizard]'); }],
    ['studio', '#/studio', null], ['profile', '#/profile', null],
    ['wipe-sheet', '#/profile', async () => { await page.click('[data-testid=clear-all]'); await page.waitForSelector('[data-testid=wipe-input]'); }],
    ['about', '#/about', null], ['wizard', '#/create', null],
    ['editor', `#/editor/${id}`, null],
    ['style-sheet', `#/editor/${id}`, async () => { await page.click('[data-testid=style-open]'); await page.waitForSelector('[data-testid=style-sheet]'); }],
    ['insert-sheet', `#/editor/${id}`, async () => { await page.click('[data-testid=insert-sheet]'); await page.waitForSelector('.insert-menu'); }],
    ['cover', `#/cover/${id}`, null], ['export', `#/export/${id}`, null], ['cloud', '#/cloud', null],
  ];
  const problems = [];
  for (const theme of ['dark', 'light']) {
    const shots = {};
    for (const skin of ['ocean', 'sunset']) {
      await page.evaluate(([th, sk]) => { const s = JSON.parse(localStorage.getItem('bookly.settings') || '{}'); s.theme = th; s.skin = sk; s.reducedMotion = true; localStorage.setItem('bookly.settings', JSON.stringify(s)); }, [theme, skin]);
      shots[skin] = {};
      for (const [name, hash, act] of states) {
        await page.goto('about:blank');
        await page.goto(`${base}&noIntro=1${hash}`);
        await page.waitForTimeout(500);
        if (act) await act();
        await page.waitForTimeout(450);
        shots[skin][name] = await snap();
      }
    }
    for (const [name] of states) {
      const a = shots.ocean[name], b = shots.sunset[name];
      for (const k of Object.keys(a)) {
        if (!b[k]) continue;
        if (chroma(a[k].bg) && a[k].bg === b[k].bg) problems.push(`${theme}/${name}: background ${a[k].bg} on .${a[k].cls}`);
        if (chroma(a[k].fg) && a[k].fg === b[k].fg) problems.push(`${theme}/${name}: text ${a[k].fg} on .${a[k].cls}`);
        const ga = colorsIn(a[k].img); if (ga && ga === colorsIn(b[k].img)) problems.push(`${theme}/${name}: gradient ${ga} on .${a[k].cls}`);
      }
    }
  }
  const uniq = [...new Set(problems)];
  assert.deepEqual(uniq.slice(0, 40), [], `${uniq.length} element(s) ignore the chosen design`);
  await ctx.close();
});

test('Buki the robot: greets once, gives tips per screen, guided tour, hides while writing, can be muted or switched off', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('bookly.settings') || '{}'); s.robotIntroSeen = false; s.introSeen = true; localStorage.setItem('bookly.settings', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('.home');
  await page.waitForSelector('[data-testid=robot-bubble]', { timeout: 5000 });
  assert.match(await page.locator('[data-testid=robot-text]').innerText(), /Buki/);
  await page.click('[data-testid=robot-close]');
  await page.reload(); await page.waitForSelector('.home'); await page.waitForTimeout(1800);
  assert.equal(await page.locator('[data-testid=robot-bubble]').count(), 0, 'greets only once');
  // tips change with the screen and "another tip" cycles
  await page.click('[data-testid=robot-button]');
  const homeTip = await page.locator('[data-testid=robot-text]').innerText();
  await page.click('[data-testid=robot-next]');
  assert.notEqual(await page.locator('[data-testid=robot-text]').innerText(), homeTip);
  const box = await page.locator('[data-testid=robot-bubble]').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360 && box.y >= 0, `bubble fits a small phone: ${JSON.stringify(box)}`);
  await page.screenshot({ path: path.join(OUT, 'robot-tip-360.png') });
  await go(page, '#/books');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-testid=robot-bubble]').count(), 0, 'bubble closes on a new screen');
  await page.click('[data-testid=robot-button]');
  assert.match(await page.locator('[data-testid=robot-text]').innerText(), /⋯|Qidiruv|Savat/);
  await page.click('[data-testid=robot-close]');
  // voice toggle: headless Chrome has no voices → says so instead of failing silently
  await page.click('[data-testid=robot-button]');
  await page.click('[data-testid=robot-voice]');
  await page.click('[data-testid=robot-next]');
  await page.waitForSelector('[data-testid=robot-bubble] small.muted');
  await page.click('[data-testid=robot-voice]');
  await page.click('[data-testid=robot-close]');
  // guided tour: 6 steps, "Show me" opens the screen
  await go(page, '#/profile');
  await page.click('[data-testid=robot-tour]');
  await page.waitForSelector('[data-testid=robot-bubble]');
  for (let i = 1; i <= 6; i++) {
    assert.match(await page.locator('.robot-bubble-head small').innerText(), new RegExp(`${i}/6`));
    if (i === 4) { await page.click('[data-testid=robot-open]'); await page.waitForFunction(() => location.hash.startsWith('#/cover')); }
    await page.click('[data-testid=robot-next]');
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid=robot-bubble]'));
  // hidden in the editor and reader (it would cover the text)
  const id = await createBookFromText(page, 'Robot sinovi', 1);
  assert.equal(await page.locator('[data-testid=robot]').count(), 0, 'no robot in the editor');
  await go(page, `#/reader/${id}`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-testid=robot]').count(), 0, 'no robot in the reader');
  // switch off in Profile
  await go(page, '#/profile');
  await page.locator('[data-testid=robot-settings]').scrollIntoViewIfNeeded();
  await page.click('label[for=rb-on]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=robot]'));
  await page.reload(); await page.waitForSelector('.profile, [data-testid=robot-settings]');
  assert.equal(await page.locator('[data-testid=robot]').count(), 0, 'stays off after reload');
  await ctx.close();
});

test('help center: journey, searchable FAQ with “show me” buttons, tour, and a clear message when not signed in', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await go(page, '#/profile');
  await page.click('[data-testid=help]');
  await page.waitForSelector('[data-testid=help-page]');
  assert.equal(await page.locator('[data-testid=help-journey] li').count(), 4);
  const all = await page.locator('[data-testid=help-faq] .faq-item').count();
  assert.ok(all >= 12, `${all} questions`);
  await page.fill('[data-testid=help-search]', 'muqova');
  const found = await page.locator('[data-testid=help-faq] .faq-item').count();
  assert.ok(found >= 1 && found < all, `search narrows the list (${found})`);
  await page.locator('[data-testid=help-faq] .faq-q').first().click();
  await page.waitForSelector('.faq-a');
  await page.screenshot({ path: path.join(OUT, 'help-360.png'), fullPage: true });
  await page.locator('.faq-a .btn').click();
  await page.waitForFunction(() => location.hash.startsWith('#/cover'));
  await go(page, '#/help');
  await page.fill('[data-testid=help-search]', 'zzzz-yo‘q');
  await page.waitForSelector('[data-testid=help-faq] .muted');
  await page.fill('[data-testid=help-feedback]', 'Salom');
  await page.click('[data-testid=help-feedback-send]');
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').last().innerText(), /kiring/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `help page overflows by ${overflow}px`);
  await ctx.close();
});

test('writing goal: words typed in the editor fill today’s ring; goal can be changed; achievements unlock', async () => {
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=writing-card]');
  assert.equal(await page.locator('.goal-num').innerHTML(), '0');
  assert.equal(await page.locator('[data-testid=achievements] li[data-got="1"]').count(), 0);
  await page.click('[data-testid=fab-create]');
  await page.click('[data-testid=create-blank]');
  await page.click('[data-testid=new-create]');
  await page.waitForSelector('[data-testid=editor]');
  await page.locator('[data-testid=blocks] .editable').first().click();
  await page.keyboard.type('Bugun men o‘n ikki so‘zdan iborat birinchi jumlamni yozdim va juda xursandman.');
  await waitSaved(page);
  await go(page, '#/profile');
  await page.waitForSelector('[data-testid=writing-card]');
  assert.equal(await page.locator('.goal-num').innerHTML(), '12', 'typed words are counted');
  assert.equal(await page.locator('[data-testid=achievements] li[data-got="1"]').count(), 1, 'first book unlocked');
  await page.locator('[data-testid=writing-card] [role=tab]').first().click(); // 150 words
  await page.waitForFunction(() => document.querySelector('.goal-of')?.textContent?.includes('150'));
  await page.reload(); await page.waitForSelector('[data-testid=writing-card]');
  assert.match(await page.locator('.goal-of').innerHTML(), /150/, 'goal is saved');
  await page.screenshot({ path: path.join(OUT, 'writing-card.png') });
  await ctx.close();
});

test('About page: opens from profile, shows real feature status in every language', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await go(page, '#/profile');
  await page.click('[data-testid=profile-about]');
  await page.waitForSelector('[data-testid=about-page]');
  const text = await page.textContent('[data-testid=about-page]');
  for (const s of ['Bizning maqsadimiz', 'Bookly imkoniyatlari', 'Bizning yondashuvimiz', 'Bizning qarashimiz', 'Biz bilan birga yarating', 'Bookly — Your Story, Your Creation.', 'PDF, EPUB, DOCX va PPTX']) assert.ok(text.includes(s), `missing: ${s}`);
  const status = await page.$$eval('[data-testid=about-features] li', (els) => Object.fromEntries(els.map((e) => [e.querySelector('strong').textContent, e.getAttribute('data-status')])));
  assert.equal(status['Kitob ustasi'], 'available');
  assert.equal(status['Interfeys dizaynlari'], 'available');
  assert.ok(!Object.keys(status).some((k) => /AI/.test(k)), 'no AI feature is advertised');
  assert.ok(Object.values(status).every((v) => v === 'available'));
  assert.ok(text.includes('hozircha yo‘q'), 'AI is listed only as planned');
  await page.screenshot({ path: path.join(OUT, 'about-360.png'), fullPage: true });
  for (const [loc, heading] of [['ru', 'Наша цель'], ['en', 'Our mission']]) {
    await page.evaluate((l) => { const s = JSON.parse(localStorage.getItem('bookly.settings') || '{}'); s.locale = l; localStorage.setItem('bookly.settings', JSON.stringify(s)); }, loc);
    await page.reload();
    await page.waitForSelector('[data-testid=about-page]');
    assert.ok((await page.textContent('[data-testid=about-page]')).includes(heading), `${loc} heading`);
  }
  await page.click('[data-testid=about-start]');
  await page.waitForSelector('.home');
  await ctx.close();
});

test('battery / heat: no endless animations, no live blur, no fixed background; reader does not over-render', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 520 });
  // Count React commits through the standard DevTools hook (React calls it in production builds too).
  await ctx.addInitScript(() => {
    window.__commits = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {} };
  });
  await page.reload(); await page.waitForSelector('.home');
  const id = await createBookFromText(page, 'Batareya sinovi', 3);
  const audit = () => page.evaluate(() => {
    const endless = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).map((a) => `${a.animationName} on ${a.effect.target?.getAttribute?.('class')}`);
    const blur = [...document.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e); return (c.backdropFilter || 'none') !== 'none' || (c.webkitBackdropFilter || 'none') !== 'none'; }).map((e) => e.className);
    const fixedBg = [document.documentElement, document.body].some((e) => getComputedStyle(e).backgroundAttachment.includes('fixed'));
    return { endless, blur, fixedBg };
  });
  for (const hash of ['#/', '#/books', '#/studio', '#/profile', '#/about', '#/cloud', `#/editor/${id}`, `#/reader/${id}`]) {
    await go(page, hash);
    await page.waitForTimeout(900);
    const a = await audit();
    assert.deepEqual(a.endless, [], `${hash}: endless animations keep the GPU busy`);
    assert.deepEqual(a.blur, [], `${hash}: live backdrop blur`);
    assert.equal(a.fixedBg, false, `${hash}: background-attachment: fixed repaints on scroll`);
  }
  // Reader: 40 scroll events must not mean 40 re-renders of the chapter.
  await go(page, `#/reader/${id}`);
  await page.waitForSelector('.reader-progress');
  if (await page.locator('[data-testid=reader-start]').count()) await page.click('[data-testid=reader-start]'); // cover page → chapter 1
  await page.waitForTimeout(500);
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  assert.ok(scrollable > 400, `reader chapter is long enough to scroll (${scrollable}px)`);
  let events = 0;
  await page.evaluate(() => { window.__commits = 0; window.__scrolls = 0; addEventListener('scroll', () => window.__scrolls++, { passive: true }); });
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i < 20 ? 4 : -4); await page.waitForTimeout(30); }
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ commits: window.__commits, scrolls: window.__scrolls }));
  events = r.scrolls;
  assert.ok(events >= 20, `scroll events fired: ${events}`);
  assert.ok(r.commits <= Math.ceil(events / 2), `reader re-rendered ${r.commits} times for ${events} scroll events`);
  await ctx.close();
});

/** Watches one input: counts blur/focus events and whether React replaced the DOM node. */
async function watchInput(page, sel) {
  await page.locator(sel).evaluate((el) => {
    window.__watch = { blur: 0, focus: 0, node: el };
    el.addEventListener('blur', () => window.__watch.blur++);
    el.addEventListener('focus', () => window.__watch.focus++);
  });
}
const watchState = (page, sel) => page.evaluate((s) => ({ blur: window.__watch.blur, sameNode: document.querySelector(s) === window.__watch.node, focused: document.activeElement === window.__watch.node, bodyLocked: document.body.classList.contains('no-scroll') }), sel);

test('dialog inputs keep focus while typing (no keyboard close/reopen): rename prompt and delete-code input', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 640 });
  await createBookFromText(page, 'Klaviatura sinovi', 3);
  await go(page, '#/books');
  await page.locator('[data-testid=row-menu]').first().click();
  await page.click('[data-testid=menu-rename]');
  const sel = '.sheet input.input';
  await page.waitForSelector(sel);
  await page.waitForTimeout(80);
  await watchInput(page, sel);
  await page.locator(sel).press('Control+A');
  for (const ch of 'Yangi nom 2026') {
    await page.keyboard.type(ch);
    const st = await watchState(page, sel);
    assert.ok(st.sameNode && st.focused && st.blur === 0 && st.bodyLocked, `stable after "${ch}": ${JSON.stringify(st)}`);
  }
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await page.evaluate(() => document.execCommand('insertText', false, ' (paste)'));
  const st = await watchState(page, sel);
  assert.ok(st.sameNode && st.focused && st.blur === 0, `stable after delete + paste: ${JSON.stringify(st)}`);
  assert.equal(await page.locator(sel).inputValue(), 'Yangi nom (paste)');
  await page.keyboard.press('Escape');
  await ctx.close();
});

test('delete all books without an account: random 4-digit code, wrong code keeps data, right code deletes books only', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 640 });
  await createBookFromText(page, 'O‘chiriladigan kitob', 3);
  // a book with an image, a profile name, avatar and theme that must survive
  await go(page, '#/profile');
  await page.click('[data-testid=profile-edit]');
  await page.fill('[data-testid=profile-name]', 'Saqlanuvchi ism');
  await page.click('[data-testid=profile-done]');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAWpBnOQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('.profile-card input[type=file]', { name: 'a.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.profile-card .avatar img');
  await page.click('text=Yorug‘');
  const codes = new Set();
  for (let i = 0; i < 3; i++) {
    await page.click('[data-testid=clear-all]');
    await page.waitForSelector('[data-testid=wipe-sheet][data-mode=local] [data-testid=wipe-input]');
    codes.add((await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, ''));
    if (i < 2) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[data-testid=wipe-sheet]')); }
  }
  for (const c of codes) assert.match(c, /^\d{4}$/);
  assert.ok(codes.size >= 2, `codes are random per session: ${[...codes]}`);
  const code = (await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, '');
  // typing digit by digit keeps focus (the Android Telegram bug)
  await page.waitForTimeout(80);
  await watchInput(page, '[data-testid=wipe-input]');
  const wrong = code === '9999' ? '1111' : '9999';
  for (const d of wrong) {
    await page.keyboard.type(d);
    const st = await watchState(page, '[data-testid=wipe-input]');
    assert.ok(st.sameNode && st.focused && st.blur === 0, `code input stable: ${JSON.stringify(st)}`);
  }
  await page.click('[data-testid=wipe-confirm]');
  await page.waitForSelector('[data-testid=wipe-message]');
  await go(page, '#/books');
  await page.waitForTimeout(300);
  // the sheet closed on navigation? if not, books must still be there
  const before = await page.evaluate(async () => (await new Promise((res) => { const r = indexedDB.open('bookly'); r.onsuccess = () => { const q = r.result.transaction('books').objectStore('books').count(); q.onsuccess = () => res(q.result); }; })));
  assert.equal(before, 1, 'wrong code deleted nothing');
  await go(page, '#/profile');
  await page.click('[data-testid=clear-all]');
  await page.waitForSelector('[data-testid=wipe-input]');
  const code2 = (await page.locator('[data-testid=wipe-code]').innerText()).replace(/\D/g, '');
  await page.fill('[data-testid=wipe-input]', code2);
  await page.screenshot({ path: path.join(OUT, 'wipe-local-360.png') });
  await page.click('[data-testid=wipe-confirm]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=wipe-sheet]'));
  const after = await page.evaluate(async () => (await new Promise((res) => { const r = indexedDB.open('bookly'); r.onsuccess = () => { const tx = r.result.transaction(['books', 'assets']); const b = tx.objectStore('books').count(); const a = tx.objectStore('assets').count(); tx.oncomplete = () => res({ books: b.result, assets: a.result }); }; })));
  assert.deepEqual(after, { books: 0, assets: 1 }, 'books and book files gone, only the avatar remains');
  await page.reload();
  await page.waitForSelector('.page.profile');
  assert.equal(await page.locator('[data-testid=profile-display-name]').innerText(), 'Saqlanuvchi ism', 'profile kept');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light', 'settings kept');
  assert.equal(await page.locator('.profile-card .avatar img').count(), 1, 'avatar kept');
  await ctx.close();
});

test('profile settings: theme, name and backup', async () => {
  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await go(page, '#/profile');
  // A. profile card: name is edited in its own sheet
  await page.click('[data-testid=profile-edit]');
  await page.fill('[data-testid=profile-name]', 'Muhayyo');
  await page.click('[data-testid=profile-done]');
  assert.equal(await page.locator('[data-testid=profile-display-name]').innerText(), 'Muhayyo');
  // B. only two stats
  assert.deepEqual(await page.locator('.stats-grid .stat span').allInnerTexts(), ['Kitoblarim', 'Boblarim']);
  // removed: replay intro; renamed: Zaxiralash
  assert.equal(await page.locator('[data-testid=replay-intro]').count(), 0);
  assert.ok((await page.locator('.page').innerText()).includes('Zaxiralash'));
  // C. language and theme
  for (const l of ['O‘zbekcha', 'Русский', 'English']) assert.equal(await page.getByRole('tab', { name: l }).count(), 1, l);
  await page.click('text=Yorug‘');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  const b = await download(page, () => page.click('[data-testid=backup]'));
  const json = JSON.parse(b.bytes.toString());
  assert.equal(json.app, 'bookly');
  // D. export defaults are one compact row that expands
  assert.equal(await page.locator('text=Sahifa o‘lchami (PDF)').count(), 0);
  await page.click('[data-testid=export-defaults]');
  await page.click('.disclosure-body .segmented button:has-text("A4")');
  assert.match(await page.locator('[data-testid=export-defaults]').innerText(), /A4/);
  // E. deleting books needs the 4-digit code — a wrong code deletes nothing
  await page.click('[data-testid=clear-all]');
  await page.waitForSelector('[data-testid=wipe-input]');
  await page.fill('[data-testid=wipe-input]', '12');
  assert.equal(await page.locator('[data-testid=wipe-confirm]').isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-testid=profile-display-name]').innerText(), 'Muhayyo', 'nothing deleted');
  await page.screenshot({ path: path.join(OUT, 'profile-360.png'), fullPage: true });
  await go(page, '#/');
  await page.waitForSelector('.home-greeting');
  assert.match(await page.locator('.home-greeting').innerText(), /Muhayyo/);
  await page.screenshot({ path: path.join(OUT, 'home-light.png') });
  await ctx.close();
});

test('GitHub Pages layout: base path, assets, deep links, 404 fallback and mobile viewports', async () => {
  // 1) the built HTML references only relative asset URLs that resolve under the base path
  const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
  assert.match(html, /<div id="root"><\/div>/, 'index.html is the app shell, not a README');
  // The Telegram Mini App script is the one intended external file (loaded only inside Telegram).
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('https://telegram.org/'));
  assert.ok(refs.some((r) => /assets\/app-[\w]+\.js$/.test(r)), 'hashed app bundle referenced');
  for (const r of refs) {
    assert.ok(r.startsWith('./'), `asset URL must be relative to ${SITE_BASE}: ${r}`);
    const res = await fetch(new URL(r, origin + SITE_BASE));
    assert.equal(res.status, 200, `${r} served under ${SITE_BASE}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/.nojekyll')), '.nojekyll present');
  // 2) root and no-slash URLs reach the app; unknown paths return the 404 fallback
  assert.equal((await fetch(origin + SITE_BASE.slice(0, -1), { redirect: 'manual' })).status, 301);
  const missing = await fetch(`${origin}${SITE_BASE}books`);
  assert.equal(missing.status, 404);

  for (const [w, h] of [[360, 800], [390, 844], [430, 932]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/books')) failed.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror@${w}: ${e.message}`));
    // first visit: real intro, then the home screen
    await page.goto(origin + SITE_BASE);
    await page.waitForSelector('[data-testid=splash]');
    await page.click('[data-testid=splash-skip]');
    await page.waitForSelector('[data-testid=splash]', { state: 'detached' });
    await page.waitForSelector('.home .hero');
    const tabWrap = await page.$$eval('.tab span', (els) => els.filter((e) => e.getBoundingClientRect().height > 20).map((e) => e.textContent));
    assert.deepEqual(tabWrap, [], `tab labels fit on one line at ${w}px`);
    assert.equal(await page.title(), 'Bookly 2.0 — Kitob yaratish studiyasi');
    assert.equal(await page.locator('.qa-tile').count(), 8, 'quick actions rendered');
    assert.ok(await page.locator('.tabbar').isVisible(), 'bottom navigation visible');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no horizontal scroll at ${w}px (${overflow})`);
    await page.screenshot({ path: path.join(OUT, `pages-home-${w}.png`) });
    // interactive: open the create sheet and start the book wizard
    await page.click('[data-testid=fab-create]');
    await page.click('[data-testid=create-wizard]');
    await page.waitForSelector('[data-testid=wizard-title]');
    assert.ok(page.url().startsWith(origin + SITE_BASE) && page.url().includes('#/create'), `hash route under base: ${page.url()}`);
    // deep link typed as a path (e.g. shared link) is rescued by 404.html
    await page.goto(`${origin}${SITE_BASE}books`);
    await page.waitForURL(/#\/books$/);
    await page.waitForSelector('[data-testid=library-search]');
    // reload on a hash route keeps the screen
    await page.goto(`${origin}${SITE_BASE}#/studio`);
    await page.reload();
    await page.waitForSelector('.studio .tool-card');
    await page.screenshot({ path: path.join(OUT, `pages-studio-${w}.png`) });
    assert.deepEqual(failed, [], `no failed requests at ${w}px`);
    await ctx.close();
  }
});

test('no uncaught errors or console errors during the run', () => {
  const real = consoleErrors.filter((e) => !/favicon/.test(e));
  assert.deepEqual(real, []);
});
