/**
 * Pure sync logic: mapping between the local Book model and cloud rows, content hashing and
 * per-book status classification. No I/O here, so every rule is unit-tested in Node.
 */
import { bookWordCount, collectAssetIds, migrateBook, type Book } from '../../models/book';

/** What this device last agreed with the cloud for one book. */
export interface SyncRecord { revision: number; hash: string; syncedAt: number }

export interface RemoteBookSummary {
  id: string;
  local_id: string;
  title: string;
  revision: number;
  content_hash: string;
  updated_at: string;
  deleted_at: string | null;
  chapter_count: number;
  word_count: number;
  device_id: string;
  cover?: Book['cover'];
}

export type BookSyncStatus =
  | 'local-only'      // never uploaded (or removed from the cloud): offer backup
  | 'synced'          // identical on both sides
  | 'local-changed'   // edited here since the last sync: upload
  | 'remote-changed'  // edited on another device, untouched here: download is safe
  | 'conflict'        // edited on both sides: the user decides
  | 'cloud-only';     // exists only in the cloud: offer restore

export interface StatusEntry {
  localId: string;
  title: string;
  status: BookSyncStatus;
  local?: Book;
  remote?: RemoteBookSummary;
  record?: SyncRecord;
  hash?: string;
}

/** Fields that represent the user's content. Volatile fields (opened/reading position) are excluded. */
export function syncableSnapshot(b: Book) {
  return {
    schemaVersion: b.schemaVersion, id: b.id, title: b.title, subtitle: b.subtitle, author: b.author,
    description: b.description, language: b.language, category: b.category, cover: b.cover, theme: b.theme,
    metadata: b.metadata, status: b.status, favorite: b.favorite, deletedAt: b.deletedAt,
    chapters: b.chapters.map((c) => ({ id: c.id, title: c.title, blocks: c.blocks })),
  };
}

/** JSON with sorted keys, so equal content always hashes equally. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const bookHash = (b: Book) => sha256Hex(canonicalJson(syncableSnapshot(b)));

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

export function toCloudPayload(book: Book, hash: string, deviceId: string) {
  return {
    p_book: {
      local_id: book.id, schema_version: book.schemaVersion, title: book.title, subtitle: book.subtitle, author: book.author,
      description: book.description, language: book.language, category: book.category, status: book.status, favorite: book.favorite,
      cover: book.cover, theme: book.theme, metadata: book.metadata, reading: book.reading, word_count: bookWordCount(book),
      content_hash: hash, device_id: deviceId, client_created_at: iso(book.createdAt), client_updated_at: iso(book.updatedAt),
      deleted_at: iso(book.deletedAt),
    },
    p_chapters: book.chapters.map((c) => ({
      local_id: c.id, title: c.title, blocks: c.blocks, client_created_at: iso(c.createdAt), client_updated_at: iso(c.updatedAt),
    })),
  };
}

interface PulledRow {
  local_id: string; schema_version: number; title: string; subtitle: string; author: string; description: string;
  language: Book['language']; category: Book['category']; status: Book['status']; favorite: boolean;
  cover: Book['cover']; theme: Book['theme']; metadata: Book['metadata']; reading: Book['reading'];
  client_created_at: string | null; client_updated_at: string | null; deleted_at: string | null; created_at: string; updated_at: string;
  chapters: { local_id: string; title: string; blocks: Book['chapters'][number]['blocks']; client_created_at: string | null; client_updated_at: string | null }[];
}

const ms = (s: string | null | undefined, fallback: number) => (s ? Date.parse(s) || fallback : fallback);

/** Rebuilds a local Book from `bookly_pull_book`. Keeps this device's reading position when given. */
export function fromCloudRow(row: PulledRow, keep?: Pick<Book, 'lastOpenedAt' | 'reading'>): Book {
  const now = Date.now();
  const created = ms(row.client_created_at, ms(row.created_at, now));
  return migrateBook({
    schemaVersion: row.schema_version || 1,
    id: row.local_id, title: row.title, subtitle: row.subtitle, author: row.author, description: row.description,
    language: row.language, category: row.category, status: row.status, favorite: row.favorite,
    cover: row.cover, theme: row.theme, metadata: row.metadata,
    reading: keep?.reading ?? row.reading ?? { chapterId: null, ratio: 0 },
    lastOpenedAt: keep?.lastOpenedAt ?? null,
    deletedAt: row.deleted_at ? ms(row.deleted_at, now) : null,
    createdAt: created,
    updatedAt: ms(row.client_updated_at, ms(row.updated_at, now)),
    chapters: row.chapters.map((c) => ({
      id: c.local_id, title: c.title, blocks: c.blocks,
      createdAt: ms(c.client_created_at, created), updatedAt: ms(c.client_updated_at, created),
    })),
  });
}

/**
 * Decides what each book needs. `hashes` holds the current content hash of every local book.
 * Rules: never classify a local book as something that implies deleting it; a book changed on
 * both sides is a conflict even if timestamps look ordered (clocks can be wrong).
 */
export function classify(
  locals: Book[], hashes: Record<string, string>, remotes: RemoteBookSummary[], records: Record<string, SyncRecord>,
): StatusEntry[] {
  const out: StatusEntry[] = [];
  const remoteById = new Map(remotes.map((r) => [r.local_id, r]));
  for (const local of locals) {
    const hash = hashes[local.id];
    const remote = remoteById.get(local.id);
    const record = records[local.id];
    remoteById.delete(local.id);
    let status: BookSyncStatus;
    if (!remote) status = 'local-only';
    else if (remote.content_hash === hash) status = 'synced';
    else if (!record) status = 'conflict'; // same book on both sides, never synced from here, different content
    else {
      const localChanged = record.hash !== hash;
      const remoteChanged = remote.revision !== record.revision;
      // unchanged here since the last sync → taking the cloud copy cannot lose local work
      status = localChanged && remoteChanged ? 'conflict' : localChanged ? 'local-changed' : 'remote-changed';
    }
    out.push({ localId: local.id, title: local.title, status, local, remote, record, hash });
  }
  for (const remote of remoteById.values()) {
    out.push({ localId: remote.local_id, title: remote.title, status: 'cloud-only', remote, record: records[remote.local_id] });
  }
  return out;
}

export function referencedAssets(book: Book): string[] {
  return collectAssetIds(book);
}

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/aac': 'aac',
};
