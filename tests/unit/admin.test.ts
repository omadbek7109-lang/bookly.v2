import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, parseAdminIds, safeButtonUrl, toTelegramHtml } from '../../supabase/functions/admin/format';

test('broadcast text: HTML is escaped, **bold** and __italic__ become tags', () => {
  assert.equal(toTelegramHtml('  Salom **hammaga** va __do‘stlar__ <script>x</script> & co  '),
    'Salom <b>hammaga</b> va <i>do‘stlar</i> &lt;script&gt;x&lt;/script&gt; &amp; co');
  assert.equal(toTelegramHtml('**'), '**', 'lone marks stay text');
  assert.equal(escapeHtml('<b>'), '&lt;b&gt;');
});

test('button links: only http(s)', () => {
  assert.equal(safeButtonUrl('https://t.me/Booklym_app_Bot'), 'https://t.me/Booklym_app_Bot');
  assert.equal(safeButtonUrl('javascript:alert(1)'), null);
  assert.equal(safeButtonUrl('tg://resolve?domain=x'), null);
  assert.equal(safeButtonUrl(''), null);
  assert.equal(safeButtonUrl('not a url'), null);
});

test('admin ids secret: commas, spaces and junk', () => {
  assert.deepEqual([...parseAdminIds(' 123, 456 789;abc,-5, 0 ')], [123, 456, 789]);
  assert.equal(parseAdminIds(undefined).size, 0);
});
