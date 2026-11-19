-- Bookly admin panel: bot subscribers, broadcasts (text / photo / button), in-app announcements,
-- user feedback, light usage events and an audit log of every admin action.
-- Additive and idempotent: creates new tables and functions only; no existing row is changed or removed.
-- Admins are configured outside the database (Edge Function secret BOOKLY_ADMIN_IDS = Telegram user ids).

-- ------------------------------------------------------------------ people who started the bot
create table if not exists public.bot_subscribers (
  telegram_id bigint primary key,
  first_name text not null default '' check (char_length(first_name) <= 128),
  username text check (username is null or char_length(username) <= 64),
  language_code text check (language_code is null or char_length(language_code) <= 16),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  blocked boolean not null default false,          -- the user blocked the bot (sending fails with 403)
  blocked_at timestamptz
);
create index if not exists bot_subscribers_active_idx on public.bot_subscribers (telegram_id) where not blocked;

-- ------------------------------------------------------------------ broadcasts
create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  admin_telegram_id bigint not null,
  text text not null default '' check (char_length(text) <= 4096),
  photo_file_id text check (photo_file_id is null or char_length(photo_file_id) <= 256),
  button_text text check (button_text is null or char_length(button_text) <= 64),
  button_url text check (button_url is null or char_length(button_url) <= 512),
  open_app_button boolean not null default true,
  status text not null default 'sending' check (status in ('sending', 'paused', 'done', 'cancelled', 'failed')),
  total integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  blocked integer not null default 0,
  cursor bigint not null default 0,                -- last telegram_id handled (subscribers are walked in id order)
  lease_until timestamptz,                         -- one worker at a time: a worker owns the broadcast until then
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists broadcasts_created_idx on public.broadcasts (created_at desc);

-- ------------------------------------------------------------------ in-app announcement banner
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 500),
  link_url text check (link_url is null or char_length(link_url) <= 512),
  tone text not null default 'info' check (tone in ('info', 'success', 'warning')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists announcements_active_idx on public.announcements (created_at desc) where active;

-- ------------------------------------------------------------------ feedback from users
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  telegram_id bigint,
  name text not null default '' check (char_length(name) <= 128),
  message text not null check (char_length(message) between 1 and 2000),
  app_version text check (app_version is null or char_length(app_version) <= 32),
  status text not null default 'new' check (status in ('new', 'read', 'answered')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

-- ------------------------------------------------------------------ light usage events (no content)
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('open', 'book_created', 'export', 'telegram_send')),
  detail text check (detail is null or char_length(detail) <= 32),   -- e.g. export format
  created_at timestamptz not null default now()
);
create index if not exists app_events_created_idx on public.app_events (created_at desc);
create index if not exists app_events_kind_idx on public.app_events (kind, created_at desc);

-- ------------------------------------------------------------------ audit
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  admin_telegram_id bigint not null,
  action text not null check (char_length(action) <= 64),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

-- ------------------------------------------------------------------ access
-- Everything is reached through the `admin` / `telegram-bot` Edge Functions (service_role).
-- The only direct client access: anyone may READ active announcements; signed-in users may log their
-- own usage events through bookly_log_event (rate limited).
alter table public.bot_subscribers enable row level security;
alter table public.broadcasts enable row level security;
alter table public.announcements enable row level security;
alter table public.feedback enable row level security;
alter table public.app_events enable row level security;
alter table public.admin_audit enable row level security;

revoke all on public.bot_subscribers, public.broadcasts, public.announcements, public.feedback, public.app_events, public.admin_audit from anon, authenticated;
grant select, insert, update on public.bot_subscribers, public.broadcasts, public.announcements, public.feedback to service_role;
grant select, insert on public.app_events, public.admin_audit to service_role;
grant select on public.announcements to anon, authenticated;

drop policy if exists announcements_read_active on public.announcements;
create policy announcements_read_active on public.announcements for select to anon, authenticated
  using (active and (expires_at is null or expires_at > now()));

