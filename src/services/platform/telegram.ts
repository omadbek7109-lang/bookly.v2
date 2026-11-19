/**
 * Telegram Mini App integration (progressive). When the app is opened inside Telegram and the
 * official `telegram-web-app.js` script is present, we expand the view, sync colors and use haptics.
 * Phase 2: `initData` from here is sent to a Supabase Edge Function that verifies the HMAC
 * signature with the bot token (server-side only) and issues a Supabase session.
 */
interface Insets { top: number; bottom: number; left: number; right: number }
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
  requestWriteAccess?(cb?: (granted: boolean) => void): void;
  isVersionAtLeast?(v: string): boolean;
  platform?: string;
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  onEvent?(event: string, cb: () => void): void;
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } };
}

export function telegram(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  const tg = w.Telegram?.WebApp;
  return tg && typeof tg.ready === 'function' && tg.initData ? tg : null;
}

export function initTelegram(): void {
  // Telegram's script has already read and cached the launch parameters, so the hash can be
  // handed back to the app router (otherwise "#tgWebAppData=..." would look like an unknown page).
  if (/tgWebApp(Data|Version|Platform)=/.test(location.hash)) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}#/`);
  }
  const tg = telegram();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    document.documentElement.classList.add('in-telegram');
    watchSafeArea(tg);
    if (wantsFullscreen()) setTelegramFullscreen(true);
  } catch (e) { console.warn('[bookly] telegram init', e); }
}

// ------------------------------------------------------------------ full screen
/** Real full screen exists on phones with Telegram 8.0+ (Bot API 8.0). */
export function canFullscreen(): boolean {
  const tg = telegram();
  return !!tg?.requestFullscreen && (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0')) && /^(android|ios)$/.test(tg.platform ?? '');
}

function wantsFullscreen(): boolean {
  try { return JSON.parse(localStorage.getItem('bookly.settings') || '{}').fullscreen !== false; } catch { return true; }
}

export function setTelegramFullscreen(on: boolean): void {
  const tg = telegram();
  if (!tg || !canFullscreen()) return;
  try { if (on && !tg.isFullscreen) tg.requestFullscreen!(); else if (!on && tg.isFullscreen) tg.exitFullscreen?.(); } catch { /* older clients */ }
}

/**
 * In full screen the app draws under the status bar and under Telegram's own Close/⋯ buttons.
 * --safe-t / --safe-b (used by every header, bar and the tab bar) then include those areas,
 * so nothing ends up hidden behind them.
 */
function watchSafeArea(tg: TgWebApp): void {
  const root = document.documentElement;
  const apply = () => {
    const full = !!tg.isFullscreen;
    root.classList.toggle('tg-fullscreen', full);
    const sa = tg.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const ca = tg.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    if (full) {
      root.style.setProperty('--safe-t', `${Math.round(sa.top + ca.top)}px`);
      root.style.setProperty('--safe-b', `max(env(safe-area-inset-bottom, 0px), ${Math.round(sa.bottom + ca.bottom)}px)`);
    } else {
      root.style.removeProperty('--safe-t');
      root.style.removeProperty('--safe-b');
    }
  };
  apply();
  for (const ev of ['fullscreenChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged']) {
    try { tg.onEvent?.(ev, apply); } catch { /* older clients */ }
  }
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

/** Signed launch data from Telegram (verified server-side by the telegram-auth Edge Function). */
export function telegramInitData(): string | null {
  return telegram()?.initData || null;
}

/** Asks Telegram to let the bot message this user (needed before the first file can be sent). */
export function requestBotWriteAccess(): Promise<boolean> {
  const tg = telegram();
  if (!tg?.requestWriteAccess || (tg.isVersionAtLeast && !tg.isVersionAtLeast('6.9'))) return Promise.resolve(false);
  return new Promise((resolve) => {
    try { tg.requestWriteAccess!((ok) => resolve(!!ok)); } catch { resolve(false); }
  });
}
