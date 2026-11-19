/**
 * Telegram Mini App initData verification (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
 * hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 * Runs unchanged in Deno (Edge Functions) and Node 20+ (unit tests): Web Crypto only.
 */
export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export type VerifyResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: 'missing_hash' | 'bad_signature' | 'expired' | 'no_user' | 'malformed' };

const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data) as BufferSource));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Constant-time comparison of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  return hex(await hmac(secret, check));
}

export async function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86400, now = Date.now()): Promise<VerifyResult> {
  if (typeof initData !== 'string' || initData.length > 8192) return { ok: false, reason: 'malformed' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  const fields: Record<string, string> = {};
  for (const [k, v] of params) if (k !== 'hash') fields[k] = v;
  const expected = await signInitData(fields, botToken);
  if (!safeEqual(expected, hash.toLowerCase())) return { ok: false, reason: 'bad_signature' };
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSeconds || authDate - now / 1000 > 300) return { ok: false, reason: 'expired' };
  let user: TelegramUser;
  try { user = JSON.parse(fields.user ?? 'null'); } catch { return { ok: false, reason: 'malformed' }; }
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'no_user' };
  return { ok: true, user, authDate };
}
