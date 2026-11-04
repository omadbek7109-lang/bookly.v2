# Bookly 2.0 — Phase 2 (Supabase) progress log

Supabase project: `lphczkjwrokfzpnlhkei` (eu-central-1). Only this project is touched.
FLECT STARS (`kyqzoamprcmupxvssokj`) and DAMEO (`reymdxmzfgctdhowndye`) are never modified.

## Done
- [x] 1. Repository / data model reviewed (Book → chapters → blocks, assets in IndexedDB).
- [x] 2. Supabase state inspected: empty project (no tables, buckets, functions, users).
- [x] 3. Schema migrations applied (`supabase/migrations/`):
      profiles, books, chapters, book_assets, user_settings, sync_metadata; triggers (updated_at,
      revision bump, owner lock, auto profile on signup); private bucket `book-assets` (15 MB,
      image/audio only); RPCs `bookly_push_book`, `bookly_pull_book`, `bookly_orphan_assets`,
      `bookly_cloud_usage`.
- [x] 4. RLS: 24 policies (own rows only, `to authenticated`); security advisors clean.
      `supabase/tests/rls_test.sql` — 29/29 checks passed (A/B isolation, storage folders,
      conflict detection, anon denied). Test data rolled back. Test users rls-test-a/b@bookly.test exist.

## Next
- [x] 5. Auth client `src/services/cloud/client.ts` (signup, login, logout, reset, update password, refresh, email-link tokens).
- [x] 6. Sync engine `src/services/cloud/sync.ts` + pure rules `sync-core.ts` (revision conflicts, device/cloud/both choice, offline retry, never deletes local). Unit tests `tests/unit/cloud.test.ts` (10) against `tests/fake-supabase.mjs`.
- [x] 7. Storage in engine: sha256 dedupe, 15 MB + image/audio check, orphan cleanup (tested).
- [x] 8. UI: Profile → AccountCard; `#/cloud` page (status, last backup/sync, usage, backup now, restore, per-book upload/restore/remove, conflict sheet, orphan cleanup, logout); auth sheet (login/signup/forgot), new-password sheet, one-time backup prompt; pages prefetched for offline use.
- [ ] 9. Tests (unit sync logic, e2e with mock server; live checks in CI) at 360/390/430.
- [ ] 10. Commit, push, deploy, final report.

## Notes
- The SQL tool asks for confirmation on statements containing `DELETE`; that prompt is auto-cancelled
  in this session, so migrations avoid deletes (stale chapters are hidden via `books.chapter_ids`).
- Sandbox cannot reach *.supabase.co over HTTPS; server behaviour is tested through SQL as the real roles.
