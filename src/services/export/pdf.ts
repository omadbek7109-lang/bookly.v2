/**
 * PDF exporter (pdf-lib). Lays out the Bookly document model directly — no screenshots.
 * Text is drawn with embedded Unicode TrueType fonts (Bookly Serif/Sans/Mono, subsets of Liberation,
 * metric-compatible with Times/Arial/Courier), so Cyrillic, Uzbek Latin (oʻ gʻ ʻ) and Russian stay real,
 * copyable text. Only if the font files cannot be loaded does it fall back to the standard WinAnsi fonts
 * with transliteration, so an export never fails because of fonts.
 */
import { PDFDocument, PDFFont, PDFName, PDFPage, PDFArray, StandardFonts, rgb, type RGB } from 'pdf-lib';
import type { Block, Book } from '../../models/book';
import { isSingleText } from '../../models/book';
import { fontById } from '../../models/templates';
import { parseInline, type Run } from '../../utils/inline';
import { audioNote, byLabel, chapterDisplayTitle, chapterLabel, exportFilename, isUzCyrillic, tocLabel } from './common';
import { MIME, type ExportInput, type ExportOutput, type ResolvedAsset } from './types';
import { loadPdfFont, pdfFontFile, type PdfFontKind, type PdfFontStyle } from './pdfFonts';
import { miniFontkit, type TtfFont } from './ttf';

const SIZES = { A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792] } as const;

// ------------------------------------------------------------------ WinAnsi safety

const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
};
const REPL: Record<string, string> = { 'ʻ': '‘', 'ʼ': '’', '′': "'", '″': '"', '‐': '-', '‑': '-', '−': '-', '«': '«', '»': '»', ' ': ' ', ' ': ' ', '​': '', '→': '->', '←': '<-', '✓': 'v', '★': '*' };

export function toWinAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_EXTRA.includes(ch)) { out += ch; continue; }
    if (ch in REPL) { out += REPL[ch]; continue; }
    const lower = ch.toLowerCase();
    if (lower in CYR) { const t = CYR[lower]; out += ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1); continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && base !== ch && [...base].every((c) => c.charCodeAt(0) < 0x7f) ? base : (code < 0x20 ? '' : '?');
  }
  return out;
}

// ------------------------------------------------------------------ helpers

function color(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) ?? ['', '4f46e5'];
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Family {
  regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont;
  /** Prepares text for this family: Unicode fonts keep it, standard fonts get WinAnsi transliteration. */
  enc: (s: string) => string;
}

const STYLES: PdfFontStyle[] = ['Regular', 'Bold', 'Italic', 'BoldItalic'];

/** Characters the embedded font lacks are replaced by close equivalents (never a missing-glyph box). */
function unicodeEncoder(fonts: TtfFont[]): (s: string) => string {
  const has = (cp: number) => fonts.every((f) => f.hasCodePoint(cp));
  return (s: string) => {
    let out = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x09) { out += ' '; continue; }
      if (cp < 0x20) continue;
      if (has(cp)) { out += ch; continue; }
      if (ch in REPL && [...REPL[ch]].every((c) => has(c.codePointAt(0)!))) { out += REPL[ch]; continue; }
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out += base && base !== ch && [...base].every((c) => has(c.codePointAt(0)!)) ? base : '?';
    }
    return out;
  };
}

async function family(doc: PDFDocument, kind: PdfFontKind): Promise<Family> {
  try {
    const bytes = await Promise.all(STYLES.map((st) => loadPdfFont(pdfFontFile(kind, st))));
    doc.registerFontkit(miniFontkit as never);
    const parsed = bytes.map((b) => miniFontkit.create(b));
    const [regular, bold, italic, boldItalic] = await Promise.all(bytes.map((b) => doc.embedFont(b, { subset: true })));
    return { regular, bold, italic, boldItalic, enc: unicodeEncoder(parsed) };
  } catch (e) {
    console.warn('[bookly] Unicode PDF fonts unavailable, using standard fonts', e);
  }
  const map = {
    Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  }[kind];
  const [regular, bold, italic, boldItalic] = await Promise.all(map.map((f) => doc.embedFont(f)));
  return { regular, bold, italic, boldItalic, enc: toWinAnsi };
}

