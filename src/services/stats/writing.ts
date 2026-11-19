/**
 * Personal writing progress, kept on this device only: words written per day (counted from the editor, so
 * imports do not inflate it), the daily goal streak and a few achievements. Small, private, no network.
 */
import { useEffect, useState } from 'react';
import type { Book } from '../../models/book';
import { bookWordCount } from '../../models/book';

const KEY = 'bookly.writing';
export interface WritingLog { days: Record<string, number>; exports: number; best: number }

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayBefore = (key: string) => { const [y, m, d] = key.split('-').map(Number); return today(new Date(y, m - 1, d - 1)); };

function load(): WritingLog {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r && typeof r === 'object' && r.days) return { days: r.days, exports: Number(r.exports) || 0, best: Number(r.best) || 0 };
  } catch { /* ignore */ }
  return { days: {}, exports: 0, best: 0 };
}
const listeners = new Set<() => void>();
function save(l: WritingLog) {
  // keep ~1 year of days
  const keys = Object.keys(l.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 370))) delete l.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* quota / private mode */ }
  listeners.forEach((f) => f());
}

/** Streak of consecutive days (ending today, or yesterday if today has no words yet) that reached the goal. */
export function streakOf(days: Record<string, number>, goal: number, now = today()): number {
  let d = (days[now] ?? 0) >= goal ? now : dayBefore(now);
  let n = 0;
  while ((days[d] ?? 0) >= goal) { n++; d = dayBefore(d); }
  return n;
}

export function addWords(delta: number, goal: number): void {
  if (!(delta > 0) || delta > 20000) return; // ignore huge jumps (pasting a whole book)
  const l = load();
  const k = today();
  l.days[k] = (l.days[k] ?? 0) + Math.round(delta);
  l.best = Math.max(l.best, streakOf(l.days, goal));
  save(l);
}
export function addExport(): void { const l = load(); l.exports++; save(l); }

export function useWritingLog(): WritingLog {
  const [l, setL] = useState(load);
  useEffect(() => { const f = () => setL(load()); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return l;
}
export const todayKey = today;
export const lastDays = (n: number, now = new Date()) => [...Array(n)].map((_, i) => today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i))));

export type AchievementId = 'first_book' | 'words_1k' | 'words_10k' | 'streak_3' | 'streak_7' | 'first_export' | 'cover_artist' | 'finisher';
export const ACHIEVEMENTS: { id: AchievementId; icon: string }[] = [
  { id: 'first_book', icon: '📘' }, { id: 'words_1k', icon: '✍️' }, { id: 'words_10k', icon: '🏔️' }, { id: 'streak_3', icon: '🔥' },
  { id: 'streak_7', icon: '🌟' }, { id: 'first_export', icon: '📦' }, { id: 'cover_artist', icon: '🎨' }, { id: 'finisher', icon: '🏁' },
];

export function achievements(books: Book[], log: WritingLog, goal: number): Record<AchievementId, boolean> {
  const live = books.filter((b) => !b.deletedAt);
  const words = live.reduce((n, b) => n + bookWordCount(b), 0);
  const streak = Math.max(log.best, streakOf(log.days, goal));
  return {
    first_book: live.length > 0,
    words_1k: words >= 1000,
    words_10k: words >= 10000,
    streak_3: streak >= 3,
    streak_7: streak >= 7,
    first_export: log.exports > 0,
    cover_artist: live.some((b) => b.cover.templateId !== 'aurora' || b.cover.background.kind === 'image'),
    finisher: live.some((b) => b.status === 'completed'),
  };
}
