/**
 * Provider contracts for AI features.
 *
 * Screens depend only on these interfaces. Phase 1 registers Demo providers; Phase 2 registers
 * implementations that call a server-side endpoint (e.g. a Supabase Edge Function), so no API key
 * ever reaches the browser.
 */
import type { Block, BookCategory, BookLanguage, WritingTone } from '../../models/book';

export interface BookBrief {
  topic: string;
  title?: string;
  language: BookLanguage;
  category: BookCategory;
  audience?: string;
  tone: WritingTone;
  chapters: number;
  description?: string;
  instructions?: string;
  author?: string;
}

export interface BookOutline {
  title: string;
  subtitle: string;
  description: string;
  chapters: { title: string; summary: string }[];
}

export interface ChapterRequest {
  brief: BookBrief;
  outline: BookOutline;
  index: number;
}

export interface TextOptions {
  language?: BookLanguage;
  tone?: WritingTone;
  signal?: AbortSignal;
  /** Context such as book title or chapter title. */
  context?: string;
}

export interface TextAIProvider {
  readonly id: string;
  readonly isDemo: boolean;
  generateBookOutline(brief: BookBrief, signal?: AbortSignal): Promise<BookOutline>;
  generateChapter(req: ChapterRequest, signal?: AbortSignal): Promise<Block[]>;
  continueText(text: string, opts?: TextOptions): Promise<string>;
  rewriteText(text: string, opts?: TextOptions): Promise<string>;
  expandText(text: string, opts?: TextOptions): Promise<string>;
  summarizeText(text: string, opts?: TextOptions): Promise<string>;
  improveGrammar(text: string, opts?: TextOptions): Promise<string>;
  fixSpelling(text: string, opts?: TextOptions): Promise<string>;
  changeTone(text: string, tone: WritingTone, opts?: TextOptions): Promise<string>;
  translateText(text: string, target: BookLanguage, opts?: TextOptions): Promise<string>;
  generateChapterTitles(context: string, count: number, opts?: TextOptions): Promise<string[]>;
  generateIntroduction(context: string, opts?: TextOptions): Promise<string>;
  generateConclusion(context: string, opts?: TextOptions): Promise<string>;
}

export type CoverStyle = 'cosmic' | 'landscape' | 'abstract' | 'geometric' | 'watercolor';

export interface ImageRequest {
  prompt: string;
  style: CoverStyle;
  colors: [string, string];
  width: number;
  height: number;
  signal?: AbortSignal;
}

export interface ImageAIProvider {
  readonly id: string;
  readonly isDemo: boolean;
  generateCover(req: ImageRequest): Promise<Blob>;
  generateIllustration(req: ImageRequest): Promise<Blob>;
}

export class AbortError extends Error {
  constructor() { super('Aborted'); this.name = 'AbortError'; }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new AbortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
