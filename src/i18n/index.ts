import uz, { type MessageKey } from './uz';
import en from './en';
import ru from './ru';

export type Locale = 'uz' | 'ru' | 'en';
export type { MessageKey };

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { uz, en, ru };
export const LOCALES: Locale[] = ['uz', 'ru', 'en'];

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  let s = DICTS[locale]?.[key] ?? uz[key];
  if (s === undefined) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function hasKey(key: string): key is MessageKey {
  return key in uz;
}

export { uz };
