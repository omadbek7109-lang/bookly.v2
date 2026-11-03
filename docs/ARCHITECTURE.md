# Bookly 2.0 — Architecture & Phase 2 hand-off

## Stack

- **React 19 + TypeScript**, bundled with **esbuild** (`scripts/build.mjs`, `scripts/dev.mjs`).
  Vite was the preferred tool, but the Phase 1 environment could only use pre-installed
  packages; esbuild is the engine Vite itself uses for dev transforms. Migrating to Vite later only
  means adding `vite.config.ts` with the `@` alias and moving `public/index.html` to the root.
- **Code splitting**: every screen except Home is `React.lazy`; each exporter (`pdf-lib`, `docx`,
  `pptxgenjs`, `jszip`) is loaded only when the user exports. Initial JS ≈ 200 kB (≈ 60 kB gzip).
- **Hash router** (`src/app/router.ts`) so the app works on any static host and inside Telegram.
- No CDN dependencies at runtime; fonts use system stacks.

## Unified document model (`src/models/book.ts`)

`Book { schemaVersion, id, title, subtitle, author, description, language, category, cover, theme,
chapters[], metadata, createdAt, updatedAt, status, favorite, deletedAt, lastOpenedAt, reading }`

`Chapter { id, title, blocks[] }` — ordered blocks with stable IDs:
`heading | paragraph | quote | list | image | table | divider | audio | pagebreak`.
Text uses a sanitized inline subset (`<b> <i> <u> <br>`, see `utils/inline.ts`).
Binary assets (images, audio) live separately in the `assets` store and are referenced by `assetId`.

`migrateBook()` upgrades any stored/imported object to the current `SCHEMA_VERSION`, including a
legacy v0 shape (`{ title, chapters: [{ title, content }] }` or `{ title, content }`) intended for
importing **Bookly Mini** data.

Every consumer — editor, reader, cover renderer and all four exporters — reads this one model.

## Storage

| Data | Where | Module |
|---|---|---|
| Books | IndexedDB `bookly/books` | `LocalBookRepository` |
| Images / audio | IndexedDB `bookly/assets` (Blob) | `LocalAssetRepository` |
| Preferences, intro flag, profile name | localStorage `bookly.settings` | `services/storage/settings.ts` |

The UI only depends on the `BookRepository` / `AssetRepository` interfaces and on the
`repoEvents` emitter, so a cloud implementation can be swapped in.

## AI providers (`src/services/ai`)

`TextAIProvider` (outline, chapter, continue, rewrite, expand, summarize, grammar, spelling, tone,
translate, titles, intro, conclusion) and `ImageAIProvider` (cover, illustration). Phase 1 registers
`DemoTextAIProvider` / `DemoImageAIProvider`. All calls accept an `AbortSignal`.
**Phase 2**: implement `RemoteTextAIProvider` that POSTs to a Supabase Edge Function
(`/functions/v1/ai-text`) with the user JWT; the function holds the model API key. Register it with
`setTextProvider()` in `services/ai/index.ts`. No screen changes required.

## Exporters (`src/services/export`)

Pure functions `(ExportInput) → { bytes, mime, filename }`, DOM-free and unit-tested in Node:
- **PDF** — own layout engine on pdf-lib: cover, title page, linked TOC, running headers, page
  numbers, justified text, lists, quotes, images, tables, page breaks, metadata.
- **DOCX** — `docx`: styles, headings, numbering, tables, images, bookmarks + internal links TOC.
- **PPTX** — `pptxgenjs`: cover, contents, section slide per chapter, auto-paginated content, image
  and table slides.
- **EPUB 3** — JSZip: stored `mimetype`, OPF 3 metadata, `nav.xhtml`, NCX fallback, cover-image,
  well-formed XHTML (validated with `xmllint` in tests), images and audio.
`prepare.ts` (browser only) resolves assets from IndexedDB, normalizes images to PNG/JPEG and renders
the cover with the same canvas renderer as the designer.

## Telegram Mini App

`services/platform/telegram.ts` detects `window.Telegram.WebApp`, calls `ready()/expand()`, syncs
header colors and haptics. Layout uses `viewport-fit=cover`, safe-area insets, `100dvh` and a
keyboard-aware toolbar (`--kb`). To enable inside a bot, add
`<script src="https://telegram.org/js/telegram-web-app.js"></script>` to `public/index.html`.

---

## Phase 2 plan (Supabase)

### Auth — Telegram Mini App
1. Client sends `Telegram.WebApp.initData` to Edge Function `tg-auth`.
2. Function verifies the HMAC-SHA256 signature with the **bot token (server secret)** and `auth_date`
   freshness, upserts `profiles`, and returns a Supabase session (custom JWT or `signInWithIdToken`
   flow via an admin-created user keyed by `telegram_id`).
3. Never trust `initDataUnsafe` on the server.

### Proposed schema (separate Supabase project for Bookly)
```sql
profiles   (id uuid pk references auth.users, telegram_id bigint unique, display_name text,
            avatar_path text, locale text default 'uz', created_at timestamptz default now())
books      (id text pk, owner_id uuid not null references profiles(id) on delete cascade,
            schema_version int not null, title text not null, status text, favorite bool,
            deleted_at timestamptz, document jsonb not null,          -- full Book JSON
            updated_at timestamptz not null, created_at timestamptz not null, revision bigint default 1)
book_assets(id text pk, owner_id uuid not null, book_id text references books(id) on delete cascade,
            storage_path text not null, mime text, size int, created_at timestamptz default now())
ai_usage   (id bigserial pk, owner_id uuid, kind text, tokens int, created_at timestamptz default now())
```
RLS on every table: `owner_id = auth.uid()` for select/insert/update/delete.
Storage bucket `book-assets` (private) with path `${auth.uid()}/${asset_id}` and matching policies.

### Sync & migration of existing local data
- Keep IndexedDB as the offline cache; add a `SyncedBookRepository` that writes locally first and
  pushes `document` + `updated_at` + `revision` to Supabase (last-writer-wins per book, with conflict
  copy when revisions diverge).
- First sign-in: upload every local book and asset (the backup format in `storage/backup.ts` is the
  same payload), then mark them synced. Nothing is deleted locally until the upload is confirmed.
- Bookly Mini users: import their old LocalStorage/JSON through `migrateBook()` (v0 → v1).

### Recommended Phase 2 tasks
1. Create a dedicated Supabase project; apply the schema + RLS + storage policies.
2. `tg-auth` Edge Function and client session handling.
3. `ai-text` / `ai-image` Edge Functions + remote providers, rate limits and `ai_usage` logging.
4. `SyncedBookRepository` + first-login migration UI with progress.
5. Unicode font embedding for PDF (`@pdf-lib/fontkit` + Noto Sans/Serif subset).
6. Complete ru/en translations; Telegram script + BackButton integration.
7. Deployment (GitHub Pages or Vercel) and bot Mini App URL.
