/**
 * POST /functions/v1/telegram-auth   body: { initData: string }
 * Verifies Telegram Mini App initData with TELEGRAM_BOT_TOKEN (Edge Function secret, never sent to
 * the browser), finds or creates the Supabase user for that Telegram account and returns a session.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { verifyInitData, type TelegramUser } from './verify.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const displayName = (u: TelegramUser) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || `Telegram ${u.id}`;
// Synthetic, non-deliverable address: Supabase Auth needs one; Telegram users never receive mail here.
const syntheticEmail = (id: number) => `tg${id}@telegram.bookly.invalid`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!botToken) return json(500, { error: 'not_configured', message: 'TELEGRAM_BOT_TOKEN secret is not set' });
  if (!url || !serviceKey || !anonKey) return json(500, { error: 'not_configured', message: 'Supabase env missing' });

  let initData = '';
  try { initData = String((await req.json()).initData ?? ''); } catch { return json(400, { error: 'bad_request' }); }

  const v = await verifyInitData(initData, botToken);
  if (!v.ok) return json(401, { error: 'invalid_init_data', reason: v.reason });
  const tg = v.user;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // 1. Existing account linked to this Telegram id?
    const { data: prof, error: profErr } = await admin.from('profiles').select('id').eq('telegram_id', tg.id).maybeSingle();
    if (profErr) throw profErr;
    let email = syntheticEmail(tg.id);
    let userId = prof?.id as string | undefined;

    if (userId) {
      const { data: u, error } = await admin.auth.admin.getUserById(userId);
      if (error || !u.user?.email) throw error ?? new Error('user without email');
      email = u.user.email;
    } else {
      // 2. Create the account (or reuse it if a previous attempt created the user but not the link).
      const created = await admin.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { display_name: displayName(tg), telegram_id: tg.id, telegram_username: tg.username ?? null },
        app_metadata: { provider: 'telegram', providers: ['telegram'] },
      });
      if (created.error) {
        const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
        userId = link?.user?.id;
        if (!userId) throw created.error;
      } else {
        userId = created.data.user.id;
      }
    }

    // 3. Keep profile in sync (service role bypasses the column lock that stops users editing telegram_id).
    const { error: upErr } = await admin.from('profiles')
      .upsert({ id: userId, telegram_id: tg.id, telegram_username: tg.username ?? null }, { onConflict: 'id' });
    if (upErr) throw upErr;
    await admin.from('profiles').update({ display_name: displayName(tg).slice(0, 120) }).eq('id', userId).eq('display_name', '');

    // 4. Issue a normal Supabase session: one-time magic-link token, redeemed server-side (no email is sent).
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkErr || !link?.properties?.hashed_token) throw linkErr ?? new Error('no token');
    const pub = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ses, error: otpErr } = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
    if (otpErr || !ses.session) throw otpErr ?? new Error('no session');

    const s = ses.session;
    return json(200, {
      access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at,
      token_type: 'bearer', user: s.user, telegram: { id: tg.id, username: tg.username ?? null, name: displayName(tg) },
    });
  } catch (e) {
    console.error('telegram-auth failed', e);
    return json(500, { error: 'server_error', message: 'Telegram orqali kirishda xatolik' });
  }
});
