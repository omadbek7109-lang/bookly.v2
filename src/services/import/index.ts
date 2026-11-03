/**
 * Importers convert TXT / DOCX / EPUB files into the Bookly document model.
 * They report anything they could not convert in `warnings` instead of silently dropping it.
 */
import { createBlock, createBook, createChapter, type Block, type Book, type Chapter } from '../../models/book';
import { uid } from '../../utils/id';
import { escapeHtml, plainText, sanitizeInline } from '../../utils/inline';

export interface PendingAsset { id: string; blob: Blob; name: string }
export interface ImportResult { book: Book; assets: PendingAsset[]; warnings: string[] }

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export async function importFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Fayl 25 MB dan katta');
  const ext = file.name.toLowerCase().split('.').pop();
  const baseTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  if (ext === 'txt' || ext === 'md' || file.type === 'text/plain') return importText(await decodeText(file), baseTitle);
  if (ext === 'docx') return importDocx(await file.arrayBuffer(), baseTitle);
  if (ext === 'epub') return importEpub(await file.arrayBuffer(), baseTitle);
  throw new Error('UNSUPPORTED');
}

async function decodeText(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1251').decode(buf); } catch { return utf8; }
}

// ------------------------------------------------------------------ TXT / Markdown

const CHAPTER_RE = /^(?:#\s+.+|(?:\d+\s*[-.]?\s*)?(?:bob|chapter|глава|qism|part)\b.*|(?:bob|chapter|глава)\s+\d+.*)$/i;

export function importText(text: string, fallbackTitle = 'Import qilingan kitob'): ImportResult {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters: Chapter[] = [];
  let title = fallbackTitle;
  let current: Chapter | null = null;
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const ensureChapter = () => { if (!current) { current = createChapter(chapters.length ? `${chapters.length + 1}-bob` : 'Kirish', []); current.blocks = []; chapters.push(current); } return current; };
  const flushPara = () => {
    if (para.length) { ensureChapter().blocks.push(createBlock('paragraph', { html: escapeHtml(para.join(' ').replace(/\s+/g, ' ').trim()) })); para = []; }
  };
  const flushList = () => { if (list) { ensureChapter().blocks.push(createBlock('list', { ordered: list.ordered, items: list.items.map(escapeHtml) })); list = null; } };

  // A leading Markdown "# Title" followed by chapter headings becomes the book title.
  const firstNonEmpty = lines.findIndex((l) => l.trim());
  if (firstNonEmpty >= 0 && /^#\s+/.test(lines[firstNonEmpty]) && lines.filter((l) => /^#\s+/.test(l)).length > 1) {
    title = lines[firstNonEmpty].replace(/^#\s+/, '').trim();
    lines.splice(firstNonEmpty, 1);
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { flushPara(); flushList(); continue; }
    if (CHAPTER_RE.test(t) && t.length < 120) {
      flushPara(); flushList();
      current = createChapter(t.replace(/^#\s+/, ''), []);
      current.blocks = [];
      chapters.push(current);
      continue;
    }
    const h = /^(#{2,4})\s+(.+)$/.exec(t);
    if (h) { flushPara(); flushList(); ensureChapter().blocks.push(createBlock('heading', { level: Math.min(3, h[1].length - 1) as 1 | 2 | 3, html: escapeHtml(h[2]) })); continue; }
    const li = /^(?:([-*•])|(\d+)[.)])\s+(.+)$/.exec(t);
    if (li) {
      flushPara();
      const ordered = !!li[2];
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(li[3]);
      continue;
    }
    if (/^>\s?/.test(t)) { flushPara(); flushList(); ensureChapter().blocks.push(createBlock('quote', { html: escapeHtml(t.replace(/^>\s?/, '')) })); continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); flushList(); ensureChapter().blocks.push(createBlock('divider')); continue; }
    flushList();
    para.push(t);
  }
  flushPara(); flushList();
  if (!chapters.length) { warnings.push('Fayl bo‘sh — bitta bo‘sh bob yaratildi.'); chapters.push(createChapter('1-bob')); }
  for (const c of chapters) if (!c.blocks.length) c.blocks.push(createBlock('paragraph'));
  const book = createBook({ title, chapters, source: 'import' });
  return { book, assets: [], warnings };
}

// ------------------------------------------------------------------ DOCX

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parseXml(xml: string, type: DOMParserSupportedType = 'application/xml'): Document {
  const doc = new DOMParser().parseFromString(xml, type);
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML tahlil qilinmadi');
  return doc;
}

function wAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`);
}

function child(el: Element, local: string): Element | null {
  for (const c of Array.from(el.children)) if (c.localName === local) return c;
  return null;
}

export async function importDocx(data: ArrayBuffer, fallbackTitle: string): Promise<ImportResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('word/document.xml topilmadi — bu DOCX fayl emas');
  const warnings: string[] = [];
  const assets: PendingAsset[] = [];
  const doc = parseXml(docXml);

  // relationships (images)
  const rels = new Map<string, string>();
  const relXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (relXml) for (const r of Array.from(parseXml(relXml).getElementsByTagName('Relationship'))) rels.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '');

  // numbering: numId -> ordered?
  const ordered = new Map<string, boolean>();
  const numXml = await zip.file('word/numbering.xml')?.async('string');
  if (numXml) {
    const nd = parseXml(numXml);
    const abs = new Map<string, boolean>();
    for (const a of Array.from(nd.getElementsByTagNameNS(W_NS, 'abstractNum'))) {
      const lvl = a.getElementsByTagNameNS(W_NS, 'lvl')[0];
      const fmt = wAttr(lvl ? lvl.getElementsByTagNameNS(W_NS, 'numFmt')[0] : null, 'val');
      abs.set(wAttr(a, 'abstractNumId') || '', !!fmt && fmt !== 'bullet' && fmt !== 'none');
    }
    for (const n of Array.from(nd.getElementsByTagNameNS(W_NS, 'num'))) {
      const absId = wAttr(n.getElementsByTagNameNS(W_NS, 'abstractNumId')[0], 'val') || '';
      ordered.set(wAttr(n, 'numId') || '', abs.get(absId) ?? false);
    }
  }

  // core title
  let title = fallbackTitle;
  let author = '';
  const core = await zip.file('docProps/core.xml')?.async('string');
  if (core) {
    const cd = parseXml(core);
    title = cd.getElementsByTagName('dc:title')[0]?.textContent?.trim() || title;
    author = cd.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || '';
  }

  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  let titleTaken = false;
  let pendingList: { ordered: boolean; numId: string; items: string[] } | null = null;
  const ensure = () => { if (!current) { current = createChapter(chapters.length ? `${chapters.length + 1}-bob` : 'Kirish', []); current.blocks = []; chapters.push(current); } return current; };
  const flushList = () => { if (pendingList) { ensure().blocks.push(createBlock('list', { ordered: pendingList.ordered, items: pendingList.items })); pendingList = null; } };
  let skippedObjects = 0;

  const runsHtml = async (p: Element): Promise<{ html: string; images: string[] }> => {
    let html = '';
    const images: string[] = [];
    const walk = async (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (c.localName === 'r') {
          const rpr = child(c, 'rPr');
          const on = (n: string) => { const e = rpr ? child(rpr, n) : null; return !!e && wAttr(e, 'val') !== '0' && wAttr(e, 'val') !== 'false' && wAttr(e, 'val') !== 'none'; };
          let text = '';
          for (const rc of Array.from(c.children)) {
            if (rc.localName === 't') text += escapeHtml(rc.textContent || '');
            else if (rc.localName === 'tab') text += ' ';
            else if (rc.localName === 'br' || rc.localName === 'cr') text += '<br>';
            else if (rc.localName === 'drawing' || rc.localName === 'pict') {
              const blip = rc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0];
              const rid = blip?.getAttributeNS(R_NS, 'embed') || blip?.getAttribute('r:embed');
              const target = rid ? rels.get(rid) : undefined;
              const f = target ? zip.file(`word/${target.replace(/^\/?word\//, '')}`) : null;
              if (f) {
                const blob = new Blob([await f.async('uint8array') as BlobPart], { type: mimeFromName(target!) });
                const id = uid('ast');
                assets.push({ id, blob, name: target!.split('/').pop() || 'image' });
                images.push(id);
              } else skippedObjects++;
            } else if (rc.localName === 'object') skippedObjects++;
          }
          if (!text) continue;
          if (on('u')) text = `<u>${text}</u>`;
          if (on('i')) text = `<i>${text}</i>`;
          if (on('b')) text = `<b>${text}</b>`;
          html += text;
        } else if (c.localName === 'hyperlink' || c.localName === 'ins' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'sdtContent') {
          await walk(c);
        }
      }
    };
    await walk(p);
    return { html: sanitizeInline(html), images };
  };

  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) throw new Error('DOCX tanasi topilmadi');
  for (const el of Array.from(body.children)) {
    if (el.localName === 'p') {
      const ppr = child(el, 'pPr');
      const style = (wAttr(ppr ? child(ppr, 'pStyle') : null, 'val') || '').toLowerCase();
      const outline = wAttr(ppr ? child(ppr, 'outlineLvl') : null, 'val');
      const numPr = ppr ? child(ppr, 'numPr') : null;
      const jc = wAttr(ppr ? child(ppr, 'jc') : null, 'val');
      const { html, images } = await runsHtml(el);
      const text = plainText(html).trim();
      const level = /^(heading|title|sarlavha|заголовок)\s*(\d)?$/.exec(style.replace(/[_-]/g, ''));
      const headingLevel = style === 'title' ? 0 : level ? Number(level[2] || 1) : outline !== null ? Number(outline) + 1 : null;

      if (numPr && text) {
        const numId = wAttr(child(numPr, 'numId'), 'val') || '0';
        const isOrdered = ordered.get(numId) ?? false;
        if (!pendingList || pendingList.numId !== numId) { flushList(); pendingList = { ordered: isOrdered, numId, items: [] }; }
        pendingList.items.push(html);
        continue;
      }
      flushList();
      if (headingLevel !== null && text) {
        if (headingLevel === 0 && !titleTaken) { title = text; titleTaken = true; continue; }
        if (headingLevel <= 1) { current = createChapter(text, []); current.blocks = []; (current as Chapter & { __explicit?: boolean }).__explicit = true; chapters.push(current); continue; }
        ensure().blocks.push(createBlock('heading', { level: Math.min(3, headingLevel - 1) as 1 | 2 | 3, html }));
        continue;
      }
      if (style.includes('quote') || style.includes('iqtibos')) { if (text) ensure().blocks.push(createBlock('quote', { html })); continue; }
      if (text) ensure().blocks.push(createBlock('paragraph', { html, align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : undefined }));
      for (const id of images) ensure().blocks.push(createBlock('image', { assetId: id, caption: '', width: 'full' }));
      if (child(el, 'r') && Array.from(el.getElementsByTagNameNS(W_NS, 'br')).some((b) => wAttr(b, 'type') === 'page') && !text) ensure().blocks.push(createBlock('pagebreak'));
    } else if (el.localName === 'tbl') {
      flushList();
      const rows: string[][] = [];
      for (const tr of Array.from(el.children).filter((c) => c.localName === 'tr')) {
        rows.push(Array.from(tr.children).filter((c) => c.localName === 'tc').map((tc) => Array.from(tc.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent).join('').trim()));
      }
      if (rows.length) ensure().blocks.push(createBlock('table', { header: true, rows }));
    } else if (el.localName === 'sdt') {
      warnings.push('Avtomatik mundarija (TOC) maydoni o‘tkazib yuborildi — Bookly mundarijani o‘zi yaratadi.');
    }
  }
  flushList();

  // --- post-processing: chapter labels, table-of-contents chapters and front matter
  const LABEL = /^(\d+\s*-\s*bob|chapter\s+\d+|глава\s+\d+)$/i;
  const TOC = /^(mundarija|contents|table of contents|содержание|оглавление)$/i;
  for (const c of chapters) c.blocks = c.blocks.filter((b) => !(b.type === 'paragraph' && LABEL.test(plainText(b.html).trim())));
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (TOC.test(chapters[i].title.trim())) { chapters.splice(i, 1); warnings.push('Hujjatdagi mundarija o‘tkazib yuborildi — Bookly uni avtomatik yaratadi.'); }
  }
  let frontCover: string | null = null;
  let description = '';
  if (chapters.length > 1 && chapters[0].title === 'Kirish' && !titleTakenAsChapter(chapters[0])) {
    const front = chapters[0];
    const words = front.blocks.reduce((n, b) => n + plainText('html' in b ? (b as { html: string }).html : '').split(/\s+/).filter(Boolean).length, 0);
    if (words < 80) {
      chapters.shift();
      const img = front.blocks.find((b) => b.type === 'image');
      if (img && img.type === 'image') frontCover = img.assetId;
      const paras = front.blocks.filter((b) => b.type === 'paragraph').map((b) => plainText((b as { html: string }).html).trim()).filter(Boolean);
      description = paras.slice(-1)[0] ?? '';
    }
  }
  if (skippedObjects) warnings.push(`${skippedObjects} ta qo‘llab-quvvatlanmaydigan obyekt (diagramma, formula yoki joylashtirilgan fayl) o‘tkazib yuborildi.`);
  if (!chapters.length) { warnings.push('Hujjatda matn topilmadi.'); chapters.push(createChapter('1-bob')); }
  for (const c of chapters) { delete (c as Chapter & { __explicit?: boolean }).__explicit; if (!c.blocks.length) c.blocks.push(createBlock('paragraph')); }
  if (chapters.length === 1 && chapters[0].title === 'Kirish') warnings.push('“Heading 1” sarlavhalari topilmadi — butun matn bitta bobga joylandi.');
  const book = createBook({ title, author: author === 'Bookly' ? '' : author, description, chapters, source: 'import' });
  if (frontCover) {
    book.cover.background = { ...book.cover.background, kind: 'image', imageAssetId: frontCover };
    book.cover.overlay = 0;
    book.cover.title = ''; book.cover.author = '';
  }
  return { book, assets, warnings };
}

