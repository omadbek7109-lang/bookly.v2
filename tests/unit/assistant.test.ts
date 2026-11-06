import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistError, DemoAssistant, RemoteAssistant, remoteAssistantConfigured, assistErrorText, type AssistTask } from '../../src/services/ai/assistant';
import { createFakeSupabase } from '../fake-supabase.mjs';

const base = { language: 'uz' as const, bookTitle: 'Kitob', chapterTitle: 'Kirish' };

test('demo assistant answers all 8 tasks without touching the input', async () => {
  const a = new DemoAssistant(0);
  const text = 'Kitob o‘qish insonni boyitadi. U fikrlashni rivojlantiradi.';
  for (const task of ['continue', 'rewrite', 'grammar', 'shorten', 'expand', 'ideas', 'dialog', 'titles'] as AssistTask[]) {
    const r = await a.run({ ...base, task, text });
    assert.ok(r.text.trim().length > 0, `${task} returns text`);
    if (task === 'titles') assert.ok((r.items?.length ?? 0) >= 3, 'titles are separate items');
  }
});

test('remote assistant: status, login required, per-task results, server errors are explained', async () => {
  const off = createFakeSupabase();
  assert.equal(await remoteAssistantConfigured('https://x.supabase.co', 'k', off.fetch), false, 'no key → off');
  assert.equal(await remoteAssistantConfigured('https://x.supabase.co', 'k', (() => Promise.reject(new Error('offline'))) as typeof fetch), false, 'offline → off, never throws');

  const fake = createFakeSupabase({ aiConfigured: true });
  assert.equal(await remoteAssistantConfigured('https://x.supabase.co', 'k', fake.fetch), true);
  let token: string | null = null;
  const remote = new RemoteAssistant({ url: 'https://x.supabase.co', key: 'k', token: async () => token, fetchImpl: fake.fetch });
  await assert.rejects(remote.run({ ...base, task: 'rewrite', text: 'Salom' }), (e: unknown) => e instanceof AssistError && e.code === 'needs_login');

  // sign up a user through the fake auth to get a real token
  const res = await fake.fetch('https://x.supabase.co/auth/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ai@test.uz', password: 'parol-123456' }) });
  token = (await res.json()).access_token;
  const r = await remote.run({ ...base, task: 'rewrite', text: 'Salom dunyo' });
  assert.equal(r.text, 'AI(rewrite): Salom dunyo');
  const titles = await remote.run({ ...base, task: 'titles', text: '' });
  assert.deepEqual(titles.items, ['Birinchi nom', 'Ikkinchi nom']);
  assert.deepEqual(fake.aiCalls, ['rewrite', 'titles']);

  const limited = new RemoteAssistant({ url: 'u', key: 'k', token: async () => 't', fetchImpl: (async () => new Response(JSON.stringify({ error: 'ai_limit' }), { status: 429 })) as typeof fetch });
  await assert.rejects(limited.run({ ...base, task: 'expand', text: 'a' }), (e: unknown) => assistErrorText(e).includes('limiti'));
});
