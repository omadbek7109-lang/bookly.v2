import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { exportPdf, toWinAnsi } from '../../src/services/export/pdf';
import { exportDocx } from '../../src/services/export/docx';
import { exportPptx } from '../../src/services/export/pptx';
import { exportEpub } from '../../src/services/export/epub';
import { DEFAULT_EXPORT_OPTIONS } from '../../src/services/export/types';
import { sampleBook } from './fixtures';
import { setPdfFontLoader } from '../../src/services/export/pdfFonts';

// In the app the fonts are fetched from public/fonts; here they are read from disk.
setPdfFontLoader(async (file) => new Uint8Array(fs.readFileSync(path.resolve('public/fonts', file))));

const OUT = path.resolve('.test-build/exports');
fs.mkdirSync(OUT, { recursive: true });
const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const save = (name: string, bytes: Uint8Array) => { const p = path.join(OUT, name); fs.writeFileSync(p, bytes); return p; };

test('PDF: valid document with cover, title page, TOC, chapters and metadata', async () => {
  const { book, assets, cover } = sampleBook();
  const out = await exportPdf({ book, assets, cover, options: { ...DEFAULT_EXPORT_OPTIONS, pageSize: 'A5' } });
  assert.equal(out.filename, 'moliyaviy-savodxonlik.pdf');
  assert.equal(out.mime, 'application/pdf');
  assert.equal(Buffer.from(out.bytes.subarray(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(out.bytes);
  assert.ok(doc.getPageCount() >= 6, `pages: ${doc.getPageCount()}`);
  assert.equal(doc.getTitle(), 'Moliyaviy savodxonlik');
  assert.equal(doc.getAuthor(), 'Test Muallif');
  const file = save(out.filename, out.bytes);
  if (has('pdftotext')) {
    const txt = spawnSync('pdftotext', ['-layout', file, '-']).stdout.toString();
    for (const s of ['Mundarija', 'Kirish: moliyaviy savodxonlik nima', 'Pul bilan ishlash odatlari', 'Asosiy g', 'Birinchi band', 'Lao Szi', 'Bosqich', 'Русский текст для проверки']) {
      assert.ok(txt.includes(s), `PDF text should contain "${s}"`);
    }
    // chapter order
    assert.ok(txt.lastIndexOf('Kirish: moliyaviy') < txt.lastIndexOf('Pul bilan ishlash odatlari'));
  }
});

test('PDF: works without cover/toc and on A4', async () => {
  const { book, assets } = sampleBook();
  const out = await exportPdf({ book, assets, cover: null, options: { includeCover: false, includeToc: false, pageSize: 'A4' } });
  const doc = await PDFDocument.load(out.bytes);
  assert.ok(doc.getPageCount() >= 3);
  const [w] = [doc.getPage(0).getWidth()];
  assert.ok(Math.abs(w - 595.28) < 1);
});

test('toWinAnsi (fallback only, when fonts cannot load) maps Uzbek apostrophes and transliterates Cyrillic', () => {
  assert.equal(toWinAnsi('oʻgʻil'), 'o‘g‘il');
  assert.equal(toWinAnsi('Книга'), 'Kniga');
  assert.equal(toWinAnsi('a→b'), 'a->b');
});

test('DOCX: valid OOXML package with headings, lists, table, image and metadata', async () => {
  const { book, assets, cover } = sampleBook();
  const out = await exportDocx({ book, assets, cover, options: DEFAULT_EXPORT_OPTIONS });
  assert.equal(out.filename, 'moliyaviy-savodxonlik.docx');
  const file = save(out.filename, out.bytes);
  const zip = await JSZip.loadAsync(out.bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  for (const s of ['Kirish: moliyaviy savodxonlik nima', 'Pul bilan ishlash odatlari', 'Mundarija', 'Lao Szi', '1-hafta', 'w:tbl', 'w:drawing', 'w:numPr', 'w:b/', 'w:i/', 'w:u ']) {
    assert.ok(xml.includes(s), `document.xml should contain ${s}`);
  }
  assert.ok(xml.indexOf('Kirish: moliyaviy') < xml.lastIndexOf('Pul bilan ishlash'));
  const core = await zip.file('docProps/core.xml')!.async('string');
  assert.ok(core.includes('Moliyaviy savodxonlik') && core.includes('Test Muallif'));
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
  assert.equal(new Set(media.map((m) => m.replace(/\.[a-z]+$/, ''))).size >= 2, true, 'cover + inline image');
  if (spawnSync('python3', ['-c', 'import docx']).status === 0) {
    const r = spawnSync('python3', ['-c', `import docx,sys; d=docx.Document(sys.argv[1]); print(len(d.paragraphs), len(d.tables), d.core_properties.title)`, file]);
    assert.equal(r.status, 0, r.stderr.toString());
    assert.match(r.stdout.toString(), /\d+ 1 Moliyaviy savodxonlik/);
  }
});

test('PPTX: valid presentation with section, content, image and table slides', async () => {
  const { book, assets, cover } = sampleBook();
  const out = await exportPptx({ book, assets, cover, options: DEFAULT_EXPORT_OPTIONS });
  assert.equal(out.filename, 'moliyaviy-savodxonlik.pptx');
  const zip = await JSZip.loadAsync(out.bytes);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.ok(slides.length >= 8, `slides: ${slides.length}`);
  let all = '';
  for (const s of slides.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))) all += await zip.file(s)!.async('string');
  for (const s of ['Moliyaviy savodxonlik', 'Mundarija', 'Kirish: moliyaviy savodxonlik nima', 'Asosiy g', 'Birinchi band', '1-hafta', 'a:tbl']) {
    assert.ok(all.includes(s), `slides should contain ${s}`);
  }
  assert.ok(all.indexOf('1-BOB') < all.indexOf('2-BOB'));
  const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
  assert.ok(media.length >= 2);
  const file = save(out.filename, out.bytes);
  if (spawnSync('python3', ['-c', 'import pptx']).status === 0) {
    const r = spawnSync('python3', ['-c', `import pptx,sys; p=pptx.Presentation(sys.argv[1]); print(len(p.slides), p.core_properties.title)`, file]);
    assert.equal(r.status, 0, r.stderr.toString());
    assert.match(r.stdout.toString(), /\d+ Moliyaviy savodxonlik/);
  }
});

test('EPUB 3: correct container, stored mimetype, nav, spine order and well-formed XHTML', async () => {
  const { book, assets, cover } = sampleBook();
  const out = await exportEpub({ book, assets, cover, options: DEFAULT_EXPORT_OPTIONS });
  assert.equal(out.filename, 'moliyaviy-savodxonlik.epub');
  // mimetype must be the first entry and uncompressed
  const b = Buffer.from(out.bytes);
  assert.equal(b.readUInt32LE(0), 0x04034b50);
  assert.equal(b.readUInt16LE(8), 0, 'mimetype stored');
  assert.equal(b.subarray(30, 38).toString(), 'mimetype');
  assert.equal(b.subarray(38, 58).toString(), 'application/epub+zip');
  const zip = await JSZip.loadAsync(out.bytes);
  const opf = await zip.file('OEBPS/content.opf')!.async('string');
  assert.match(opf, /<dc:title>Moliyaviy savodxonlik<\/dc:title>/);
  assert.match(opf, /<dc:creator id="author">Test Muallif<\/dc:creator>/);
  assert.match(opf, /<dc:language>uz-Latn<\/dc:language>/);
  assert.match(opf, /properties="cover-image"/);
  assert.match(opf, /properties="nav"/);
  assert.match(opf, /dcterms:modified/);
  const spine = [...opf.matchAll(/itemref idref="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(spine, ['cover', 'title', 'nav', 'ch1', 'ch2']);
  // every manifest href exists
  for (const m of opf.matchAll(/href="([^"]+)"/g)) assert.ok(zip.file(`OEBPS/${m[1]}`), `missing ${m[1]}`);
  const ch1 = await zip.file('OEBPS/chapter-1.xhtml')!.async('string');
  for (const s of ['<strong>qalin</strong>', '<em>kursiv</em>', 'class="u"', '<ol>', '<ul>', '<blockquote>', '<figure class="medium">', '<table>', '<audio', '<hr/>']) assert.ok(ch1.includes(s), `chapter-1 should contain ${s}`);
  const file = save(out.filename, out.bytes);
  if (has('xmllint')) {
    const dir = path.join(OUT, 'epub-unzipped');
    fs.rmSync(dir, { recursive: true, force: true });
    for (const name of Object.keys(zip.files)) {
      const f = zip.file(name);
      if (!f) continue;
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, await f.async('uint8array'));
    }
    const xmlFiles = Object.keys(zip.files).filter((n) => /\.(xhtml|opf|ncx|xml)$/.test(n)).map((n) => path.join(dir, n));
    const r = spawnSync('xmllint', ['--noout', ...xmlFiles]);
    assert.equal(r.status, 0, r.stderr.toString());
  }
  assert.ok(fs.existsSync(file));
});

test('single-text book ("bitta yaxlit matn"): no artificial chapters in any format', async () => {
  const { book: base, assets, cover } = sampleBook();
  const ch = { ...base.chapters[0], title: 'Ichki nom' };
  const book = { ...base, chapters: [ch], metadata: { ...base.metadata, layout: 'single' as const } };
  const opts = { ...DEFAULT_EXPORT_OPTIONS, includeToc: true };

  const pdf = await exportPdf({ book, assets, cover, options: opts });
  const pdfFile = save('single.pdf', pdf.bytes);
  if (has('pdftotext')) {
    const txt = spawnSync('pdftotext', ['-layout', pdfFile, '-']).stdout.toString();
    assert.ok(!txt.includes('Mundarija'), 'no TOC');
    assert.ok(!txt.includes('1-bob') && !txt.includes('1-BOB') && !txt.includes('Ichki nom'), 'no chapter label/title');
    assert.ok(txt.includes('Birinchi band'), 'body text present');
  }

  const epub = await JSZip.loadAsync((await exportEpub({ book, assets, cover, options: opts })).bytes);
  const x = await epub.file('OEBPS/chapter-1.xhtml')!.async('string');
  assert.ok(!x.includes('chapter-title') && !x.includes('chapter-label') && !x.includes('Ichki nom'));
  const opf = await epub.file('OEBPS/content.opf')!.async('string');
  assert.match(opf, /idref="nav" linear="no"/);

  const docx = await JSZip.loadAsync((await exportDocx({ book, assets, cover, options: opts })).bytes);
  const doc = await docx.file('word/document.xml')!.async('string');
  assert.ok(!doc.includes('Ichki nom') && !doc.includes('1-BOB') && !doc.includes('Mundarija'));

  const pptx = await JSZip.loadAsync((await exportPptx({ book, assets, cover, options: opts })).bytes);
  const slides = await Promise.all(Object.keys(pptx.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => pptx.file(f)!.async('string')));
  assert.ok(!slides.some((s) => s.includes('Ichki nom') || s.includes('1-BOB') || s.includes('Mundarija')));
});