/** True when the first chapter came from a real "Heading 1" titled "Kirish" (not the implicit front-matter bucket). */
function titleTakenAsChapter(c: Chapter): boolean {
  return (c as Chapter & { __explicit?: boolean }).__explicit === true;
}

function mimeFromName(n: string): string {
  const e = n.toLowerCase().split('.').pop();
  return e === 'png' ? 'image/png' : e === 'gif' ? 'image/gif' : e === 'webp' ? 'image/webp' : e === 'svg' ? 'image/svg+xml' : e === 'mp3' ? 'audio/mpeg' : e === 'm4a' ? 'audio/mp4' : 'image/jpeg';
}

// ------------------------------------------------------------------ EPUB

function resolvePath(base: string, rel: string): string {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').concat(decodeURIComponent(rel.split('#')[0])).split('/');
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

export async function importEpub(data: ArrayBuffer, fallbackTitle: string): Promise<ImportResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const warnings: string[] = [];
  const assets: PendingAsset[] = [];
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('META-INF/container.xml topilmadi — bu EPUB emas');
  const opfPath = parseXml(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('OPF fayl ko‘rsatilmagan');
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('OPF fayl topilmadi');
  const opf = parseXml(opfXml);
  const meta = (tag: string) => opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', tag)[0]?.textContent?.trim() || '';
  const title = meta('title') || fallbackTitle;
  const author = meta('creator');
  const description = meta('description').replace(/<[^>]+>/g, '');
  const langRaw = meta('language').toLowerCase();
  const language = langRaw.startsWith('ru') ? 'ru' : langRaw.startsWith('en') ? 'en' : 'uz';

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of Array.from(opf.getElementsByTagName('item'))) {
    manifest.set(it.getAttribute('id') || '', { href: resolvePath(opfPath, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  }
  const spine = Array.from(opf.getElementsByTagName('itemref')).map((r) => ({ idref: r.getAttribute('idref') || '', linear: r.getAttribute('linear') !== 'no' }));
  const chapters: Chapter[] = [];
  const assetByPath = new Map<string, string>();
  let skippedAudio = 0, skippedOther = 0;

  const assetFor = async (path: string): Promise<string | null> => {
    if (assetByPath.has(path)) return assetByPath.get(path)!;
    const f = zip.file(path);
    if (!f) return null;
    const blob = new Blob([await f.async('uint8array') as BlobPart], { type: mimeFromName(path) });
    const id = uid('ast');
    assets.push({ id, blob, name: path.split('/').pop() || 'image' });
    assetByPath.set(path, id);
    return id;
  };

  for (const { idref, linear } of spine) {
    const item = manifest.get(idref);
    if (!item || !linear || item.props.includes('nav')) continue;
    if (!/x?html/.test(item.type)) continue;
    const src = await zip.file(item.href)?.async('string');
    if (!src) { warnings.push(`Spine fayli topilmadi: ${item.href}`); continue; }
    let d: Document;
    try { d = parseXml(src, 'application/xhtml+xml'); } catch { d = new DOMParser().parseFromString(src, 'text/html'); }
    const bodyEl = d.getElementsByTagName('body')[0];
    if (!bodyEl) continue;
    const type = (bodyEl.getAttribute('epub:type') || '') + ' ' + Array.from(bodyEl.querySelectorAll('section')).map((s) => s.getAttribute('epub:type') || '').join(' ');
    if (/\b(cover|titlepage|toc)\b/.test(type) && bodyEl.textContent!.trim().length < 400) continue;

    const blocks: Block[] = [];
    let chapterTitle = '';
    const visit = async (el: Element) => {
      for (const c of Array.from(el.children)) {
        const tag = c.localName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          const text = (c.textContent || '').trim();
          if (!text) continue;
          if (!chapterTitle && (tag === 'h1' || tag === 'h2')) { chapterTitle = text; continue; }
          blocks.push(createBlock('heading', { level: Math.min(3, Math.max(1, Number(tag[1]) - 1)) as 1 | 2 | 3, html: sanitizeInline(c.innerHTML) }));
        } else if (tag === 'p') {
          if ((c.getAttribute('class') || '').includes('chapter-label')) continue;
          const imgs = Array.from(c.getElementsByTagName('img'));
          const html = sanitizeInline(c.innerHTML);
          if (plainText(html).trim()) blocks.push(createBlock('paragraph', { html }));
          for (const im of imgs) { const id = await assetFor(resolvePath(item.href, im.getAttribute('src') || '')); if (id) blocks.push(createBlock('image', { assetId: id, caption: im.getAttribute('alt') || '', width: 'full' })); }
        } else if (tag === 'blockquote') {
          const cite = c.getElementsByTagName('cite')[0];
          const citeText = cite?.textContent?.replace(/^—\s*/, '').trim() || '';
          cite?.remove();
          blocks.push(createBlock('quote', { html: sanitizeInline(c.innerHTML), cite: citeText }));
        } else if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(c.children).filter((x) => x.localName === 'li').map((li) => sanitizeInline(li.innerHTML)).filter((x) => plainText(x).trim());
          if (items.length) blocks.push(createBlock('list', { ordered: tag === 'ol', items }));
        } else if (tag === 'img' || tag === 'figure' || tag === 'image') {
          const im = tag === 'figure' ? c.getElementsByTagName('img')[0] : c;
          const srcAttr = im?.getAttribute('src') || im?.getAttribute('xlink:href') || im?.getAttribute('href');
          if (srcAttr) {
            const id = await assetFor(resolvePath(item.href, srcAttr));
            const cap = c.getElementsByTagName('figcaption')[0]?.textContent?.trim() || im?.getAttribute('alt') || '';
            if (id) blocks.push(createBlock('image', { assetId: id, caption: cap, width: 'full' }));
          }
        } else if (tag === 'table') {
          const rows = Array.from(c.getElementsByTagName('tr')).map((tr) => Array.from(tr.children).map((td) => (td.textContent || '').trim()));
          if (rows.length) blocks.push(createBlock('table', { header: !!c.getElementsByTagName('th').length, rows }));
        } else if (tag === 'hr') {
          blocks.push(createBlock('divider'));
        } else if (tag === 'audio' || tag === 'video') {
          skippedAudio++;
        } else if (tag === 'svg' || tag === 'math' || tag === 'iframe' || tag === 'object') {
          skippedOther++;
        } else if (['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'body'].includes(tag)) {
          if ((c.getAttribute('class') || '').includes('pagebreak')) { blocks.push(createBlock('pagebreak')); continue; }
          if ((c.getAttribute('class') || '').includes('audio')) { skippedAudio++; continue; }
          await visit(c);
        } else if (c.textContent?.trim()) {
          blocks.push(createBlock('paragraph', { html: sanitizeInline(c.innerHTML || c.textContent || '') }));
        }
      }
    };
    await visit(bodyEl);
    if (!blocks.length && !chapterTitle) continue;
    const t = chapterTitle || d.getElementsByTagName('title')[0]?.textContent?.trim() || `${chapters.length + 1}-bob`;
    const ch = createChapter(t, blocks);
    chapters.push(ch);
  }
  if (skippedAudio) warnings.push(`${skippedAudio} ta audio/video element import qilinmadi.`);
  if (skippedOther) warnings.push(`${skippedOther} ta SVG/formula/ichki obyekt import qilinmadi.`);
  const coverItem = [...manifest.values()].find((m) => m.props.includes('cover-image'));
  if (!chapters.length) { warnings.push('EPUB ichida o‘qiladigan bob topilmadi.'); chapters.push(createChapter('1-bob')); }
  const book = createBook({ title, author, description, language, chapters, source: 'import' });
  if (coverItem) {
    const id = await assetFor(coverItem.href);
    if (id) {
      book.cover.background = { ...book.cover.background, kind: 'image', imageAssetId: id };
      book.cover.overlay = 0.35;
    }
  }
  return { book, assets, warnings };
}
