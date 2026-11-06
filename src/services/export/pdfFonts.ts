/**
 * Unicode fonts for PDF export (public/fonts, built by scripts/build-fonts.py from Liberation, OFL 1.1).
 * Loaded lazily the first time a PDF is exported and cached in memory; the browser also caches the files.
 */
export type PdfFontKind = 'Times' | 'Helvetica' | 'Courier';
export type PdfFontStyle = 'Regular' | 'Bold' | 'Italic' | 'BoldItalic';
export type FontLoader = (file: string) => Promise<Uint8Array>;

const FILE_PREFIX: Record<PdfFontKind, string> = { Times: 'BooklySerif', Helvetica: 'BooklySans', Courier: 'BooklyMono' };
export const pdfFontFile = (kind: PdfFontKind, style: PdfFontStyle) => `${FILE_PREFIX[kind]}-${style}.ttf`;

const browserLoader: FontLoader | null = typeof document !== 'undefined' && typeof fetch !== 'undefined'
  ? async (file) => {
    const res = await fetch(new URL(`fonts/${file}`, document.baseURI));
    if (!res.ok) throw new Error(`font ${file}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  : null;

let loader: FontLoader | null = browserLoader;
const cache = new Map<string, Promise<Uint8Array>>();

/** Tests (Node) read the files from disk; pass null to simulate fonts being unavailable. */
export function setPdfFontLoader(l: FontLoader | null) { loader = l; cache.clear(); }

export function loadPdfFont(file: string): Promise<Uint8Array> {
  if (!loader) return Promise.reject(new Error('no font loader'));
  let p = cache.get(file);
  if (!p) {
    p = loader(file);
    cache.set(file, p);
    p.catch(() => cache.delete(file)); // allow a retry later (e.g. when back online)
  }
  return p;
}

/** Warm the cache in the background (export screen opened) so a later offline export still has fonts. */
export function prefetchPdfFonts(kinds: PdfFontKind[] = ['Times', 'Helvetica']) {
  for (const k of kinds) for (const s of ['Regular', 'Bold', 'Italic', 'BoldItalic'] as PdfFontStyle[]) void loadPdfFont(pdfFontFile(k, s)).catch(() => {});
}
