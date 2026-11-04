-- The auth trigger function must not be callable through the REST API (/rest/v1/rpc).
revoke execute on function public.bookly_handle_new_user() from public, anon, authenticated;
-- Covering index for the composite foreign key chapters(book_id, user_id) -> books(id, user_id).
create index if not exists chapters_book_user_idx on public.chapters (book_id, user_id);
