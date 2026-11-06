import uz, { type MessageKey } from './uz';
import en from './en';
import ru from './ru';

export type Locale = 'uz' | 'ru' | 'en';
export type { MessageKey };

const DICTS: Record<Locale, Record<MessageKey, string>> = { uz, en, ru };
export const LOCALES: Locale[] = ['uz', 'ru', 'en'];

export type Vars = Record<string, string | number>;

/** Plural form index: Russian has 3 forms (1 / 2-4 / 5+), English 2, Uzbek 1. */
function pluralIndex(locale: Locale, n: number): number {
  const a = Math.abs(n);
  if (locale === 'ru') {
    const m10 = a % 10, m100 = a % 100;
    if (m10 === 1 && m100 !== 11) return 0;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
    return 2;
  }
  if (locale === 'en') return a === 1 ? 0 : 1;
  return 0;
}

/**
 * Placeholders: `{name}` inserts a value; `{n|глава|главы|глав}` picks the plural form for the number n.
 */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  let s = DICTS[locale]?.[key] ?? uz[key];
  if (s === undefined) return key;
  if (vars) {
    s = s.replace(/\{(\w+)\|([^}]+)\}/g, (m, k: string, forms: string) => {
      if (!(k in vars)) return m;
      const list = forms.split('|');
      return list[Math.min(pluralIndex(locale, Number(vars[k])), list.length - 1)];
    });
    s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  }
  return s;
}

// The current UI language for code outside React (services, error messages). Set by SettingsProvider.
let current: Locale = 'uz';
export function setCurrentLocale(l: Locale) { current = l; }
export function currentLocale(): Locale { return current; }
/** Translate in the current UI language (for non-React modules). */
export function tr(key: MessageKey, vars?: Vars): string { return translate(current, key, vars); }

export function hasKey(key: string): key is MessageKey {
  return key in uz;
}

export { uz };
