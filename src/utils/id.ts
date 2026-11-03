/** Stable, collision-resistant IDs for books, chapters, blocks and assets. */
export function uid(prefix = ''): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const raw = c && typeof c.randomUUID === 'function'
    ? c.randomUUID().replace(/-/g, '').slice(0, 16)
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 16);
  return prefix ? `${prefix}_${raw}` : raw;
}

export function slugify(input: string, fallback = 'bookly'): string {
  const map: Record<string, string> = { 'ʻ': '', '‘': '', '’': '', "'": '', '`': '', 'ş': 's', 'ç': 'c', 'ğ': 'g', 'ö': 'o', 'ü': 'u' };
  const cyr: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'o', ф: 'f', х: 'x', ҳ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
    ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const s = input
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? cyr[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}
