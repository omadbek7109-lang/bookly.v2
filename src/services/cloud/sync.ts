/**
 * Cloud backup & sync engine (local-first).
 *
 * - IndexedDB stays the source of truth; the cloud is an optional copy.
 * - Sync never deletes a local book. A book trashed on another device arrives in the Trash here.
 * - Conflicts (changed on both sides) are never auto-resolved: the user picks
 *   "this device", "cloud" or "keep both".
 * - Network errors switch to `offline` and retry on the `online` event / with back-off.
 */
import { duplicateBook, type Book } from '../../models/book';
import { uid } from '../../utils/id';
import { CloudClient, CloudError, type CloudUser } from './client';
import { CLOUD_MIME, MAX_CLOUD_ASSET_BYTES } from './config';
import {
  bookHash, classify, EXT_BY_MIME, fromCloudRow, referencedAssets, sha256Hex, toCloudPayload,
  type RemoteBookSummary, type StatusEntry, type SyncRecord,
} from './sync-core';

export interface LocalBooks {
  list(): Promise<Book[]>;
  get(id: string): Promise<Book | null>;
  save(b: Book, opts?: { touch?: boolean }): Promise<Book>;
}
export interface LocalAssets {
  get(id: string): Promise<{ blob: Blob; mime: string; name: string; size: number } | null>;
  put(blob: Blob, name: string, id: string): Promise<unknown>;
}
export interface SyncStateStore {
  load(): Promise<SyncState | null>;
  save(s: SyncState): Promise<void>;
}

export interface SyncState {
  userId: string;
  records: Record<string, SyncRecord>;
  lastSyncAt: number | null;
  lastBackupAt: number | null;
}

export type EnginePhase = 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface EngineSnapshot {
  phase: EnginePhase;
  entries: StatusEntry[];
  lastSyncAt: number | null;
  lastBackupAt: number | null;
  message: string | null;
  progress: { done: number; total: number } | null;
}

interface RemoteAssetRow { local_id: string; sha256: string; storage_path: string; mime: string; size_bytes: number; name: string }

export interface SyncReport { uploaded: number; downloaded: number; conflicts: number; skippedAssets: string[] }

export class SyncEngine {
  private state: SyncState | null = null;
  private snapshot: EngineSnapshot = { phase: 'signed-out', entries: [], lastSyncAt: null, lastBackupAt: null, message: null, progress: null };
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private running: Promise<SyncReport> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 30_000;

  constructor(
    private readonly client: CloudClient,
    private readonly books: LocalBooks,
    private readonly assets: LocalAssets,
    private readonly store: SyncStateStore,
    readonly deviceId: string,
    readonly deviceName: string,
  ) {}

  // ---------------------------------------------------------------- observable state
  get current() { return this.snapshot; }
  subscribe(fn: (s: EngineSnapshot) => void) { this.listeners.add(fn); fn(this.snapshot); return () => { this.listeners.delete(fn); }; }
  private emit(patch: Partial<EngineSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((f) => { try { f(this.snapshot); } catch (e) { console.error(e); } });
  }

  private async loadState(user: CloudUser): Promise<SyncState> {
    if (this.state?.userId === user.id) return this.state;
    const saved = await this.store.load();
    // Records belong to one account: another account on this device starts fresh (nothing is deleted).
    this.state = saved && saved.userId === user.id ? saved : { userId: user.id, records: {}, lastSyncAt: null, lastBackupAt: null };
    this.emit({ lastSyncAt: this.state.lastSyncAt, lastBackupAt: this.state.lastBackupAt });
    return this.state;
  }
  private async persist() { if (this.state) await this.store.save(this.state); }

  reset() {
    this.state = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.emit({ phase: 'signed-out', entries: [], lastSyncAt: null, lastBackupAt: null, message: null, progress: null });
  }

