/**
 * Bookly AI writing assistant (Edge Function `ai-assist`, verify_jwt = false — it checks the session itself).
 *
 *   GET  ?action=status  → { configured }   (no secrets, no model details)
 *   POST { task, text, note, language, bookTitle, chapterTitle }   Authorization: Bearer <user access token>
 *        → { text, items? }
 *
 * The model API key (ANTHROPIC_API_KEY) lives only in Edge Function secrets. Each signed-in user has a daily
 * allowance (BOOKLY_AI_DAILY_LIMIT, default 60) counted atomically in public.ai_usage.
 * The assistant performs only the requested task; it never writes a whole book.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Task = 'continue' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'ideas' | 'dialog' | 'titles';
const TASKS: Record<Task, { prompt: string; needsText: boolean; maxTokens: number }> = {
  continue: { needsText: true, maxTokens: 500, prompt: 'Continue the text naturally with 2–4 sentences (one short paragraph). Return only the new continuation, not the original text.' },
  rewrite: { needsText: true, maxTokens: 900, prompt: 'Rewrite the text so it says the same thing more clearly and vividly. Keep a similar length and the author’s voice.' },
  grammar: { needsText: true, maxTokens: 900, prompt: 'Fix spelling, grammar and punctuation only. Do not change wording, meaning or style. Return the corrected text.' },
  shorten: { needsText: true, maxTokens: 600, prompt: 'Shorten the text to about half its length, keeping the key ideas and the author’s voice.' },
  expand: { needsText: true, maxTokens: 1000, prompt: 'Expand the text with concrete details or a short example so it becomes about 1.5–2 times longer. Keep the author’s voice.' },
  ideas: { needsText: false, maxTokens: 500, prompt: 'Give 5 short, concrete ideas for what the author could write next. One idea per line, numbered 1–5.' },
  dialog: { needsText: false, maxTokens: 700, prompt: 'Write a short dialogue (6–10 lines) that fits the context. Every line starts with an em dash (—). No narration outside the lines.' },
  titles: { needsText: false, maxTokens: 300, prompt: 'Suggest 5 different titles for this chapter or text. One title per line. No numbering, no quotes, no extra words.' },
};
const LANG: Record<string, string> = { uz: 'Uzbek (Latin script)', ru: 'Russian', en: 'English' };

const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('action') === 'status') return json(200, { configured: !!apiKey });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!apiKey) return json(503, { error: 'ai_not_configured' });

  const supaUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'needs_login' });
  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !u?.user) return json(401, { error: 'session_expired' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
  const task = body.task as Task;
  const spec = TASKS[task];
  if (!spec) return json(400, { error: 'bad_request' });
  const text = clip(body.text, 6000).trim();
  if (spec.needsText && !text) return json(400, { error: 'bad_request' });

  const limit = Number(Deno.env.get('BOOKLY_AI_DAILY_LIMIT') || 60);
  const { data: allowed, error: limErr } = await admin.rpc('bookly_ai_take', { p_user: u.user.id, p_limit: limit });
  if (limErr) { console.error('ai limit check failed', limErr.code, limErr.message); return json(500, { error: 'ai_error' }); }
  if (!allowed) return json(429, { error: 'ai_limit' });

  const language = LANG[String(body.language)] ?? LANG.uz;
  const system = [
    'You are the writing assistant inside Bookly, an app where people write their own books.',
    'Do exactly the one task you are given, on the text you are given. Never write a whole book or several chapters.',
    'Reply with the result only: no preface, no explanations, no surrounding quotes, no markdown.',
    `Write in ${language}.`,
  ].join(' ');
  const context = [
    body.bookTitle ? `Book title: ${clip(body.bookTitle, 200)}` : '',
    body.chapterTitle ? `Chapter title: ${clip(body.chapterTitle, 200)}` : '',
    body.note ? `Author's note: ${clip(body.note, 400)}` : '',
  ].filter(Boolean).join('\n');
  const user = `${spec.prompt}\n\n${context}${text ? `\n\nText:\n<<<\n${text}\n>>>` : ''}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('BOOKLY_AI_MODEL') || 'claude-haiku-5-5', max_tokens: spec.maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('model error', res.status, out?.error?.type); return json(502, { error: 'ai_error' }); }
    const result = String((out.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n')).trim();
    if (!result) return json(502, { error: 'ai_error' });
    if (task === 'titles') {
      const items = result.split('\n').map((x) => x.replace(/^\s*(?:\d+[.)]|[-–—•*])\s*/, '').replace(/^["“«']|["”»']$/g, '').trim()).filter(Boolean).slice(0, 8);
      return json(200, { text: items.join('\n'), items });
    }
    return json(200, { text: result });
  } catch (e) {
    console.error('ai-assist failed', e instanceof Error ? e.message : e);
    return json(502, { error: 'ai_error' });
  }
});
