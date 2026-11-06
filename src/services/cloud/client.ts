/**
 * Minimal, dependency-free Supabase client (Auth + PostgREST + RPC + Storage) for Bookly.
 * Only the publishable key is used; all data access is authorised by the user's JWT and RLS.
 * The transport (`fetch`) and session storage are injectable so the client is unit-testable.
 */
import { ASSET_BUCKET } from './config';

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  user: CloudUser;
}

export interface CloudUser {
  id: string;
  email: string;
  email_confirmed_at?: string | null;
  user_metadata?: { display_name?: string };
}

export interface SessionStore {
  load(): Session | null;
  save(s: Session | null): void;
}

export class CloudError extends Error {
  constructor(message: string, readonly code: string, readonly status = 0) {
    super(message);
    this.name = 'CloudError';
  }
  /** True when the device is offline or the server could not be reached. */
  get offline() { return this.code === 'network'; }
}

const UZ_ERRORS: Record<string, string> = {
  invalid_credentials: 'Email yoki parol noto‘g‘ri.',
  email_not_confirmed: 'Email tasdiqlanmagan. Pochtangizdagi havolani oching.',
  user_already_exists: 'Bu email bilan hisob allaqachon mavjud. Kirishni tanlang.',
  email_exists: 'Bu email bilan hisob allaqachon mavjud. Kirishni tanlang.',
  weak_password: 'Parol juda oddiy: kamida 8 ta belgi, harf va raqam ishlating.',
  over_email_send_rate_limit: 'Juda ko‘p email so‘raldi. Bir necha daqiqadan keyin qayta urinib ko‘ring.',
  over_request_rate_limit: 'Juda ko‘p urinish. Biroz kutib, qayta urinib ko‘ring.',
  email_address_invalid: 'Email manzili noto‘g‘ri.',
  validation_failed: 'Ma’lumotlar noto‘g‘ri kiritildi.',
  same_password: 'Yangi parol eskisidan farq qilishi kerak.',
  session_expired: 'Sessiya tugadi. Qaytadan kiring.',
  refresh_token_not_found: 'Sessiya tugadi. Qaytadan kiring.',
  network: 'Internet yo‘q yoki server javob bermadi. Lokal ish davom etadi.',
  signup_disabled: 'Ro‘yxatdan o‘tish hozircha yopiq.',
  invalid_init_data: 'Telegram ma’lumotlari tasdiqlanmadi. Bookly’ni bot ichidan qayta oching.',
  not_configured: 'Telegram orqali kirish serverda hali sozlanmagan.',
  server_error: 'Serverda xatolik. Birozdan keyin qayta urinib ko‘ring.',
};

export function friendlyError(e: unknown): string {
  if (e instanceof CloudError) return UZ_ERRORS[e.code] ?? e.message;
  return (e as Error)?.message || String(e);
}

type Fetch = typeof fetch;

export class CloudClient {
  private session: Session | null;
  private refreshing: Promise<Session | null> | null = null;
  private listeners = new Set<(s: Session | null) => void>();

  constructor(
    readonly url: string,
    readonly key: string,
    private readonly store: SessionStore,
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.session = store.load();
  }

  // ---------------------------------------------------------------- session
  get currentSession() { return this.session; }
  get user() { return this.session?.user ?? null; }

  onSessionChange(fn: (s: Session | null) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private setSession(s: Session | null) {
    this.session = s;
    this.store.save(s);
    this.listeners.forEach((f) => { try { f(s); } catch (e) { console.error(e); } });
  }

  private toSession(raw: Record<string, unknown>): Session {
    const expiresIn = Number(raw.expires_in ?? 3600);
    return {
      access_token: String(raw.access_token),
      refresh_token: String(raw.refresh_token),
      expires_at: Number(raw.expires_at ?? Math.floor(this.now() / 1000) + expiresIn),
      user: raw.user as CloudUser,
    };
  }

  // ---------------------------------------------------------------- low-level request
  private async raw(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.key);
    if (init.auth !== false) {
      const s = await this.validSession();
      if (s) headers.set('Authorization', `Bearer ${s.access_token}`);
    }
    try {
      return await this.fetchImpl(this.url + path, { ...init, headers });
    } catch (e) {
      throw new CloudError((e as Error)?.message || 'network', 'network');
    }
  }