  // ---------------------------------------------------------------- status
  async refreshStatus(): Promise<StatusEntry[]> {
    const user = this.client.user;
    if (!user) { this.reset(); return []; }
    const st = await this.loadState(user);
    try {
      const [locals, remotes] = await Promise.all([this.books.list(), this.listRemote()]);
      const hashes: Record<string, string> = {};
      for (const b of locals) hashes[b.id] = await bookHash(b);
      const entries = classify(locals, hashes, remotes, st.records);
      // Remember identical copies (e.g. restored earlier) so later edits are detected correctly.
      let dirty = false;
      for (const e of entries) {
        if (e.status === 'synced' && e.remote && (!e.record || e.record.revision !== e.remote.revision || e.record.hash !== e.hash)) {
          st.records[e.localId] = { revision: e.remote.revision, hash: e.hash!, syncedAt: Date.now() };
          dirty = true;
        }
      }
      if (dirty) await this.persist();
      this.emit({ phase: 'idle', entries, message: null });
      return entries;
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  private listRemote(): Promise<RemoteBookSummary[]> {
    return this.client.select<RemoteBookSummary>('books',
      'select=id,local_id,title,revision,content_hash,updated_at,deleted_at,chapter_count,word_count,device_id,cover&order=updated_at.desc');
  }

  // ---------------------------------------------------------------- full sync
  /**
   * Uploads local-only/changed books, downloads cloud-only/remote-changed books, leaves conflicts
   * for the user. `mode: 'backup'` only uploads; `mode: 'restore'` only downloads.
   */
  sync(mode: 'sync' | 'backup' | 'restore' = 'sync', onlyIds?: string[]): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.runSync(mode, onlyIds).finally(() => { this.running = null; });
    return this.running;
  }

  private async runSync(mode: 'sync' | 'backup' | 'restore', onlyIds?: string[]): Promise<SyncReport> {
    const report: SyncReport = { uploaded: 0, downloaded: 0, conflicts: 0, skippedAssets: [] };
    if (!this.client.user) return report;
    this.emit({ phase: 'syncing', message: null, progress: { done: 0, total: 0 } });
    try {
      const entries = (await this.refreshStatus()).filter((e) => !onlyIds || onlyIds.includes(e.localId));
      const up = mode !== 'restore' ? entries.filter((e) => e.status === 'local-only' || e.status === 'local-changed') : [];
      const down = mode !== 'backup' ? entries.filter((e) => e.status === 'cloud-only' || e.status === 'remote-changed') : [];
      report.conflicts = entries.filter((e) => e.status === 'conflict').length;
      const total = up.length + down.length;
      let done = 0;
      this.emit({ phase: 'syncing', progress: { done, total } });
      const remoteAssets = up.length || down.length ? await this.listRemoteAssets() : new Map<string, RemoteAssetRow>();
      for (const e of up) {
        const res = await this.pushBook(e.local!, e.record?.revision ?? null, false, remoteAssets, report);
        if (res === 'conflict') report.conflicts++; else report.uploaded++;
        this.emit({ progress: { done: ++done, total } });
      }
      for (const e of down) {
        await this.pullBook(e.localId, remoteAssets, report);
        report.downloaded++;
        this.emit({ progress: { done: ++done, total } });
      }
      const st = this.state!;
      st.lastSyncAt = Date.now();
      if (report.uploaded || mode === 'backup') st.lastBackupAt = st.lastSyncAt;
      await this.persist();
      await this.recordDevice(report.uploaded > 0 || mode === 'backup');
      this.retryDelay = 30_000;
      this.emit({ lastSyncAt: st.lastSyncAt, lastBackupAt: st.lastBackupAt, progress: null });
      await this.refreshStatus();
      return report;
    } catch (e) {
      this.handleError(e);
      throw e;
    }
  }

  // ---------------------------------------------------------------- conflicts
  /** Resolves one conflicted book according to the user's choice. Nothing is lost silently. */
  async resolve(localId: string, choice: 'device' | 'cloud' | 'both'): Promise<void> {
    const local = await this.books.get(localId);
    const remoteAssets = await this.listRemoteAssets();
    const report: SyncReport = { uploaded: 0, downloaded: 0, conflicts: 0, skippedAssets: [] };
    if (choice === 'device') {
      if (local) await this.pushBook(local, null, true, remoteAssets, report);
    } else {
      if (choice === 'both' && local) {
        // Keep this device's version as a separate book before taking the cloud copy.
        const copy = duplicateBook(local, ' (bu qurilma)');
        copy.favorite = local.favorite;
        await this.books.save(copy, { touch: false });
      }
      await this.pullBook(localId, remoteAssets, report);
    }
    await this.refreshStatus();
  }

  /** Removes the cloud copy only; the book stays on this device. */
  async removeFromCloud(localId: string): Promise<void> {
    await this.client.remove('books', `local_id=eq.${encodeURIComponent(localId)}`);
    if (this.state) { delete this.state.records[localId]; await this.persist(); }
    await this.refreshStatus();
  }

  // ---------------------------------------------------------------- per-book transfer
  private async pushBook(book: Book, baseRevision: number | null, force: boolean, remoteAssets: Map<string, RemoteAssetRow>, report: SyncReport): Promise<'ok' | 'conflict'> {
    for (const id of referencedAssets(book)) {
      if (remoteAssets.has(id)) continue;
      const row = await this.uploadAsset(id, remoteAssets);
      if (row) remoteAssets.set(id, row); else report.skippedAssets.push(id);
    }
    const hash = await bookHash(book);
    const payload = toCloudPayload(book, hash, this.deviceId);
    const res = await this.client.rpc<{ status: 'ok' | 'conflict'; revision: number }>('bookly_push_book', {
      ...payload, p_base_revision: baseRevision, p_force: force,
    });
    if (res.status === 'conflict') return 'conflict';
    this.state!.records[book.id] = { revision: Number(res.revision), hash, syncedAt: Date.now() };
    await this.persist();
    return 'ok';
  }

  private async pullBook(localId: string, remoteAssets: Map<string, RemoteAssetRow>, report: SyncReport): Promise<void> {
    const row = await this.client.rpc<Parameters<typeof fromCloudRow>[0] & { revision: number } | null>('bookly_pull_book', { p_local_id: localId });
    if (!row) return;
    const existing = await this.books.get(localId);
    const book = fromCloudRow(row, existing ?? undefined);
    for (const id of referencedAssets(book)) {
      if (await this.assets.get(id)) continue;
      const meta = remoteAssets.get(id);
      if (!meta) { report.skippedAssets.push(id); continue; }
      try {
        const blob = await this.client.downloadObject(meta.storage_path);
        await this.assets.put(new Blob([blob], { type: meta.mime }), meta.name || id, id);
      } catch (e) {
        if (e instanceof CloudError && e.offline) throw e;
        report.skippedAssets.push(id);
      }
    }
    await this.books.save(book, { touch: false });
    this.state!.records[localId] = { revision: Number(row.revision), hash: await bookHash(book), syncedAt: Date.now() };
    await this.persist();
  }

  private async listRemoteAssets(): Promise<Map<string, RemoteAssetRow>> {
    const rows = await this.client.select<RemoteAssetRow>('book_assets', 'select=local_id,sha256,storage_path,mime,size_bytes,name');
    return new Map(rows.map((r) => [r.local_id, r]));
  }

  /** Uploads one asset with content-hash de-duplication. Returns null when the file is not allowed. */
  private async uploadAsset(id: string, remoteAssets: Map<string, RemoteAssetRow>): Promise<RemoteAssetRow | null> {
    const a = await this.assets.get(id);
    if (!a) return null;
    const mime = (a.blob.type || a.mime || '').toLowerCase();
    if (!CLOUD_MIME.test(mime) || a.blob.size === 0 || a.blob.size > MAX_CLOUD_ASSET_BYTES) return null;
    const sha = await sha256Hex(await a.blob.arrayBuffer());
    const user = this.client.user!;
    const same = [...remoteAssets.values()].find((r) => r.sha256 === sha);
    const storagePath = same?.storage_path ?? `${user.id}/${sha}.${EXT_BY_MIME[mime] ?? 'bin'}`;
    if (!same) await this.client.uploadObject(storagePath, a.blob);
    const row: RemoteAssetRow = { local_id: id, sha256: sha, storage_path: storagePath, mime, size_bytes: a.blob.size, name: (a.name || id).slice(0, 255) };
    await this.client.upsert('book_assets', row, 'user_id,local_id');
    return row;
  }

  private async recordDevice(backup: boolean) {
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      device_id: this.deviceId, device_name: this.deviceName.slice(0, 120), last_sync_at: now,
      books_synced: Object.keys(this.state?.records ?? {}).length,
    };
    if (backup) row.last_backup_at = now;
    try { await this.client.upsert('sync_metadata', row, 'user_id,device_id'); } catch (e) { if (e instanceof CloudError && e.offline) throw e; }
  }

