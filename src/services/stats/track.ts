/**
 * Light usage events for the admin statistics (no book content): app opened, book created, export (format),
 * file sent to Telegram. Only for signed-in users; never blocks the UI and never throws.
 */
import { cloudClient } from '../../features/cloud/CloudContext';

export type TrackKind = 'open' | 'book_created' | 'export' | 'telegram_send';

export function track(kind: TrackKind, detail?: string): void {
  try { cloudClient()?.logEvent(kind, detail); } catch { /* statistics must never break the app */ }
}

/** "open" once per app session, after the user is known. */
export function trackOpenOnce(): void {
  try {
    if (sessionStorage.getItem('bookly.opened')) return;
    sessionStorage.setItem('bookly.opened', '1');
  } catch { /* private mode: still fine to send once per load */ }
  track('open');
}