const pick = (f: Family, b?: boolean, i?: boolean) => (b && i ? f.boldItalic : b ? f.bold : i ? f.italic : f.regular);

interface Token { text: string; font: PDFFont; size: number; underline?: boolean; space: boolean; width: number; br?: boolean }

function tokenize(runs: Run[], fam: Family, size: number, forceBold = false, forceItalic = false): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const font = pick(fam, r.bold || forceBold, r.italic || forceItalic);
    const text = fam.enc(r.text);
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      const t = space ? ' ' : part;
      out.push({ text: t, font, size, underline: r.underline, space, width: font.widthOfTextAtSize(t, size) });
    }
    if (r.br) out.push({ text: '', font, size, space: false, width: 0, br: true });
  }
  return out;
}

function wrap(tokens: Token[], maxWidth: number): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  let w = 0;
  const flush = () => {
    while (line.length && line[line.length - 1].space) line.pop();
    lines.push(line); line = []; w = 0;
  };
  for (const tok of tokens) {
    if (tok.br) { flush(); continue; }
    if (tok.space && line.length === 0) continue;
    if (w + tok.width > maxWidth && line.length) {
      flush();
      if (tok.space) continue;
    }
    if (tok.width > maxWidth) {
      // hard-break very long words
      let chunk = '';
      for (const ch of tok.text) {
        const cw = tok.font.widthOfTextAtSize(chunk + ch, tok.size);
        if (cw > maxWidth && chunk) {
          line.push({ ...tok, text: chunk, width: tok.font.widthOfTextAtSize(chunk, tok.size) }); flush(); chunk = ch;
        } else chunk += ch;
      }
      const cw = tok.font.widthOfTextAtSize(chunk, tok.size);
      line.push({ ...tok, text: chunk, width: cw }); w += cw;
      continue;
    }
    line.push(tok); w += tok.width;
  }
  if (line.length) flush();
  return lines.filter((l, i, arr) => l.length || (i > 0 && i < arr.length - 1));
}

// ------------------------------------------------------------------ layout engine

class Layout {
  page!: PDFPage;
  y = 0;
  readonly pages: { page: PDFPage; chapter: number | null }[] = [];
  chapter: number | null = null;

  constructor(
    readonly doc: PDFDocument,
    readonly w: number,
    readonly h: number,
    readonly m: { top: number; bottom: number; left: number; right: number },
  ) {}

  get contentWidth() { return this.w - this.m.left - this.m.right; }
  get top() { return this.h - this.m.top; }

  newPage() {
    this.page = this.doc.addPage([this.w, this.h]);
    this.pages.push({ page: this.page, chapter: this.chapter });
    this.y = this.top;
  }

  atTop() { return this.y >= this.top - 0.5; }

  ensure(height: number) {
    if (this.y - height < this.m.bottom) this.newPage();
  }

  /** Draws wrapped rich text; returns the drawn line rectangles (for decorations). */
  text(
    runs: Run[],
    o: { fam: Family; size: number; leading?: number; align?: string; indent?: number; color?: RGB; bold?: boolean; italic?: boolean; firstIndent?: number; widthLimit?: number },
  ): { page: PDFPage; y: number; h: number }[] {
    const leading = o.leading ?? o.size * 1.45;
    const indent = o.indent ?? 0;
    const maxW = (o.widthLimit ?? this.contentWidth) - indent;
    const lines = wrap(tokenize(runs, o.fam, o.size, o.bold, o.italic), maxW);
    const rects: { page: PDFPage; y: number; h: number }[] = [];
    lines.forEach((line, li) => {
      this.ensure(leading);
      const baseline = this.y - o.size;
      const lineW = line.reduce((s, t) => s + t.width, 0);
      let x = this.m.left + indent;
      let extra = 0;
      const spaces = line.filter((t) => t.space).length;
      if (o.align === 'center') x += (maxW - lineW) / 2;
      else if (o.align === 'right') x += maxW - lineW;
      else if (o.align === 'justify' && li < lines.length - 1 && spaces > 0 && lineW > maxW * 0.75) extra = (maxW - lineW) / spaces;
      for (const t of line) {
        if (!t.space && t.text) {
          this.page.drawText(t.text, { x, y: baseline, size: t.size, font: t.font, color: o.color });
          if (t.underline) this.page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + t.width, y: baseline - 1.5 }, thickness: 0.6, color: o.color });
        }
        x += t.width + (t.space ? extra : 0);
      }
      rects.push({ page: this.page, y: this.y, h: leading });
      this.y -= leading;
    });
    return rects;
  }

  space(h: number) {
    this.y -= h;
    if (this.y < this.m.bottom) this.newPage();
  }
}

