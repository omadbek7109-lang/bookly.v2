import { test } from 'node:test';
import assert from 'node:assert/strict';
import uz from '../../src/i18n/uz';
import ru from '../../src/i18n/ru';
import en from '../../src/i18n/en';
import { translate } from '../../src/i18n';

const keys = Object.keys(uz) as (keyof typeof uz)[];
const vars = (s: string) => [...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]).sort().filter((v, i, a) => a.indexOf(v) === i).join(',');

/** Words that are the same in every language (product, format and file names). */
const NEUTRAL = /\b(Bookly|Telegram|PDF|EPUB|DOCX|PPTX|TXT|Word|PowerPoint|Email|email|PNG|JPG|XML|OPF|SVG|META-INF|txt|docx|epub|pdf|pptx|Unicode|container|xml|word|document|Heading|A4|A5|KB|MB|B|Letter|MB|KB|start|DEMO|AI|uz|ru|en|v|f|n|i|p|a|c|B|I|U|kod|code|size|name|title|msg|time|done|total|up|down|href|word|email|mb)\b/g;

test('every interface text exists in Uzbek, Russian and English with the same placeholders', () => {
  for (const [name, dict] of [['ru', ru], ['en', en]] as const) {
    assert.deepEqual(Object.keys(dict).sort(), [...keys].sort(), `${name} has exactly the Uzbek keys`);
    for (const k of keys) {
      assert.ok(dict[k].trim().length > 0, `${name}.${k} is not empty`);
      assert.equal(vars(dict[k]), vars(uz[k]), `${name}.${k} uses the same {placeholders} as uz`);
    }
  }
});

test('no language mixes in another script', () => {
  for (const k of keys) {
    assert.ok(!/[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(uz[k]), `uz.${k} is Latin Uzbek: ${uz[k]}`);
    assert.ok(!/[А-Яа-яЁё]/.test(en[k]), `en.${k} has no Cyrillic: ${en[k]}`);
    const latinLeft = ru[k].replace(/\{[^}]*\}/g, '').replace(NEUTRAL, '').match(/[A-Za-z]{2,}/g);
    assert.equal(latinLeft, null, `ru.${k} has no stray Latin words: ${ru[k]} → ${latinLeft}`);
  }
  // typical Uzbek-only letters/words never leak into ru/en
  for (const k of keys) for (const [n, s] of [['ru', ru[k]], ['en', en[k]]]) assert.ok(!/[‘’]\w|o‘|g‘|\b(va|uchun|kitob|bob)\b/.test(s) || /’s\b|’t\b|’re\b|’ll\b/.test(s), `${n}.${k} has no Uzbek: ${s}`);
});

test('plural forms follow each language', () => {
  assert.equal(translate('ru', 'common.chapters', { n: 1 }), '1 глава');
  assert.equal(translate('ru', 'common.chapters', { n: 3 }), '3 главы');
  assert.equal(translate('ru', 'common.chapters', { n: 5 }), '5 глав');
  assert.equal(translate('ru', 'common.chapters', { n: 11 }), '11 глав');
  assert.equal(translate('ru', 'common.chapters', { n: 22 }), '22 главы');
  assert.equal(translate('en', 'common.words', { n: 1 }), '1 word');
  assert.equal(translate('en', 'common.words', { n: 7 }), '7 words');
  assert.equal(translate('uz', 'common.chapters', { n: 7 }), '7 bob');
  assert.equal(translate('en', 'export.success', { name: 'a.pdf', size: '2 KB' }), 'a.pdf is ready (2 KB)');
});