  private async json<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!res.ok) {
      const code = String(body.error_code ?? body.code ?? body.error ?? (res.status === 401 ? 'session_expired' : `http_${res.status}`));
      const msg = String(body.msg ?? body.message ?? body.error_description ?? body.error ?? res.statusText);
      throw new CloudError(msg, code === 'invalid_grant' && /invalid login/i.test(msg) ? 'invalid_credentials' : code, res.status);
    }
    return body as T;
  }

  /** Returns a non-expired session, refreshing it when needed. */
  async validSession(): Promise<Session | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expires_at * 1000 - this.now() > 60_000) return s;
    return this.refresh();
  }

  refresh(): Promise<Session | null> {
    if (this.refreshing) return this.refreshing;
    const s = this.session;
    if (!s) return Promise.resolve(null);
    this.refreshing = (async () => {
      try {
        const res = await this.raw('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }),
        });
        const next = this.toSession(await this.json(res));
        this.setSession(next);
        return next;
      } catch (e) {
        // Offline: keep the old session and try again later. Rejected token: sign out locally.
        if (!(e instanceof CloudError && e.offline)) this.setSession(null);
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // ---------------------------------------------------------------- auth
  async signUp(email: string, password: string, displayName: string, redirectTo?: string): Promise<{ needsConfirmation: boolean }> {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    const res = await this.raw(`/auth/v1/signup${q}`, {
      method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, data: { display_name: displayName } }),
    });
    const body = await this.json<Record<string, unknown>>(res);
    if (body.access_token) { this.setSession(this.toSession(body)); return { needsConfirmation: false }; }
    return { needsConfirmation: true };
  }

  async signIn(email: string, password: string): Promise<Session> {
    const res = await this.raw('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    const s = this.toSession(await this.json(res));
    this.setSession(s);
    return s;
  }

  /** Exchanges Telegram Mini App initData for a Supabase session (Edge Function `telegram-auth`). */
  async signInWithTelegram(initData: string): Promise<Session> {
    const res = await this.raw('/functions/v1/telegram-auth', {
      method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }),
    });
    const body = await this.json<Record<string, unknown>>(res);
    const s = this.toSession(body);
    this.setSession(s);
    return s;
  }

  async signOut(): Promise<void> {
    const s = this.session;
    this.setSession(null);
    if (!s) return;
    try {
      await this.fetchImpl(`${this.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${s.access_token}` } });
    } catch { /* offline logout still clears the local session */ }
  }

  async requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    await this.json(await this.raw(`/auth/v1/recover${q}`, {
      method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    }));
  }

  async updatePassword(password: string): Promise<void> {
    const body = await this.json<CloudUser>(await this.raw('/auth/v1/user', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    }));
    if (this.session) this.setSession({ ...this.session, user: body });
  }

  /** Accepts the tokens Supabase appends to email links (#access_token=...&type=recovery|signup). */
  async consumeAuthRedirect(hash: string): Promise<'recovery' | 'signup' | 'magiclink' | null> {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const access = p.get('access_token');
    if (!access) {
      const err = p.get('error_description');
      if (err) throw new CloudError(err, p.get('error_code') || 'auth_link');
      return null;
    }
    const s: Session = {
      access_token: access, refresh_token: p.get('refresh_token') || '',
      expires_at: Number(p.get('expires_at')) || Math.floor(this.now() / 1000) + Number(p.get('expires_in') || 3600),
      user: { id: '', email: '' },
    };
    this.session = s;
    const user = await this.json<CloudUser>(await this.raw('/auth/v1/user'));
    this.setSession({ ...s, user });
    return (p.get('type') as 'recovery' | 'signup' | 'magiclink') ?? 'magiclink';
  }

  // ---------------------------------------------------------------- data (PostgREST)
  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return this.json<T>(await this.authed(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }));
  }

  async select<T>(table: string, query: string): Promise<T[]> {
    return this.json<T[]>(await this.authed(`/rest/v1/${table}?${query}`, { method: 'GET' }));
  }

  async upsert<T>(table: string, rows: object | object[], onConflict: string): Promise<T[]> {
    return this.json<T[]>(await this.authed(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows),
    }));
  }

  async update<T>(table: string, query: string, patch: object): Promise<T[]> {
    return this.json<T[]>(await this.authed(`/rest/v1/${table}?${query}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(patch),
    }));
  }

  async remove(table: string, query: string): Promise<void> {
    await this.json(await this.authed(`/rest/v1/${table}?${query}`, { method: 'DELETE' }));
  }

  // ---------------------------------------------------------------- storage
  async uploadObject(path: string, blob: Blob): Promise<'created' | 'exists'> {
    const res = await this.authed(`/storage/v1/object/${ASSET_BUCKET}/${path}`, {
      method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': '31536000' }, body: blob,
    });
    if (res.status === 409) return 'exists';
    if (!res.ok) {
      const text = await res.text();
      if (/already exists|Duplicate/i.test(text)) return 'exists';
      let msg = text;
      try { const j = JSON.parse(text); msg = j.message || j.error || text; } catch { /* plain text */ }
      throw new CloudError(msg, res.status === 413 ? 'too_large' : `storage_${res.status}`, res.status);
    }
    return 'created';
  }

  async downloadObject(path: string): Promise<Blob> {
    const res = await this.authed(`/storage/v1/object/authenticated/${ASSET_BUCKET}/${path}`, { method: 'GET' });
    if (!res.ok) throw new CloudError(`download ${res.status}`, `storage_${res.status}`, res.status);
    return res.blob();
  }

  async removeObjects(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await this.json(await this.authed(`/storage/v1/object/${ASSET_BUCKET}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
    }));
  }

  /** Authenticated request; refreshes and retries once on 401. */
  private async authed(path: string, init: RequestInit): Promise<Response> {
    if (!this.session) throw new CloudError('not signed in', 'session_expired', 401);
    let res = await this.raw(path, init);
    if (res.status === 401 && this.session) {
      await this.refresh();
      res = await this.raw(path, init);
    }
    return res;
  }
}

export const localSessionStore: SessionStore = {
  load() {
    try { const s = JSON.parse(localStorage.getItem('bookly.auth') || 'null'); return s && s.access_token ? s : null; } catch { return null; }
  },
  save(s) {
    try { if (s) localStorage.setItem('bookly.auth', JSON.stringify(s)); else localStorage.removeItem('bookly.auth'); } catch { /* private mode */ }
  },
};
