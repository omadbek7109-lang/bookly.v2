import type { Book, Chapter } from '../../models/book';
import { slugify } from '../../utils/id';
import type { ExportFormat } from './types';

export function exportFilename(book: Book, format: ExportFormat): string {
  return `${slugify(book.title || 'bookly')}.${format}`;
}

/**
 * Uzbek is written in Latin or Cyrillic script; the book language is just "uz", so the script is detected
 * from the book's own text and exported labels (chapter, contents, author) follow it.
 */
const cyrScriptCache = new WeakMap<Book, boolean>();
export function isUzCyrillic(book: Book): boolean {
  if (book.language !== 'uz') return false;
  let v = cyrScriptCache.get(book);
  if (v === undefined) {
    const sample = [book.title, book.subtitle, book.description, ...book.chapters.slice(0, 3).flatMap((c) => [c.title, ...c.blocks.slice(0, 8).map((b) => ('html' in b ? b.html : ''))])].join(' ').replace(/<[^>]+>/g, '');
    const cyr = (sample.match(/[\u0400-\u04FF]/g) ?? []).length;
    const lat = (sample.match(/[A-Za-z]/g) ?? []).length;
    v = cyr > lat;
    cyrScriptCache.set(book, v);
  }
  return v;
}

/** Default chapter name in the book's own language (content, not interface). */
export function chapterLabelLang(language: string, index: number, uzCyrillic = false): string {
  if (language === 'en') return `Chapter ${index + 1}`;
  if (language === 'ru') return `Глава ${index + 1}`;
  return uzCyrillic ? `${index + 1}-боб` : `${index + 1}-bob`;
}

export function chapterLabel(book: Book, index: number): string {
  return chapterLabelLang(book.language, index, isUzCyrillic(book));
}

export function tocLabel(book: Book): string {
  return book.language === 'en' ? 'Contents' : book.language === 'ru' ? 'Содержание' : isUzCyrillic(book) ? 'Мундарижа' : 'Mundarija';
}

export function byLabel(book: Book): string {
  return book.language === 'en' ? 'by' : book.language === 'ru' ? 'Автор:' : isUzCyrillic(book) ? 'Муаллиф:' : 'Muallif:';
}

export function audioNote(book: Book, title: string): string {
  const t = title || 'Audio';
  if (book.language === 'en') return `Audio: ${t} (available in the EPUB edition)`;
  if (book.language === 'ru') return `Аудио: ${t} (доступно в версии EPUB)`;
  if (isUzCyrillic(book)) return `Аудио: ${t} (EPUB нашрида тинглаш мумкин)`;
  return `Audio: ${t} (EPUB nashrida tinglash mumkin)`;
}

export function chapterDisplayTitle(book: Book, c: Chapter, i: number): string {
  return c.title.trim() || chapterLabel(book, i);
}

export function langTag(book: Book): string {
  return book.language === 'uz' ? (isUzCyrillic(book) ? 'uz-Cyrl' : 'uz-Latn') : book.language;
}

export function u8(data: ArrayBuffer | Uint8Array | Blob | string): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new Error('Unsupported binary type');
}

export function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function hexColor(c: string, fallback = '4f46e5'): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  return m ? m[1].toUpperCase() : fallback.toUpperCase();
}
