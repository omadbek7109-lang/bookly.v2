import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookProgress, bookWordCount, createBlock, createBook, createChapter, duplicateBook, migrateBook, SCHEMA_VERSION } from '../../src/models/book';
import { parseInline, plainText, sanitizeInline } from '../../src/utils/inline';
import { slugify } from '../../src/utils/id';

test('createBook produces a valid, versioned document with stable ids', () => {
  const b = createBook({ title: 'Test' });
  assert.equal(b.schemaVersion, SCHEMA_VERSION);
  assert.match(b.id, /^book_/);
  assert.equal(b.chapters.length, 1);
  assert.match(b.chapters[0].id, /^ch_/);
  assert.match(b.chapters[0].blocks[0].id, /^blk_/);
  assert.equal(b.deletedAt, null);
});

test('duplicateBook deep-copies with fresh ids', () => {
  const b = createBook({ title: 'Asl', chapters: [createChapter('A', [createBlock('paragraph', { html: 'x' })])] });
  b.favorite = true;
  const d = duplicateBook(b);
  assert.notEqual(d.id, b.id);
  assert.notEqual(d.chapters[0].id, b.chapters[0].id);
  assert.notEqual(d.chapters[0].blocks[0].id, b.chapters[0].blocks[0].id);
  assert.equal(d.favorite, false);
  assert.match(d.title, /nusxa/);
  d.chapters[0].title = 'changed';
  assert.equal(b.chapters[0].title, 'A');
});

test('migrateBook upgrades legacy Bookly Mini shapes', () => {
  const legacy = { id: 'old1', title: 'Eski kitob', chapters: [{ title: 'Bob 1', content: 'Birinchi paragraf.\n\nIkkinchi <paragraf>.' }] };
  const b = migrateBook(legacy);
  assert.equal(b.schemaVersion, SCHEMA_VERSION);
  assert.equal(b.id, 'old1');
  assert.equal(b.chapters[0].blocks.length, 2);
  assert.equal(b.metadata.source, 'migration');
  const single = migrateBook({ title: 'Bir', content: 'Matn' });
  assert.equal(single.chapters.length, 1);
  assert.throws(() => migrateBook({ schemaVersion: 999 }));
});

test('migrateBook fills defaults on partial v1 records', () => {
  const b = migrateBook({ schemaVersion: 1, id: 'x', title: 'T', chapters: [{ id: 'c', title: 'C', blocks: [] }] });
  assert.equal(b.chapters[0].blocks.length, 1);
  assert.ok(b.cover.background.colors.length === 2);
  assert.equal(b.status, 'draft');
});

test('inline parser keeps formatting and strips unsafe markup', () => {
  const runs = parseInline('Salom <b>qalin <i>ikki</i></b> <script>alert(1)</script><u>u</u><br>keyin');
  assert.deepEqual(runs.map((r) => [r.text, !!r.bold, !!r.italic, !!r.underline]), [
    ['Salom ', false, false, false], ['qalin ', true, false, false], ['ikki', true, true, false], [' alert(1)', false, false, false], ['u', false, false, true], ['keyin', false, false, false],
  ]);
  assert.equal(sanitizeInline('<span style="x">a</span><strong>b</strong><img src=x onerror=1>'), 'a<b>b</b>');
  assert.equal(plainText('a&amp;b<br>c'), 'a&b\nc');
  assert.equal(sanitizeInline('<div>bir</div><div>ikki</div>'), 'bir<br>ikki');
});

test('word count and progress', () => {
  const b = createBook({ chapters: [createChapter('A', [createBlock('paragraph', { html: 'so‘z '.repeat(50) })]), createChapter('B')] });
  assert.equal(bookWordCount(b), 50);
  assert.equal(bookProgress(b), 50);
  b.status = 'completed';
  assert.equal(bookProgress(b), 100);
});

test('slugify handles Uzbek and Cyrillic', () => {
  assert.equal(slugify('Moliyaviy savodxonlik: o‘zbek tilida!'), 'moliyaviy-savodxonlik-ozbek-tilida');
  assert.equal(slugify('Книга'), 'kniga');
  assert.equal(slugify('***'), 'bookly');
});
