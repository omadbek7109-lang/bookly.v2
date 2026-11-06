/**
 * Export quality matrix: every format × book layout × writing system, reopened and checked for real content.
 * A file being produced is not enough — text must come back exactly (Cyrillic, Uzbek oʻ gʻ, Russian, English).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { createBlock, createBook, createChapter, type Book, type BookLanguage } from '../../src/models/book';
import { exportPdf } from '../../src/services/export/pdf';
import { exportDocx } from '../../src/services/export/docx';
import { exportPptx } from '../../src/services/export/pptx';
import { exportEpub } from '../../src/services/export/epub';
import { setPdfFontLoader } from '../../src/services/export/pdfFonts';
import { DEFAULT_EXPORT_OPTIONS } from '../../src/services/export/types';
import { makePng } from './fixtures';

const OUT = path.resolve('.test-build/exports-lang');
fs.mkdirSync(OUT, { recursive: true });
const diskFonts = async (file: string) => new Uint8Array(fs.readFileSync(path.resolve('public/fonts', file)));
setPdfFontLoader(diskFonts);
const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

interface Sample { id: string; language: BookLanguage; title: string; heading: string; para: string; quote: string; chapter2: string; probes: string[] }
const SAMPLES: Sample[] = [
  {
    id: 'uz-latn', language: 'uz', title: 'Oʻzbek tili goʻzalligi', heading: 'Gʻoya va maqsad', chapter2: 'Ikkinchi bob: shoir soʻzi',
    para: 'Shahar choʻqqisida oʻgʻil va qiz gʻalaba haqida gaplashdi. Sh, Ch, Oʻ, Gʻ va ng harflari toʻgʻri chiqishi kerak.',
    quote: 'Ilm — aql chirogʻi.', probes: ['Oʻzbek tili goʻzalligi', 'choʻqqisida', 'oʻgʻil', 'gʻalaba', 'Oʻ, Gʻ', 'chirogʻi'],
  },
  {
    id: 'uz-cyrl', language: 'uz', title: 'Ўзбек тили гўзаллиги', heading: 'Ғоя ва мақсад', chapter2: 'Иккинчи боб: шоир сўзи',
    para: 'Шаҳар чўққисида ўғил ва қиз ғалаба ҳақида гаплашди. Ш, Ч, Ў, Ғ, Қ, Ҳ ҳарфлари тўғри чиқиши керак.',
    quote: 'Илм — ақл чироғи.', probes: ['Ўзбек тили гўзаллиги', 'чўққисида', 'ўғил', 'ғалаба', 'Ў, Ғ, Қ, Ҳ', 'чироғи'],
  },
  {
    id: 'ru', language: 'ru', title: 'Красота русского языка', heading: 'Идея и цель', chapter2: 'Глава вторая: слово поэта',
    para: 'Съешь же ещё этих мягких французских булок да выпей чаю. Ёлка, щука и объём должны остаться без изменений.',
    quote: 'Учение — свет, а неучение — тьма.', probes: ['Красота русского языка', 'Съешь же ещё', 'французских булок', 'Ёлка, щука и объём', 'неучение — тьма'],
  },
  {
    id: 'en', language: 'en', title: 'The Beauty of Language', heading: 'Idea and purpose', chapter2: 'Chapter two: the poet’s word',
    para: 'The quick brown fox jumps over the lazy dog. “Quotes”, em dashes — and ellipses… must survive.',
    quote: 'Knowledge is light.', probes: ['The Beauty of Language', 'quick brown fox', 'lazy dog', 'Knowledge is light'],
  },
];

function makeBook(s: Sample, single: boolean): { book: Book; assets: Record<string, { id: string; bytes: Uint8Array; mime: string; width: number; height: number; name: string }> } {
  const long = Array.from({ length: 40 }, () => s.para).join(' ');
  const c1 = createChapter(s.heading, [
    createBlock('paragraph', { html: s.para }),
    createBlock('heading', { level: 1, html: s.heading }),
    createBlock('quote', { html: s.quote }),
    createBlock('image', { assetId: 'img', caption: s.heading, width: 'medium' }),
    createBlock('paragraph', { html: long }),
  ]);
  const c2 = createChapter(s.chapter2, [createBlock('paragraph', { html: `<b>${s.para}</b>` })]);
  const book = createBook({ title: s.title, author: 'Muallif Муаллиф', language: s.language, chapters: single ? [{ ...c1, blocks: [...c1.blocks, ...c2.blocks] }] : [c1, c2], layout: single ? 'single' : 'chapters' });
  return { book, assets: { img: { id: 'img', bytes: makePng(120, 80), mime: 'image/png', width: 120, height: 80, name: 'r.png' } } };
}

const norm = (t: string) => t.replace(/\s+/g, ' ');
const xmlText = (x: string) => norm(x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));

for (const s of SAMPLES) {
  for (const single of [false, true]) {
    const label = `${s.id} ${single ? 'single-text' : 'chapters'}`;

    test(`PDF ${label}: Unicode text survives (copy/search), embedded fonts, long text paginates`, async () => {
      const { book, assets } = makeBook(s, single);
      const out = await exportPdf({ book, assets, cover: null, options: { ...DEFAULT_EXPORT_OPTIONS, includeCover: false, pageSize: 'A5' } });
      const doc = await PDFDocument.load(out.bytes);
      assert.ok(doc.getPageCount() >= 4, `long text spans pages (${doc.getPageCount()})`);
      assert.equal(doc.getTitle(), s.title, 'metadata title kept as Unicode');
      const file = path.join(OUT, `${label.replace(' ', '-')}.pdf`);
      fs.writeFileSync(file, out.bytes);
      if (!has('pdftotext')) return;
      const txt = norm(spawnSync('pdftotext', [file, '-']).stdout.toString());
      for (const p of s.probes) assert.ok(txt.includes(p), `PDF text contains "${p}"`);
      assert.ok(!txt.includes('?'.repeat(3)), 'no replacement characters');
      if (single) assert.ok(!/1-bob|1-боб|Глава 1|Chapter 1|Mundarija|Мундарижа|Содержание|Contents/i.test(txt), 'no artificial chapters/TOC');
      if (!single) assert.ok(txt.includes(s.chapter2), 'second chapter title');
      if (s.id === 'uz-cyrl' && !single) assert.ok(txt.includes('1-БОБ') && txt.includes('Мундарижа') && !txt.includes('1-BOB'), 'Cyrillic Uzbek book gets Cyrillic labels');
      if (has('pdffonts')) {
        const fonts = spawnSync('pdffonts', [file]).stdout.toString();
        assert.match(fonts, /BooklySerif-Regular/);
        const names = fonts.split('\n').filter((l) => /Bookly/.test(l)).map((l) => l.split(/\s+/)[0].replace(/-\d+$/, ''));
        assert.equal(new Set(names).size, names.length, `each font style embedded once: ${names.join(', ')}`);
        for (const line of fonts.split('\n').filter((l) => /Bookly/.test(l))) assert.match(line, /CID TrueType\s+Identity-H\s+yes\s+\S+\s+yes/, `embedded subset with ToUnicode: ${line}`);
      }
    });

    test(`DOCX ${label}: reopened document has the exact text and image`, async () => {
      const { book, assets } = makeBook(s, single);
      const zip = await JSZip.loadAsync((await exportDocx({ book, assets, cover: null, options: DEFAULT_EXPORT_OPTIONS })).bytes);
      const xml = await zip.file('word/document.xml')!.async('string');
      const text = xmlText(xml);
      for (const p of s.probes) assert.ok(text.includes(p), `DOCX contains "${p}"`);
      assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')), 'image embedded');
      assert.equal(xml.includes('Heading1') || xml.includes('Heading2'), true, 'headings styled');
    });

    test(`EPUB ${label}: reopened XHTML has the exact text and image`, async () => {
      const { book, assets } = makeBook(s, single);
      const zip = await JSZip.loadAsync((await exportEpub({ book, assets, cover: null, options: DEFAULT_EXPORT_OPTIONS })).bytes);
      const pages = await Promise.all(Object.keys(zip.files).filter((f) => /chapter-\d+\.xhtml$/.test(f)).map((f) => zip.file(f)!.async('string')));
      assert.equal(pages.length, single ? 1 : 2);
      const text = xmlText(pages.join(' '));
      for (const p of s.probes.filter((x) => x !== s.title)) assert.ok(text.includes(p), `EPUB contains "${p}"`);
      assert.ok(pages.join('').includes('<blockquote'), 'quote kept');
      assert.ok(Object.keys(zip.files).some((f) => /OEBPS\/(images|media)\//.test(f) || /\.png$/.test(f)), 'image packaged');
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      assert.ok(opf.includes(`<dc:title>${s.title}</dc:title>`), 'title metadata');
    });

    test(`PPTX ${label}: reopened slides have the exact text`, async () => {
      const { book, assets } = makeBook(s, single);
      const zip = await JSZip.loadAsync((await exportPptx({ book, assets, cover: null, options: DEFAULT_EXPORT_OPTIONS })).bytes);
      const slides = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')));
      const text = xmlText(slides.join(' '));
      for (const p of s.probes.slice(0, 3)) assert.ok(text.includes(p), `PPTX contains "${p}"`);
      assert.ok(Object.keys(zip.files).some((f) => f.startsWith('ppt/media/')), 'image embedded');
    });
  }
}

test('PDF falls back to standard fonts (transliterated) if font files cannot be loaded — export never fails', async () => {
  setPdfFontLoader(null);
  try {
    const { book, assets } = makeBook(SAMPLES[2], false);
    const out = await exportPdf({ book, assets, cover: null, options: { ...DEFAULT_EXPORT_OPTIONS, includeCover: false } });
    const file = path.join(OUT, 'fallback.pdf');
    fs.writeFileSync(file, out.bytes);
    if (has('pdftotext')) assert.ok(norm(spawnSync('pdftotext', [file, '-']).stdout.toString()).includes('Krasota russkogo'));
  } finally { setPdfFontLoader(diskFonts); }
});
