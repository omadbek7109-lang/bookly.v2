import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievements, lastDays, streakOf } from '../../src/services/stats/writing';
import { createBlock, createBook, createChapter } from '../../src/models/book';

test('streak counts consecutive goal days ending today, or yesterday while today is still open', () => {
  const days = { '2026-11-15': 400, '2026-11-16': 300, '2026-11-17': 350, '2026-11-18': 310 };
  assert.equal(streakOf(days, 300, '2026-11-18'), 4);
  assert.equal(streakOf(days, 300, '2026-11-19'), 4, 'today not written yet → streak still alive');
  assert.equal(streakOf({ ...days, '2026-11-19': 120 }, 300, '2026-11-19'), 4, 'today below goal does not break it yet');
  assert.equal(streakOf(days, 300, '2026-11-20'), 0, 'a whole missed day breaks it');
  assert.equal(streakOf({ '2026-11-17': 299, '2026-11-18': 500 }, 300, '2026-11-18'), 1, 'below goal does not count');
  assert.equal(streakOf({ '2026-02-28': 300, '2026-03-01': 300 }, 300, '2026-03-01'), 2, 'month boundary');
  assert.equal(streakOf({ '2025-12-31': 300, '2026-01-01': 300 }, 300, '2026-01-01'), 2, 'year boundary');
});

test('last 7 days are consecutive and end today', () => {
  const d = lastDays(7, new Date(2026, 10, 3));
  assert.deepEqual(d, ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
});

test('achievements reflect real progress', () => {
  const none = achievements([], { days: {}, exports: 0, best: 0 }, 300);
  assert.ok(Object.values(none).every((v) => v === false));
  const words = Array.from({ length: 120 }, () => 'so‘z').join(' ');
  const b = createBook({ title: 'A', chapters: [createChapter('1', Array.from({ length: 10 }, () => createBlock('paragraph', { html: words })))] });
  b.status = 'completed';
  const a = achievements([b], { days: {}, exports: 1, best: 3 }, 300);
  assert.equal(a.first_book, true);
  assert.equal(a.words_1k, true);
  assert.equal(a.words_10k, false);
  assert.equal(a.first_export, true);
  assert.equal(a.streak_3, true);
  assert.equal(a.streak_7, false);
  assert.equal(a.finisher, true);
  const trashed = { ...b, deletedAt: Date.now() };
  assert.equal(achievements([trashed], { days: {}, exports: 0, best: 0 }, 300).first_book, false, 'books in the trash do not count');
});