// ------------------------------------------------------------------ main

async function embedImage(doc: PDFDocument, a: ResolvedAsset) {
  if (a.mime === 'image/png') return doc.embedPng(a.bytes);
  if (a.mime === 'image/jpeg') return doc.embedJpg(a.bytes);
  return null;
}

export async function exportPdf(input: ExportInput): Promise<ExportOutput> {
  const { book, assets, options } = input;
  const single = isSingleText(book);
  const doc = await PDFDocument.create();
  const [W, H] = SIZES[options.pageSize] ?? SIZES.A5;
  const small = W < 500;
  const margin = small ? { top: 58, bottom: 62, left: 50, right: 50 } : { top: 72, bottom: 72, left: 68, right: 68 };
  // one embedded font set per family, shared by body/headings/UI text
  const families = new Map<PdfFontKind, Promise<Family>>();
  const fam = (k: PdfFontKind) => { let f = families.get(k); if (!f) { f = family(doc, k); families.set(k, f); } return f; };
  const body = await fam(fontById(book.theme.bodyFont).pdf);
  const head = await fam(fontById(book.theme.headingFont).pdf);
  const ui = await fam('Helvetica');
  const ink = color(book.theme.ink || '#1c1b29');
  const accent = color(book.theme.accent || '#4f46e5');
  const muted = rgb(0.45, 0.45, 0.5);
  const base = (book.theme.baseSize || 12) * (small ? 0.88 : 1);

  // Document metadata is stored as UTF-16 by pdf-lib — no transliteration needed.
  doc.setTitle(book.title);
  doc.setAuthor(book.author || 'Bookly');
  doc.setSubject(book.description || book.subtitle || '');
  doc.setKeywords(book.metadata.keywords);
  doc.setCreator('Bookly 2.0');
  doc.setProducer('Bookly 2.0 (pdf-lib)');
  doc.setLanguage(book.language === 'uz' ? (isUzCyrillic(book) ? 'uz-Cyrl' : 'uz-Latn') : book.language);
  doc.setCreationDate(new Date(book.createdAt));
  doc.setModificationDate(new Date(book.updatedAt));

  // --- cover
  if (options.includeCover) {
    const p = doc.addPage([W, H]);
    const img = input.cover ? await embedImage(doc, input.cover) : null;
    if (img) {
      const scale = Math.max(W / img.width, H / img.height);
      p.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    } else {
      const [c1, c2] = book.cover.background.colors;
      const steps = 40;
      for (let i = 0; i < steps; i++) {
        const a = color(c1), b = color(c2), t = i / (steps - 1);
        p.drawRectangle({ x: 0, y: H - (H / steps) * (i + 1), width: W, height: H / steps + 1, color: rgb(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t) });
      }
      const tc = color(book.cover.textColor || '#ffffff');
      const titleLines = wrap(tokenize([{ text: book.cover.title || book.title }], head, small ? 26 : 34, true), W - 80);
      let y = H * 0.58 + (titleLines.length * 36) / 2;
      for (const l of titleLines) {
        const lw = l.reduce((s, t) => s + t.width, 0);
        let x = (W - lw) / 2;
        for (const t of l) { if (!t.space) p.drawText(t.text, { x, y, size: t.size, font: t.font, color: tc }); x += t.width; }
        y -= small ? 32 : 42;
      }
      const au = head.enc(book.cover.author || book.author);
      if (au) p.drawText(au, { x: (W - head.regular.widthOfTextAtSize(au, 13)) / 2, y: H * 0.18, size: 13, font: head.regular, color: tc });
    }
  }

  // --- title page
  const lay = new Layout(doc, W, H, margin);
  lay.newPage();
  const titlePageIndex = doc.getPageCount() - 1;
  lay.space(H * 0.22);
  lay.text([{ text: book.title }], { fam: head, size: small ? 24 : 30, bold: true, align: 'center', color: ink, leading: small ? 30 : 38 });
  if (book.subtitle) { lay.space(8); lay.text([{ text: book.subtitle }], { fam: head, size: base + 2, italic: true, align: 'center', color: muted }); }
  lay.space(18);
  lay.page.drawLine({ start: { x: W / 2 - 24, y: lay.y }, end: { x: W / 2 + 24, y: lay.y }, thickness: 1.5, color: accent });
  lay.space(22);
  if (book.author) lay.text([{ text: `${byLabel(book)} ${book.author}` }], { fam: head, size: base + 1, align: 'center', color: ink });
  if (book.description) { lay.space(30); lay.text(parseInline(book.description), { fam: body, size: base - 1, align: 'center', color: muted, indent: 20, widthLimit: lay.contentWidth - 20 }); }
  lay.page.drawText('Bookly 2.0', { x: (W - ui.regular.widthOfTextAtSize('Bookly 2.0', 8)) / 2, y: margin.bottom / 2, size: 8, font: ui.regular, color: muted });

  // --- chapters
  const chapterStart: number[] = [];
  const contentFirst = doc.getPageCount();
  for (let ci = 0; ci < book.chapters.length; ci++) {
    const ch = book.chapters[ci];
    lay.chapter = ci;
    if (single) {
      // One continuous text: start on a new page once, then flow every block without chapter headings.
      if (ci === 0) { lay.newPage(); chapterStart.push(doc.getPageCount() - 1); lay.space(base); }
      for (const b of ch.blocks) await drawBlock(b);
      continue;
    }
    lay.newPage();
    chapterStart.push(doc.getPageCount() - 1);
    lay.space(small ? 40 : 70);
    lay.text([{ text: chapterLabel(book, ci).toUpperCase() }], { fam: ui, size: 8.5, bold: true, color: accent });
    lay.space(6);
    lay.text([{ text: chapterDisplayTitle(book, ch, ci) }], { fam: head, size: small ? 20 : 24, bold: true, color: ink, leading: small ? 25 : 30 });
    lay.space(6);
    lay.page.drawRectangle({ x: margin.left, y: lay.y, width: 32, height: 2.5, color: accent });
    lay.space(base * 1.8);
    for (const b of ch.blocks) await drawBlock(b);
  }

  async function drawBlock(b: Block) {
    switch (b.type) {
      case 'heading': {
        const size = b.level === 1 ? base * 1.55 : b.level === 2 ? base * 1.3 : base * 1.1;
        lay.ensure(size * 3);
        lay.space(size * 0.6);
        lay.text(parseInline(b.html), { fam: head, size, bold: true, color: ink, align: b.align });
        lay.space(size * 0.35);
        break;
      }
      case 'paragraph': {
        const runs = parseInline(b.html);
        if (!runs.length) { lay.space(base * 0.6); break; }
        lay.text(runs, { fam: body, size: base, color: ink, align: b.align ?? 'justify' });
        lay.space(base * 0.65);
        break;
      }
      case 'quote': {
        lay.space(base * 0.3);
        const rects = lay.text(parseInline(b.html), { fam: body, size: base * 1.02, italic: true, color: ink, indent: 16 });
        for (const r of rects) r.page.drawRectangle({ x: margin.left + 2, y: r.y - r.h + 2, width: 2.5, height: r.h, color: accent });
        if (b.cite) lay.text([{ text: `— ${b.cite}` }], { fam: body, size: base * 0.85, color: muted, indent: 16 });
        lay.space(base * 0.8);
        break;
      }
      case 'list': {
        let n = 0;
        for (const item of b.items) {
          n++;
          const runs = parseInline(item);
          if (!runs.length) continue;
          lay.ensure(base * 1.5);
          const marker = b.ordered ? `${n}.` : '•';
          const yTop = lay.y;
          const pageBefore = lay.page;
          lay.text(runs, { fam: body, size: base, color: ink, indent: 18 });
          // ensure() above guarantees the first line (and its marker) lands on `pageBefore`.
          pageBefore.drawText(marker, { x: margin.left + 4, y: yTop - base, size: base, font: b.ordered ? body.regular : body.bold, color: accent });
          lay.space(base * 0.25);
        }
        lay.space(base * 0.5);
        break;
      }
      case 'image': {
        const a = b.assetId ? assets[b.assetId] : undefined;
        const img = a ? await embedImage(doc, a) : null;
        if (!img) break;
        const ratio = b.width === 'small' ? 0.45 : b.width === 'medium' ? 0.7 : 1;
        let w = lay.contentWidth * ratio;
        let h = (img.height / img.width) * w;
        const maxH = (lay.top - margin.bottom) * 0.8;
        if (h > maxH) { h = maxH; w = (img.width / img.height) * h; }
        lay.ensure(h + base * 2);
        lay.page.drawImage(img, { x: margin.left + (lay.contentWidth - w) / 2, y: lay.y - h, width: w, height: h });
        lay.y -= h + 6;
        if (b.caption) lay.text([{ text: b.caption }], { fam: body, size: base * 0.82, italic: true, align: 'center', color: muted });
        lay.space(base * 0.8);
        break;
      }
      case 'table': {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const cw = lay.contentWidth / cols;
        const size = base * 0.82;
        const pad = 5;
        lay.space(base * 0.3);
        b.rows.forEach((row, ri) => {
          const isHead = b.header && ri === 0;
          const cells = Array.from({ length: cols }, (_, i) => wrap(tokenize([{ text: row[i] ?? '' }], ui, size, isHead), cw - pad * 2));
          const rowH = Math.max(1, ...cells.map((c) => c.length)) * size * 1.35 + pad * 2;
          lay.ensure(rowH);
          const top = lay.y;
          if (isHead) lay.page.drawRectangle({ x: margin.left, y: top - rowH, width: lay.contentWidth, height: rowH, color: rgb(0.93, 0.92, 0.99) });
          cells.forEach((lines, i) => {
            const x0 = margin.left + i * cw;
            lay.page.drawRectangle({ x: x0, y: top - rowH, width: cw, height: rowH, borderColor: rgb(0.8, 0.8, 0.86), borderWidth: 0.6 });
            lines.forEach((l, li) => {
              let x = x0 + pad;
              for (const t of l) { if (!t.space) lay.page.drawText(t.text, { x, y: top - pad - size - li * size * 1.35, size, font: t.font, color: ink }); x += t.width; }
            });
          });
          lay.y -= rowH;
        });
        lay.space(base);
        break;
      }
      case 'divider': {
        lay.ensure(base * 2);
        lay.space(base * 0.6);
        lay.page.drawLine({ start: { x: W / 2 - 40, y: lay.y }, end: { x: W / 2 + 40, y: lay.y }, thickness: 0.8, color: accent });
        lay.space(base);
        break;
      }
      case 'audio': {
        lay.text([{ text: `» ${audioNote(book, b.title)}` }], { fam: ui, size: base * 0.85, italic: true, color: accent });
        lay.space(base * 0.6);
        break;
      }
      case 'pagebreak': {
        if (!lay.atTop()) lay.newPage();
        break;
      }
    }
  }

  // --- running headers & page numbers
  const total = doc.getPageCount();
  let tocPages = 0;
  const tocLine = 22;
  const perTocPage = Math.max(1, Math.floor((H - margin.top - margin.bottom - 70) / tocLine));
  if (options.includeToc && book.chapters.length && !single) tocPages = Math.ceil(book.chapters.length / perTocPage);
  const finalNumber = (idx: number) => idx + (idx >= titlePageIndex + 1 ? tocPages : 0) + 1;

  for (let i = contentFirst; i < total; i++) {
    const meta = lay.pages[i - (doc.getPageCount() - lay.pages.length)];
    const p = doc.getPage(i);
    const num = String(finalNumber(i));
    p.drawText(num, { x: (W - ui.regular.widthOfTextAtSize(num, 8.5)) / 2, y: margin.bottom / 2 - 4, size: 8.5, font: ui.regular, color: muted });
    if (meta && meta.chapter !== null && !chapterStart.includes(i)) {
      if (single) continue;
      const label = ui.enc(chapterDisplayTitle(book, book.chapters[meta.chapter], meta.chapter)).slice(0, 70);
      p.drawText(label, { x: margin.left, y: H - margin.top / 2, size: 7.5, font: ui.italic, color: muted });
      p.drawLine({ start: { x: margin.left, y: H - margin.top / 2 - 5 }, end: { x: W - margin.right, y: H - margin.top / 2 - 5 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.9) });
    }
  }

  // --- table of contents (inserted after the title page, with clickable links)
  if (tocPages) {
    for (let t = 0; t < tocPages; t++) {
      const p = doc.insertPage(titlePageIndex + 1 + t, [W, H]);
      let y = H - margin.top;
      if (t === 0) {
        const label = head.enc(tocLabel(book));
        p.drawText(label, { x: margin.left, y: y - 22, size: 22, font: head.bold, color: ink });
        p.drawRectangle({ x: margin.left, y: y - 34, width: 32, height: 2.5, color: accent });
      }
      y -= 70;
      const slice = book.chapters.slice(t * perTocPage, (t + 1) * perTocPage);
      slice.forEach((ch, k) => {
        const ci = t * perTocPage + k;
        const targetIdx = chapterStart[ci] + tocPages; // after insertion
        const num = String(targetIdx + 1);
        const size = base * 0.95;
        const numW = ui.regular.widthOfTextAtSize(num, size);
        let title = `${ci + 1}. ${body.enc(chapterDisplayTitle(book, ch, ci))}`;
        const maxW = W - margin.left - margin.right - numW - 24;
        while (body.regular.widthOfTextAtSize(title, size) > maxW && title.length > 4) title = title.slice(0, -2);
        if (title !== `${ci + 1}. ${body.enc(chapterDisplayTitle(book, ch, ci))}`) title = title.trimEnd() + '…';
        p.drawText(title, { x: margin.left, y, size, font: body.regular, color: ink });
        const tw = body.regular.widthOfTextAtSize(title, size);
        for (let dx = margin.left + tw + 6; dx < W - margin.right - numW - 6; dx += 4) p.drawText('.', { x: dx, y, size: size * 0.8, font: ui.regular, color: rgb(0.7, 0.7, 0.75) });
        p.drawText(num, { x: W - margin.right - numW, y, size, font: ui.regular, color: accent });
        // link annotation → chapter page
        const target = doc.getPage(targetIdx);
        const annot = doc.context.obj({
          Type: 'Annot', Subtype: 'Link', Border: [0, 0, 0],
          Rect: [margin.left, y - 4, W - margin.right, y + size + 2],
          Dest: [target.ref, PDFName.of('XYZ'), null, null, null],
        });
        const annots = p.node.lookup(PDFName.of('Annots'));
        const ref = doc.context.register(annot);
        if (annots instanceof PDFArray) annots.push(ref);
        else p.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
        y -= tocLine;
      });
      const pn = String(titlePageIndex + 2 + t);
      p.drawText(pn, { x: (W - ui.regular.widthOfTextAtSize(pn, 8.5)) / 2, y: margin.bottom / 2 - 4, size: 8.5, font: ui.regular, color: muted });
    }
  }

  const bytes = await doc.save();
  return { bytes, mime: MIME.pdf, filename: exportFilename(book, 'pdf'), extension: 'pdf' };
}

export type { Book };
