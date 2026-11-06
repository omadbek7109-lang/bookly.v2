import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { CloudClient, friendlyError, localSessionStore, type CloudUser } from '../../services/cloud/client';
import { cloudConfigured, SUPABASE_KEY, SUPABASE_URL } from '../../services/cloud/config';
import { deviceIdentity, SyncEngine, type EngineSnapshot, type SyncReport, type SyncState } from '../../services/cloud/sync';
import { idbGet, idbPut } from '../../services/storage/db';
import { assets, books, repoEvents } from '../../services/storage/repository';
import { telegramInitData } from '../../services/platform/telegram';

interface CloudCtx {
  available: boolean;
  user: CloudUser | null;
  snapshot: EngineSnapshot;
  online: boolean;
  /** Set after a password-reset link was opened: the app asks for a new password. */
  recovery: boolean;
  clearRecovery: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  /** True inside the Telegram Mini App, where sign-in needs no password. */
  inTelegram: boolean;
  signInWithTelegram: () => Promise<void>;
  telegramBusy: boolean;
  signUp: (email: string, password: string, name: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  sync: (mode?: 'sync' | 'backup' | 'restore', ids?: string[]) => Promise<SyncReport | null>;
  engine: SyncEngine | null;
  /** Shows the one-time "back up your local books?" question after the first sign-in. */
  backupPrompt: boolean;
  answerBackupPrompt: (backupNow: boolean) => Promise<void>;
}

const Ctx = createContext<CloudCtx | null>(null);

const syncStore = {
  load: async () => (await idbGet<SyncState>('meta', 'cloud.sync').catch(() => undefined)) ?? null,
  save: (s: SyncState) => idbPut('meta', s, 'cloud.sync'),
};

/** Where Supabase email links (confirm sign-up, reset password) send the user back to. */
export const authRedirectUrl = () => (typeof location === 'undefined' ? undefined : `${location.origin}${location.pathname}`);

let singleton: { client: CloudClient; engine: SyncEngine } | null = null;
function services() {
  if (!cloudConfigured()) return null;
  if (!singleton) {
    const client = new CloudClient(SUPABASE_URL, SUPABASE_KEY, localSessionStore);
    const dev = deviceIdentity();
    const engine = new SyncEngine(client, books, { get: (id) => assets.get(id), put: (b, n, id) => assets.put(b, n, id) }, syncStore, dev.id, dev.name);
    singleton = { client, engine };
  }
  return singleton;
}

export function CloudProvider({ children }: { children: ReactNode }) {
  const svc = services();
  const { settings, update } = useSettings();
  const { toast } = useUi();
  const [user, setUser] = useState<CloudUser | null>(svc?.client.user ?? null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(svc?.engine.current ?? { phase: 'signed-out', entries: [], lastSyncAt: null, lastBackupAt: null, message: null, progress: null });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [recovery, setRecovery] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useCallback(async (mode: 'sync' | 'backup' | 'restore' = 'sync', ids?: string[]) => {
    if (!svc?.client.user) return null;
    try { return await svc.engine.sync(mode, ids); } catch { return null; }
  }, [svc]);

  // Session & engine state
  useEffect(() => {
    if (!svc) return;
    const offSession = svc.client.onSessionChange((s) => { setUser(s?.user ?? null); if (!s) svc.engine.reset(); });
    const offEngine = svc.engine.subscribe(setSnapshot);
    return () => { offSession(); offEngine(); };
  }, [svc]);

  // Inside Telegram: sign in automatically with the signed launch data (no password).
  const [telegramBusy, setTelegramBusy] = useState(false);
  const signInWithTelegram = useCallback(async () => {
    const initData = telegramInitData();
    if (!svc || !initData) return;
    setTelegramBusy(true);
    try { await svc.client.signInWithTelegram(initData); }
    finally { setTelegramBusy(false); }
  }, [svc]);
  useEffect(() => {
    if (!svc || svc.client.user || !telegramInitData()) return;
    signInWithTelegram().catch((e) => toast(friendlyError(e), 'error'));
  }, [svc, signInWithTelegram, toast]);

  // Links from Supabase emails land on #access_token=...&type=recovery|signup
  useEffect(() => {
    if (!svc || !/access_token=|error_description=/.test(location.hash)) return;
    const hash = location.hash;
    history.replaceState(history.state, '', `${location.pathname}${location.search}#/profile`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    svc.client.consumeAuthRedirect(hash).then((type) => {
      if (type === 'recovery') setRecovery(true);
      else if (type) toast('Email tasdiqlandi. Hisobingizga kirdingiz.', 'success');
    }).catch((e) => toast(friendlyError(e), 'error'));
  }, [svc, toast]);

  // Start-up sync, online/offline handling, auto-sync after local edits
  useEffect(() => {
    if (!svc) return;
    const onOnline = () => { setOnline(true); if (svc.client.user && settingsRef.current.cloudAutoSync) void sync(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const off = repoEvents.on(() => {
      if (!svc.client.user || !settingsRef.current.cloudAutoSync) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (svc.engine.current.phase !== 'syncing') void sync(); }, 5000);
    });
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); off(); if (timer.current) clearTimeout(timer.current); };
  }, [svc, sync]);

  useEffect(() => {
    if (!svc || !user) return;
    // Pick up the display name chosen at sign-up when this device has none yet.
    const name = user.user_metadata?.display_name;
    if (name && !settingsRef.current.profile.name) update({ profile: { ...settingsRef.current.profile, name } });
    const t = setTimeout(() => {
      if (settingsRef.current.cloudAutoSync && settingsRef.current.cloudPromptedFor === user.id) void sync();
      else void svc.engine.refreshStatus().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [svc, user, sync, update]);

  const backupPrompt = !!user && settings.cloudPromptedFor !== user.id;

  const answerBackupPrompt = useCallback(async (backupNow: boolean) => {
    if (!user) return;
    update({ cloudPromptedFor: user.id, cloudAutoSync: backupNow ? settingsRef.current.cloudAutoSync : false });
    if (backupNow) {
      const r = await sync('sync');
      if (r) toast(`Cloud: ${r.uploaded} ta kitob yuklandi, ${r.downloaded} ta tiklandi`, 'success');
    }
  }, [user, update, sync, toast]);

  const value = useMemo<CloudCtx>(() => ({
    available: !!svc,
    user, snapshot, online, recovery,
    clearRecovery: () => setRecovery(false),
    signIn: async (email, password) => { await svc!.client.signIn(email.trim(), password); },
    inTelegram: !!telegramInitData(),
    signInWithTelegram,
    telegramBusy,
    signUp: (email, password, name) => svc!.client.signUp(email.trim(), password, name.trim(), authRedirectUrl()),
    signOut: async () => { await svc!.client.signOut(); svc!.engine.reset(); },
    resetPassword: (email) => svc!.client.requestPasswordReset(email.trim(), authRedirectUrl()),
    updatePassword: (password) => svc!.client.updatePassword(password),
    sync,
    engine: svc?.engine ?? null,
    backupPrompt,
    answerBackupPrompt,
  }), [svc, user, snapshot, online, recovery, sync, backupPrompt, answerBackupPrompt, signInWithTelegram, telegramBusy]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCloud() {
  const c = useContext(Ctx);
  if (!c) throw new Error('CloudProvider missing');
  return c;
}
