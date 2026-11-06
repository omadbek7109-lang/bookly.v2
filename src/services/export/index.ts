import { tr } from '../../i18n';
/** Export entry point — each format is lazy-loaded so heavy libraries never hit the first paint. */
import type { ExportFormat, ExportInput, ExportOutput } from './types';

export async function runExport(format: ExportFormat, input: ExportInput): Promise<ExportOutput> {
  if (!input.book.chapters.length) throw new Error(tr('export.noChapters'));
  switch (format) {
    case 'pdf': return (await import('./pdf')).exportPdf(input);
    case 'docx': return (await import('./docx')).exportDocx(input);
    case 'pptx': return (await import('./pptx')).exportPptx(input);
    case 'epub': return (await import('./epub')).exportEpub(input);
    default: throw new Error(`Unsupported format: ${String(format)}`);
  }
}

export * from './types';
