import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes, useRoute } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, Field, IconButton, ListRow, Segmented, Select, Sheet, Spinner } from '../../components/ui';
import {
  chapterWordCount, createBlock, createChapter, bookWordCount, blockText, isSingleText,
  type Align, type Block, type Book, type BookCategory, type BookLanguage, type BlockType, type Chapter,
} from '../../models/book';
import type { MessageKey } from '../../i18n';
import { books } from '../../services/storage/repository';
import { syncCoverText } from '../../services/cover/renderCover';
import { plainText, sanitizeInline, textToInline } from '../../utils/inline';
import { AssistantSheet, type ApplyMode, type AssistantTarget } from '../ai-assistant/AssistantSheet';
import { useWritingAssistant } from '../ai-assistant/useAssistant';
import { chapterLabel } from '../../services/export/common';
import { ChapterContent } from '../reader/BookContent';
import { BlockView, placeCaret, type BlockHandlers } from './blocks';
import { useEditorState, type SaveStatus } from './useEditorState';

/** Long chapter titles wrap instead of being cut off on narrow phones. */
function fitTitle(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export default function EditorPage({ bookId }: { bookId: string }) {
  const { t } = useSettings();
  const [state, setState] = useState<{ book: Book | null; loading: boolean }>({ book: null, loading: true });
  useEffect(() => {
    let alive = true;
    books.get(bookId).then((b) => {
      if (!alive) return;
      if (b && !b.deletedAt) void books.save({ ...b, lastOpenedAt: Date.now() }, { touch: false });
      setState({ book: b && !b.deletedAt ? b : null, loading: false });
    }).catch(() => alive && setState({ book: null, loading: false }));
    return () => { alive = false; };
  }, [bookId]);
  if (state.loading) return <div className="page-loading"><Spinner label={t('common.loading')} /></div>;
  if (!state.book) return <EmptyState icon="alert" title={t('editor.notFound')} text={t('editor.notFoundText')} action={<Button onClick={() => navigate(routes.books())}>{t('editor.goLibrary')}</Button>} />;
  return <Editor initial={state.book} />;
}

type SheetName = null | 'chapters' | 'format' | 'insert' | 'assistant' | 'block' | 'details' | 'preview';

interface InsertItem { id: string; type: BlockType; icon: IconName; label: MessageKey; hint: MessageKey; init?: Partial<Block> }
/** The "+" menu: the five everyday blocks first, the rest behind "Boshqa bloklar". */
const MAIN_INSERTS: InsertItem[] = [
  { id: 'heading', type: 'heading', icon: 'heading', label: 'insert.heading', hint: 'insert.headingHint', init: { level: 1 } as Partial<Block> },
  { id: 'subheading', type: 'heading', icon: 'type', label: 'insert.subheading', hint: 'insert.subheadingHint', init: { level: 2 } as Partial<Block> },
  { id: 'paragraph', type: 'paragraph', icon: 'alignLeft', label: 'insert.paragraph', hint: 'insert.paragraphHint' },
  { id: 'quote', type: 'quote', icon: 'quote', label: 'insert.quote', hint: 'insert.quoteHint' },
  { id: 'image', type: 'image', icon: 'image', label: 'insert.image', hint: 'insert.imageHint' },
];
const INSERTS: { type: BlockType; icon: IconName; label: MessageKey; init?: Partial<Block> }[] = [
  { type: 'list', icon: 'list', label: 'editor.block.list' },
  { type: 'list', icon: 'listOrdered', label: 'editor.block.olist', init: { ordered: true } as Partial<Block> },
  { type: 'image', icon: 'image', label: 'editor.block.image' },
  { type: 'table', icon: 'table', label: 'editor.block.table' },
  { type: 'divider', icon: 'minus', label: 'editor.block.divider' },
  { type: 'audio', icon: 'music', label: 'editor.block.audio' },
  { type: 'pagebreak', icon: 'pageBreak', label: 'editor.block.pagebreak' },
];

const isEmptyText = (b: Block | undefined) => !!b && b.type === 'paragraph' && !plainText(b.html).trim();
const isText = (b: Block | undefined): b is Extract<Block, { type: 'paragraph' | 'heading' | 'quote' }> => !!b && (b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote');

function Editor({ initial }: { initial: Book }) {
  const { t } = useSettings();
  const { confirm, prompt, toast } = useUi();
  const route = useRoute();
  const ed = useEditorState(initial);
  const { book, update } = ed;
  const [chapterId, setChapterId] = useState(() => {
    const q = route.query.get('ch');
    return book.chapters.find((c) => c.id === q)?.id ?? book.reading.chapterId ?? book.chapters[0].id;
  });
  const chapter = book.chapters.find((c) => c.id === chapterId) ?? book.chapters[0];
  const chIndex = book.chapters.indexOf(chapter);
  const [active, setActive] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [menuBlock, setMenuBlock] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const focusReq = useRef<{ id: string; where: 'start' | 'end' } | null>(null);
  const savedRange = useRef<{ range: Range; blockId: string; text: string } | null>(null);
  const [assistTarget, setAssistTarget] = useState<AssistantTarget | null>(null);
  const [moreInserts, setMoreInserts] = useState(false);
  const ai = useWritingAssistant();
  const single = isSingleText(book);

  useEffect(() => { if (chapter.id !== chapterId) setChapterId(chapter.id); }, [chapter.id, chapterId]);

  // ---------------------------------------------------------------- focus management
  useLayoutEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    const el = els.current.get(req.id);
    if (el && el.isConnected) {
      focusReq.current = null;
      if (el.isContentEditable) placeCaret(el, req.where);
      else { el.querySelector<HTMLElement>('input,textarea,button')?.focus() ?? el.focus(); }
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  const focusBlock = (id: string, where: 'start' | 'end' = 'end') => { focusReq.current = { id, where }; };

  // ---------------------------------------------------------------- mutations
  const mutateChapter = useCallback((fn: (c: Chapter) => Chapter, coalesce?: string) => {
    update((b) => ({ ...b, chapters: b.chapters.map((c) => (c.id === chapterId ? { ...fn(c), updatedAt: Date.now() } : c)) }), coalesce);
  }, [update, chapterId]);

  const setBlocks = (fn: (blocks: Block[]) => Block[], coalesce?: string) => mutateChapter((c) => {
    const next = fn(c.blocks);
    return { ...c, blocks: next.length ? next : [createBlock('paragraph')] };
  }, coalesce);

  const replaceBlock = (blk: Block, coalesce?: boolean) => setBlocks((bs) => bs.map((x) => (x.id === blk.id ? blk : x)), coalesce ? `blk:${blk.id}` : undefined);

  const insertAfter = (afterId: string | null, blk: Block, focus = true) => {
    setBlocks((bs) => {
      const i = afterId ? bs.findIndex((x) => x.id === afterId) : bs.length - 1;
      const c = [...bs];
      c.splice(i + 1, 0, blk);
      return c;
    });
    if (focus) { focusBlock(blk.id, 'start'); setActive(blk.id); }
  };

  /** "+" menu: an empty paragraph under the cursor turns into the chosen block; otherwise a new block is added below. */
  const insertFromMenu = (type: BlockType, init: Partial<Block> = {}) => {
    setSheet(null); setMoreInserts(false);
    const cur = chapter.blocks.find((x) => x.id === active) ?? null;
    if (cur && isEmptyText(cur) && type !== 'paragraph') {
      const nb = { ...createBlock(type, init as never), id: cur.id } as Block;
      setBlocks((bs) => bs.map((x) => (x.id === cur.id ? nb : x)));
      focusBlock(cur.id, 'start');
      return;
    }
    insertAfter(cur?.id ?? chapter.blocks[chapter.blocks.length - 1]?.id ?? null, createBlock(type, init as never));
  };

  const removeBlock = (id: string) => {
    const idx = chapter.blocks.findIndex((x) => x.id === id);
    const prev = chapter.blocks[idx - 1] ?? chapter.blocks[idx + 1];
    setBlocks((bs) => bs.filter((x) => x.id !== id));
    if (prev) focusBlock(prev.id, 'end');
  };

  const moveBlock = (id: string, d: -1 | 1) => setBlocks((bs) => {
    const i = bs.findIndex((x) => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= bs.length) return bs;
    const c = [...bs]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  const turnInto = (id: string, type: 'paragraph' | 'heading' | 'quote' | 'list', opt: { level?: 1 | 2 | 3; ordered?: boolean } = {}) => {
    setBlocks((bs) => bs.map((b) => {
      if (b.id !== id) return b;
      const html = isText(b) ? b.html : b.type === 'list' ? b.items.join('<br>') : textToInline(blockText(b));
      if (type === 'list') return { id: b.id, type: 'list', ordered: !!opt.ordered, items: html.split(/<br\s*\/?>/i).map((x) => x.trim()).filter(Boolean).concat(html.trim() ? [] : ['']) };
      if (type === 'heading') return { id: b.id, type: 'heading', level: opt.level ?? 2, html: sanitizeInline(html), align: isText(b) && 'align' in b ? b.align : undefined };
      if (type === 'quote') return { id: b.id, type: 'quote', html: sanitizeInline(html), cite: '' };
      return { id: b.id, type: 'paragraph', html: sanitizeInline(html), align: isText(b) && 'align' in b ? b.align : undefined };
    }));
    focusBlock(id, 'end');
  };

  const setAlign = (id: string, align: Align) => setBlocks((bs) => bs.map((b) => (b.id === id && (b.type === 'paragraph' || b.type === 'heading') ? { ...b, align } : b)));

  const handlers = (b: Block, i: number): BlockHandlers => ({
    onChange: (nb, coalesce) => replaceBlock(nb, coalesce),
    onSplit: (after) => {
      const nb = createBlock('paragraph', { html: after });
      insertAfter(b.id, nb);
    },
    onMergeUp: () => {
      const prev = chapter.blocks[i - 1];
      if (!prev) return;
      const cur = chapter.blocks[i];
      const curHtml = isText(cur) ? cur.html : '';
      if (isText(prev) && (isText(cur) || (cur.type === 'list' && !cur.items.some((x) => x.trim())))) {
        setBlocks((bs) => bs.filter((x) => x.id !== cur.id).map((x) => (x.id === prev.id && isText(x) ? { ...x, html: sanitizeInline(x.html + curHtml) } : x)));
        focusBlock(prev.id, 'end');
      } else if (!plainText(curHtml).trim()) {
        removeBlock(cur.id);
      }
      setActive(prev.id);
    },
    onExitList: () => insertAfter(b.id, createBlock('paragraph')),
    onFocus: () => setActive(b.id),
    onMenu: () => { setActive(b.id); setMenuBlock(b.id); setSheet('block'); },
    register: (el) => {
      if (!el) { els.current.delete(b.id); return; }
      els.current.set(b.id, el);
      // A block that was just created or converted mounts after the focus effect ran: focus it now.
      const req = focusReq.current;
      if (req && req.id === b.id) {
        focusReq.current = null;
        if (el.isContentEditable) placeCaret(el, req.where); else el.focus();
        el.scrollIntoView({ block: 'nearest' });
      }
    },
  });

  // ---------------------------------------------------------------- chapters
  const selectChapter = (id: string) => {
    setChapterId(id);
    setActive(null);
    navigate(routes.editor(book.id, id), { replace: true });
    window.scrollTo({ top: 0 });
  };
  const addChapter = () => {
    // "N-bob" is only a starting suggestion: the title field opens selected so the writer can type their own.
    const c = createChapter(chapterLabel(book, book.chapters.length));
    update((b) => {
      const idx = b.chapters.findIndex((x) => x.id === chapterId);
      const list = [...b.chapters]; list.splice(idx + 1, 0, c);
      return { ...b, chapters: list, metadata: { ...b.metadata, targetChapters: Math.max(b.metadata.targetChapters, list.length) } };
    });
    setChapterId(c.id);
    setSheet(null);
    toast(t('editor.chapterAdded'), 'success');
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chapter-title-input')?.select(), 60);
  };
  const renameChapter = async (c: Chapter) => {
    const name = await prompt({ title: t('common.rename'), value: c.title, placeholder: t('editor.chapterTitlePh'), confirmLabel: t('common.save') });
    if (name) update((b) => ({ ...b, chapters: b.chapters.map((x) => (x.id === c.id ? { ...x, title: name } : x)) }));
  };
  const deleteChapter = async (c: Chapter) => {
    if (book.chapters.length <= 1) { toast(t('editor.cantDeleteLast'), 'error'); return; }
    if (!(await confirm({ title: t('editor.deleteChapter'), message: t('editor.confirmDeleteChapter', { title: c.title || '—' }), confirmLabel: t('common.delete'), danger: true }))) return;
    const idx = book.chapters.findIndex((x) => x.id === c.id);
    update((b) => ({ ...b, chapters: b.chapters.filter((x) => x.id !== c.id) }));
    if (c.id === chapterId) setChapterId(book.chapters[idx - 1]?.id ?? book.chapters[idx + 1].id);
  };
  const moveChapter = (id: string, d: -1 | 1) => update((b) => {
    const i = b.chapters.findIndex((x) => x.id === id), j = i + d;
    if (j < 0 || j >= b.chapters.length) return b;
    const c = [...b.chapters]; [c[i], c[j]] = [c[j], c[i]]; return { ...b, chapters: c };
  });

  // ---------------------------------------------------------------- format & assistant
  const exec = (cmd: 'bold' | 'italic' | 'underline') => {
    document.execCommand(cmd);
    const el = active ? els.current.get(active) : null;
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const openAssistant = () => {
    const sel = window.getSelection();
    savedRange.current = null;
    let selection: string | null = null;
    const el = active ? els.current.get(active) : null;
    if (sel && sel.rangeCount && !sel.isCollapsed && el && el.contains(sel.anchorNode)) {
      selection = sel.toString();
      savedRange.current = { range: sel.getRangeAt(0).cloneRange(), blockId: active!, text: selection };
    }
    const blk = chapter.blocks.find((x) => x.id === active);
    setAssistTarget({
      selection, blockText: blk ? blockText(blk) : '', hasBlock: !!blk, chapterTitle: single ? '' : chapter.title, bookTitle: book.title, language: book.language, single,
    });
    setSheet('assistant');
  };

  const applyAssistant = (mode: ApplyMode, text: string) => {
    const blk = chapter.blocks.find((x) => x.id === active);
    if (mode === 'title') {
      if (single) {
        const hb = createBlock('heading', { level: 1, html: textToInline(text) });
        setBlocks((bs) => { const c = [...bs]; c.splice(blk ? Math.max(0, bs.findIndex((x) => x.id === blk.id)) : 0, 0, hb); return c; });
      }
      else update((b) => ({ ...b, chapters: b.chapters.map((c) => (c.id === chapterId ? { ...c, title: text } : c)) }));
      toast(t('assistant.applied'), 'success');
      return;
    }
    const paragraphs = () => text.split(/\n{2,}|\n(?=—)/).map((x) => x.trim()).filter(Boolean).map((x) => createBlock('paragraph', { html: textToInline(x) }));
    if (mode === 'insert' || !blk) {
      const nbs = paragraphs();
      if (!nbs.length) return;
      setBlocks((bs) => {
        const i = blk ? bs.findIndex((x) => x.id === blk.id) : bs.length - 1;
        const c = [...bs];
        // an empty paragraph under the cursor is filled instead of leaving a blank line
        if (blk && isEmptyText(blk)) c.splice(i, 1, ...nbs); else c.splice(i + 1, 0, ...nbs);
        return c;
      });
      toast(t('assist.inserted'), 'success');
      return;
    }
    // replace — selection-level when possible, otherwise the whole block
    const sr = savedRange.current;
    const el = els.current.get(blk.id);
    if (sr && sr.blockId === blk.id && el?.isContentEditable) {
      setTimeout(() => {
        el.focus();
        const s = window.getSelection();
        s?.removeAllRanges(); s?.addRange(sr.range);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, 60);
    } else if (isText(blk)) replaceBlock({ ...blk, html: textToInline(text) });
    else if (blk.type === 'list') replaceBlock({ ...blk, items: text.split('\n').filter(Boolean).map(textToInline) });
    toast(t('assist.replaced'), 'success');
  };

  // ---------------------------------------------------------------- book structure (chapters ⇄ one continuous text)
  const setLayout = async (to: 'chapters' | 'single') => {
    if (to === (single ? 'single' : 'chapters')) return;
    if (to === 'chapters') {
      update((b) => ({ ...b, metadata: { ...b.metadata, layout: 'chapters' }, chapters: b.chapters.map((c, i) => (c.title.trim() ? c : { ...c, title: chapterLabel(b, i) })) }));
      toast(t('layout.nowChapters'), 'success');
      return;
    }
    if (book.chapters.length > 1) {
      const ok = await confirm({
        title: t('layout.toSingleTitle'),
        message: t('layout.toSingleText', { n: book.chapters.length }),
        confirmLabel: t('layout.merge'),
      });
      if (!ok) return;
    }
    update((b) => {
      const blocks: Block[] = b.chapters.length > 1
        ? b.chapters.flatMap((c, i) => [createBlock('heading', { level: 1, html: textToInline(c.title.trim() || chapterLabel(b, i)) }), ...c.blocks])
        : b.chapters[0].blocks;
      const merged = { ...b.chapters[0], blocks, updatedAt: Date.now() };
      return { ...b, metadata: { ...b.metadata, layout: 'single' }, chapters: [merged] };
    });
    setChapterId(book.chapters[0].id);
    toast(t('layout.nowSingle'), 'success');
  };

  // ---------------------------------------------------------------- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); ed.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); ed.redo(); }
      else if (k === 's') { e.preventDefault(); void ed.saveNow(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed]);

  const menuTarget = chapter.blocks.find((x) => x.id === menuBlock);
  const wc = useMemo(() => chapterWordCount(chapter), [chapter]);

  return (
    <div className={`editor ${single ? 'is-single' : ''}`} data-testid="editor" data-layout={single ? 'single' : 'chapters'}>
      <header className="editor-bar">
        <IconButton icon="chevronLeft" label={t('common.back')} onClick={() => { void ed.saveNow(); back(routes.books()); }} />
        <button type="button" className="editor-booktitle" onClick={() => setSheet('details')} data-testid="editor-details" aria-label={t('editor.details')}>
          <strong>{book.title}</strong>
          <SaveChip status={ed.status} onRetry={() => void ed.saveNow()} />
        </button>
        <IconButton icon="undo" label={t('editor.undo')} onClick={ed.undo} disabled={!ed.canUndo} data-testid="undo" />
        <IconButton icon="redo" label={t('editor.redo')} onClick={ed.redo} disabled={!ed.canRedo} data-testid="redo" />
        <IconButton icon="eye" label={t('editor.preview')} onClick={() => setSheet('preview')} data-testid="editor-preview" />
        <IconButton icon="save" label={t('common.save')} onClick={() => void ed.saveNow().then(() => toast(t('common.saved'), 'success'))} data-testid="save-now" className="desktop-show" />
      </header>

      <div className="editor-layout">
        {!single && (
          <aside className="editor-chapters" aria-label={t('editor.chapters')}>
            <ChapterList book={book} current={chapter.id} onSelect={selectChapter} onAdd={addChapter} onRename={renameChapter} onDelete={deleteChapter} onMove={moveChapter} />
          </aside>
        )}

        <div className="editor-main">
          {!single && (
            <button type="button" className="chapter-picker glass" onClick={() => setSheet('chapters')} data-testid="chapter-picker" aria-label={t('editor.chapterList')}>
              <Icon name="list" size={18} />
              <span><b>{chIndex + 1}/{book.chapters.length}</b> {chapter.title || chapterLabel(book, chIndex)}</span>
              <small>{t('editor.chapters')}</small>
              <Icon name="chevronDown" size={18} />
            </button>
          )}

          <div className="page-paper">
            {!single && (
              <textarea key={chapter.id} className="chapter-title-input" rows={1} value={chapter.title} placeholder={t('editor.chapterTitleWrite')} aria-label={t('editor.chapterTitlePh')}
                ref={fitTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const first = chapter.blocks[0]; if (first) { focusBlock(first.id, 'start'); setActive(first.id); } } }}
                onChange={(e) => { fitTitle(e.target); mutateChapter((c) => ({ ...c, title: e.target.value.replace(/\n/g, ' ') }), `title:${chapter.id}`); }} data-testid="chapter-title" />
            )}
            <div className="blocks" data-testid="blocks">
              {chapter.blocks.map((b, i) => <BlockView key={b.id} block={b} h={handlers(b, i)} active={active === b.id} />)}
            </div>
            <p className="word-count muted small" aria-live="off">{t('editor.words', { n: wc })}</p>
          </div>
        </div>
      </div>

      <nav className="editor-toolbar" aria-label={t('editor.toolbar')} onMouseDown={(e) => { if ((e.target as HTMLElement).closest('.keep-focus')) e.preventDefault(); }}>
        <button type="button" className="tb-btn tb-icon keep-focus" onClick={() => exec('bold')} aria-label={t('editor.boldB')} title={t('editor.bold')} data-testid="fmt-bold"><Icon name="bold" size={20} /></button>
        <button type="button" className="tb-btn tb-icon keep-focus" onClick={() => exec('italic')} aria-label={t('editor.italicI')} title={t('editor.italic')} data-testid="fmt-italic"><Icon name="italic" size={20} /></button>
        <button type="button" className="tb-btn tb-icon keep-focus" onClick={() => exec('underline')} aria-label={t('editor.underlineU')} title={t('editor.underline')} data-testid="fmt-underline"><Icon name="underline" size={20} /></button>
        <span className="tb-sep" />
        <button type="button" className="tb-btn tb-labeled" onClick={() => setSheet('insert')} data-testid="insert-sheet"><Icon name="plus" size={20} /><span>{t('editor.insert')}</span></button>
        {(ai.status === 'ready' || ai.status === 'needs-login' || ai.status === 'demo') && (
          <button type="button" className="tb-btn tb-labeled tb-ai keep-focus" onClick={openAssistant} data-testid="ai-open"><Icon name="sparkles" size={20} /><span>{t('editor.ai')}</span></button>
        )}
      </nav>

      {/* ---------------------------------------------------------- sheets */}
      <Sheet open={sheet === 'chapters'} onClose={() => setSheet(null)} title={t('editor.chapters')} size="md">
        <ChapterList book={book} current={chapter.id} onSelect={(id) => { selectChapter(id); setSheet(null); }} onAdd={addChapter} onRename={renameChapter} onDelete={deleteChapter} onMove={moveChapter} />
      </Sheet>

      <Sheet open={sheet === 'insert'} onClose={() => { setSheet(null); setMoreInserts(false); }} title={t('editor.insert')} size="sm">
        <div className="insert-menu" role="menu">
          {MAIN_INSERTS.map((x) => (
            <button key={x.id} type="button" role="menuitem" className="insert-row" data-testid={`insert-${x.id}`} onClick={() => insertFromMenu(x.type, x.init)}>
              <span className="insert-ic"><Icon name={x.icon} size={20} /></span>
              <span className="insert-txt"><strong>{t(x.label)}</strong><small>{t(x.hint)}</small></span>
            </button>
          ))}
          <button type="button" className="insert-more" aria-expanded={moreInserts} onClick={() => setMoreInserts((v) => !v)} data-testid="insert-more">
            <Icon name={moreInserts ? 'chevronUp' : 'chevronDown'} size={16} /> {t('insert.more')}
          </button>
          {moreInserts && (
            <div className="insert-grid">
              {INSERTS.map((x) => (
                <button key={x.label} type="button" className="insert-tile" data-testid={`insert-${x.label.split('.').pop()}`} onClick={() => insertFromMenu(x.type, x.init ?? {})}>
                  <Icon name={x.icon} size={20} /><span>{t(x.label)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === 'block' && !!menuTarget} onClose={() => setSheet(null)} title={t('editor.blockActions')} size="sm">
        {menuTarget && (
          <>
            <BlockFormat blk={menuTarget} onTurn={(ty, o) => { turnInto(menuTarget.id, ty, o); setSheet(null); }} onAlign={(a) => setAlign(menuTarget.id, a)} />
            <div className="list">
              <ListRow icon="arrowUp" title={t('editor.moveUp')} onClick={() => moveBlock(menuTarget.id, -1)} testId="block-up" />
              <ListRow icon="arrowDown" title={t('editor.moveDown')} onClick={() => moveBlock(menuTarget.id, 1)} testId="block-down" />
              <ListRow icon="plus" title={t('editor.addBlockBelow')} onClick={() => { setActive(menuTarget.id); setSheet('insert'); }} />
              <ListRow icon="trash" danger title={t('editor.deleteBlock')} onClick={() => { removeBlock(menuTarget.id); setSheet(null); }} testId="block-delete" />
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={sheet === 'details'} onClose={() => setSheet(null)} title={t('editor.details')} size="md">
        <BookDetails book={book} single={single} onLayout={(l) => void setLayout(l)} onChange={(fn) => update(fn, 'details')} onSaved={() => void ed.saveNow()} />
      </Sheet>

      <Sheet open={sheet === 'preview'} onClose={() => setSheet(null)} title={t('editor.preview')} size="lg"
        footer={<Button icon="bookOpen" onClick={() => { void ed.saveNow(); navigate(routes.reader(book.id)); }}>{t('reader.startReading')}</Button>}>
        <div className="preview-paper" style={{ background: book.theme.paper, color: book.theme.ink }} data-testid="live-preview">
          <ChapterContent book={book} chapter={chapter} index={chIndex} />
        </div>
      </Sheet>

      {assistTarget && <AssistantSheet open={sheet === 'assistant'} onClose={() => setSheet(null)} target={assistTarget} onApply={applyAssistant} assistant={ai.assistant} status={ai.status} />}
    </div>
  );
}

function SaveChip({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const { t } = useSettings();
  const map: Record<SaveStatus, [string, IconName]> = {
    saved: [t('common.saved'), 'check'], saving: [t('common.saving'), 'clock'], dirty: [t('common.saving'), 'clock'], error: [t('editor.saveErrorRetry'), 'alert'],
  };
  const [label, icon] = map[status];
  return (
    <small className={`save-chip is-${status}`} role="status" aria-live="polite" data-testid="save-status" data-status={status}
      onClick={status === 'error' ? (e) => { e.stopPropagation(); onRetry(); } : undefined}>
      <Icon name={icon} size={12} strokeWidth={2.4} /> {label}
    </small>
  );
}

function BlockFormat({ blk, onTurn, onAlign }: { blk: Block; onTurn: (t: 'paragraph' | 'heading' | 'quote' | 'list', o?: { level?: 1 | 2 | 3; ordered?: boolean }) => void; onAlign: (a: Align) => void }) {
  const { t } = useSettings();
  const convertible = isText(blk) || blk.type === 'list';
  const cur = blk.type === 'heading' ? `h${blk.level}` : blk.type === 'list' ? (blk.ordered ? 'ol' : 'ul') : blk.type;
  const opts: { id: string; label: string; icon: IconName; run: () => void }[] = [
    { id: 'paragraph', label: t('editor.block.paragraph'), icon: 'alignLeft', run: () => onTurn('paragraph') },
    { id: 'h1', label: t('editor.h1'), icon: 'heading', run: () => onTurn('heading', { level: 1 }) },
    { id: 'h2', label: t('editor.h2'), icon: 'heading', run: () => onTurn('heading', { level: 2 }) },
    { id: 'h3', label: t('editor.h3'), icon: 'heading', run: () => onTurn('heading', { level: 3 }) },
    { id: 'quote', label: t('editor.block.quote'), icon: 'quote', run: () => onTurn('quote') },
    { id: 'ul', label: t('editor.block.list'), icon: 'list', run: () => onTurn('list', { ordered: false }) },
    { id: 'ol', label: t('editor.block.olist'), icon: 'listOrdered', run: () => onTurn('list', { ordered: true }) },
  ];
  return (
    <div className="block-format">
      {convertible && (
        <>
          <p className="muted small">{t('editor.turnInto')}</p>
          <div className="chips">{opts.map((o) => <button key={o.id} type="button" className={`chip-btn ${cur === o.id ? 'is-active' : ''}`} onClick={o.run} data-testid={`turn-${o.id}`}><Icon name={o.icon} size={15} /> {o.label}</button>)}</div>
        </>
      )}
      {(blk.type === 'paragraph' || blk.type === 'heading') && (
        <>
          <p className="muted small">{t('editor.align')}</p>
          <Segmented value={blk.align ?? 'left'} label={t('editor.align')} onChange={(v) => onAlign(v as Align)} options={[
            { value: 'left', label: t('editor.alignLeft'), icon: 'alignLeft' }, { value: 'center', label: t('editor.alignCenter'), icon: 'alignCenter' },
            { value: 'right', label: t('editor.alignRight'), icon: 'alignRight' }, { value: 'justify', label: t('editor.alignJustify'), icon: 'alignJustify' },
          ]} />
        </>
      )}
    </div>
  );
}

function ChapterList({ book, current, onSelect, onAdd, onRename, onDelete, onMove }: {
  book: Book; current: string; onSelect: (id: string) => void; onAdd: () => void; onRename: (c: Chapter) => void; onDelete: (c: Chapter) => void; onMove: (id: string, d: -1 | 1) => void;
}) {
  const { t } = useSettings();
  return (
    <div className="chapter-list">
      <ol data-testid="chapter-list">
        {book.chapters.map((c, i) => (
          <li key={c.id} className={c.id === current ? 'is-current' : ''}>
            <button type="button" className="ch-select" onClick={() => onSelect(c.id)} aria-current={c.id === current ? 'true' : undefined}>
              <span className="ch-num">{i + 1}</span>
              <span className="ch-text"><span>{c.title || chapterLabel(book, i)}</span><small>{t('editor.words', { n: chapterWordCount(c) })}</small></span>
            </button>
            <span className="ch-tools">
              <IconButton icon="edit" label={t('common.rename')} onClick={() => onRename(c)} size={16} />
              <IconButton icon="arrowUp" label={t('editor.moveUp')} onClick={() => onMove(c.id, -1)} disabled={i === 0} size={16} data-testid="ch-up" />
              <IconButton icon="arrowDown" label={t('editor.moveDown')} onClick={() => onMove(c.id, 1)} disabled={i === book.chapters.length - 1} size={16} data-testid="ch-down" />
              <IconButton icon="trash" label={t('editor.deleteChapter')} onClick={() => onDelete(c)} size={16} data-testid="ch-delete" />
            </span>
          </li>
        ))}
      </ol>
      <Button variant="secondary" icon="plus" block onClick={onAdd} data-testid="add-chapter">{t('editor.addChapter')}</Button>
      <p className="muted small center">{t('common.words', { n: bookWordCount(book) })}</p>
    </div>
  );
}

const CATS: BookCategory[] = ['education', 'business', 'self-development', 'fiction', 'children', 'academic', 'guide', 'journal', 'technology', 'finance', 'other'];

function BookDetails({ book, single, onLayout, onChange, onSaved }: { book: Book; single: boolean; onLayout: (l: 'chapters' | 'single') => void; onChange: (fn: (b: Book) => Book) => void; onSaved: () => void }) {
  const { t } = useSettings();
  const set = (patch: Partial<Book>) => onChange((b) => {
    const next = { ...b, ...patch };
    return { ...next, cover: syncCoverText(next, b) };
  });
  return (
    <div className="form">
      <Field label={t('creator.bookTitle')} htmlFor="d-title"><input id="d-title" className="input" value={book.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('editor.bookTitlePh')} data-testid="details-title" /></Field>
      <Field label={t('cover.subtitle')} htmlFor="d-sub"><input id="d-sub" className="input" value={book.subtitle} onChange={(e) => set({ subtitle: e.target.value })} placeholder={t('editor.subtitlePh')} /></Field>
      <Field label={t('creator.author')} htmlFor="d-author"><input id="d-author" className="input" value={book.author} onChange={(e) => set({ author: e.target.value })} placeholder={t('editor.authorPh')} /></Field>
      <Field label={t('creator.description')} htmlFor="d-desc"><textarea id="d-desc" className="input" rows={3} value={book.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('editor.descriptionPh')} /></Field>
      <div className="form-row">
        <Field label={t('creator.category')} htmlFor="d-cat">
          <Select id="d-cat" label={t('creator.category')} value={book.category} onChange={(v) => set({ category: v })} testId="details-category"
            options={CATS.map((c) => ({ value: c, label: t(`category.${c}` as MessageKey) }))} />
        </Field>
        <Field label={t('creator.language')} htmlFor="d-lang">
          <Select id="d-lang" label={t('creator.language')} value={book.language} onChange={(v) => set({ language: v as BookLanguage })} testId="details-language"
            options={(['uz', 'en', 'ru'] as const).map((l) => ({ value: l, label: t(`lang.${l}` as MessageKey) }))} />
        </Field>
      </div>
      <Field label={t('layout.label')} hint={single ? t('layout.singleHint') : t('layout.chaptersHint', { n: book.chapters.length })}>
        <Segmented value={single ? 'single' : 'chapters'} label={t('layout.label')} onChange={(v) => onLayout(v as 'chapters' | 'single')}
          options={[{ value: 'chapters', label: t('create.layout.chapters'), icon: 'list' }, { value: 'single', label: t('create.layout.single'), icon: 'file' }]} />
      </Field>
      <Field label={t('editor.status')}>
        <Segmented value={book.status} label={t('editor.status')} onChange={(v) => set({ status: v })} options={[{ value: 'draft', label: t('status.draft') }, { value: 'completed', label: t('status.completed'), icon: 'check' }]} />
      </Field>
      <Field label={t('editor.keywords')} htmlFor="d-kw" hint={t('editor.keywordsHint')}>
        <input id="d-kw" className="input" value={book.metadata.keywords.join(', ')} onChange={(e) => onChange((b) => ({ ...b, metadata: { ...b.metadata, keywords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } }))} />
      </Field>
      <div className="row-actions wrap">
        <Button variant="secondary" icon="image" onClick={() => { onSaved(); navigate(routes.cover(book.id)); }}>{t('books.cover')}</Button>
        <Button variant="secondary" icon="layout" onClick={() => { onSaved(); navigate(routes.templates()); }}>{t('nav.templates')}</Button>
        <Button variant="secondary" icon="download" onClick={() => { onSaved(); navigate(routes.export(book.id)); }} data-testid="details-export">{t('common.export')}</Button>
      </div>
    </div>
  );
}
