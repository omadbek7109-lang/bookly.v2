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
- [x] 9. Tests: unit 23/23 (10 cloud), e2e flows 13/13 + cloud 7/7 (360/390/430), SQL RLS 29/29. Live HTTP check `npm run test:live` in CI job `live-supabase` (needs 4 secrets).
- [x] 10. Pushed; CI 704ddf8: unit, build, e2e, deploy to gh-pages all green; Pages serves gh-pages.

## Telegram Mini App sign-in (2026-11-06)
- [x] `profiles.telegram_id` (unique) + column-level lock (users cannot set telegram_id) — verified by SQL test.
- [x] Edge Function `telegram-auth` (verify_jwt off; HMAC-SHA256 initData check with TELEGRAM_BOT_TOKEN secret,
      24 h freshness, find/create user, session via one-time magic-link token redeemed server-side).
- [x] Client: auto sign-in inside Telegram, "Telegram orqali kirish" button, launch hash cleaned, Telegram script loaded only in Telegram.
- [x] Tests: unit verify (matches Telegram reference algorithm, rejects tampering/expired), e2e Telegram flow, CI `telegram-check`.

## Telegram fixes + bot (2026-11-06, later)
- [x] Root cause of "Serverda xatolik": service_role had no table grants (42501) → migration `20261106133000_bookly_service_role_grants.sql`.
- [x] telegram-auth v2: verifyOtp('email') with 'magiclink' fallback; returns a short `detail` code shown in the toast.
- [x] Edge Function `telegram-bot`: webhook (secret = HMAC(bot token)), /start + /help with "Bookly'ni ochish" Mini App button,
      chat menu button, commands, descriptions (`?action=setup`, run by CI `telegram-check`), and `?action=send`
      (multipart, initData-verified) → Bot API sendDocument to the user's own chat; asks requestWriteAccess if needed.
- [x] Export: after generating, choose "Yuklab olish" or "Telegram'ga yuborish" (outside Telegram: download + Share).
- [x] Profile inside Telegram: Telegram sign-in primary with visible errors, email optional.
- [x] Editor chapter titles wrap; sheet footers wrap; Uzbek Cyrillic → Latin in PDF (х → x).

## Open items (owner action)
- Supabase → Authentication → URL Configuration: Site URL + Redirect URL = https://omadbek7109-lang.github.io/bookly.v2/
- Custom SMTP for production sign-up/reset emails (built-in mailer is rate limited).
- Add 4 GitHub secrets BOOKLY_TEST_EMAIL_A/B, BOOKLY_TEST_PASSWORD_A/B to run the live HTTP check.
- Not yet built: syncing user_settings and profile avatar to the cloud; stale chapter-row cleanup; ru/en texts for cloud screens.

## Notes
- The SQL tool asks for confirmation on statements containing `DELETE`; that prompt is auto-cancelled
  in this session, so migrations avoid deletes (stale chapters are hidden via `books.chapter_ids`).
- Sandbox cannot reach *.supabase.co over HTTPS; server behaviour is tested through SQL as the real roles.

## Profile & editor UX redesign (2026-11-07)
- [x] Book layout `metadata.layout`: 'chapters' (default, all old books) | 'single' (one continuous text). No migration of old data.
      Exporters (PDF/EPUB/DOCX/PPTX) and reader add no chapter labels/titles/TOC for single-text books. Switching
      chapters → single merges chapters with their titles kept as headings (confirmed, nothing deleted).
- [x] New book sheet: title + two mode cards ("Boblar bilan" / "Bitta yaxlit matn").
- [x] Editor: toolbar B · I · U · "Qo'shish" · "AI yordamchi"; "+" menu Sarlavha / Kichik sarlavha / Oddiy matn / Iqtibos / Rasm
      (+ "Boshqa bloklar"); block menu only on the active block; placeholder "Matningizni shu yerga yozing..."; smaller text on
      phones; caret kept above the toolbar/keyboard; focus fixes (new/converted blocks, sheet focus return);
      save status Saqlanmoqda / Saqlandi / Saqlashda xatolik (auto-retry + tap to retry).
- [x] AI yordamchi: 8 tasks, answer never auto-inserted (Matnga qo'shish / Eski matnni almashtirish / Qayta urinish / Nusxalash).
      Edge Function `ai-assist` (Anthropic API key only as secret ANTHROPIC_API_KEY; per-user daily limit via
      `public.ai_usage` + `bookly_ai_take`, migration 20261107090000). Without the key the editor hides the AI button.
- [x] Profile: card (photo, name, account status, edit sheet), 2 stats, language/theme/reduced motion (explained),
      compact export defaults, "Zaxiralash" (cloud + file backup/restore + storage), delete-all needs typing O'CHIRISH,
      About / Privacy / Help / Version. "Replay intro" removed.
- [x] Tests: unit 30/30, e2e 24/24 (incl. new: two modes at 360px, AI hidden/demo/server, profile at 360px).
- [ ] Owner action: add Edge Function secret ANTHROPIC_API_KEY to turn the AI yordamchi on (optional BOOKLY_AI_MODEL, BOOKLY_AI_DAILY_LIMIT).

## Phase 3 — languages, export quality, stability (2026-11-07)
- [x] i18n: all interface text in src/i18n/{uz,ru,en}.ts (797 keys each; ru/en typed as complete `Record<MessageKey,string>`).
      Services translate through `tr()` (current UI language). Plural forms for ru/en (`{n|глава|главы|глав}`).
      Unit test: same keys + placeholders, no script mixing. E2E: every screen/dialog in ru/en/uz at 360 px.
- [x] PDF: real Unicode text. Embedded fonts Bookly Serif/Sans/Mono (renamed Liberation subsets, OFL, public/fonts,
      built by scripts/build-fonts.py) + own TrueType reader/subsetter (src/services/export/ttf.ts) for pdf-lib.
      Uzbek Cyrillic books get Cyrillic labels (1-боб, Мундарижа). Falls back to standard fonts only if fonts fail to load.
- [x] Export matrix test: PDF/EPUB/DOCX/PPTX × chapters/single × uz-Latn/uz-Cyrl/ru/en, reopened and text verified.
- [x] Mobile: toasts move to the top while a dialog is open; dialogs rise above the on-screen keyboard (global --kb).
- [x] New books and default chapter names follow the chosen language.
- [x] RLS re-checked: every public table owner-only; cross-user read = 0 rows; users cannot write ai_usage.
