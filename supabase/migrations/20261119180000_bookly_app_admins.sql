-- Admins kept in the database (in addition to the optional Edge Function secret BOOKLY_ADMIN_IDS), plus
-- admin-only book overviews. Additive and idempotent. Book TEXT is never exposed — only metadata.

create table if not exists public.app_admins (
  telegram_id bigint primary key,
  note text check (note is null or char_length(note) <= 64),
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant select on public.app_admins to service_role;

insert into public.app_admins (telegram_id, note) values (7550418397, 'owner') on conflict (telegram_id) do nothing;

-- All books (newest activity first), with the owner. Metadata only.
create or replace function public.bookly_admin_books(p_search text default '', p_user uuid default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, user_id uuid, owner_name text, owner_telegram text, title text, author text, category text, language text,
               status text, chapter_count integer, word_count integer, deleted boolean,
               created_at timestamptz, updated_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select b.id, b.user_id, coalesce(p.display_name, u.email::text), p.telegram_username, b.title, b.author, b.category, b.language,
         b.status, b.chapter_count, b.word_count, b.deleted_at is not null,
         b.created_at, b.updated_at
  from public.books b
  join auth.users u on u.id = b.user_id
  left join public.profiles p on p.id = b.user_id
  where (p_user is null or b.user_id = p_user)
    and (coalesce(p_search, '') = '' or b.title ilike '%' || p_search || '%' or b.author ilike '%' || p_search || '%'
         or p.display_name ilike '%' || p_search || '%' or p.telegram_username ilike '%' || p_search || '%')
  order by b.updated_at desc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
$$;
revoke all on function public.bookly_admin_books(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.bookly_admin_books(text, uuid, integer, integer) to service_role;
