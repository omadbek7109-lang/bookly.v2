-- Telegram Mini App sign-in: link a Supabase user to a Telegram account.
alter table public.profiles add column if not exists telegram_id bigint;
alter table public.profiles add column if not exists telegram_username text check (telegram_username is null or char_length(telegram_username) <= 64);
create unique index if not exists profiles_telegram_id_unique on public.profiles (telegram_id) where telegram_id is not null;

-- Users may edit only their own display fields; telegram_id/username are written by the
-- telegram-auth Edge Function (service role). Prevents claiming someone else's Telegram id.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_path, locale) on public.profiles to authenticated;
