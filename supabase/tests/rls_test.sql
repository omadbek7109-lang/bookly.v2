-- RLS / Storage / sync-RPC security test for Bookly.
-- Runs as the real `authenticated` and `anon` roles against two test users (rls-test-a/b@bookly.test);
-- every test write is rolled back. Paste into the Supabase SQL editor and run. Expected: all pass = true.
do $outer$
declare
  a uuid := (select id from auth.users where email = 'rls-test-a@bookly.test');
  b uuid := (select id from auth.users where email = 'rls-test-b@bookly.test');
  r jsonb; c int; t text;
  res jsonb := '[]';
  book jsonb := '{"local_id":"book_rlstest1","title":"A kitobi","schema_version":1,"cover":{"background":{"imageAssetId":"ast_a1"}}}';
  chs jsonb := '[{"local_id":"ch_1","title":"Bir","blocks":[{"id":"b1","type":"paragraph","html":"salom"}]},{"local_id":"ch_2","title":"Ikki","blocks":[{"id":"b2","type":"image","assetId":"ast_a2"}]}]';
begin
  begin
    -- ===== user A
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    r := public.bookly_push_book(book, chs, null, false);
    res := res || jsonb_build_array(jsonb_build_object('test', 'A creates book via RPC', 'pass', coalesce(r->>'status' = 'ok' and (r->>'revision')::int = 1, false), 'detail', r::text));
    r := public.bookly_push_book(book || '{"title":"A kitobi v2"}', chs, 1, false);
    res := res || jsonb_build_array(jsonb_build_object('test', 'A updates with correct base revision', 'pass', coalesce(r->>'status' = 'ok' and (r->>'revision')::int = 2, false), 'detail', r::text));
    r := public.bookly_push_book(book || '{"title":"eski qurilma"}', chs, 1, false);
    res := res || jsonb_build_array(jsonb_build_object('test', 'stale base revision returns conflict (no write)', 'pass', coalesce(r->>'status' = 'conflict' and (r->>'revision')::int = 2, false), 'detail', r::text));
    select title into t from public.books where local_id = 'book_rlstest1';
    res := res || jsonb_build_array(jsonb_build_object('test', 'conflict did not overwrite cloud copy', 'pass', coalesce(t = 'A kitobi v2', false), 'detail', t));
    r := public.bookly_push_book(book || '{"title":"bir bob"}', jsonb_build_array(chs -> 0), 2, false);
    r := public.bookly_pull_book('book_rlstest1');
    res := res || jsonb_build_array(jsonb_build_object('test', 'chapter removed on device is hidden on pull', 'pass', coalesce(jsonb_array_length(r->'chapters') = 1 and r->>'title' = 'bir bob', false), 'detail', jsonb_array_length(r->'chapters')::text));
    r := public.bookly_push_book(book, chs, 1, true);
    res := res || jsonb_build_array(jsonb_build_object('test', 'forced push (user chose this device) succeeds', 'pass', coalesce(r->>'status' = 'ok', false), 'detail', r::text));
    r := public.bookly_pull_book('book_rlstest1');
    res := res || jsonb_build_array(jsonb_build_object('test', 'pull returns chapters in order', 'pass', coalesce(r->'chapters'->0->>'local_id' = 'ch_1' and r->'chapters'->1->>'local_id' = 'ch_2', false), 'detail', (r->'chapters')::text));
    update public.books set user_id = b where local_id = 'book_rlstest1';
    select count(*) into c from public.books where local_id = 'book_rlstest1' and user_id = a;
    res := res || jsonb_build_array(jsonb_build_object('test', 'owner cannot hand a book to another user', 'pass', coalesce(c = 1, false), 'detail', c::text));
    insert into public.book_assets (local_id, sha256, storage_path, mime, size_bytes) values ('ast_a1', repeat('a', 64), a || '/' || repeat('a', 64) || '.png', 'image/png', 1000);
    insert into storage.objects (bucket_id, name, owner_id) values ('book-assets', a || '/' || repeat('a', 64) || '.png', a::text);
    res := res || jsonb_build_array(jsonb_build_object('test', 'A writes own asset row + storage object', 'pass', coalesce(true, false), 'detail', ''));
    begin
      insert into storage.objects (bucket_id, name, owner_id) values ('book-assets', b || '/evil.png', a::text);
      res := res || jsonb_build_array(jsonb_build_object('test', 'A cannot write into B''s storage folder', 'pass', coalesce(false, false), 'detail', 'insert succeeded'));
    exception when insufficient_privilege then
      res := res || jsonb_build_array(jsonb_build_object('test', 'A cannot write into B''s storage folder', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    begin
      insert into storage.objects (bucket_id, name, owner_id) values ('book-assets', 'shared/evil.png', a::text);
      res := res || jsonb_build_array(jsonb_build_object('test', 'A cannot write outside own folder', 'pass', coalesce(false, false), 'detail', 'insert succeeded'));
    exception when insufficient_privilege then
      res := res || jsonb_build_array(jsonb_build_object('test', 'A cannot write outside own folder', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    begin
      insert into public.book_assets (local_id, sha256, storage_path, mime, size_bytes) values ('big', repeat('b', 64), a || '/x', 'image/png', 20000000);
      res := res || jsonb_build_array(jsonb_build_object('test', 'asset over 15 MB rejected', 'pass', coalesce(false, false), 'detail', 'insert succeeded'));
    exception when check_violation then
      res := res || jsonb_build_array(jsonb_build_object('test', 'asset over 15 MB rejected', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    begin
      insert into public.book_assets (local_id, sha256, storage_path, mime, size_bytes) values ('exe', repeat('c', 64), a || '/x', 'application/x-msdownload', 10);
      res := res || jsonb_build_array(jsonb_build_object('test', 'non image/audio asset type rejected', 'pass', coalesce(false, false), 'detail', 'insert succeeded'));
    exception when check_violation then
      res := res || jsonb_build_array(jsonb_build_object('test', 'non image/audio asset type rejected', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    select count(*) into c from public.bookly_orphan_assets();
    res := res || jsonb_build_array(jsonb_build_object('test', 'referenced cover asset is not an orphan', 'pass', coalesce(c = 0, false), 'detail', c::text));
    select books into c from public.bookly_cloud_usage();
    res := res || jsonb_build_array(jsonb_build_object('test', 'usage summary counts own books', 'pass', coalesce(c = 1, false), 'detail', c::text));

    -- ===== user B
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    select count(*) into c from public.books;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B sees none of A''s books', 'pass', coalesce(c = 0, false), 'detail', c::text));
    select count(*) into c from public.chapters;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B sees none of A''s chapters', 'pass', coalesce(c = 0, false), 'detail', c::text));
    select count(*) into c from public.book_assets;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B sees none of A''s asset rows', 'pass', coalesce(c = 0, false), 'detail', c::text));
    select count(*) into c from storage.objects where bucket_id = 'book-assets';
    res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot list A''s storage files', 'pass', coalesce(c = 0, false), 'detail', c::text));
    select count(*) into c from public.profiles;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B sees only own profile', 'pass', coalesce(c = 1, false), 'detail', c::text));
    r := public.bookly_pull_book('book_rlstest1');
    res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot pull A''s book by id', 'pass', coalesce(r is null, false), 'detail', coalesce(r::text, 'null')));
    update public.books set title = 'hacked' where user_id = a;
    get diagnostics c = row_count;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot update A''s books', 'pass', coalesce(c = 0, false), 'detail', c::text));
    update public.profiles set display_name = 'hacked' where id = a;
    get diagnostics c = row_count;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot update A''s profile', 'pass', coalesce(c = 0, false), 'detail', c::text));
    update storage.objects set name = b || '/stolen.png' where bucket_id = 'book-assets';
    get diagnostics c = row_count;
    res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot move A''s storage files', 'pass', coalesce(c = 0, false), 'detail', c::text));
    begin
      insert into public.books (user_id, local_id, title) values (a, 'planted', 'x');
      res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot insert a book owned by A', 'pass', coalesce(false, false), 'detail', 'insert succeeded'));
    exception when insufficient_privilege then
      res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot insert a book owned by A', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    r := public.bookly_push_book(book || '{"title":"B kitobi"}', chs, null, false);
    res := res || jsonb_build_array(jsonb_build_object('test', 'same local id for B creates B''s own separate book', 'pass', coalesce(r->>'status' = 'ok' and (r->>'revision')::int = 1, false), 'detail', r::text));
    begin
      insert into public.chapters (user_id, book_id, local_id, position)
      values (b, (select id from public.books where local_id = 'book_rlstest1' and user_id = a), 'x', 0);
      res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot attach a chapter to A''s book', 'pass', coalesce(false, false), 'detail', 'insert succeeded'));
    exception when foreign_key_violation or insufficient_privilege or not_null_violation then
      res := res || jsonb_build_array(jsonb_build_object('test', 'B cannot attach a chapter to A''s book', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;

    -- ===== anonymous
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin
      select count(*) into c from public.books;
      res := res || jsonb_build_array(jsonb_build_object('test', 'anon reads zero books', 'pass', coalesce(c = 0, false), 'detail', c::text));
    exception when insufficient_privilege then
      res := res || jsonb_build_array(jsonb_build_object('test', 'anon reads zero books', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    begin
      r := public.bookly_pull_book('book_rlstest1');
      res := res || jsonb_build_array(jsonb_build_object('test', 'anon cannot call sync RPC', 'pass', coalesce(false, false), 'detail', coalesce(r::text, 'null')));
    exception when insufficient_privilege then
      res := res || jsonb_build_array(jsonb_build_object('test', 'anon cannot call sync RPC', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    begin
      select count(*) into c from storage.objects;
      res := res || jsonb_build_array(jsonb_build_object('test', 'anon lists zero storage objects', 'pass', coalesce(c = 0, false), 'detail', c::text));
    exception when insufficient_privilege then
      res := res || jsonb_build_array(jsonb_build_object('test', 'anon lists zero storage objects', 'pass', coalesce(true, false), 'detail', sqlerrm));
    end;
    execute 'reset role';
    raise exception 'ROLLBACK_TEST_DATA';
  exception when raise_exception then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then raise; end if;
  end;
  perform set_config('bookly.rls_results', res::text, false);
end $outer$;
select x->>'test' as test, (x->>'pass')::boolean as pass, left(x->>'detail', 80) as detail
from jsonb_array_elements(current_setting('bookly.rls_results')::jsonb) x;
