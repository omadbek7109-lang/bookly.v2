/**
 * Book & asset repositories.
 *
 * The UI only talks to the `BookRepository` / `AssetRepository` interfaces. Phase 1 ships the
 * IndexedDB implementations; Phase 2 can add a Supabase-backed implementation (or a sync layer
 * wrapping the local one) without touching screens.
 */
import { migrateBook, type Book } from '../../models/book';
import { uid } from '../../utils/id';
import { idbDelete, idbGet, idbGetAll, idbPut } from './db';

export interface BookRepository {
  list(): Promise<Book[]>;
  get(id: string): Promise<Book | null>;
  save(book: Book, opts?: { touch?: boolean }): Promise<Book>;
  remove(id: string): Promise<void>;
  subscribe(fn: (e: RepoEvent) => void): () => void;
}

export interface StoredAsset {
  id: string;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  createdAt: number;
}

export interface AssetRepository {
  put(file: Blob, name?: string): Promise<StoredAsset>;
  get(id: string): Promise<StoredAsset | null>;
  remove(id: string): Promise<void>;
  list(): Promise<StoredAsset[]>;
}

export type RepoEvent = { type: 'saved'; book: Book } | { type: 'removed'; id: string } | { type: 'reset' };

class Emitter {
  private fns = new Set<(e: RepoEvent) => void>();
  on(fn: (e: RepoEvent) => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  emit(e: RepoEvent) { this.fns.forEach((f) => { try { f(e); } catch (err) { console.error(err); } }); }
}

export const repoEvents = new Emitter();

export class LocalBookRepository implements BookRepository {
  async list(): Promise<Book[]> {
    const rows = await idbGetAll<unknown>('books');
    const out: Book[] = [];
    for (const r of rows) {
      try { out.push(migrateBook(r)); } catch (e) { console.warn('[bookly] skipped unreadable book', e); }
    }
    return out;
  }

  async get(id: string): Promise<Book | null> {
    const r = await idbGet<unknown>('books', id);
    return r ? migrateBook(r) : null;
  }

  async save(book: Book, { touch = true } = {}): Promise<Book> {
    const next: Book = touch ? { ...book, updatedAt: Date.now() } : book;
    await idbPut('books', next);
    repoEvents.emit({ type: 'saved', book: next });
    return next;
  }

  async remove(id: string): Promise<void> {
    await idbDelete('books', id);
    repoEvents.emit({ type: 'removed', id });
  }

  subscribe(fn: (e: RepoEvent) => void) { return repoEvents.on(fn); }
}

export const MAX_ASSET_BYTES = 15 * 1024 * 1024;

export class LocalAssetRepository implements AssetRepository {
  private urlCache = new Map<string, string>();

  async put(file: Blob, name = 'asset'): Promise<StoredAsset> {
    if (file.size > MAX_ASSET_BYTES) throw new Error('FILE_TOO_LARGE');
    const asset: StoredAsset = { id: uid('ast'), blob: file, mime: file.type || 'application/octet-stream', name, size: file.size, createdAt: Date.now() };
    await idbPut('assets', asset);
    return asset;
  }

  async get(id: string): Promise<StoredAsset | null> {
    return (await idbGet<StoredAsset>('assets', id)) ?? null;
  }

  async remove(id: string): Promise<void> {
    const url = this.urlCache.get(id);
    if (url) { URL.revokeObjectURL(url); this.urlCache.delete(id); }
    await idbDelete('assets', id);
  }

  async list(): Promise<StoredAsset[]> {
    return idbGetAll<StoredAsset>('assets');
  }

  /** Cached object URL for displaying an asset. */
  async url(id: string): Promise<string | null> {
    const cached = this.urlCache.get(id);
    if (cached) return cached;
    const a = await this.get(id);
    if (!a) return null;
    const url = URL.createObjectURL(a.blob);
    this.urlCache.set(id, url);
    return url;
  }
}

export const books = new LocalBookRepository();
export const assets = new LocalAssetRepository();
