/**
 * Bookly Telegram bot (Edge Function `telegram-bot`, verify_jwt = false — it authenticates itself).
 *
 *   POST  (Telegram webhook)  header X-Telegram-Bot-Api-Secret-Token  → answers /start, /help and messages
 *                              with a welcome text and an "Open Bookly" Mini App button.
 *   POST  ?action=send         multipart: initData, file, caption       → sends an exported book file to the
 *                              user's Telegram chat. The user is identified by the HMAC-verified initData,
 *                              so the file can only ever go to the person who opened the Mini App.
 *   GET   ?action=setup                                                  → (idempotent) registers the webhook,
 *                              the chat menu button, commands and bot descriptions. Only sets fixed values.
 *
 * TELEGRAM_BOT_TOKEN lives only in Edge Function secrets; it is never returned or logged.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { verifyInitData } from './verify.ts';

const APP_URL = Deno.env.get('BOOKLY_APP_URL') || 'https://omadbek7109-lang.github.io/bookly.v2/';
const MAX_FILE = 49 * 1024 * 1024; // Bot API upload limit is 50 MB

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const enc = new TextEncoder();
async function webhookSecret(token: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('bookly-webhook-v1')));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function tg(token: string, method: string, body: unknown): Promise<{ ok: boolean; description?: string; error_code?: number; result?: unknown }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
}

const openButton = (text = '📖 Bookly’ni ochish') => ({ inline_keyboard: [[{ text, web_app: { url: APP_URL } }]] });

function welcome(name: string) {
  return [
    `Assalomu alaykum, <b>${esc(name)}</b>! 👋`,
    '',
    '📚 <b>Bookly</b> — sun’iy intellekt yordamida elektron kitob yaratish ilovasi.',
    '',
    '✍️ Kitob yozing va tahrirlang',
    '🤖 AI yordamchi bilan boblar va g‘oyalar',
    '🎨 Chiroyli muqova yarating',
    '📄 PDF, EPUB, DOCX, PPTX formatida eksport',
    '☁️ Kitoblaringiz Cloud’da xavfsiz saqlanadi',
    '',
    'Tayyor fayllarni shu chatga ham yuborib beraman — ular shu yerda saqlanib qoladi.',
    '',
    'Boshlash uchun pastdagi tugmani bosing 👇',
  ].join('\n');
}

async function handleUpdate(token: string, update: Record<string, any>) {
  const msg = update.message;
  if (!msg?.chat?.id || msg.chat.type !== 'private') return;
  const text: string = msg.text ?? '';
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'do‘st';
  let reply: string;
  if (/^\/start\b/.test(text)) reply = welcome(name);
  else if (/^\/help\b/.test(text)) {
    reply = [
      '<b>Bookly yordam</b>',
      '',
      '1. «📖 Bookly’ni ochish» tugmasini bosing.',
      '2. Yangi kitob yarating yoki shablon tanlang.',
      '3. Eksport bo‘limida PDF/EPUB/DOCX/PPTX ni tanlang.',
      '4. «Telegram’ga yuborish» ni bossangiz, fayl shu chatga keladi.',
      '',
      'Hisob Telegram orqali avtomatik ochiladi — parol kerak emas.',
    ].join('\n');
  } else reply = 'Bookly bilan ishlash uchun ilovani oching 👇';
  const r = await tg(token, 'sendMessage', { chat_id: msg.chat.id, text: reply, parse_mode: 'HTML', reply_markup: openButton(), link_preview_options: { is_disabled: true } });
  if (!r.ok) console.error('sendMessage failed', r.error_code, r.description);
}

async function setup(token: string, selfUrl: string) {
  const secret = await webhookSecret(token);
  const steps: Record<string, unknown> = {};
  const run = async (name: string, method: string, body: unknown) => {
    const r = await tg(token, method, body);
    steps[name] = r.ok ? 'ok' : `${r.error_code}: ${r.description}`;
  };
  await run('webhook', 'setWebhook', { url: selfUrl, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false });
  await run('menu_button', 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Bookly', web_app: { url: APP_URL } } });
  await run('commands', 'setMyCommands', { commands: [{ command: 'start', description: 'Bookly’ni ochish' }, { command: 'help', description: 'Yordam' }] });
  await run('short_description', 'setMyShortDescription', { short_description: 'AI yordamida elektron kitob yarating: yozing, muqova qiling, PDF/EPUB yuklab oling.' });
  await run('description', 'setMyDescription', { description: 'Bookly — sun’iy intellekt yordamida elektron kitob yaratish ilovasi. Kitob yozing, muqova yarating va PDF, EPUB, DOCX, PPTX formatida yuklab oling. /start bosing va ilovani oching.' });
  const info = await tg(token, 'getWebhookInfo', {});
  const r = info.result as Record<string, unknown> | undefined;
  return { steps, webhook: { url: r?.url, pending: r?.pending_update_count, last_error: r?.last_error_message ?? null } };
}

async function sendFile(token: string, req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return json(400, { error: 'bad_request' }); }
  const initData = String(form.get('initData') ?? '');
  const v = await verifyInitData(initData, token, 7 * 86400);
  if (!v.ok) return json(401, { error: 'invalid_init_data', reason: v.reason });
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json(400, { error: 'bad_request', message: 'file missing' });
  if (file.size > MAX_FILE) return json(413, { error: 'file_too_large' });
  const filename = String(form.get('filename') || file.name || 'bookly-kitob').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  const caption = String(form.get('caption') ?? '').slice(0, 900);

  const out = new FormData();
  out.set('chat_id', String(v.user.id));
  out.set('document', new File([await file.arrayBuffer()], filename, { type: file.type || 'application/octet-stream' }));
  out.set('caption', caption ? `${caption}\n\n📚 Bookly orqali yaratildi` : '📚 Bookly orqali yaratildi');
  out.set('reply_markup', JSON.stringify(openButton('📖 Bookly’ni ochish')));
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: out });
  const r = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (r.ok) return json(200, { ok: true });
  console.error('sendDocument failed', r.error_code, r.description);
  if (r.error_code === 403 || /chat not found|initiate conversation|blocked/i.test(r.description ?? '')) return json(403, { error: 'need_start' });
  if (r.error_code === 413) return json(413, { error: 'file_too_large' });
  return json(502, { error: 'telegram_error', detail: String(r.error_code ?? 'unknown') });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return json(500, { error: 'not_configured' });
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  try {
    if (action === 'setup') {
      const base = (Deno.env.get('SUPABASE_URL') || `${url.protocol}//${url.host}`).replace(/\/$/, '');
      return json(200, await setup(token, `${base}/functions/v1/telegram-bot`));
    }
    if (action === 'send' && req.method === 'POST') return await sendFile(token, req);
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    // Telegram webhook: only Telegram knows the derived secret token.
    const got = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (!safeEqual(got, await webhookSecret(token))) return json(401, { error: 'unauthorized' });
    const update = await req.json().catch(() => null);
    if (update) await handleUpdate(token, update);
    return json(200, { ok: true });
  } catch (e) {
    console.error('telegram-bot failed', e instanceof Error ? e.message : e);
    return json(500, { error: 'server_error' });
  }
});
