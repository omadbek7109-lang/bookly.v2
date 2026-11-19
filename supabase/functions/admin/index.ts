/**
 * Bookly admin API + user feedback (Edge Function `admin`, verify_jwt = false — it authenticates itself).
 *
 * Who is an admin: the Telegram user ids in the Edge Function secret BOOKLY_ADMIN_IDS (comma separated).
 * The caller proves who they are with EITHER the Supabase session (Authorization: Bearer <jwt>, the profile's
 * telegram_id is checked) OR the Telegram Mini App initData (header X-Telegram-Init-Data, HMAC-verified with the
 * bot token). Nothing here trusts an id sent in the request body.
 *
 *   POST { action: 'whoami' }                                     → { admin, name }
 *   POST { action: 'feedback', message }                          → any signed-in user / Telegram user
 *   — admin only —
 *   POST { action: 'stats', days? }                               → dashboard numbers
 *   POST { action: 'users', search?, offset? }                    → user list
 *   POST { action: 'broadcast_test' | 'broadcast', text, button_text?, button_url?, open_app?, photo? (base64 data URL) }
 *   POST { action: 'broadcast_status', id } / 'broadcast_resume' / 'broadcast_cancel' / 'broadcasts'
 *   POST { action: 'message_user', telegram_id, text, photo? }
 *   POST { action: 'announce', text, link_url?, tone?, days? } / 'announcements' / 'announce_off' { id }
 *   POST { action: 'feedback_list' } / 'feedback_reply' { id, text } / 'feedback_read' { id }
 *   POST { action: 'audit' }
 *
 * TELEGRAM_BOT_TOKEN and the service key live only in Edge Function secrets; never returned or logged.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { verifyInitData } from './verify.ts';
import { escapeHtml, parseAdminIds, safeButtonUrl, SEND_INTERVAL_MS, toTelegramHtml } from './format.ts';

const APP_URL = Deno.env.get('BOOKLY_APP_URL') || 'https://omadbek7109-lang.github.io/bookly.v2/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-telegram-init-data',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_PHOTO = 8 * 1024 * 1024;
const WORK_BUDGET_MS = 100_000; // one worker run; longer broadcasts continue in the next run (resume)

type TgResult = { ok: boolean; description?: string; error_code?: number; result?: any; parameters?: { retry_after?: number } };
interface Caller { userId: string | null; telegramId: number | null; name: string; admin: boolean }

async function tg(token: string, method: string, body: unknown): Promise<TgResult> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.byteLength > MAX_PHOTO ? null : new Blob([bytes], { type: m[1] });
}

interface Message { html: string; photoFileId: string | null; buttonText: string | null; buttonUrl: string | null; openApp: boolean }

function keyboard(m: Message) {
  const rows: unknown[][] = [];
  if (m.buttonText && m.buttonUrl) rows.push([{ text: m.buttonText, url: m.buttonUrl }]);
  if (m.openApp) rows.push([{ text: '📖 Bookly’ni ochish', web_app: { url: APP_URL } }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

/** Sends one message (text, or photo with caption). Uploads a new photo once and returns its file_id for reuse. */
async function sendTo(token: string, chatId: number, m: Message, photo?: Blob | null): Promise<TgResult> {
  const markup = keyboard(m);
  if (photo) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('photo', new File([photo], 'bookly.jpg', { type: photo.type }));
    if (m.html) { form.set('caption', m.html.slice(0, 1024)); form.set('parse_mode', 'HTML'); }
    if (markup) form.set('reply_markup', JSON.stringify(markup));
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    return await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  }
  if (m.photoFileId) return tg(token, 'sendPhoto', { chat_id: chatId, photo: m.photoFileId, caption: m.html.slice(0, 1024) || undefined, parse_mode: 'HTML', reply_markup: markup });
  return tg(token, 'sendMessage', { chat_id: chatId, text: m.html, parse_mode: 'HTML', reply_markup: markup, link_preview_options: { is_disabled: true } });
}