-- Usage event from the app (the user's own session). At most 60 events per user per hour.
create or replace function public.bookly_log_event(p_kind text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if p_kind not in ('open', 'book_created', 'export', 'telegram_send') then return; end if;
  if (select count(*) from public.app_events e where e.user_id = uid and e.created_at > now() - interval '1 hour') >= 60 then return; end if;
  insert into public.app_events (user_id, kind, detail) values (uid, p_kind, left(p_detail, 32));
end $$;
revoke all on function public.bookly_log_event(text, text) from public, anon;
grant execute on function public.bookly_log_event(text, text) to authenticated;

-- Dashboard numbers in one call (service_role only).
create or replace function public.bookly_admin_stats(p_days integer default 14)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with days as (
    select generate_series((now() at time zone 'utc')::date - (greatest(1, least(p_days, 90)) - 1), (now() at time zone 'utc')::date, interval '1 day')::date as d
  )
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'users_telegram', (select count(*) from public.profiles p where p.telegram_id is not null),
    'users_new_7d', (select count(*) from auth.users u where u.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct e.user_id) from public.app_events e where e.created_at > now() - interval '7 days'),
    'books', (select count(*) from public.books),
    'chapters', (select count(*) from public.chapters),
    'books_new_7d', (select count(*) from public.books b where b.created_at > now() - interval '7 days'),
    'storage_bytes', (select coalesce(sum(a.size_bytes), 0) from public.book_assets a),
    'subscribers', (select count(*) from public.bot_subscribers),
    'subscribers_active', (select count(*) from public.bot_subscribers s where not s.blocked),
    'exports_7d', (select count(*) from public.app_events e where e.kind = 'export' and e.created_at > now() - interval '7 days'),
    'exports_by_format', (select coalesce(jsonb_object_agg(x.detail, x.n), '{}'::jsonb) from (
        select coalesce(e.detail, '?') as detail, count(*) as n from public.app_events e
        where e.kind = 'export' and e.created_at > now() - interval '30 days' group by 1) x),
    'feedback_new', (select count(*) from public.feedback f where f.status = 'new'),
    'daily', (select jsonb_agg(jsonb_build_object(
        'day', d.d,
        'users', (select count(*) from auth.users u where (u.created_at at time zone 'utc')::date = d.d),
        'books', (select count(*) from public.books b where (b.created_at at time zone 'utc')::date = d.d),
        'active', (select count(distinct e.user_id) from public.app_events e where (e.created_at at time zone 'utc')::date = d.d),
        'subscribers', (select count(*) from public.bot_subscribers s where (s.started_at at time zone 'utc')::date = d.d)
      ) order by d.d) from days d)
  );
$$;
revoke all on function public.bookly_admin_stats(integer) from public, anon, authenticated;
grant execute on function public.bookly_admin_stats(integer) to service_role;

-- User list for the admin (service_role only): newest first, optional search by name / username / email.
create or replace function public.bookly_admin_users(p_search text default '', p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, email text, display_name text, telegram_id bigint, telegram_username text, created_at timestamptz,
               last_sign_in_at timestamptz, books bigint, last_book_at timestamptz, subscribed boolean, blocked boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select u.id, u.email::text, p.display_name, p.telegram_id, p.telegram_username, u.created_at, u.last_sign_in_at,
         (select count(*) from public.books b where b.user_id = u.id),
         (select max(b.updated_at) from public.books b where b.user_id = u.id),
         s.telegram_id is not null, coalesce(s.blocked, false)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.bot_subscribers s on s.telegram_id = p.telegram_id
  where coalesce(p_search, '') = ''
     or p.display_name ilike '%' || p_search || '%'
     or p.telegram_username ilike '%' || p_search || '%'
     or u.email ilike '%' || p_search || '%'
     or p.telegram_id::text = p_search
  order by u.created_at desc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
$$;
revoke all on function public.bookly_admin_users(text, integer, integer) from public, anon, authenticated;
grant execute on function public.bookly_admin_users(text, integer, integer) to service_role;
