-- Per-user daily counter for the AI writing assistant (Edge Function `ai-assist`).
-- Additive and idempotent; no existing data is touched.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  requests integer not null default 0 check (requests >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_usage' and policyname = 'ai_usage: owner can read') then
    create policy "ai_usage: owner can read" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
grant select, insert, update on public.ai_usage to service_role;

-- Atomically takes one request from today's allowance. Returns false when the limit is reached.
create or replace function public.bookly_ai_take(p_user uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  insert into public.ai_usage as u (user_id, day, requests)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set requests = u.requests + 1
    where u.requests < p_limit
  returning requests into used;
  return used is not null;
end;
$$;
revoke all on function public.bookly_ai_take(uuid, integer) from public, anon, authenticated;
grant execute on function public.bookly_ai_take(uuid, integer) to service_role;
