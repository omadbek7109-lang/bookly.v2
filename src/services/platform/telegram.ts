/**
 * Telegram Mini App integration (progressive). When the app is opened inside Telegram and the
 * official `telegram-web-app.js` script is present, we expand the view, sync colors and use haptics.
 * Phase 2: `initData` from here is sent to a Supabase Edge Function that verifies the HMAC
 * signature with the bot token (server-side only) and issues a Supabase session.
 */
interface TgWebApp {
  ready(): void;
  expand(): void;
  initData: string;
  colorScheme?: 'light' | 'dark';
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(t: 'error' | 'success' | 'warning'): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } };
}

export function telegram(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  const tg = w.Telegram?.WebApp;
  return tg && typeof tg.ready === 'function' && tg.initData ? tg : null;
}

export function initTelegram(): void {
  const tg = telegram();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    document.documentElement.classList.add('in-telegram');
  } catch (e) { console.warn('[bookly] telegram init', e); }
}

export function syncTelegramColors(bg: string): void {
  const tg = telegram();
  try { tg?.setHeaderColor?.(bg); tg?.setBackgroundColor?.(bg); } catch { /* older clients */ }
}

export function haptic(kind: 'light' | 'success' | 'error' = 'light'): void {
  const h = telegram()?.HapticFeedback;
  try {
    if (!h) { if (kind !== 'light') navigator.vibrate?.(kind === 'error' ? [30, 40, 30] : 18); return; }
    if (kind === 'light') h.impactOccurred('light'); else h.notificationOccurred(kind);
  } catch { /* ignore */ }
}

export function telegramUserName(): string | null {
  const u = telegram()?.initDataUnsafe?.user;
  return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || null : null;
}
