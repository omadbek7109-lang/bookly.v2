import { memo, useEffect, useLayoutEffect, useRef, type KeyboardEvent as RKeyboardEvent } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Button, IconButton, Segmented } from '../../components/ui';
import type { Block, ImageBlock, AudioBlock, ListBlock, TableBlock, TextBlock } from '../../models/book';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { assets, MAX_ASSET_BYTES } from '../../services/storage/repository';
import { sanitizeInline } from '../../utils/inline';
import type { MessageKey } from '../../i18n';

export interface BlockHandlers {
  onChange: (b: Block, coalesce?: boolean) => void;
  onSplit: (afterHtml: string) => void;
  onMergeUp: () => void;
  onExitList: () => void;
  onFocus: () => void;
  onMenu: () => void;
  register: (el: HTMLElement | null) => void;
}

// ------------------------------------------------------------------ caret helpers

export function placeCaret(el: HTMLElement, where: 'start' | 'end') {
  el.focus({ preventScroll: false });
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(where === 'start');
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0).cloneRange();
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length === 0 && !pre.cloneContents().querySelector('img,br');
}

function extractAfterCaret(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return '';
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const after = document.createRange();
  after.setStart(r.endContainer, r.endOffset);
  after.setEnd(el, el.childNodes.length);
  const frag = after.extractContents();
  const div = document.createElement('div');
  div.appendChild(frag);
  return sanitizeInline(div.innerHTML);
}

// ------------------------------------------------------------------ rich text (heading / paragraph / quote)

function useEditableSync(ref: React.RefObject<HTMLElement | null>, html: string) {
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (last.current !== html && sanitizeInline(el.innerHTML) !== html) el.innerHTML = html;
    last.current = html;
  }, [html, ref]);
  return last;
}

