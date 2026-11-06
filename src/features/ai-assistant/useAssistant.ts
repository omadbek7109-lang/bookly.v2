import { useEffect, useMemo, useState } from 'react';
import { DemoAssistant, RemoteAssistant, remoteAssistantConfigured, type WritingAssistant } from '../../services/ai/assistant';
import { SUPABASE_KEY, SUPABASE_URL } from '../../services/cloud/config';
import { cloudClient, useCloud } from '../cloud/CloudContext';

/**
 * 'off'         — no AI connected: the editor hides the AI button (no fake features).
 * 'needs-login' — AI is connected on the server, but the writer must be signed in (Telegram signs in automatically).
 * 'ready'       — real AI through the Edge Function.
 * 'demo'        — explicit offline demo (`?demoAI=1`, automated tests); labelled DEMO.
 */
export type AssistantStatus = 'checking' | 'off' | 'needs-login' | 'ready' | 'demo';

const q = typeof location === 'undefined' ? '' : location.search;
const DEMO = /[?&](demoAI|fastAI)=1/.test(q);
const FAST = /[?&]fastAI=1/.test(q);

let configured: Promise<boolean> | null = null;
const checkConfigured = () => (configured ??= remoteAssistantConfigured(SUPABASE_URL, SUPABASE_KEY));

export function useWritingAssistant(): { status: AssistantStatus; assistant: WritingAssistant | null } {
  const { user } = useCloud();
  const [remoteOn, setRemoteOn] = useState<boolean | null>(DEMO ? false : null);
  useEffect(() => {
    if (DEMO) return;
    let alive = true;
    void checkConfigured().then((v) => { if (alive) setRemoteOn(v); });
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    if (DEMO) return { status: 'demo' as const, assistant: new DemoAssistant(FAST ? 0 : undefined) };
    if (remoteOn === null) return { status: 'checking' as const, assistant: null };
    if (!remoteOn) return { status: 'off' as const, assistant: null };
    const client = cloudClient();
    const assistant = new RemoteAssistant({ url: SUPABASE_URL, key: SUPABASE_KEY, token: async () => (client ? client.accessToken() : null) });
    return { status: user ? 'ready' as const : 'needs-login' as const, assistant };
  }, [remoteOn, user]);
}
