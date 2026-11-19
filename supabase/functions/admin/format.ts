/**
 * Message formatting for admin broadcasts. Admins type plain text with two light marks:
 *   **bold**   and   __italic__   — everything else is escaped, so a broadcast can never break Telegram's HTML.
 * Pure functions: run in Deno (Edge Function) and Node (unit tests).
 */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toTelegramHtml(text: string): string {
  return escapeHtml(text.trim())
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n][^_]*?)__/g, '<i>$1</i>');
}

/** Only http(s) and t.me links are allowed on buttons. */
export function safeButtonUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

/** Parses "123, 456 789" (Edge Function secret BOOKLY_ADMIN_IDS) into a set of Telegram ids. */
export function parseAdminIds(raw: string | undefined | null): Set<number> {
  return new Set(String(raw ?? '').split(/[\s,;]+/).map((x) => Number(x)).filter((n) => Number.isSafeInteger(n) && n > 0));
}

/** Telegram allows ~30 messages/second to different chats; stay comfortably under it. */
export const SEND_INTERVAL_MS = 45;
