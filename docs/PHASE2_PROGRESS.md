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
- [ ] 5. Auth client (signup, login, logout, password reset, session refresh) — zero-dependency fetch client.
- [ ] 6. Cloud backup & sync engine (revision-based conflicts, user choice, offline retry, never deletes local).
- [ ] 7. Storage: sha256 dedupe upload/download, size/type checks, orphan cleanup action.
- [ ] 8. UI in Profile: Account, Cloud Backup, Sync status, Last backup, Storage usage, Backup now, Restore, Logout, conflict sheet.
- [ ] 9. Tests (unit sync logic, e2e with mock server; live checks in CI) at 360/390/430.
- [ ] 10. Commit, push, deploy, final report.

## Notes
- The SQL tool asks for confirmation on statements containing `DELETE`; that prompt is auto-cancelled
  in this session, so migrations avoid deletes (stale chapters are hidden via `books.chapter_ids`).
- Sandbox cannot reach *.supabase.co over HTTPS; server behaviour is tested through SQL as the real roles.
