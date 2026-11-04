-- Bookly sync RPCs. SECURITY INVOKER: every statement runs as the signed-in user, so RLS applies.

-- The book row keeps the authoritative chapter order. Chapter rows whose local_id is not listed
-- are stale (removed on a device); they are ignored when reading and cleaned up by the client.
alter table public.books add column if not exists chapter_ids text[] not null default '{}';

-- Saves a whole book (book row + ordered chapters) in one transaction with optimistic concurrency.
--   p_base_revision: the cloud revision this device last synced (null = never synced).
--   p_force: true when the user explicitly chose "keep this device's version" in a conflict.
-- Returns {status: 'ok', revision, updated_at} or {status: 'conflict', revision, updated_at, content_hash, device_id}.
create or replace function public.bookly_push_book(p_book jsonb, p_chapters jsonb, p_base_revision bigint default null, p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_local text := p_book ->> 'local_id';
  cur public.books;
  saved public.books;
  ch jsonb;
  pos int := 0;
  keep text[] := '{}';
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_local is null or jsonb_typeof(p_chapters) <> 'array' then raise exception 'invalid payload' using errcode = '22023'; end if;

  -- (computed first: SELECT INTO resets FOUND, which is checked right after the books lookup)
  select coalesce(array_agg(e ->> 'local_id' order by ord), '{}') into keep
  from jsonb_array_elements(p_chapters) with ordinality as x(e, ord);

  select * into cur from public.books where user_id = uid and local_id = v_local for update;

  if found and not p_force and cur.revision is distinct from p_base_revision then
    return jsonb_build_object('status', 'conflict', 'revision', cur.revision, 'updated_at', cur.updated_at,
      'content_hash', cur.content_hash, 'device_id', cur.device_id, 'deleted_at', cur.deleted_at);
  end if;

  if found then
    update public.books set
      schema_version = coalesce((p_book ->> 'schema_version')::int, 1),
      title = coalesce(p_book ->> 'title', ''), subtitle = coalesce(p_book ->> 'subtitle', ''),
      author = coalesce(p_book ->> 'author', ''), description = coalesce(p_book ->> 'description', ''),
      language = coalesce(p_book ->> 'language', 'uz'), category = coalesce(p_book ->> 'category', 'other'),
      status = coalesce(p_book ->> 'status', 'draft'), favorite = coalesce((p_book ->> 'favorite')::boolean, false),
      cover = coalesce(p_book -> 'cover', '{}'), theme = coalesce(p_book -> 'theme', '{}'),
      metadata = coalesce(p_book -> 'metadata', '{}'), reading = coalesce(p_book -> 'reading', '{}'),
      chapter_ids = keep, chapter_count = jsonb_array_length(p_chapters), word_count = coalesce((p_book ->> 'word_count')::int, 0),
      content_hash = coalesce(p_book ->> 'content_hash', ''), device_id = coalesce(p_book ->> 'device_id', ''),
      client_created_at = (p_book ->> 'client_created_at')::timestamptz,
      client_updated_at = (p_book ->> 'client_updated_at')::timestamptz,
      deleted_at = (p_book ->> 'deleted_at')::timestamptz
    where id = cur.id
    returning * into saved;
  else
    insert into public.books (user_id, local_id, schema_version, title, subtitle, author, description, language, category,
      status, favorite, cover, theme, metadata, reading, chapter_ids, chapter_count, word_count, content_hash, device_id,
      client_created_at, client_updated_at, deleted_at)
    values (uid, v_local, coalesce((p_book ->> 'schema_version')::int, 1), coalesce(p_book ->> 'title', ''),
      coalesce(p_book ->> 'subtitle', ''), coalesce(p_book ->> 'author', ''), coalesce(p_book ->> 'description', ''),
      coalesce(p_book ->> 'language', 'uz'), coalesce(p_book ->> 'category', 'other'), coalesce(p_book ->> 'status', 'draft'),
      coalesce((p_book ->> 'favorite')::boolean, false), coalesce(p_book -> 'cover', '{}'), coalesce(p_book -> 'theme', '{}'),
      coalesce(p_book -> 'metadata', '{}'), coalesce(p_book -> 'reading', '{}'), keep, jsonb_array_length(p_chapters),
      coalesce((p_book ->> 'word_count')::int, 0), coalesce(p_book ->> 'content_hash', ''), coalesce(p_book ->> 'device_id', ''),
      (p_book ->> 'client_created_at')::timestamptz, (p_book ->> 'client_updated_at')::timestamptz, (p_book ->> 'deleted_at')::timestamptz)
    returning * into saved;
  end if;

  for ch in select * from jsonb_array_elements(p_chapters) loop
    insert into public.chapters (user_id, book_id, local_id, position, title, blocks, client_created_at, client_updated_at)
    values (uid, saved.id, ch ->> 'local_id', pos, coalesce(ch ->> 'title', ''), coalesce(ch -> 'blocks', '[]'),
      (ch ->> 'client_created_at')::timestamptz, (ch ->> 'client_updated_at')::timestamptz)
    on conflict (book_id, local_id) do update set position = excluded.position, title = excluded.title,
      blocks = excluded.blocks, client_created_at = excluded.client_created_at, client_updated_at = excluded.client_updated_at;
    pos := pos + 1;
  end loop;

  return jsonb_build_object('status', 'ok', 'revision', saved.revision, 'updated_at', saved.updated_at);
end $$;

-- Returns one cloud book with its ordered chapters, shaped for the app.
create or replace function public.bookly_pull_book(p_local_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(b) || jsonb_build_object('chapters', coalesce((
      select jsonb_agg(jsonb_build_object('local_id', c.local_id, 'title', c.title, 'blocks', c.blocks,
        'client_created_at', c.client_created_at, 'client_updated_at', c.client_updated_at) order by c.position)
      from public.chapters c where c.book_id = b.id and c.user_id = b.user_id and c.local_id = any (b.chapter_ids)), '[]'::jsonb))
  from public.books b
  where b.user_id = (select auth.uid()) and b.local_id = p_local_id;
$$;

-- Assets no cloud book references any more (cover image, image/audio blocks). Used by the
-- "free up cloud space" action; the client removes them only after the user confirms.
create or replace function public.bookly_orphan_assets()
returns setof public.book_assets language sql stable security invoker set search_path = '' as $$
  with refs as (
    select b.cover #>> '{background,imageAssetId}' as ref from public.books b where b.user_id = (select auth.uid())
    union
    select blk ->> 'assetId' from public.books b
      join public.chapters c on c.book_id = b.id and c.user_id = b.user_id and c.local_id = any (b.chapter_ids),
      jsonb_array_elements(c.blocks) blk
    where b.user_id = (select auth.uid()) and blk ? 'assetId'
  )
  select a.* from public.book_assets a
  where a.user_id = (select auth.uid()) and not exists (select 1 from refs where refs.ref = a.local_id);
$$;

grant execute on function public.bookly_push_book(jsonb, jsonb, bigint, boolean) to authenticated;
grant execute on function public.bookly_pull_book(text) to authenticated;
grant execute on function public.bookly_orphan_assets() to authenticated;
revoke execute on function public.bookly_push_book(jsonb, jsonb, bigint, boolean) from public, anon;
revoke execute on function public.bookly_pull_book(text) from public, anon;
revoke execute on function public.bookly_orphan_assets() from public, anon;
revoke execute on function public.bookly_cloud_usage() from public, anon;
