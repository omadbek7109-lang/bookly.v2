// Calls the deployed telegram-auth Edge Function with a forged signature.
// Expected: 401 invalid_init_data / bad_signature — proves the function is live, CORS works and the
// TELEGRAM_BOT_TOKEN secret is configured (without it the function answers 500 not_configured).
const URL_ = process.env.SUPABASE_URL || 'https://lphczkjwrokfzpnlhkei.supabase.co';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_h7GZN0DOMiNYA47Ik0RMuA_DIwaHkbQ';
const fn = `${URL_}/functions/v1/telegram-auth`;
let failed = 0;
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`); };

const pre = await fetch(fn, { method: 'OPTIONS', headers: { Origin: 'https://omadbek7109-lang.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey,content-type' } });
report(pre.ok && pre.headers.get('access-control-allow-origin') === '*', 'CORS preflight', `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);

const forged = new URLSearchParams({ user: JSON.stringify({ id: 1, first_name: 'Fake' }), auth_date: String(Math.floor(Date.now() / 1000)), hash: '0'.repeat(64) }).toString();
const r = await fetch(fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: forged }) });
const body = await r.text();
report(r.status === 401 && /bad_signature/.test(body), 'forged initData rejected (bot token secret is set)', `${r.status} ${body}`);
if (r.status === 500 && /not_configured/.test(body)) console.log('       → TELEGRAM_BOT_TOKEN secret is missing in Supabase → Edge Functions → Secrets');

const empty = await fetch(fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const eb = await empty.text();
report(empty.status === 401, 'empty initData rejected', `${empty.status} ${eb}`);

// ---- telegram-bot: register webhook + menu button (idempotent), then check its guards.
const bot = `${URL_}/functions/v1/telegram-bot`;
const setupRes = await fetch(`${bot}?action=setup`, { headers: { apikey: KEY } });
const setupBody = await setupRes.text();
report(setupRes.ok && /"webhook":"ok"/.test(setupBody) && /"menu_button":"ok"/.test(setupBody), 'bot webhook + menu button registered', `${setupRes.status} ${setupBody}`);
const hook = await fetch(bot, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { chat: { id: 1, type: 'private' }, text: '/start' } }) });
report(hook.status === 401, 'webhook without Telegram secret rejected', `${hook.status} ${await hook.text()}`);
const fd = new FormData();
fd.set('initData', forged);
fd.set('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'x.pdf');
const send = await fetch(`${bot}?action=send`, { method: 'POST', headers: { apikey: KEY }, body: fd });
report(send.status === 401, 'send-file with forged initData rejected', `${send.status} ${await send.text()}`);

// ---- ai-assist: status is public, generation requires a signed-in user.
const ai = `${URL_}/functions/v1/ai-assist`;
const st = await fetch(`${ai}?action=status`, { headers: { apikey: KEY } });
const stBody = await st.json().catch(() => ({}));
report(st.ok && typeof stBody.configured === 'boolean', `ai-assist status (configured: ${stBody.configured})`, `${st.status} ${JSON.stringify(stBody)}`);
const anonAi = await fetch(ai, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'ideas', text: '' }) });
report(anonAi.status === (stBody.configured ? 401 : 503), 'ai-assist refuses requests without a session', `${anonAi.status} ${await anonAi.text()}`);
process.exit(failed ? 1 : 0);
