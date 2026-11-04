-- Bookly 2.0 — Phase 2: optional cloud backup & sync.
-- Mirrors the local document model (src/models/book.ts): a book row holds book-level fields,
-- chapters hold ordered `blocks` (jsonb, same shape as the app), assets point to Storage objects.
-- Idempotent: safe to run more than once. Nothing here deletes data.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ helpers
create or replace function public.bookly_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------------ profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  user_id uuid generated always as (id) stored,
  display_name text not null default '' check (char_length(display_name) <= 120),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 512),
  locale text not null default 'uz' check (locale in ('uz', 'ru', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.bookly_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 120), ''))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

-- ------------------------------------------------------------------ books
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id text not null check (char_length(local_id) between 1 and 80),
  schema_version int not null default 1,
  title text not null default '' check (char_length(title) <= 300),
  subtitle text not null default '' check (char_length(subtitle) <= 300),
  author text not null default '' check (char_length(author) <= 200),
  description text not null default '' check (char_length(description) <= 5000),
  language text not null default 'uz' check (language in ('uz', 'ru', 'en')),
  category text not null default 'other' check (char_length(category) <= 40),
  status text not null default 'draft' check (status in ('draft', 'completed')),
  favorite boolean not null default false,
  cover jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  reading jsonb not null default '{}'::jsonb,
  chapter_count int not null default 0,
  word_count int not null default 0,
  content_hash text not null default '',
  revision bigint not null default 1,
  device_id text not null default '' check (char_length(device_id) <= 80),
  client_created_at timestamptz,
  client_updated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint books_user_local_unique unique (user_id, local_id),
  constraint books_id_user_unique unique (id, user_id)
);
create index if not exists books_user_updated_idx on public.books (user_id, updated_at desc);

-- Every update bumps the revision; clients use it for optimistic concurrency (conflict detection).
create or replace function public.bookly_books_bump_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.user_id := old.user_id;            -- ownership can never be transferred
  new.local_id := old.local_id;
  return new;
end $$;

-- ------------------------------------------------------------------ chapters
create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  book_id uuid not null,
  local_id text not null check (char_length(local_id) between 1 and 80),
  position int not null check (position >= 0),
  title text not null default '' check (char_length(title) <= 300),
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  client_created_at timestamptz,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- composite FK: a chapter can only belong to a book of the same owner
  constraint chapters_book_fk foreign key (book_id, user_id) references public.books (id, user_id) on delete cascade,
  constraint chapters_book_local_unique unique (book_id, local_id)
);
create index if not exists chapters_book_position_idx on public.chapters (book_id, position);
create index if not exists chapters_user_idx on public.chapters (user_id);

-- ------------------------------------------------------------------ book_assets (Storage objects)
create table if not exists public.book_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id text not null check (char_length(local_id) between 1 and 80),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null check (char_length(storage_path) <= 512),
  mime text not null check (mime ~ '^(image|audio)/[a-z0-9.+-]+$'),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 15728640),
  name text not null default '' check (char_length(name) <= 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_assets_user_local_unique unique (user_id, local_id)
);
create index if not exists book_assets_user_sha_idx on public.book_assets (user_id, sha256);

-- ------------------------------------------------------------------ user_settings
create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_user_unique unique (user_id)
);

-- ------------------------------------------------------------------ sync_metadata (one row per device)
create table if not exists public.sync_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 80),
  device_name text not null default '' check (char_length(device_name) <= 120),
  last_sync_at timestamptz,
  last_backup_at timestamptz,
  books_synced int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_metadata_user_device_unique unique (user_id, device_id)
);

-- ------------------------------------------------------------------ triggers
do $$
declare t text;
begin
  foreach t in array array['profiles', 'chapters', 'book_assets', 'user_settings', 'sync_metadata'] loop
    if not exists (select 1 from pg_trigger where tgname = 'touch_updated_at' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.bookly_touch_updated_at()', t);
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'bump_revision' and tgrelid = 'public.books'::regclass) then
    create trigger bump_revision before update on public.books for each row execute function public.bookly_books_bump_revision();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'bookly_on_auth_user_created' and tgrelid = 'auth.users'::regclass) then
    create trigger bookly_on_auth_user_created after insert on auth.users for each row execute function public.bookly_handle_new_user();
  end if;
end $$;

-- ------------------------------------------------------------------ privileges
-- Signed-in users only. Policies below are all `to authenticated`, so the anon role matches no
-- policy and RLS denies it every row even though Supabase's default grants exist.
grant select, insert, update, delete on public.books, public.chapters, public.book_assets, public.sync_metadata to authenticated;
grant select, update on public.profiles, public.user_settings to authenticated;

-- ------------------------------------------------------------------ row level security
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.chapters enable row level security;
alter table public.book_assets enable row level security;
alter table public.user_settings enable row level security;
alter table public.sync_metadata enable row level security;

do $$
declare
  t text;
  owner_col text;
  ops text[];
  op text;
  pol text;
begin
  foreach t in array array['profiles', 'books', 'chapters', 'book_assets', 'user_settings', 'sync_metadata'] loop
    owner_col := case when t = 'profiles' then 'id' else 'user_id' end;
    ops := case when t in ('profiles', 'user_settings') then array['select', 'update'] else array['select', 'insert', 'update', 'delete'] end;
    foreach op in array ops loop
      pol := t || '_' || op || '_own';
      continue when exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol);
      if op = 'select' or op = 'delete' then
        execute format('create policy %I on public.%I for %s to authenticated using ((select auth.uid()) = %I)', pol, t, op, owner_col);
      elsif op = 'insert' then
        execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = %I)', pol, t, owner_col);
      else
        execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = %I) with check ((select auth.uid()) = %I)', pol, t, owner_col, owner_col);
      end if;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------------ storage: private bucket, one folder per user
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-assets', 'book-assets', false, 15728640,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  op text;
  pol text;
  own constant text := $q$bucket_id = 'book-assets' and (storage.foldername(name))[1] = (select auth.uid())::text$q$;
begin
  foreach op in array array['select', 'insert', 'update', 'delete'] loop
    pol := 'bookly assets ' || op || ' own';
    continue when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = pol);
    if op in ('select', 'delete') then
      execute format('create policy %I on storage.objects for %s to authenticated using (%s)', pol, op, own);
    elsif op = 'insert' then
      execute format('create policy %I on storage.objects for insert to authenticated with check (%s)', pol, own);
    else
      execute format('create policy %I on storage.objects for update to authenticated using (%s) with check (%s)', pol, own, own);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ usage summary for the Settings screen
create or replace function public.bookly_cloud_usage()
returns table (books int, chapters int, assets int, asset_bytes bigint, last_backup_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select
    (select count(*)::int from public.books b where b.user_id = (select auth.uid()) and b.deleted_at is null),
    (select count(*)::int from public.chapters c where c.user_id = (select auth.uid())),
    (select count(*)::int from public.book_assets a where a.user_id = (select auth.uid())),
    (select coalesce(sum(a.size_bytes), 0)::bigint from public.book_assets a where a.user_id = (select auth.uid())),
    (select max(s.last_backup_at) from public.sync_metadata s where s.user_id = (select auth.uid()));
$$;
grant execute on function public.bookly_cloud_usage() to authenticated;
