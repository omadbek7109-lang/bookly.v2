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
  base = `${origin}${SITE_BASE}?fastAI=1`;
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

async function createAiBook(page, topic = 'Moliyaviy savodxonlik', chapters = 3) {
  await go(page, '#/create');
  await page.fill('[data-testid=creator-topic]', topic);
  await page.locator('[data-testid=creator-chapters]').fill(String(chapters));
  await page.click('[data-testid=creator-outline]');
  await page.waitForSelector('[data-testid=outline-list] li');
  await page.click('[data-testid=creator-write]');
  await page.waitForFunction(() => document.querySelectorAll('.gen-item.is-done').length === document.querySelectorAll('.gen-item').length, null, { timeout: 15000 });
  await page.click('[data-testid=creator-save-edit]');
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

test('AI book creator generates chapter by chapter and saves to library (persists after reload)', async () => {
  const { ctx, page } = await newPage();
  // validation
  await go(page, '#/create');
  await page.click('[data-testid=creator-outline]');
  assert.ok(await page.locator('.field-error').count() >= 1, 'empty topic must be rejected');
  const id = await createAiBook(page, 'Yoshlar uchun moliyaviy savodxonlik', 4);
  assert.match(id, /^book_/);
  const chapters = await page.locator('[data-testid=chapter-list] li').count();
  assert.equal(chapters, 4);
  assert.ok((await page.locator('[data-testid=blocks] .blk-wrap').count()) > 3, 'generated chapter has blocks');
  await page.screenshot({ path: path.join(OUT, 'editor.png') });
  await page.reload();
  await page.waitForSelector('[data-testid=editor]');
  assert.equal(await page.locator('[data-testid=chapter-list] li').count(), 4);
  await go(page, '#/');
  await page.waitForSelector('[data-testid=recent-books] .book-tile');
  await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: true });
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

test('AI writing assistant suggests and only replaces on accept', async () => {
  const { ctx, page } = await newPage();
  await createAiBook(page, 'Vaqtni boshqarish', 3);
  const para = page.locator('[data-testid=blocks] .blk-paragraph .editable').nth(1);
  const original = await para.innerText();
  await para.click();
  await page.click('[data-testid=ai-open]');
  await page.click('[data-testid=ai-expand]');
  await page.waitForSelector('[data-testid=ai-result]');
  await page.screenshot({ path: path.join(OUT, 'assistant.png') });
  assert.equal(await para.innerText(), original, 'original preserved before accept');
  await page.click('[data-testid=ai-reject]');
  await page.keyboard.press('Escape');
  assert.equal(await para.innerText(), original);
  await para.click();
  await page.click('[data-testid=ai-open]');
  await page.click('[data-testid=ai-expand]');
  await page.waitForSelector('[data-testid=ai-result]');
  await page.click('[data-testid=ai-accept]');
  await page.waitForTimeout(300);
  const changed = await para.innerText();
  assert.notEqual(changed, original);
  assert.ok(changed.length > original.length, 'expanded text is longer');
  await ctx.close();
});

test('library: search, favorite, duplicate, rename, trash and restore', async () => {
  const { ctx, page } = await newPage();
  await createAiBook(page, 'Sog‘lom turmush tarzi', 3);
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

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file), file };
}

test('cover designer customises the cover and exports PNG/JPG', async () => {
  const { ctx, page } = await newPage();
  const id = await createAiBook(page, 'Kosmos sirlari', 3);
  await go(page, `#/cover/${id}`);
  await page.waitForSelector('[data-testid=cover-canvas]');
  await page.fill('[data-testid=cover-title]', 'Kosmos sirlari: yulduzlar');
  await page.getByRole('tab', { name: 'Shablon', exact: true }).click();
  await page.click('[data-testid=cover-tpl-bold]');
  await page.getByRole('tab', { name: 'Ranglar', exact: true }).click();
  await page.click('[data-testid=palette-sunset]');
  await page.getByRole('tab', { name: 'AI fon', exact: true }).click();
  await page.click('[data-testid=cover-ai-generate]');
  await page.waitForSelector('.cover-ai-tag');
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
  assert.equal(saved.aiGenerated, true);
  await ctx.close();
});

