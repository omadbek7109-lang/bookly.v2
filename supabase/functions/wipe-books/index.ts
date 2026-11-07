/**
 * Deletes all of the signed-in user's BOOKS (books, chapters, book files) after a 4-digit confirmation code.
 * The account, profile, settings and everything else are kept. (Edge Function `wipe-books`, verify_jwt = false:
 * the user's session token is checked here.)
 *
 *   POST { action: 'start' }                         → { request_id, code, expires_at }
 *   POST { action: 'confirm', request_id, code }     → { status: 'ok', books, chapters, files_removed, files_failed }
 *                                                      | { status: 'wrong', attempts_left } | 'locked' | 'expired' | 'invalid'
 *
 * Security: the code comes from crypto.getRandomValues (rejection sampling, no modulo bias); only an HMAC of
 * (request id, code) keyed with a server secret is stored; checks, attempt counting (max 5), expiry (5 min),
 * single use and the deletion itself run in one locked SQL transaction (bookly_wipe_confirm).
 * Codes are never logged.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const enc = new TextEncoder();

/** Uniform random 0000–9999 from a CSPRNG. */
function randomCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4294960000) return String(buf[0] % 10000).padStart(4, '0'); // 4294960000 = 429496 * 10000
  }
}

async function codeHash(secret: string, requestId: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`bookly-wipe:${requestId}:${code}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const notReady = (e: { code?: string; message?: string }) => e.code === 'PGRST202' || /function .* does not exist|book_wipe_requests/i.test(e.message ?? '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const secret = Deno.env.get('BOOKLY_WIPE_SECRET') || serviceKey; // pepper for code hashes; never leaves the server

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'needs_login' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !u?.user) return json(401, { error: 'session_expired' });
  const userId = u.user.id;

  let body: { action?: string; request_id?: string; code?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }

  try {
    if (body.action === 'start') {
      const code = randomCode();
      const requestId = crypto.randomUUID();
      const { data: expiresAt, error } = await admin.rpc('bookly_wipe_start', { p_user: userId, p_request: requestId, p_code_hash: await codeHash(secret, requestId, code) });
      if (error) {
        if (/rate_limited/.test(error.message)) return json(429, { error: 'wipe_rate_limited' });
        if (notReady(error)) return json(503, { error: 'wipe_not_ready' });
        throw error;
      }
      // The code is shown to the user on purpose (it confirms intent); it is not logged and is stored only as an HMAC.
      return json(200, { request_id: requestId, code, expires_at: expiresAt });
    }

    if (body.action === 'confirm') {
      const requestId = String(body.request_id ?? '');
      const code = String(body.code ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d{4}$/.test(code)) return json(400, { error: 'bad_request' });
      const hash = await codeHash(secret, requestId, code);
      const { data, error } = await admin.rpc('bookly_wipe_confirm', { p_user: userId, p_request: requestId, p_code_hash: hash });
      if (error) { if (notReady(error)) return json(503, { error: 'wipe_not_ready' }); throw error; }
      const r = data as { status: string; books?: number; chapters?: number; paths?: string[]; attempts_left?: number };
      if (r.status !== 'ok') return json(r.status === 'wrong' ? 422 : 409, { status: r.status, attempts_left: r.attempts_left ?? 0 });

      // Database rows are gone. Remove the files: everything listed in book_assets plus anything else in the
      // user's own folder (only `${userId}/…` paths are ever touched).
      const paths = new Set((r.paths ?? []).filter((p) => p.startsWith(`${userId}/`)));
      for (let offset = 0; ; offset += 1000) {
        const { data: objs, error: lErr } = await admin.storage.from('book-assets').list(userId, { limit: 1000, offset });
        if (lErr || !objs?.length) break;
        for (const o of objs) if (o.name) paths.add(`${userId}/${o.name}`);
        if (objs.length < 1000) break;
      }
      let removed = 0, failed = 0;
      const all = [...paths];
      for (let i = 0; i < all.length; i += 100) {
        const chunk = all.slice(i, i + 100);
        const { data: rm, error: rmErr } = await admin.storage.from('book-assets').remove(chunk);
        if (rmErr) failed += chunk.length; else removed += rm?.length ?? chunk.length;
      }
      if (failed) console.error('wipe-books: some files were not removed', { user: userId, failed });
      return json(200, { status: 'ok', books: r.books ?? 0, chapters: r.chapters ?? 0, files_removed: removed, files_failed: failed });
    }
    return json(400, { error: 'bad_request' });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('wipe-books failed', err?.code, err?.message);
    return json(500, { error: 'server_error' });
  }
});
