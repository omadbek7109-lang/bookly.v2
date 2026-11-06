import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setCurrentLocale, translate, type MessageKey, type Vars } from '../i18n';
import type { Book } from '../models/book';
import { books as bookRepo, repoEvents } from '../services/storage/repository';
import { loadSettings, saveSettings, type Settings } from '../services/storage/settings';
import { haptic, syncTelegramColors } from '../services/platform/telegram';

// ------------------------------------------------------------------ settings & i18n

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  resolvedTheme: 'light' | 'dark';
}

const SettingsContext = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);

  const resolvedTheme: 'light' | 'dark' = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang = settings.locale;
    document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
    const bg = resolvedTheme === 'dark' ? '#0d0e2b' : '#f7f5fb';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
    syncTelegramColors(bg);
  }, [resolvedTheme, settings.locale, settings.reducedMotion]);

  const update = useCallback((patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => {
    setSettings((s) => {
      const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) };
      saveSettings(next);
      return next;
    });
  }, []);

  setCurrentLocale(settings.locale); // services translate their messages in the chosen language too
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(settings.locale, key, vars), [settings.locale]);
  const value = useMemo(() => ({ settings, update, t, resolvedTheme }), [settings, update, t, resolvedTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsContext);
  if (!c) throw new Error('SettingsProvider missing');
  return c;
}

export const useT = () => useSettings().t;

// ------------------------------------------------------------------ library store

interface LibraryCtx {
  books: Book[];
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const LibraryContext = createContext<LibraryCtx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setBooks(await bookRepo.list());
      setError(null);
    } catch (e) {
      console.error(e);
      setError(String((e as Error).message || e));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return repoEvents.on((e) => {
      if (e.type === 'saved') setBooks((list) => { const i = list.findIndex((b) => b.id === e.book.id); if (i < 0) return [...list, e.book]; const copy = [...list]; copy[i] = e.book; return copy; });
      else if (e.type === 'removed') setBooks((list) => list.filter((b) => b.id !== e.id));
      else void reload();
    });
  }, [reload]);

  const value = useMemo(() => ({ books, ready, error, reload }), [books, ready, error, reload]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const c = useContext(LibraryContext);
  if (!c) throw new Error('LibraryProvider missing');
  return c;
}

// ------------------------------------------------------------------ toasts & dialogs

export interface Toast { id: number; text: string; kind: 'info' | 'success' | 'error'; action?: { label: string; run: () => void } }

interface DialogState {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  value?: string;
  placeholder?: string;
  resolve: (v: string | boolean | null) => void;
}

interface UiCtx {
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  confirm: (o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (o: { title: string; value?: string; placeholder?: string; confirmLabel?: string }) => Promise<string | null>;
  toasts: Toast[];
  dismiss: (id: number) => void;
  dialog: DialogState | null;
  closeDialog: (v: string | boolean | null) => void;
}

const UiContext = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind, action }]);
    if (kind !== 'info') haptic(kind === 'error' ? 'error' : 'success');
    setTimeout(() => dismiss(id), action ? 5000 : 2600);
  }, [dismiss]);

  const confirm = useCallback((o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', ...o, resolve: (v) => resolve(!!v) })), []);
  const prompt = useCallback((o: { title: string; value?: string; placeholder?: string; confirmLabel?: string }) =>
    new Promise<string | null>((resolve) => setDialog({ kind: 'prompt', ...o, resolve: (v) => resolve(typeof v === 'string' ? v : null) })), []);
  const closeDialog = useCallback((v: string | boolean | null) => {
    setDialog((d) => { d?.resolve(v); return null; });
  }, []);

  const value = useMemo(() => ({ toast, confirm, prompt, toasts, dismiss, dialog, closeDialog }), [toast, confirm, prompt, toasts, dismiss, dialog, closeDialog]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const c = useContext(UiContext);
  if (!c) throw new Error('UiProvider missing');
  return c;
}