/** Sends with one retry on Telegram's flood limit (429 retry_after). */
async function sendWithRetry(token: string, chatId: number, m: Message): Promise<TgResult> {
  let r = await sendTo(token, chatId, m);
  if (!r.ok && r.error_code === 429) {
    await sleep(Math.min(30, r.parameters?.retry_after ?? 3) * 1000);
    r = await sendTo(token, chatId, m);
  }
  return r;
}

const isBlockedError = (r: TgResult) => r.error_code === 403 || /blocked|deactivated|chat not found/i.test(r.description ?? '');

/**
 * Walks bot subscribers in telegram_id order from the broadcast's cursor. One worker at a time (lease);
 * stops after WORK_BUDGET_MS with status 'paused' so the admin panel can resume it.
 */
async function runBroadcast(db: SupabaseClient, token: string, id: string): Promise<void> {
  const started = Date.now();
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + WORK_BUDGET_MS + 30_000).toISOString();
  const { data: claimed } = await db.from('broadcasts').update({ status: 'sending', lease_until: lease })
    .eq('id', id).in('status', ['sending', 'paused']).or(`lease_until.is.null,lease_until.lt."${now}"`).select('*');
  const b = claimed?.[0];
  if (!b) return; // someone else is sending it, or it is finished
  const m: Message = { html: b.text, photoFileId: b.photo_file_id, buttonText: b.button_text, buttonUrl: b.button_url, openApp: b.open_app_button };
  let { cursor, sent, failed, blocked } = b as { cursor: number; sent: number; failed: number; blocked: number };
  for (;;) {
    const { data: batch, error } = await db.from('bot_subscribers').select('telegram_id').eq('blocked', false).gt('telegram_id', cursor).order('telegram_id').limit(50);
    if (error) { await db.from('broadcasts').update({ status: 'paused', lease_until: null, cursor, sent, failed, blocked }).eq('id', id); return; }
    if (!batch?.length) {
      await db.from('broadcasts').update({ status: 'done', lease_until: null, cursor, sent, failed, blocked, finished_at: new Date().toISOString() }).eq('id', id);
      return;
    }
    for (const row of batch) {
      // the admin already got this exact message as the preview when the broadcast started
      if (Number(row.telegram_id) === Number(b.admin_telegram_id)) { sent++; cursor = Number(row.telegram_id); continue; }
      const r = await sendWithRetry(token, Number(row.telegram_id), m);
      if (r.ok) sent++;
      else if (isBlockedError(r)) {
        blocked++;
        await db.from('bot_subscribers').update({ blocked: true, blocked_at: new Date().toISOString() }).eq('telegram_id', row.telegram_id);
      } else failed++;
      cursor = Number(row.telegram_id);
      await sleep(SEND_INTERVAL_MS);
    }
    const { data: cur } = await db.from('broadcasts').update({ cursor, sent, failed, blocked }).eq('id', id).select('status');
    if (cur?.[0]?.status === 'cancelled') { await db.from('broadcasts').update({ lease_until: null, finished_at: new Date().toISOString() }).eq('id', id); return; }
    if (Date.now() - started > WORK_BUDGET_MS) { await db.from('broadcasts').update({ status: 'paused', lease_until: null }).eq('id', id); return; }
  }
}

function background(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else void p;
}

