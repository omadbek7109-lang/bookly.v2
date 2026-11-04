/** Small preferences live in localStorage (never book content). */
import type { Locale } from '../../i18n';

export type ThemePref = 'system' | 'light' | 'dark';
export type ExportFormat = 'pdf' | 'pptx' | 'epub' | 'docx';

export interface Settings {
  locale: Locale;
  theme: ThemePref;
  introSeen: boolean;
  reducedMotion: boolean;
  defaultExport: ExportFormat;
  pdfPageSize: 'A4' | 'A5' | 'Letter';
  exportIncludeCover: boolean;
  exportIncludeToc: boolean;
  reader: { fontSize: number; lineHeight: number; font: 'serif' | 'sans'; mode: 'light' | 'sepia' | 'dark' };
  profile: { name: string; avatarAssetId: string | null };
  /** Optional cloud backup: sync automatically while signed in. */
  cloudAutoSync: boolean;
  /** The "back up your local books?" question was answered for this account id. */
  cloudPromptedFor: string | null;
}

export const SETTINGS_KEY = 'bookly.settings';

export const DEFAULT_SETTINGS: Settings = {
  locale: 'uz',
  theme: 'system',
  introSeen: false,
  reducedMotion: false,
  defaultExport: 'pdf',
  pdfPageSize: 'A5',
  exportIncludeCover: true,
  exportIncludeToc: true,
  reader: { fontSize: 18, lineHeight: 1.7, font: 'serif', mode: 'light' },
  profile: { name: '', avatarAssetId: null },
  cloudAutoSync: true,
  cloudPromptedFor: null,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...raw, reader: { ...DEFAULT_SETTINGS.reader, ...(raw.reader || {}) }, profile: { ...DEFAULT_SETTINGS.profile, ...(raw.profile || {}) } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}
