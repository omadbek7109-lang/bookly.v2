import { tr } from '../../i18n';
/** Browser-side preparation: reads assets from IndexedDB, normalises images, renders the cover. */
import { collectAssetIds, type Book } from '../../models/book';
import { renderCoverBlob } from '../cover/renderCover';
import { assets as assetRepo } from '../storage/repository';
import { runExport } from './index';
import type { ExportFormat, ExportOptions, ExportOutput, ResolvedAsset } from './types';

async function blobToBytes(b: Blob) { return new Uint8Array(await b.arrayBuffer()); }

async function normaliseImage(id: string, blob: Blob, name: string): Promise<ResolvedAsset | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const maxSide = 2000;
    const needsResize = Math.max(bmp.width, bmp.height) > maxSide;
    if ((blob.type === 'image/png' || blob.type === 'image/jpeg') && !needsResize) {
      return { id, bytes: await blobToBytes(blob), mime: blob.type, width: bmp.width, height: bmp.height, name };
    }
    // Convert webp/gif/svg/oversized images to PNG or JPEG so every format can embed them.
    const scale = needsResize ? maxSide / Math.max(bmp.width, bmp.height) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const mime = blob.type === 'image/png' || blob.type === 'image/gif' ? 'image/png' : 'image/jpeg';
    const out = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('convert failed'))), mime, 0.9));
    return { id, bytes: await blobToBytes(out), mime, width: c.width, height: c.height, name };
  } catch (e) {
    console.warn('[bookly] image skipped', id, e);
    return null;
  }
}

export async function resolveAssets(book: Book): Promise<Record<string, ResolvedAsset>> {
  const out: Record<string, ResolvedAsset> = {};
  for (const id of collectAssetIds(book)) {
    const a = await assetRepo.get(id);
    if (!a) continue;
    if (a.mime.startsWith('image/')) {
      const r = await normaliseImage(id, a.blob, a.name);
      if (r) out[id] = r;
    } else {
      out[id] = { id, bytes: await blobToBytes(a.blob), mime: a.mime, name: a.name };
    }
  }
  return out;
}

export async function exportBook(book: Book, format: ExportFormat, options: ExportOptions): Promise<ExportOutput> {
  const [assets, coverBlob] = await Promise.all([
    resolveAssets(book),
    options.includeCover ? renderCoverBlob(book.cover, { width: format === 'pptx' ? 1200 : 1400 }) : Promise.resolve(null),
  ]);
  const cover: ResolvedAsset | null = coverBlob
    ? { id: 'cover', bytes: await blobToBytes(coverBlob), mime: 'image/jpeg', width: format === 'pptx' ? 1200 : 1400, height: Math.round((format === 'pptx' ? 1200 : 1400) * 1.5) }
    : null;
  return runExport(format, { book, assets, cover, options });
}

export type SaveOutcome = 'saved' | 'declined' | 'failed';

interface DownloadsApi { save(req: { filename: string; data: Blob }): Promise<{ status: string }> }
interface ClaudeHost { use(name: string): Promise<unknown> }

/** Resolves the Claude artifact `downloads` capability when the app runs as a claude.ai artifact. */
function artifactDownloads(): Promise<DownloadsApi | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') return Promise.resolve(null);
  return host.use('downloads').then((d) => (d as DownloadsApi | null) ?? null).catch(() => null);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): Promise<SaveOutcome> {
  return downloadBlob(new Blob([bytes as BlobPart], { type: mime }), filename);
}

/**
 * Saves a generated file. Inside a claude.ai artifact the sandbox blocks <a download>, so the
 * platform's `downloads` capability is used (the viewer confirms the save). Everywhere else
 * (GitHub Pages, Telegram, local) a regular browser download is started.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<SaveOutcome> {
  const dl = await artifactDownloads();
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'declined';
      console.warn('[bookly] artifact download failed', e);
      return 'failed';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} ${tr('unit.b')}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ${tr('unit.kb')}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${tr('unit.mb')}`;
}