async function identify(req: Request, db: SupabaseClient, token: string, admins: Set<number>): Promise<Caller | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (jwt && jwt.split('.').length === 3) {
    const { data } = await db.auth.getUser(jwt);
    if (data?.user) {
      const { data: prof } = await db.from('profiles').select('telegram_id, display_name').eq('id', data.user.id).maybeSingle();
      const tid = prof?.telegram_id ? Number(prof.telegram_id) : null;
      return { userId: data.user.id, telegramId: tid, name: prof?.display_name || data.user.email || '', admin: tid !== null && admins.has(tid) };
    }
  }
  const initData = req.headers.get('x-telegram-init-data') ?? '';
  if (initData) {
    const v = await verifyInitData(initData, token, 86400);
    if (v.ok) return { userId: null, telegramId: v.user.id, name: [v.user.first_name, v.user.last_name].filter(Boolean).join(' '), admin: admins.has(v.user.id) };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const admins = parseAdminIds(Deno.env.get('BOOKLY_ADMIN_IDS'));

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
  const action = String(body.action ?? '');

  try {
    const me = await identify(req, db, token, admins);
    if (!me) return json(401, { error: 'needs_login' });

    if (action === 'whoami') return json(200, { admin: me.admin, name: me.name, configured: admins.size > 0 });

    if (action === 'feedback') {
      const message = String(body.message ?? '').trim().slice(0, 2000);
      if (!message) return json(400, { error: 'bad_request' });
      const since = new Date(Date.now() - 3600_000).toISOString();
      const q = db.from('feedback').select('id', { count: 'exact', head: true }).gt('created_at', since);
      const { count } = me.userId ? await q.eq('user_id', me.userId) : await q.eq('telegram_id', me.telegramId);
      if ((count ?? 0) >= 5) return json(429, { error: 'rate_limited' });
      const { error } = await db.from('feedback').insert({ user_id: me.userId, telegram_id: me.telegramId, name: me.name.slice(0, 128), message, app_version: String(body.version ?? '').slice(0, 32) || null });
      if (error) throw error;
      // let admins know right away
      if (token) for (const a of admins) await tg(token, 'sendMessage', { chat_id: a, parse_mode: 'HTML', text: `💬 <b>Yangi fikr</b> — ${escapeHtml(me.name || 'foydalanuvchi')}\n\n${escapeHtml(message)}` }).catch(() => null);
      return json(200, { ok: true });
    }

    if (!me.admin) return json(403, { error: 'not_admin' });
    const audit = (what: string, details: Record<string, unknown> = {}) => db.from('admin_audit').insert({ admin_telegram_id: me.telegramId, action: what, details });

    switch (action) {
      case 'stats': {
        const { data, error } = await db.rpc('bookly_admin_stats', { p_days: Number(body.days) || 14 });
        if (error) throw error;
        return json(200, data);
      }
      case 'users': {
        const { data, error } = await db.rpc('bookly_admin_users', { p_search: String(body.search ?? '').slice(0, 80), p_limit: 50, p_offset: Number(body.offset) || 0 });
        if (error) throw error;
        return json(200, { users: data });
      }
      case 'broadcast_test':
      case 'broadcast':
      case 'message_user': {
        if (!token) return json(503, { error: 'bot_not_configured' });
        const text = String(body.text ?? '').slice(0, 4000);
        const photo = body.photo ? dataUrlToBlob(String(body.photo)) : null;
        if (body.photo && !photo) return json(400, { error: 'bad_photo' });
        if (!text.trim() && !photo) return json(400, { error: 'empty_message' });
        const buttonUrl = safeButtonUrl(body.button_url);
        const m: Message = {
          html: toTelegramHtml(text), photoFileId: null,
          buttonText: buttonUrl ? String(body.button_text ?? '').trim().slice(0, 64) || null : null, buttonUrl,
          openApp: body.open_app !== false,
        };
        if (photo && m.html.length > 1024) return json(400, { error: 'caption_too_long' });
        // the first send goes to the admin: a preview, and it uploads the photo once (file_id is reused)
        const target = action === 'message_user' ? Number(body.telegram_id) : me.telegramId!;
        if (!Number.isSafeInteger(target) || target <= 0) return json(400, { error: 'bad_request' });
        const first = await sendTo(token, target, m, photo);
        if (!first.ok) return json(isBlockedError(first) ? 409 : 400, { error: isBlockedError(first) ? 'user_blocked_bot' : 'telegram_error', detail: first.description ?? '' });
        const sizes = first.result?.photo as { file_id: string }[] | undefined;
        m.photoFileId = sizes?.length ? sizes[sizes.length - 1].file_id : null;
        if (action === 'message_user') { await audit('message_user', { telegram_id: target }); return json(200, { ok: true }); }
        if (action === 'broadcast_test') return json(200, { ok: true });
        const { count } = await db.from('bot_subscribers').select('telegram_id', { count: 'exact', head: true }).eq('blocked', false);
        const { data: row, error } = await db.from('broadcasts').insert({
          admin_telegram_id: me.telegramId, text: m.html, photo_file_id: m.photoFileId, button_text: m.buttonText, button_url: m.buttonUrl,
          open_app_button: m.openApp, total: count ?? 0,
        }).select('*').single();
        if (error) throw error;
        await audit('broadcast', { id: row.id, total: row.total, photo: !!m.photoFileId });
        background(runBroadcast(db, token, row.id));
        return json(200, { broadcast: row });
      }
      case 'broadcast_resume': {
        if (!token) return json(503, { error: 'bot_not_configured' });
        background(runBroadcast(db, token, String(body.id)));
        return json(200, { ok: true });
      }
      case 'broadcast_cancel': {
        await db.from('broadcasts').update({ status: 'cancelled' }).eq('id', String(body.id)).in('status', ['sending', 'paused']);
        await audit('broadcast_cancel', { id: body.id });
        return json(200, { ok: true });
      }
      case 'broadcast_status': {
        const { data } = await db.from('broadcasts').select('*').eq('id', String(body.id)).maybeSingle();
        return json(200, { broadcast: data });
      }
      case 'broadcasts': {
        const { data } = await db.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(20);
        return json(200, { broadcasts: data ?? [] });
      }
      case 'announce': {
        const text = String(body.text ?? '').trim().slice(0, 500);
        if (!text) return json(400, { error: 'bad_request' });
        const days = Math.min(90, Math.max(0, Number(body.days) || 0));
        await db.from('announcements').update({ active: false }).eq('active', true);
        const { data, error } = await db.from('announcements').insert({
          text, link_url: safeButtonUrl(body.link_url), tone: ['info', 'success', 'warning'].includes(body.tone) ? body.tone : 'info',
          expires_at: days ? new Date(Date.now() + days * 86400_000).toISOString() : null,
        }).select('*').single();
        if (error) throw error;
        await audit('announce', { id: data.id });
        return json(200, { announcement: data });
      }
      case 'announcements': {
        const { data } = await db.from('announcements').select('*').order('created_at', { ascending: false }).limit(20);
        return json(200, { announcements: data ?? [] });
      }
      case 'announce_off': {
        await db.from('announcements').update({ active: false }).eq('id', String(body.id));
        await audit('announce_off', { id: body.id });
        return json(200, { ok: true });
      }
      case 'feedback_list': {
        const { data } = await db.from('feedback').select('*').order('created_at', { ascending: false }).limit(100);
        return json(200, { feedback: data ?? [] });
      }
      case 'feedback_read': {
        await db.from('feedback').update({ status: 'read' }).eq('id', String(body.id)).eq('status', 'new');
        return json(200, { ok: true });
      }
      case 'feedback_reply': {
        const { data: f } = await db.from('feedback').select('*').eq('id', String(body.id)).maybeSingle();
        const text = String(body.text ?? '').trim().slice(0, 3500);
        if (!f || !text) return json(400, { error: 'bad_request' });
        if (!f.telegram_id) return json(409, { error: 'no_telegram' });
        if (!token) return json(503, { error: 'bot_not_configured' });
        const r = await tg(token, 'sendMessage', { chat_id: f.telegram_id, parse_mode: 'HTML', text: `💬 <b>Bookly jamoasi javobi</b>\n\n${toTelegramHtml(text)}` });
        if (!r.ok) return json(isBlockedError(r) ? 409 : 400, { error: isBlockedError(r) ? 'user_blocked_bot' : 'telegram_error' });
        await db.from('feedback').update({ status: 'answered' }).eq('id', f.id);
        await audit('feedback_reply', { id: f.id });
        return json(200, { ok: true });
      }
      case 'audit': {
        const { data } = await db.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(50);
        return json(200, { audit: data ?? [] });
      }
      default:
        return json(400, { error: 'bad_request' });
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('admin failed', action, err?.code, err?.message);
    if (err?.code === 'PGRST202' || err?.code === '42P01' || /does not exist|schema cache/i.test(err?.message ?? '')) return json(503, { error: 'admin_not_ready' });
    return json(500, { error: 'server_error' });
  }
});