test('export center produces valid PDF, EPUB, DOCX and PPTX files; import round-trips', async () => {
  const { ctx, page } = await newPage();
  const id = await createAiBook(page, 'Raqamli marketing', 3);
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
  const id = await createAiBook(page, 'Bolalar ertaklari', 3);
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

test('AI yordamchi: hidden when no AI is connected; demo shows the 8 tasks and the 4 choices', async () => {
  // no ?fastAI / ?demoAI and no server → the AI button is not shown at all
  const ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p0 = await ctx0.newPage();
  await p0.goto(`${origin}${SITE_BASE}?noIntro=1`);
  await p0.waitForSelector('.home');
  await p0.click('[data-testid=fab-create]');
  await p0.click('[data-testid=create-blank]');
  await p0.click('[data-testid=new-create]');
  await p0.waitForSelector('[data-testid=editor]');
  await p0.waitForTimeout(1500);
  assert.equal(await p0.locator('[data-testid=ai-open]').count(), 0, 'no fake AI button');
  for (const id of ['fmt-bold', 'fmt-italic', 'fmt-underline', 'insert-sheet']) assert.equal(await p0.locator(`[data-testid=${id}]`).count(), 1, id);
  await ctx0.close();

  const { ctx, page } = await newPage({ width: 360, height: 740 });
  await createAiBook(page, 'Kitob o‘qish foydasi', 3);
  const para = page.locator('[data-testid=blocks] .blk-paragraph .editable').nth(1);
  const original = await para.innerText();
  await para.click();
  await page.click('[data-testid=ai-open]');
  for (const id of ['continue', 'rewrite', 'grammar', 'shorten', 'expand', 'ideas', 'dialog', 'titles']) assert.equal(await page.locator(`[data-testid=ai-${id}]`).count(), 1, `task ${id}`);
  await page.screenshot({ path: path.join(OUT, 'assistant-tasks-360.png') });
  await page.click('[data-testid=ai-continue]');
  await page.waitForSelector('[data-testid=ai-result]');
  for (const id of ['ai-insert', 'ai-retry', 'ai-copy']) assert.equal(await page.locator(`[data-testid=${id}]`).count(), 1, id);
  assert.equal(await page.locator('[data-testid=ai-accept]').count(), 0, '"continue" cannot replace');
  assert.equal(await para.innerText(), original, 'nothing changes before the writer chooses');
  await page.click('[data-testid=ai-retry]');
  await page.waitForSelector('[data-testid=ai-result]');
  const before = await page.locator('[data-testid=blocks] .blk-wrap').count();
  await page.click('[data-testid=ai-insert]');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('[data-testid=blocks] .blk-wrap').count() > before, 'inserted below');
  assert.equal(await para.innerText(), original, 'insert keeps the original');
  // title suggestion becomes the chapter title
  await para.click();
  await page.click('[data-testid=ai-open]');
  await page.click('[data-testid=ai-titles]');
  await page.waitForSelector('[data-testid=ai-title-item]');
  const pick = (await page.locator('[data-testid=ai-title-item] .list-row-text > span').first().innerText()).trim();
  await page.locator('[data-testid=ai-title-item]').first().click();
  assert.equal(await page.locator('[data-testid=chapter-title]').inputValue(), pick);
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
    await createAiBook(page, 'Responsive sinov', 3);
    for (const hash of ['#/', '#/books', '#/studio', '#/templates', '#/profile', '#/export', '#/create', '#/import']) {
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
  // E. deleting everything needs the confirmation word — a wrong word deletes nothing
  await page.click('[data-testid=clear-all]');
  await page.fill('.sheet input', 'ha');
  await page.click('[data-testid=dialog-confirm]');
  await page.waitForTimeout(300);
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
    assert.equal(await page.title(), 'Bookly 2.0 — AI Book Creator');
    assert.equal(await page.locator('.qa-tile').count(), 8, 'quick actions rendered');
    assert.ok(await page.locator('.tabbar').isVisible(), 'bottom navigation visible');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no horizontal scroll at ${w}px (${overflow})`);
    await page.screenshot({ path: path.join(OUT, `pages-home-${w}.png`) });
    // interactive: open the create sheet and start an AI book
    await page.click('[data-testid=fab-create]');
    await page.click('[data-testid=create-ai]');
    await page.waitForSelector('[data-testid=creator-topic]');
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
