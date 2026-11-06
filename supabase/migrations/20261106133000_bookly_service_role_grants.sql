-- Edge Functions (telegram-auth) use the service_role key. On this project service_role had no table
-- privileges, so the function failed with "permission denied for table profiles" (42501).
-- Grants only; idempotent and non-destructive.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles, public.books, public.chapters,
  public.book_assets, public.user_settings, public.sync_metadata to service_role;
grant execute on function public.bookly_cloud_usage(), public.bookly_pull_book(text),
  public.bookly_orphan_assets(), public.bookly_push_book(jsonb, jsonb, bigint, boolean) to service_role;
