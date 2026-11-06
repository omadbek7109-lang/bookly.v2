/**
 * Sends an exported file to the user's own Telegram chat through the Bookly bot
 * (Edge Function `telegram-bot?action=send`). The server verifies the signed initData, so a file can
 * only be delivered to the Telegram account that opened the Mini App. No bot token in the browser.
 */
import { CloudError } from '../cloud/client';
import { SUPABASE_KEY, SUPABASE_URL } from '../cloud/config';
import { requestBotWriteAccess, telegramInitData } from './telegram';

type Fetch = typeof fetch;

async function postOnce(bytes: Uint8Array, filename: string, mime: string, caption: string, initData: string, fetchImpl: Fetch) {
  const fd = new FormData();
  fd.set('initData', initData);
  fd.set('filename', filename);
  fd.set('caption', caption);
  fd.set('file', new Blob([bytes as BlobPart], { type: mime }), filename);
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_URL}/functions/v1/telegram-bot?action=send`, { method: 'POST', headers: { apikey: SUPABASE_KEY }, body: fd });
  } catch { throw new CloudError('network', 'network'); }
  const body = await res.json().catch(() => ({})) as { error?: string; detail?: string; message?: string };
  if (!res.ok) throw new CloudError(body.message || body.error || `HTTP ${res.status}`, body.error || `http_${res.status}`, res.status, body.detail ?? '');
}

export async function sendFileToTelegram(bytes: Uint8Array, filename: string, mime: string, caption: string, fetchImpl: Fetch = (...a) => fetch(...a)): Promise<void> {
  const initData = telegramInitData();
  if (!initData) throw new CloudError('Bu funksiya faqat Telegram ichida ishlaydi.', 'not_in_telegram');
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new CloudError('not configured', 'not_configured');
  try {
    await postOnce(bytes, filename, mime, caption, initData, fetchImpl);
  } catch (e) {
    // The bot may not message a user who never pressed /start: ask Telegram for permission once, then retry.
    if (e instanceof CloudError && e.code === 'need_start' && await requestBotWriteAccess()) {
      await postOnce(bytes, filename, mime, caption, initData, fetchImpl);
      return;
    }
    throw e;
  }
}
