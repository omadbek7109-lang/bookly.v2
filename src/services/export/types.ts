import type { Book } from '../../models/book';

export type ExportFormat = 'pdf' | 'pptx' | 'epub' | 'docx';

/** Binary asset already decoded to bytes — exporters never touch IndexedDB or the DOM. */
export interface ResolvedAsset {
  id: string;
  bytes: Uint8Array;
  mime: string;
  /** Pixel size for images. */
  width?: number;
  height?: number;
  name?: string;
}

export interface ExportOptions {
  includeCover: boolean;
  includeToc: boolean;
  pageSize: 'A4' | 'A5' | 'Letter';
}

export interface ExportInput {
  book: Book;
  assets: Record<string, ResolvedAsset>;
  /** Rendered cover artwork (JPEG/PNG) — optional. */
  cover?: ResolvedAsset | null;
  options: ExportOptions;
}

export interface ExportOutput {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  extension: string;
}

export const MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { includeCover: true, includeToc: true, pageSize: 'A5' };

export function isImageMime(m: string) { return m === 'image/png' || m === 'image/jpeg'; }
