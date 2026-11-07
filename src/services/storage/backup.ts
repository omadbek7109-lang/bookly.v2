import { tr } from '../../i18n';
/** Local backup / restore (JSON with base64 assets). Also the hand-off format for the Phase 2 cloud migration. */
import { migrateBook, type Book } from '../../models/book';
import { assets, books, repoEvents } from './repository';
import { idbClearAll } from './db';

export interface BackupFile {
  app: 'bookly';
  format: 1;
  exportedAt: string;
  books: Book[];
  assets: { id: string; name: string; mime: string; data: string }[];
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function createBackup(): Promise<Blob> {
  const all = await books.list();
  const list = await assets.list();
  const file: BackupFile = {
    app: 'bookly', format: 1, exportedAt: new Date().toISOString(), books: all,
    assets: await Promise.all(list.map(async (a) => ({ id: a.id, name: a.name, mime: a.mime, data: await blobToBase64(a.blob) }))),
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function restoreBackup(file: Blob): Promise<number> {
  const parsed = JSON.parse(await file.text()) as Partial<BackupFile>;
  if (parsed.app !== 'bookly' || !Array.isArray(parsed.books)) throw new Error(tr('backup.notBookly'));
  for (const a of parsed.assets ?? []) await assets.put(base64ToBlob(a.data, a.mime), a.name, a.id);
  let n = 0;
  for (const raw of parsed.books) { await books.save(migrateBook(raw), { touch: false }); n++; }
  return n;
}

/**
 * "Delete all books" on this device: every book plus the images/audio stored for books.
 * Kept: settings, profile (and its avatar image), sync device id. Returns how many books were removed.
 */
export async function wipeLocalBooks(keepAssetIds: (string | null | undefined)[] = []): Promise<number> {
  const keep = new Set(keepAssetIds.filter(Boolean) as string[]);
  const all = await books.list();
  for (const b of all) await books.remove(b.id);
  for (const a of await assets.list()) if (!keep.has(a.id)) await assets.remove(a.id);
  repoEvents.emit({ type: 'reset' });
  return all.length;
}

/** Full factory reset of this device (books, files, settings). Not used by the profile any more. */
export async function clearAllData(): Promise<void> {
  await idbClearAll();
  try { localStorage.removeItem('bookly.settings'); } catch { /* ignore */ }
  repoEvents.emit({ type: 'reset' });
}
