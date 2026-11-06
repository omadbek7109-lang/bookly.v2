import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signInitData, verifyInitData } from '../../supabase/functions/telegram-auth/verify';

const TOKEN = '123456789:AAFakeBotTokenForTestsOnly_xxxxxxxxx';

/** Independent implementation of Telegram's documented algorithm using node:crypto. */
function telegramReferenceHash(fields: Record<string, string>, token: string) {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return createHmac('sha256', secret).update(check).digest('hex');
}

function initData(overrides: Record<string, string> = {}, token = TOKEN, now = Math.floor(Date.now() / 1000)) {
  const fields: Record<string, string> = {
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: 279058397, first_name: 'Ali', last_name: 'Valiyev', username: 'ali_v', language_code: 'uz' }),
    auth_date: String(now),
    ...overrides,
  };
  const hash = telegramReferenceHash(fields, token);
  return { str: new URLSearchParams({ ...fields, hash }).toString(), fields, hash };
}

test('signature matches Telegram’s documented HMAC-SHA256 algorithm', async () => {
  const { fields, hash } = initData();
  assert.equal(await signInitData(fields, TOKEN), hash);
});

test('valid initData is accepted and returns the Telegram user', async () => {
  const r = await verifyInitData(initData().str, TOKEN);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.user.id, 279058397); assert.equal(r.user.username, 'ali_v'); }
});

test('tampered user, wrong bot token, missing hash and stale data are rejected', async () => {
  const good = initData();
  const p = new URLSearchParams(good.str);
  p.set('user', JSON.stringify({ id: 1, first_name: 'Hacker' }));
  assert.deepEqual(await verifyInitData(p.toString(), TOKEN), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(await verifyInitData(good.str, '999:OtherBotToken'), { ok: false, reason: 'bad_signature' });
  const noHash = new URLSearchParams(good.str); noHash.delete('hash');
  assert.deepEqual(await verifyInitData(noHash.toString(), TOKEN), { ok: false, reason: 'missing_hash' });
  const old = initData({}, TOKEN, Math.floor(Date.now() / 1000) - 3 * 86400);
  assert.deepEqual(await verifyInitData(old.str, TOKEN), { ok: false, reason: 'expired' });
  const noUser = initData({ user: 'null' });
  assert.deepEqual(await verifyInitData(noUser.str, TOKEN), { ok: false, reason: 'no_user' });
  assert.deepEqual(await verifyInitData('x'.repeat(9000), TOKEN), { ok: false, reason: 'malformed' });
});
