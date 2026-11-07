-- "Barcha ma'lumotlarni o'chirish": server-verified deletion of a user's books (NOT the account).
-- A 4-digit code is generated in the Edge Function `wipe-books` (crypto-secure), stored here only as an
-- HMAC hash, bound to the user and one request, valid for 5 minutes, max 5 wrong attempts, single use.
-- Additive and idempotent: no existing data is touched by this migration.

create table if not exists public.book_wipe_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  status text not null default 'pending' check (status in ('pending', 'used', 'locked', 'expired', 'superseded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create unique index if not exists book_wipe_requests_one_pending on public.book_wipe_requests (user_id) where status = 'pending';
create index if not exists book_wipe_requests_user_idx on public.book_wipe_requests (user_id, created_at desc);

-- Only the Edge Function (service_role) works with this table; users have no direct access at all.
alter table public.book_wipe_requests enable row level security;
revoke all on public.book_wipe_requests from anon, authenticated;
grant select, insert, update on public.book_wipe_requests to service_role;

-- Starts a new deletion session: any earlier pending one for this user is superseded (no parallel sessions).
create or replace function public.bookly_wipe_start(p_user uuid, p_request uuid, p_code_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  exp timestamptz := now() + interval '5 minutes';
begin
  -- rate limit: at most 10 sessions per user per hour
  if (select count(*) from public.book_wipe_requests r where r.user_id = p_user and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  update public.book_wipe_requests r set status = 'superseded' where r.user_id = p_user and r.status = 'pending';
  insert into public.book_wipe_requests (id, user_id, code_hash, expires_at) values (p_request, p_user, p_code_hash, exp);
  return exp;
end;
$$;

-- Verifies the code and, only on success, deletes the user's books, chapters and asset records in the same
-- transaction. Returns the storage paths of the user's files so the Edge Function can remove the objects.
-- The request row is locked (FOR UPDATE), so two concurrent confirmations cannot both succeed.
create or replace function public.bookly_wipe_confirm(p_user uuid, p_request uuid, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.book_wipe_requests%rowtype;
  n_books integer;
  n_chapters integer;
  paths text[];
begin
  select * into req from public.book_wipe_requests r where r.id = p_request and r.user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if req.status <> 'pending' then return jsonb_build_object('status', case when req.status = 'locked' then 'locked' else 'invalid' end); end if;
  if req.expires_at < now() then
    update public.book_wipe_requests set status = 'expired' where id = req.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if req.code_hash <> p_code_hash then
    update public.book_wipe_requests set attempts = attempts + 1, status = case when attempts + 1 >= 5 then 'locked' else status end
      where id = req.id;
    return jsonb_build_object('status', case when req.attempts + 1 >= 5 then 'locked' else 'wrong' end, 'attempts_left', greatest(0, 4 - req.attempts));
  end if;

  update public.book_wipe_requests set status = 'used', used_at = now() where id = req.id;
  select coalesce(array_agg(a.storage_path), '{}') into paths from public.book_assets a where a.user_id = p_user;
  delete from public.chapters c where c.user_id = p_user;
  get diagnostics n_chapters = row_count;
  delete from public.book_assets a where a.user_id = p_user;
  delete from public.books b where b.user_id = p_user;
  get diagnostics n_books = row_count;
  return jsonb_build_object('status', 'ok', 'books', n_books, 'chapters', n_chapters, 'paths', to_jsonb(paths));
end;
$$;

revoke all on function public.bookly_wipe_start(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bookly_wipe_confirm(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bookly_wipe_start(uuid, uuid, text) to service_role;
grant execute on function public.bookly_wipe_confirm(uuid, uuid, text) to service_role;
