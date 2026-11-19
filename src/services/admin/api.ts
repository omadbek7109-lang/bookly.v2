/**
 * Client for the `admin` Edge Function (admin panel + user feedback). Every call carries the user's own
 * session; the server decides who is an admin (Telegram ids in its secrets) — nothing here grants rights.
 */
import { useEffect, useState } from 'react';
import { cloudClient, useCloud } from '../../features/cloud/CloudContext';
import { CloudError } from '../cloud/client';

export interface AdminStats {
  users: number; users_telegram: number; users_new_7d: number; active_7d: number;
  books: number; chapters: number; books_new_7d: number; storage_bytes: number;
  subscribers: number; subscribers_active: number; exports_7d: number; exports_by_format: Record<string, number>;
  feedback_new: number;
  daily: { day: string; users: number; books: number; active: number; subscribers: number }[];
}
export interface AdminUser {
  id: string; email: string | null; display_name: string; telegram_id: number | null; telegram_username: string | null;
  created_at: string; last_sign_in_at: string | null; books: number; last_book_at: string | null; subscribed: boolean; blocked: boolean;
}
export interface Broadcast {
  id: string; text: string; photo_file_id: string | null; button_text: string | null; button_url: string | null; open_app_button: boolean;
  status: 'sending' | 'paused' | 'done' | 'cancelled' | 'failed'; total: number; sent: number; failed: number; blocked: number;
  created_at: string; finished_at: string | null;
}
export interface AdminBook {
  id: string; user_id: string; owner_name: string | null; owner_telegram: string | null; title: string; author: string | null;
  category: string | null; language: string | null; status: string | null; chapter_count: number; word_count: number; deleted: boolean;
  created_at: string; updated_at: string;
}
export interface Announcement { id: string; text: string; link_url: string | null; tone: 'info' | 'success' | 'warning'; active: boolean; created_at: string; expires_at: string | null }
export interface FeedbackItem { id: string; user_id: string | null; telegram_id: number | null; name: string; message: string; status: 'new' | 'read' | 'answered'; created_at: string }
export interface AuditItem { id: number; admin_telegram_id: number; action: string; details: Record<string, unknown>; created_at: string }
export interface OutgoingMessage { text: string; photo?: string | null; button_text?: string; button_url?: string; open_app?: boolean }

/** Error codes the UI explains: needs_login, not_admin, admin_not_ready, bot_not_configured, user_blocked_bot, … */
export class AdminError extends Error {
  constructor(readonly code: string, readonly status: number, readonly detail = '') { super(code); }
}

export async function adminCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const c = cloudClient();
  if (!c || !c.user) throw new AdminError('needs_login', 401);
  let r: { status: number; body: T & { error?: string; detail?: string } };
  try { r = await c.invoke<T & { error?: string; detail?: string }>('admin', { action, ...payload }); }
  catch (e) { throw new AdminError(e instanceof CloudError ? e.code : 'network', 0); }
  // 404 = function not deployed yet
  if (r.status === 404) throw new AdminError('admin_not_ready', 404);
  if (r.status < 200 || r.status >= 300) throw new AdminError(r.body?.error || 'server_error', r.status, r.body?.detail || '');
  return r.body;
}

export const adminApi = {
  whoami: () => adminCall<{ admin: boolean; name: string; configured: boolean }>('whoami'),
  stats: (days = 14) => adminCall<AdminStats>('stats', { days }),
  users: (search = '', offset = 0) => adminCall<{ users: AdminUser[] }>('users', { search, offset }).then((r) => r.users ?? []),
  books: (search = '', userId?: string) => adminCall<{ books: AdminBook[] }>('books', { search, user_id: userId ?? null }).then((r) => r.books ?? []),
  test: (m: OutgoingMessage) => adminCall<{ ok: true }>('broadcast_test', { ...m }),
  broadcast: (m: OutgoingMessage) => adminCall<{ broadcast: Broadcast }>('broadcast', { ...m }).then((r) => r.broadcast),
  broadcastStatus: (id: string) => adminCall<{ broadcast: Broadcast | null }>('broadcast_status', { id }).then((r) => r.broadcast),
  resume: (id: string) => adminCall<{ ok: true }>('broadcast_resume', { id }),
  cancel: (id: string) => adminCall<{ ok: true }>('broadcast_cancel', { id }),
  broadcasts: () => adminCall<{ broadcasts: Broadcast[] }>('broadcasts').then((r) => r.broadcasts ?? []),
  messageUser: (telegramId: number, m: OutgoingMessage) => adminCall<{ ok: true }>('message_user', { telegram_id: telegramId, ...m }),
  announce: (a: { text: string; link_url?: string; tone?: Announcement['tone']; days?: number }) => adminCall<{ announcement: Announcement }>('announce', a).then((r) => r.announcement),
  announcements: () => adminCall<{ announcements: Announcement[] }>('announcements').then((r) => r.announcements ?? []),
  announceOff: (id: string) => adminCall<{ ok: true }>('announce_off', { id }),
  feedbackList: () => adminCall<{ feedback: FeedbackItem[] }>('feedback_list').then((r) => r.feedback ?? []),
  feedbackRead: (id: string) => adminCall<{ ok: true }>('feedback_read', { id }),
  feedbackReply: (id: string, text: string) => adminCall<{ ok: true }>('feedback_reply', { id, text }),
  audit: () => adminCall<{ audit: AuditItem[] }>('audit').then((r) => r.audit ?? []),
};

/** Sends user feedback to the Bookly team (any signed-in user). */
export const sendFeedback = (message: string, version: string) => adminCall<{ ok: true }>('feedback', { message, version });

const CACHE = 'bookly.admin';
/** Is the signed-in user an admin? Asked once per sign-in and cached for the session. */
export function useIsAdmin(): boolean {
  const cloud = useCloud();
  const uid = cloud.user?.id ?? null;
  const [admin, setAdmin] = useState<boolean>(() => {
    try { const c = JSON.parse(sessionStorage.getItem(CACHE) || 'null'); return !!(c && c.uid === uid && c.admin); } catch { return false; }
  });
  useEffect(() => {
    if (!uid) { setAdmin(false); return; }
    let alive = true;
    try { const c = JSON.parse(sessionStorage.getItem(CACHE) || 'null'); if (c && c.uid === uid) { setAdmin(!!c.admin); return; } } catch { /* ignore */ }
    adminApi.whoami().then((r) => {
      if (!alive) return;
      setAdmin(r.admin);
      try { sessionStorage.setItem(CACHE, JSON.stringify({ uid, admin: r.admin })); } catch { /* ignore */ }
    }).catch(() => { /* server not ready / offline: no admin entry */ });
    return () => { alive = false; };
  }, [uid]);
  return admin;
}

/** Shrinks a picked photo to ≤1600 px JPEG so broadcasts stay well under Telegram's limits. */
export async function photoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

/** Same light markup as the server: escape, then **bold** / __italic__ — used for the live preview. */
export function previewHtml(text: string): string {
  return text.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, '<b>$1</b>').replace(/__([^_\n][^_]*?)__/g, '<i>$1</i>').replace(/\n/g, '<br>');
}
