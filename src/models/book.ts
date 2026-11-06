/**
 * Bookly unified document model.
 *
 * Every screen (editor, reader, cover designer) and every exporter (PDF, PPTX, EPUB, DOCX)
 * reads from this single schema. Bump SCHEMA_VERSION and extend `migrateBook` when it changes.
 */
import { uid } from '../utils/id';
import { countWords, plainText } from '../utils/inline';

export const SCHEMA_VERSION = 1;

export type BookLanguage = 'uz' | 'ru' | 'en';
export type BookStatus = 'draft' | 'completed';
export type Align = 'left' | 'center' | 'right' | 'justify';
export type WritingTone = 'educational' | 'professional' | 'academic' | 'creative' | 'informal' | 'storytelling';
export type BookCategory =
  | 'education' | 'business' | 'self-development' | 'fiction' | 'children' | 'academic' | 'guide' | 'journal' | 'technology' | 'finance' | 'other';

/** Inline HTML limited to <b>, <i>, <u>, <br> (see utils/inline.ts). */
export type InlineHtml = string;

interface BlockBase { id: string }
export interface HeadingBlock extends BlockBase { type: 'heading'; level: 1 | 2 | 3; html: InlineHtml; align?: Align }
export interface ParagraphBlock extends BlockBase { type: 'paragraph'; html: InlineHtml; align?: Align }
export interface QuoteBlock extends BlockBase { type: 'quote'; html: InlineHtml; cite?: string }
export interface ListBlock extends BlockBase { type: 'list'; ordered: boolean; items: InlineHtml[] }
export interface ImageBlock extends BlockBase { type: 'image'; assetId: string | null; caption: string; width: 'small' | 'medium' | 'full' }
export interface TableBlock extends BlockBase { type: 'table'; rows: string[][]; header: boolean }
export interface DividerBlock extends BlockBase { type: 'divider' }
export interface AudioBlock extends BlockBase { type: 'audio'; assetId: string | null; title: string }
export interface PageBreakBlock extends BlockBase { type: 'pagebreak' }

export type Block =
  | HeadingBlock | ParagraphBlock | QuoteBlock | ListBlock | ImageBlock | TableBlock | DividerBlock | AudioBlock | PageBreakBlock;
export type BlockType = Block['type'];
export type TextBlock = HeadingBlock | ParagraphBlock | QuoteBlock;

export interface Chapter {
  id: string;
  title: string;
  blocks: Block[];
  createdAt: number;
  updatedAt: number;
}

export interface CoverDesign {
  templateId: string;
  title: string;
  subtitle: string;
  author: string;
  background: {
    kind: 'gradient' | 'solid' | 'image';
    colors: [string, string];
    imageAssetId: string | null;
    /** 0..1 focal point of the image. */
    imageX: number;
    imageY: number;
    /** 1 = cover-fit, >1 zooms in. */
    imageScale: number;
  };
  textColor: string;
  accentColor: string;
  fontId: string;
  /** 0..1 darkening overlay used to keep text readable on photos. */
  overlay: number;
  layout: 'center' | 'top' | 'bottom' | 'left';
  /** True when the background was produced by the (demo) AI image provider. */
  aiGenerated?: boolean;
  aiPrompt?: string;
}

export interface BookTheme {
  templateId: string;
  headingFont: string;
  bodyFont: string;
  accent: string;
  paper: string;
  ink: string;
  baseSize: number;
}

export interface BookMetadata {
  keywords: string[];
  audience: string;
  tone: WritingTone;
  publisher: string;
  isbn: string;
  rights: string;
  source: 'manual' | 'demo-ai' | 'ai' | 'import' | 'template' | 'migration';
  targetChapters: number;
  /**
   * 'chapters' (default, also for every book created before this field existed) or 'single':
   * one continuous text without chapter headings. Stored in metadata so it syncs to the cloud as-is.
   */
  layout?: BookLayout;
}

export type BookLayout = 'chapters' | 'single';

/** True for "one continuous text" books: no chapter titles in the editor, reader or exports. */
export const isSingleText = (b: Pick<Book, 'metadata'>) => b.metadata?.layout === 'single';

export interface Book {
  schemaVersion: number;
  id: string;
  title: string;
  subtitle: string;
  author: string;
  description: string;
  language: BookLanguage;
  category: BookCategory;
  cover: CoverDesign;
  theme: BookTheme;
  chapters: Chapter[];
  metadata: BookMetadata;
  createdAt: number;
  updatedAt: number;
  status: BookStatus;
  favorite: boolean;
  /** Soft delete timestamp — books with a value live in the Trash. */
  deletedAt: number | null;
  lastOpenedAt: number | null;
  reading: { chapterId: string | null; ratio: number };
}

