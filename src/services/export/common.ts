import type { Book, Chapter } from '../../models/book';
import { slugify } from '../../utils/id';
import type { ExportFormat } from './types';

export function exportFilename(book: Book, format: ExportFormat): string {
  return `${slugify(book.title || 'bookly')}.${format}`;
}

export function chapterLabel(book: Book, index: number): string {
  if (book.language === 'en') return `Chapter ${index + 1}`;
  if (book.language === 'ru') return `Глава ${index + 1}`;
  return `${index + 1}-bob`;
}

export function tocLabel(book: Book): string {
  return book.language === 'en' ? 'Contents' : book.language === 'ru' ? 'Содержание' : 'Mundarija';
}

export function byLabel(book: Book): string {
  return book.language === 'en' ? 'by' : book.language === 'ru' ? 'Автор:' : 'Muallif:';
}

export function audioNote(book: Book, title: string): string {
  const t = title || 'Audio';
  if (book.language === 'en') return `Audio: ${t} (available in the EPUB edition)`;
  if (book.language === 'ru') return `Аудио: ${t} (доступно в версии EPUB)`;
  return `Audio: ${t} (EPUB nashrida tinglash mumkin)`;
}

export function chapterDisplayTitle(book: Book, c: Chapter, i: number): string {
  return c.title.trim() || chapterLabel(book, i);
}

export function langTag(book: Book): string {
  return book.language === 'uz' ? 'uz-Latn' : book.language;
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