  // ---------------------------------------------------------------- cloud usage & cleanup
  async usage(): Promise<{ books: number; chapters: number; assets: number; asset_bytes: number; last_backup_at: string | null } | null> {
    const rows = await this.client.rpc<{ books: number; chapters: number; assets: number; asset_bytes: number; last_backup_at: string | null }[]>('bookly_cloud_usage', {});
    return rows[0] ?? null;
  }

  async orphanAssets(): Promise<RemoteAssetRow[]> {
    return this.client.rpc<RemoteAssetRow[]>('bookly_orphan_assets', {});
  }

  /** Deletes cloud files no cloud book references (after the user confirmed). */
  async cleanOrphans(rows: RemoteAssetRow[]): Promise<number> {
    if (!rows.length) return 0;
    const stillUsed = new Set((await this.client.select<RemoteAssetRow>('book_assets', 'select=storage_path,local_id'))
      .filter((r) => !rows.some((o) => o.local_id === r.local_id)).map((r) => r.storage_path));
    await this.client.removeObjects([...new Set(rows.map((r) => r.storage_path))].filter((p) => !stillUsed.has(p)));
    await this.client.remove('book_assets', `local_id=in.(${rows.map((r) => `"${r.local_id.replace(/"/g, '')}"`).join(',')})`);
    return rows.length;
  }

  // ---------------------------------------------------------------- errors & retry
  private handleError(e: unknown) {
    const offline = e instanceof CloudError && e.offline;
    this.emit({ phase: offline ? 'offline' : e instanceof CloudError && e.code === 'session_expired' ? 'signed-out' : 'error', message: (e as Error)?.message ?? String(e), progress: null });
    if (offline) this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { void this.sync().catch(() => {}); }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 5 * 60_000);
  }
}

export function deviceIdentity(): { id: string; name: string } {
  let id = '';
  try { id = localStorage.getItem('bookly.device') || ''; } catch { /* ignore */ }
  if (!id) { id = uid('dev'); try { localStorage.setItem('bookly.device', id); } catch { /* ignore */ } }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac/i.test(ua) ? 'macOS' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Qurilma';
  const app = /Telegram/i.test(ua) ? 'Telegram' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Brauzer';
  return { id, name: `${os} · ${app}` };
}