const TextEditor = memo(function TextEditor({ block, h }: { block: TextBlock; h: BlockHandlers }) {
  const { t } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const last = useEditableSync(ref, block.html);
  useLayoutEffect(() => { h.register(ref.current); return () => h.register(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeInline(el.innerHTML);
    last.current = html;
    if (html !== block.html) h.onChange({ ...block, html }, true);
  };

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    const el = ref.current!;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const after = extractAfterCaret(el);
      emit();
      h.onSplit(after);
    } else if (e.key === 'Backspace' && caretAtStart(el)) {
      e.preventDefault();
      emit();
      h.onMergeUp();
    } else if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
      emit();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? sanitizeInline(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, clean);
    emit();
  };

  const placeholder = block.type === 'heading' ? t('editor.headingPh') : block.type === 'quote' ? t('editor.quotePh') : t('editor.paragraphPh');
  const Tag = block.type === 'heading' ? (`h${block.level + 1}` as 'h2') : 'div';
  return (
    <div className={`blk blk-${block.type} ${block.type === 'heading' ? `lvl-${block.level}` : ''}`} data-block={block.id}>
      <Tag
        ref={ref as React.RefObject<HTMLHeadingElement>}
        className={`editable align-${'align' in block && block.align ? block.align : 'left'}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={block.type !== 'heading'}
        aria-label={placeholder}
        data-placeholder={placeholder}
        spellCheck
        onInput={emit}
        onBlur={emit}
        onFocus={h.onFocus}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {block.type === 'quote' && (
        <input className="quote-cite" value={block.cite ?? ''} placeholder={t('editor.quoteCitePh')} onChange={(e) => h.onChange({ ...block, cite: e.target.value }, true)} onFocus={h.onFocus} aria-label={t('editor.quoteCitePh')} />
      )}
    </div>
  );
});

// ------------------------------------------------------------------ list

const ListEditor = memo(function ListEditor({ block, h }: { block: ListBlock; h: BlockHandlers }) {
  const { t } = useSettings();
  const ref = useRef<HTMLUListElement>(null);
  const html = block.items.map((i) => `<li>${i || '<br>'}</li>`).join('');
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    if (last.current !== html) ref.current.innerHTML = html;
    last.current = html;
  }, [html]);
  useLayoutEffect(() => { h.register(ref.current); return () => h.register(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const read = () => {
    const el = ref.current!;
    let lis = Array.from(el.querySelectorAll('li')).map((li) => sanitizeInline(li.innerHTML));
    if (!lis.length) lis = [sanitizeInline(el.innerHTML)];
    return lis;
  };
  const emit = () => {
    const items = read();
    last.current = items.map((i) => `<li>${i || '<br>'}</li>`).join('');
    if (items.join('\u0000') !== block.items.join('\u0000')) h.onChange({ ...block, items }, true);
  };
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const sel = window.getSelection();
      const li = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('li') : null;
      if (li && !li.textContent?.trim() && li === ref.current?.lastElementChild) {
        e.preventDefault();
        li.remove();
        emit();
        h.onExitList();
      }
    } else if (e.key === 'Backspace' && read().every((x) => !x.trim()) && ref.current && caretAtStart(ref.current)) {
      e.preventDefault();
      h.onMergeUp();
    }
  };
  const Tag = block.ordered ? 'ol' : 'ul';
  return (
    <div className="blk blk-list" data-block={block.id}>
      <Tag ref={ref as React.RefObject<HTMLUListElement & HTMLOListElement>} className="editable" contentEditable suppressContentEditableWarning
        role="textbox" aria-multiline aria-label={t('editor.listItemPh')} onInput={emit} onBlur={emit} onFocus={h.onFocus} onKeyDown={onKeyDown}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} />
    </div>
  );
});

// ------------------------------------------------------------------ table

function TableEditor({ block, h }: { block: TableBlock; h: BlockHandlers }) {
  const { t } = useSettings();
  const cols = Math.max(1, ...block.rows.map((r) => r.length));
  const setCell = (r: number, c: number, v: string) => {
    const rows = block.rows.map((row) => Array.from({ length: cols }, (_, i) => row[i] ?? ''));
    rows[r][c] = v;
    h.onChange({ ...block, rows }, true);
  };
  const addRow = () => h.onChange({ ...block, rows: [...block.rows, Array(cols).fill('')] });
  const addCol = () => h.onChange({ ...block, rows: block.rows.map((r) => [...r, '']) });
  const delRow = () => block.rows.length > 1 && h.onChange({ ...block, rows: block.rows.slice(0, -1) });
  const delCol = () => cols > 1 && h.onChange({ ...block, rows: block.rows.map((r) => r.slice(0, cols - 1)) });
  return (
    <div className="blk blk-table" data-block={block.id} ref={(el) => h.register(el)}>
      <div className="table-scroll">
        <table className={block.header ? 'has-header' : ''}>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c}><input value={row[c] ?? ''} onChange={(e) => setCell(r, c, e.target.value)} onFocus={h.onFocus} aria-label={`${r + 1}:${c + 1}`} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="blk-tools">
        <Button size="sm" variant="ghost" icon="plus" onClick={addRow}>{t('editor.tableAddRow')}</Button>
        <Button size="sm" variant="ghost" icon="plus" onClick={addCol}>{t('editor.tableAddCol')}</Button>
        <IconButton icon="minus" label={t('editor.tableRemoveRow')} onClick={delRow} size={18} />
        <IconButton icon="x" label={t('editor.tableRemoveCol')} onClick={delCol} size={18} />
        <label className="mini-check"><input type="checkbox" checked={block.header} onChange={(e) => h.onChange({ ...block, header: e.target.checked })} /> {t('editor.tableHeader')}</label>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ media

function useUpload(kind: 'image' | 'audio') {
  const { t } = useSettings();
  const { toast } = useUi();
  return async (file: File | undefined): Promise<string | null> => {
    if (!file) return null;
    if (!file.type.startsWith(`${kind}/`)) { toast(t('editor.unsupportedFile'), 'error'); return null; }
    if (file.size > MAX_ASSET_BYTES) { toast(t('editor.fileTooLarge', { mb: Math.round(MAX_ASSET_BYTES / 1048576) }), 'error'); return null; }
    try { return (await assets.put(file, file.name)).id; } catch (e) { toast(String((e as Error).message), 'error'); return null; }
  };
}

function ImageEditor({ block, h }: { block: ImageBlock; h: BlockHandlers }) {
  const { t } = useSettings();
  const url = useAssetUrl(block.assetId);
  const upload = useUpload('image');
  const input = useRef<HTMLInputElement>(null);
  const pick = async (f?: File) => { const id = await upload(f); if (id) h.onChange({ ...block, assetId: id }); };
  return (
    <div className="blk blk-image" data-block={block.id} ref={(el) => h.register(el)} tabIndex={-1} onFocus={h.onFocus}>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="image-input" />
      {url ? (
        <figure className={`img-${block.width}`}>
          <img src={url} alt={block.caption || ''} />
        </figure>
      ) : (
        <button type="button" className="drop-zone" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
          <Icon name="image" size={28} /><span>{t('editor.uploadImage')}</span>
        </button>
      )}
      <input className="caption" value={block.caption} placeholder={t('editor.captionPh')} onChange={(e) => h.onChange({ ...block, caption: e.target.value }, true)} onFocus={h.onFocus} aria-label={t('editor.captionPh')} />
      {url && (
        <div className="blk-tools">
          <Segmented value={block.width} label={t('editor.imageSize')} onChange={(w) => h.onChange({ ...block, width: w })}
            options={(['small', 'medium', 'full'] as const).map((v) => ({ value: v, label: t(`editor.size.${v}` as MessageKey) }))} />
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => input.current?.click()}>{t('editor.replaceImage')}</Button>
        </div>
      )}
    </div>
  );
}

function AudioEditor({ block, h }: { block: AudioBlock; h: BlockHandlers }) {
  const { t } = useSettings();
  const url = useAssetUrl(block.assetId);
  const upload = useUpload('audio');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="blk blk-audio" data-block={block.id} ref={(el) => h.register(el)} tabIndex={-1} onFocus={h.onFocus}>
      <input ref={input} type="file" accept="audio/*" hidden onChange={async (e) => { const id = await upload(e.target.files?.[0]); e.target.value = ''; if (id) h.onChange({ ...block, assetId: id, title: block.title || e.target.files?.[0]?.name || '' }); }} />
      <div className="audio-card">
        <span className="quick-icon tone-violet"><Icon name="music" size={22} /></span>
        <input className="caption" value={block.title} placeholder={t('editor.audioTitlePh')} onChange={(e) => h.onChange({ ...block, title: e.target.value }, true)} onFocus={h.onFocus} aria-label={t('editor.audioTitlePh')} />
        <Button size="sm" variant="secondary" icon="upload" onClick={() => input.current?.click()}>{t('editor.uploadAudio')}</Button>
      </div>
      {url && <audio controls src={url} preload="metadata" />}
    </div>
  );
}

// ------------------------------------------------------------------ dispatcher

export function BlockView({ block, h, active }: { block: Block; h: BlockHandlers; active: boolean }) {
  const { t } = useSettings();
  let inner: React.ReactNode;
  switch (block.type) {
    case 'heading': case 'paragraph': case 'quote': inner = <TextEditor key={block.type === 'heading' ? `h${block.level}` : block.type} block={block} h={h} />; break;
    case 'list': inner = <ListEditor key={block.ordered ? 'ol' : 'ul'} block={block} h={h} />; break;
    case 'table': inner = <TableEditor block={block} h={h} />; break;
    case 'image': inner = <ImageEditor block={block} h={h} />; break;
    case 'audio': inner = <AudioEditor block={block} h={h} />; break;
    case 'divider': inner = <div className="blk blk-divider" tabIndex={0} ref={(el) => h.register(el)} onFocus={h.onFocus} role="separator"><hr /></div>; break;
    case 'pagebreak': inner = <div className="blk blk-pagebreak" tabIndex={0} ref={(el) => h.register(el)} onFocus={h.onFocus}><span>{t('editor.pageBreak')}</span></div>; break;
  }
  return (
    <div className={`blk-wrap ${active ? 'is-active' : ''}`}>
      {inner}
      <button type="button" className="blk-handle" onMouseDown={(e) => e.preventDefault()} onClick={h.onMenu} aria-label={t('editor.blockActions')} data-testid="block-handle">
        <Icon name="moreH" size={18} />
      </button>
    </div>
  );
}
