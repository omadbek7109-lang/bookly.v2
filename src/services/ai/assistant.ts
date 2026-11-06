/**
 * Writing assistant used by the editor ("AI yordamchi").
 *
 * The assistant only does the one task the writer asks for, on the text they point at; it never writes
 * the whole book and never changes the document by itself — the editor shows the answer and the writer
 * chooses what to do with it.
 *
 * Providers:
 *  - `RemoteAssistant` — Supabase Edge Function `ai-assist`. The model API key lives only in Edge Function
 *    secrets; the browser sends the signed-in user's session token so usage can be limited per account.
 *  - `DemoAssistant` — offline sample generator, used only when explicitly requested (`?demoAI=1`, tests).
 *    It is labelled DEMO in the UI. Without either, the editor hides the AI button instead of faking it.
 */
import type { BookLanguage } from '../../models/book';
import { DemoTextAIProvider } from './demoText';
import { tr, type MessageKey } from '../../i18n';

export type AssistTask = 'continue' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'ideas' | 'dialog' | 'titles';

export interface AssistRequest {
  task: AssistTask;
  /** The selected text or the current paragraph (may be empty for ideas/dialog/titles). */
  text: string;
  /** Optional extra instruction from the writer (e.g. who talks in the dialog). */
  note?: string;
  language: BookLanguage;
  bookTitle: string;
  chapterTitle: string;
  signal?: AbortSignal;
}

export interface AssistResult {
  text: string;
  /** For `titles`: separate suggestions. */
  items?: string[];
}

export interface WritingAssistant {
  readonly kind: 'remote' | 'demo';
  run(req: AssistRequest): Promise<AssistResult>;
}

/** Tasks that need some text to work on. */
export const TASK_NEEDS_TEXT: Record<AssistTask, boolean> = {
  continue: true, rewrite: true, grammar: true, shorten: true, expand: true, ideas: false, dialog: false, titles: false,
};

export class AssistError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'AssistError'; }
}

// ------------------------------------------------------------------ demo (offline, explicit opt-in only)

export class DemoAssistant implements WritingAssistant {
  readonly kind = 'demo' as const;
  private gen: DemoTextAIProvider;
  constructor(latency?: number) { this.gen = new DemoTextAIProvider(latency); }

  async run(r: AssistRequest): Promise<AssistResult> {
    const o = { signal: r.signal, language: r.language, context: r.chapterTitle };
    const topic = r.note?.trim() || r.chapterTitle || r.bookTitle || r.text.slice(0, 60);
    switch (r.task) {
      case 'continue': return { text: await this.gen.continueText(r.text, o) };
      case 'rewrite': return { text: await this.gen.rewriteText(r.text, o) };
      case 'grammar': return { text: await this.gen.fixSpelling(await this.gen.improveGrammar(r.text, o), o) };
      case 'shorten': return { text: await this.gen.summarizeText(r.text, o) };
      case 'expand': return { text: await this.gen.expandText(r.text, o) };
      case 'titles': {
        const items = await this.gen.generateChapterTitles(topic, 5, o);
        return { text: items.join('\n'), items };
      }
      case 'ideas': {
        const items = await this.gen.generateChapterTitles(topic, 5, o);
        return { text: items.map((x, i) => `${i + 1}. ${x}`).join('\n') };
      }
      case 'dialog': {
        await this.gen.continueText(topic, o); // same simulated latency
        const t = r.language === 'en'
          ? `— What do you think about ${topic}?\n— I think it matters more than it seems.\n— Then let's start today.`
          : r.language === 'ru'
            ? `— Что ты думаешь о теме «${topic}»?\n— Думаю, это важнее, чем кажется.\n— Тогда начнём сегодня.`
            : `— «${topic}» haqida nima deb o‘ylaysan?\n— Menimcha, bu ko‘ringanidan muhimroq.\n— Unda bugundan boshlaymiz.`;
        return { text: t };
      }
    }
  }
}

// ------------------------------------------------------------------ remote (Edge Function)

export interface RemoteDeps {
  url: string;
  key: string;
  /** Current user's access token, or null when signed out. */
  token: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export class RemoteAssistant implements WritingAssistant {
  readonly kind = 'remote' as const;
  constructor(private deps: RemoteDeps) {}

  async run(r: AssistRequest): Promise<AssistResult> {
    const token = await this.deps.token();
    if (!token) throw new AssistError('login required', 'needs_login');
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(`${this.deps.url}/functions/v1/ai-assist`, {
        method: 'POST',
        signal: r.signal,
        headers: { apikey: this.deps.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: r.task, text: r.text.slice(0, 6000), note: (r.note ?? '').slice(0, 400), language: r.language, bookTitle: r.bookTitle.slice(0, 200), chapterTitle: r.chapterTitle.slice(0, 200) }),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new AssistError('network', 'network');
    }
    const body = await res.json().catch(() => ({})) as { text?: string; items?: string[]; error?: string };
    if (!res.ok || typeof body.text !== 'string') throw new AssistError(body.error ?? `HTTP ${res.status}`, body.error ?? (res.status === 401 ? 'needs_login' : 'ai_error'));
    return { text: body.text, items: Array.isArray(body.items) ? body.items.map(String) : undefined };
  }
}

/** Asks the server whether a model API key is configured. Never throws. */
export async function remoteAssistantConfigured(url: string, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!url || !key) return false;
  try {
    const res = await fetchImpl(`${url}/functions/v1/ai-assist?action=status`, { headers: { apikey: key } });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({})) as { configured?: boolean };
    return body.configured === true;
  } catch { return false; }
}

export const ASSIST_ERRORS: Record<string, MessageKey> = {
  needs_login: 'assistErr.needs_login',
  session_expired: 'err.session_expired',
  ai_limit: 'assistErr.ai_limit',
  ai_not_configured: 'assistErr.ai_not_configured',
  network: 'err.network',
  ai_error: 'assistErr.ai_error',
  bad_request: 'assistErr.bad_request',
};
export const assistErrorText = (e: unknown) => tr(e instanceof AssistError ? ASSIST_ERRORS[e.code] ?? ASSIST_ERRORS.ai_error : ASSIST_ERRORS.ai_error);