export const DEFAULT_THEME: BookTheme = {
  templateId: 'classic-indigo',
  headingFont: 'serif',
  bodyFont: 'serif',
  accent: '#4f46e5',
  paper: '#ffffff',
  ink: '#1c1b29',
  baseSize: 12,
};

export function defaultCover(title = '', author = ''): CoverDesign {
  return {
    templateId: 'aurora',
    title,
    subtitle: '',
    author,
    background: { kind: 'gradient', colors: ['#312e81', '#7c3aed'], imageAssetId: null, imageX: 0.5, imageY: 0.5, imageScale: 1 },
    textColor: '#ffffff',
    accentColor: '#c4b5fd',
    fontId: 'serif',
    overlay: 0.25,
    layout: 'center',
  };
}

export function createBlock<T extends BlockType>(type: T, init: Partial<Extract<Block, { type: T }>> = {}): Extract<Block, { type: T }> {
  const id = uid('blk');
  let b: Block;
  switch (type) {
    case 'heading': b = { id, type, level: 2, html: '' }; break;
    case 'paragraph': b = { id, type, html: '' }; break;
    case 'quote': b = { id, type, html: '', cite: '' }; break;
    case 'list': b = { id, type, ordered: false, items: [''] }; break;
    case 'image': b = { id, type, assetId: null, caption: '', width: 'full' }; break;
    case 'table': b = { id, type, header: true, rows: [['', ''], ['', '']] }; break;
    case 'divider': b = { id, type }; break;
    case 'audio': b = { id, type, assetId: null, title: '' }; break;
    case 'pagebreak': b = { id, type }; break;
    default: throw new Error(`Unknown block type ${String(type)}`);
  }
  return { ...b, ...init, id: (init as { id?: string }).id ?? id } as Extract<Block, { type: T }>;
}

export function createChapter(title = '', blocks: Block[] = []): Chapter {
  const now = Date.now();
  return { id: uid('ch'), title, blocks: blocks.length ? blocks : [createBlock('paragraph')], createdAt: now, updatedAt: now };
}

export interface NewBookInput {
  title?: string; subtitle?: string; author?: string; description?: string; language?: BookLanguage;
  category?: BookCategory; chapters?: Chapter[]; source?: BookMetadata['source']; tone?: WritingTone; audience?: string;
  targetChapters?: number;
  layout?: BookLayout;
}

export function createBook(input: NewBookInput = {}): Book {
  const now = Date.now();
  const title = input.title?.trim() || 'Nomsiz kitob';
  const author = input.author?.trim() || '';
  const cover = defaultCover(title, author);
  cover.subtitle = input.subtitle ?? '';
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('book'),
    title,
    subtitle: input.subtitle ?? '',
    author,
    description: input.description ?? '',
    language: input.language ?? 'uz',
    category: input.category ?? 'other',
    cover,
    theme: { ...DEFAULT_THEME },
    chapters: input.chapters && input.chapters.length ? input.chapters : [createChapter(input.layout === 'single' ? '' : '1-bob')],
    metadata: {
      keywords: [], audience: input.audience ?? '', tone: input.tone ?? 'educational', publisher: '', isbn: '', rights: '',
      source: input.source ?? 'manual', targetChapters: input.targetChapters ?? (input.chapters?.length || 1),
      ...(input.layout ? { layout: input.layout } : {}),
    },
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    favorite: false,
    deletedAt: null,
    lastOpenedAt: null,
    reading: { chapterId: null, ratio: 0 },
  };
}

/** Deep clone with fresh IDs for book, chapters and blocks (assets are shared by reference). */
export function duplicateBook(book: Book, titleSuffix = ' (nusxa)'): Book {
  const now = Date.now();
  const copy: Book = structuredCloneSafe(book);
  copy.id = uid('book');
  copy.title = book.title + titleSuffix;
  copy.cover.title = copy.cover.title ? copy.cover.title + titleSuffix : copy.title;
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.favorite = false;
  copy.deletedAt = null;
  copy.lastOpenedAt = null;
  copy.reading = { chapterId: null, ratio: 0 };
  copy.chapters = copy.chapters.map((c) => ({ ...c, id: uid('ch'), blocks: c.blocks.map((b) => ({ ...b, id: uid('blk') })) }));
  return copy;
}

export function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

