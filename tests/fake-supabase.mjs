// In-memory stand-in for the parts of Supabase Bookly uses (Auth, PostgREST tables/RPCs, Storage).
// Semantics mirror supabase/migrations/*.sql: per-user isolation, revision-based conflicts on
// bookly_push_book, chapter order via chapter_ids, storage folders per user. The real server's
// rules are verified separately by supabase/tests/rls_test.sql.
// Used by unit tests (as a fetch implementation) and by browser e2e tests (via page.route).

let seq = 0;
const nextId = (p) => `${p}-${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 36);

export function createFakeSupabase({ requireConfirmation = false } = {}) {
  const users = new Map(); // email -> {id,email,password,confirmed,meta}
  const tokens = new Map(); // access token -> userId
  const refreshTokens = new Map();
  const books = []; const chapters = []; const assets = []; const sync = []; const objects = new Map();
  const log = [];
  const sentFiles = [];
  let online = true;

  const json = (status, body) => ({ status, headers: { 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  const issue = (u) => {
    const at = `at_${u.id}_${++seq}`; const rt = `rt_${u.id}_${seq}`;
    tokens.set(at, u.id); refreshTokens.set(rt, u.id);
    return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: pub(u) };
  };
  const pub = (u) => ({ id: u.id, email: u.email, email_confirmed_at: u.confirmed ? new Date().toISOString() : null, user_metadata: u.meta });
  const userOf = (headers) => {
    const h = headers.authorization || headers.Authorization || '';
    return tokens.get(h.replace(/^Bearer /, '')) || null;
  };

  function pushBook(uid, { p_book, p_chapters, p_base_revision, p_force }) {
    const keep = p_chapters.map((c) => c.local_id);
    let cur = books.find((b) => b.user_id === uid && b.local_id === p_book.local_id);
    if (cur && !p_force && cur.revision !== p_base_revision) {
      return { status: 'conflict', revision: cur.revision, updated_at: cur.updated_at, content_hash: cur.content_hash, device_id: cur.device_id };
    }
    const fields = { ...p_book, chapter_ids: keep, chapter_count: p_chapters.length, updated_at: new Date().toISOString() };
    if (cur) { Object.assign(cur, fields, { revision: cur.revision + 1 }); }
    else { cur = { id: nextId('b'), user_id: uid, revision: 1, created_at: fields.updated_at, deleted_at: null, ...fields }; books.push(cur); }
    p_chapters.forEach((c, i) => {
      const ex = chapters.find((x) => x.book_id === cur.id && x.local_id === c.local_id);
      if (ex) Object.assign(ex, c, { position: i }); else chapters.push({ ...c, id: nextId('c'), user_id: uid, book_id: cur.id, position: i });
    });
    return { status: 'ok', revision: cur.revision, updated_at: cur.updated_at };
  }

  function pullBook(uid, local) {
    const b = books.find((x) => x.user_id === uid && x.local_id === local);
    if (!b) return null;
    const chs = chapters.filter((c) => c.book_id === b.id && b.chapter_ids.includes(c.local_id)).sort((a, c) => a.position - c.position)
      .map(({ local_id, title, blocks, client_created_at, client_updated_at }) => ({ local_id, title, blocks, client_created_at, client_updated_at }));
    return { ...structuredClone(b), chapters: structuredClone(chs) };
  }

  function filterRows(rows, params) {
    let out = rows;
    for (const [k, v] of params) {
      if (['select', 'order', 'on_conflict', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
    }
    return out;
  }

  function project(rows, select) {
    if (!select || select === '*') return structuredClone(rows);
    const cols = select.split(',');
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, structuredClone(r[c] ?? null)])));
  }

  async function handle(method, url, headers, body) {
    if (!online) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const path = u.pathname;
    const q = u.searchParams;
    const text = body ? Buffer.from(body).toString('utf8') : '';
    const data = () => (text ? JSON.parse(text) : {});
    log.push(`${method} ${path}`);

    // ----------------------------------------------------------- auth
    if (path === '/auth/v1/signup') {
      const { email, password, data: meta } = data();
      if (users.has(email)) return json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      if (!password || password.length < 8) return json(422, { error_code: 'weak_password', msg: 'Password should be at least 8 characters.' });
      const user = { id: nextId('u'), email, password, confirmed: !requireConfirmation, meta: meta || {} };
      users.set(email, user);
      return json(200, requireConfirmation ? pub(user) : issue(user));
    }
    if (path === '/auth/v1/token') {
      if (q.get('grant_type') === 'password') {
        const { email, password } = data();
        const user = users.get(email);
        if (!user || user.password !== password) return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (!user.confirmed) return json(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
        return json(200, issue(user));
      }
      const id = refreshTokens.get(data().refresh_token);
      if (!id) return json(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      return json(200, issue([...users.values()].find((x) => x.id === id)));
    }
    if (path === '/functions/v1/telegram-auth') {
      // Real function verifies the HMAC with the bot token; the fake accepts a test hash.
      const p = new URLSearchParams(data().initData || '');
      if (p.get('hash') !== 'test-valid-hash') return json(401, { error: 'invalid_init_data', reason: 'bad_signature' });
      const tg = JSON.parse(p.get('user') || 'null');
      const email = `tg${tg.id}@telegram.bookly.invalid`;
      let user = users.get(email);
      if (!user) { user = { id: nextId('u'), email, password: null, confirmed: true, meta: { display_name: [tg.first_name, tg.last_name].filter(Boolean).join(' '), telegram_id: tg.id } }; users.set(email, user); }
      return json(200, issue(user));
    }
    if (path === '/functions/v1/telegram-bot' && q.get('action') === 'send') {
      // Real function verifies initData and calls Bot API sendDocument; the fake checks the multipart body.
      const raw = body ? Buffer.from(body).toString('latin1') : '';
      if (!raw.includes('test-valid-hash')) return json(401, { error: 'invalid_init_data', reason: 'bad_signature' });
      if (!/name="file"/.test(raw)) return json(400, { error: 'bad_request' });
      sentFiles.push(/filename="([^"]+)"/.exec(raw)?.[1] ?? '?');
      return json(200, { ok: true });
    }
    if (path === '/auth/v1/logout') { tokens.delete((headers.authorization || '').replace(/^Bearer /, '')); return { status: 204, headers: {}, body: '' }; }
    if (path === '/auth/v1/recover') return json(200, {});
    const uid = userOf(headers);
    if (path === '/auth/v1/user') {
      if (!uid) return json(401, { error_code: 'session_expired', msg: 'invalid JWT' });
      const user = [...users.values()].find((x) => x.id === uid);
      if (method === 'PUT') { const d = data(); if (d.password) user.password = d.password; }
      return json(200, pub(user));
    }

    // ----------------------------------------------------------- everything below needs a user (RLS)
    if (!uid) return json(401, { code: 'PGRST301', message: 'JWT expired' });

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      if (fn === 'bookly_push_book') return json(200, pushBook(uid, data()));
      if (fn === 'bookly_pull_book') return json(200, pullBook(uid, data().p_local_id));
      if (fn === 'bookly_cloud_usage') {
        const mine = assets.filter((a) => a.user_id === uid);
        return json(200, [{ books: books.filter((b) => b.user_id === uid && !b.deleted_at).length, chapters: chapters.filter((c) => c.user_id === uid).length, assets: mine.length, asset_bytes: mine.reduce((n, a) => n + a.size_bytes, 0), last_backup_at: sync.filter((s) => s.user_id === uid).map((s) => s.last_backup_at).filter(Boolean).sort().pop() ?? null }]);
      }
      if (fn === 'bookly_orphan_assets') {
        const refs = new Set();
        for (const b of books.filter((x) => x.user_id === uid)) {
          if (b.cover?.background?.imageAssetId) refs.add(b.cover.background.imageAssetId);
          for (const c of chapters.filter((x) => x.book_id === b.id && b.chapter_ids.includes(x.local_id))) for (const blk of c.blocks) if (blk.assetId) refs.add(blk.assetId);
        }
        return json(200, structuredClone(assets.filter((a) => a.user_id === uid && !refs.has(a.local_id))));
      }
      return json(404, { message: `unknown rpc ${fn}` });
    }

    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      const store = { books, chapters, book_assets: assets, sync_metadata: sync }[table];
      if (!store) return json(404, { message: 'no table' });
      const mine = store.filter((r) => r.user_id === uid);
      if (method === 'GET') return json(200, project(filterRows(mine, q), q.get('select')));
      if (method === 'DELETE') {
        const doomed = new Set(filterRows(mine, q));
        for (let i = store.length - 1; i >= 0; i--) if (doomed.has(store[i])) {
          if (table === 'books') for (let j = chapters.length - 1; j >= 0; j--) if (chapters[j].book_id === store[i].id) chapters.splice(j, 1);
          store.splice(i, 1);
        }
        return { status: 204, headers: {}, body: '' };
      }
      if (method === 'POST') {
        const keys = (q.get('on_conflict') || '').split(',').filter((k) => k !== 'user_id');
        const rows = [].concat(data()).map((r) => ({ ...r, user_id: uid }));
        const out = [];
        for (const r of rows) {
          const ex = store.find((x) => x.user_id === uid && keys.every((k) => x[k] === r[k]));
          if (ex) { Object.assign(ex, r); out.push(ex); } else { const n = { id: nextId('r'), created_at: new Date().toISOString(), ...r }; store.push(n); out.push(n); }
        }
        return json(201, structuredClone(out));
      }
      if (method === 'PATCH') { const rows = filterRows(mine, q); rows.forEach((r) => Object.assign(r, data())); return json(200, structuredClone(rows)); }
    }

    // ----------------------------------------------------------- storage
    const prefix = '/storage/v1/object/';
    if (path.startsWith(prefix)) {
      let rest = path.slice(prefix.length);
      if (method === 'DELETE' && rest === 'book-assets') {
        for (const p of data().prefixes || []) if (p.startsWith(`${uid}/`)) objects.delete(p);
        return json(200, []);
      }
      const auth = rest.startsWith('authenticated/');
      if (auth) rest = rest.slice('authenticated/'.length);
      const [bucket, ...parts] = rest.split('/');
      const name = decodeURIComponent(parts.join('/'));
      if (bucket !== 'book-assets' || !name.startsWith(`${uid}/`)) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      if (method === 'POST') {
        if (objects.has(name)) return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        const size = body ? body.byteLength : 0;
        if (size > 15 * 1024 * 1024) return json(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        objects.set(name, { bytes: Buffer.from(body), type: headers['content-type'] || 'application/octet-stream' });
        return json(200, { Key: `book-assets/${name}` });
      }
      if (method === 'GET') {
        const o = objects.get(name);
        if (!o) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        return { status: 200, headers: { 'content-type': o.type }, body: o.bytes };
      }
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  }

  /** fetch()-compatible wrapper for unit tests. */
  async function fakeFetch(input, init = {}) {
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    let body = null;
    if (init.body instanceof Blob) body = new Uint8Array(await init.body.arrayBuffer());
    else if (typeof init.body === 'string') body = new TextEncoder().encode(init.body);
    const r = await handle(init.method || 'GET', String(input), headers, body);
    return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
  }

  return {
    handle, fetch: fakeFetch, log, sentFiles,
    setOnline(v) { online = v; },
    confirm(email) { const u = users.get(email); if (u) u.confirmed = true; },
    state: { users, books, chapters, assets, objects, sync },
  };
}
