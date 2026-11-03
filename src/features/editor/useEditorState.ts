/**
 * Editor state: the working copy of the book, undo/redo history (with typing coalescing)
 * and safe autosave with a visible status.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book } from '../../models/book';
import { books } from '../../services/storage/repository';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
const MAX_HISTORY = 120;
const AUTOSAVE_MS = 900;

export function useEditorState(initial: Book) {
  const [book, setBook] = useState<Book>(initial);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const past = useRef<Book[]>([]);
  const future = useRef<Book[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const latest = useRef(book);
  const savedRef = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const [, force] = useState(0);
  latest.current = book;

  const persist = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const snapshot = latest.current;
    if (snapshot === savedRef.current) return;
    if (saving.current) await saving.current;
    setStatus('saving');
    saving.current = (async () => {
      try {
        const saved = await books.save(snapshot);
        savedRef.current = snapshot;
        // keep updatedAt in sync without creating a history entry
        if (latest.current === snapshot) { latest.current = saved; savedRef.current = saved; setBook(saved); }
        setStatus(latest.current === savedRef.current ? 'saved' : 'dirty');
      } catch (e) {
        console.error('[bookly] save failed', e);
        setStatus('error');
      } finally { saving.current = null; }
    })();
    await saving.current;
  }, []);

  const schedule = useCallback(() => {
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }, [persist]);

  /** Applies a change. `coalesce` groups rapid edits of the same kind (typing) into one undo step. */
  const update = useCallback((fn: (b: Book) => Book, coalesce?: string) => {
    const prev = latest.current;
    const next = fn(prev);
    if (next === prev) return;
    const now = Date.now();
    const same = coalesce && lastKey.current && lastKey.current.key === coalesce && now - lastKey.current.at < 1200;
    if (!same) {
      past.current.push(prev);
      if (past.current.length > MAX_HISTORY) past.current.shift();
    }
    lastKey.current = coalesce ? { key: coalesce, at: now } : null;
    future.current = [];
    latest.current = next;
    setBook(next);
    schedule();
  }, [schedule]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(latest.current);
    lastKey.current = null;
    latest.current = prev;
    setBook(prev);
    schedule();
    force((x) => x + 1);
  }, [schedule]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(latest.current);
    lastKey.current = null;
    latest.current = next;
    setBook(next);
    schedule();
    force((x) => x + 1);
  }, [schedule]);

  // Flush on tab hide / unmount so nothing is lost.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void persist(); };
    const onUnload = () => { void persist(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      void persist();
    };
  }, [persist]);

  return {
    book, update, undo, redo, status, saveNow: persist,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
  };
}