export function blockText(b: Block): string {
  switch (b.type) {
    case 'heading': case 'paragraph': case 'quote': return plainText(b.html);
    case 'list': return b.items.map(plainText).join('\n');
    case 'table': return b.rows.map((r) => r.join(' ')).join('\n');
    case 'image': return b.caption;
    case 'audio': return b.title;
    default: return '';
  }
}

export function chapterWordCount(c: Chapter): number {
  return c.blocks.reduce((n, b) => n + countWords(blockText(b)), 0);
}

export function bookWordCount(book: Book): number {
  return book.chapters.reduce((n, c) => n + chapterWordCount(c), 0);
}

/** Completion used by cards: 100% when completed, otherwise share of chapters that have real content. */
export function bookProgress(book: Book): number {
  if (book.status === 'completed') return 100;
  const target = Math.max(book.metadata.targetChapters || 0, book.chapters.length, 1);
  const filled = book.chapters.filter((c) => chapterWordCount(c) >= 40).length;
  return Math.min(99, Math.round((filled / target) * 100));
}

export function collectAssetIds(book: Book): string[] {
  const ids = new Set<string>();
  if (book.cover.background.imageAssetId) ids.add(book.cover.background.imageAssetId);
  for (const c of book.chapters) for (const b of c.blocks) {
    if ((b.type === 'image' || b.type === 'audio') && b.assetId) ids.add(b.assetId);
  }
  return [...ids];
}

// ---------------------------------------------------------------- migrations

type Raw = Record<string, unknown>;

/**
 * Brings any stored or imported book object up to the current schema.
 * v0 = legacy Bookly Mini shape ({ title, chapters: [{ title, content: string }] } or { title, content }).
 */
export function migrateBook(input: unknown): Book {
  if (!input || typeof input !== 'object') throw new Error('Kitob maʼlumoti noto‘g‘ri');
  const raw = input as Raw;
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) throw new Error(`Kitob yangiroq Bookly versiyasida yaratilgan (schema ${version})`);
  let book: Book = version === 0 ? fromLegacy(raw) : (raw as unknown as Book);
  book = fillDefaults(book);
  return book;
}

function fromLegacy(raw: Raw): Book {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const toBlocks = (content: string): Block[] => {
    const parts = content.split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean);
    return parts.length
      ? parts.map((p) => createBlock('paragraph', { html: p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') }))
      : [createBlock('paragraph')];
  };
  const rawChapters = Array.isArray(raw.chapters) ? (raw.chapters as Raw[]) : null;
  const chapters = rawChapters
    ? rawChapters.map((c, idx) => createChapter(str(c.title) || `${idx + 1}-bob`, Array.isArray(c.blocks) ? (c.blocks as Block[]) : toBlocks(str(c.content) || str(c.text))))
    : [createChapter('1-bob', toBlocks(str(raw.content) || str(raw.text)))];
  const book = createBook({ title: str(raw.title) || str(raw.name), author: str(raw.author), description: str(raw.description), chapters, source: 'migration' });
  if (typeof raw.id === 'string' && raw.id) book.id = raw.id;
  const created = Number(raw.createdAt ?? raw.created);
  if (created > 0) book.createdAt = created;
  return book;
}

function fillDefaults(b: Book): Book {
  const base = createBook({ title: b.title });
  const merged: Book = {
    ...base,
    ...b,
    schemaVersion: SCHEMA_VERSION,
    cover: { ...defaultCover(b.title, b.author), ...(b.cover || {}), background: { ...defaultCover().background, ...(b.cover?.background || {}) } },
    theme: { ...DEFAULT_THEME, ...(b.theme || {}) },
    metadata: { ...base.metadata, ...(b.metadata || {}) },
    reading: { ...base.reading, ...(b.reading || {}) },
    deletedAt: b.deletedAt ?? null,
    lastOpenedAt: b.lastOpenedAt ?? null,
    favorite: !!b.favorite,
    status: b.status === 'completed' ? 'completed' : 'draft',
  };
  merged.chapters = (Array.isArray(b.chapters) && b.chapters.length ? b.chapters : [createChapter('1-bob')]).map((c) => ({
    id: c.id || uid('ch'),
    title: c.title ?? '',
    createdAt: c.createdAt || merged.createdAt,
    updatedAt: c.updatedAt || merged.updatedAt,
    blocks: (Array.isArray(c.blocks) && c.blocks.length ? c.blocks : [createBlock('paragraph')]).map((blk) => ({ ...blk, id: blk.id || uid('blk') })),
  }));
  return merged;
}
