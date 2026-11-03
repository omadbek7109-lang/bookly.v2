/** PPTX exporter (pptxgenjs): cover slide, contents, a section slide per chapter and paginated content slides. */
import PptxGenJS from 'pptxgenjs';
import type { Block, Book } from '../../models/book';
import { fontById } from '../../models/templates';
import { parseInline, plainText, type Run } from '../../utils/inline';
import { audioNote, base64, byLabel, chapterDisplayTitle, chapterLabel, exportFilename, hexColor, tocLabel, u8 } from './common';
import { MIME, type ExportInput, type ExportOutput, type ResolvedAsset } from './types';

type TextProps = PptxGenJS.TextProps;

const W = 13.333;
const H = 7.5;
const BUDGET = 620; // characters of body text per content slide

interface Item { kind: 'para' | 'bullet' | 'number' | 'quote' | 'note'; runs: Run[]; n?: number; cost: number }
interface ContentSlide { title: string; items: Item[]; image?: { asset: ResolvedAsset; caption: string }; table?: string[][]; tableHeader?: boolean }

function dataUri(a: ResolvedAsset) { return `${a.mime};base64,${base64(a.bytes)}`; }

function splitLong(runs: Run[]): Run[][] {
  const text = runs.map((r) => r.text).join('');
  if (text.length <= BUDGET) return [runs];
  // Long paragraphs are split into sentence groups (formatting is flattened for the overflow parts).
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const parts: Run[][] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > BUDGET && cur) { parts.push([{ text: cur.trim() }]); cur = s; } else cur += ' ' + s;
  }
  if (cur.trim()) parts.push([{ text: cur.trim() }]);
  return parts;
}

export function paginateChapter(book: Book, blocks: Block[], chapterTitle: string, assets: Record<string, ResolvedAsset>): ContentSlide[] {
  const slides: ContentSlide[] = [];
  const cont = book.language === 'en' ? ' (cont.)' : book.language === 'ru' ? ' (продолжение)' : ' (davomi)';
  let cur: ContentSlide = { title: chapterTitle, items: [] };
  let cost = 0;
  const push = () => { if (cur.items.length || cur.image || cur.table) slides.push(cur); cost = 0; };
  const fresh = (title?: string) => { push(); cur = { title: title ?? (slides.length || cur.items.length ? chapterTitle + cont : chapterTitle), items: [] }; };
  const add = (it: Item) => {
    if (cost + it.cost > BUDGET && cur.items.length) fresh();
    cur.items.push(it); cost += it.cost;
  };
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const t = plainText(b.html).trim();
        if (!t) break;
        if (cur.items.length || cur.image || cur.table) fresh(t); else cur.title = t;
        break;
      }
      case 'paragraph': {
        const r = parseInline(b.html);
        for (const part of splitLong(r)) {
          const c = part.reduce((s, x) => s + x.text.length, 0);
          if (c) add({ kind: 'para', runs: part, cost: c + 40 });
        }
        break;
      }
      case 'quote': {
        const r = parseInline(b.html);
        if (b.cite) r.push({ text: `  — ${b.cite}` });
        add({ kind: 'quote', runs: r, cost: plainText(b.html).length + 60 });
        break;
      }
      case 'list':
        b.items.forEach((it, i) => {
          const r = parseInline(it);
          const c = plainText(it).length;
          if (c) add({ kind: b.ordered ? 'number' : 'bullet', runs: r, n: i + 1, cost: c + 30 });
        });
        break;
      case 'image': {
        const a = b.assetId ? assets[b.assetId] : undefined;
        if (!a) break;
        fresh(b.caption || cur.title);
        cur.image = { asset: a, caption: b.caption };
        fresh();
        break;
      }
      case 'table':
        fresh(cur.items.length ? undefined : cur.title);
        cur.table = b.rows; cur.tableHeader = b.header;
        fresh();
        break;
      case 'audio':
        add({ kind: 'note', runs: [{ text: audioNote(book, b.title) }], cost: 60 });
        break;
      case 'divider':
      case 'pagebreak':
        if (cur.items.length) fresh();
        break;
    }
  }
  push();
  return slides;
}

export async function exportPptx(input: ExportInput): Promise<ExportOutput> {
  const { book, assets, options } = input;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = book.title;
  pptx.author = book.author || 'Bookly';
  pptx.subject = book.subtitle || book.description.slice(0, 200);
  pptx.company = 'Bookly 2.0';

  const accent = hexColor(book.theme.accent);
  const ink = hexColor(book.theme.ink, '1c1b29');
  const paper = hexColor(book.theme.paper || '#ffffff', 'FFFFFF');
  const headFace = fontById(book.theme.headingFont).office;
  const bodyFace = fontById(book.theme.bodyFont).office;
  const [c1, c2] = book.cover.background.colors.map((c) => hexColor(c));
  const coverText = hexColor(book.cover.textColor || '#ffffff', 'FFFFFF');

  // --- cover slide
  const cover = pptx.addSlide();
  cover.background = { color: c1 };
  if (options.includeCover && input.cover) {
    const ratio = (input.cover.width || 2) / (input.cover.height || 3);
    const ch = H - 0.8, cw = ch * ratio;
    cover.addImage({ data: dataUri(input.cover), x: 0.6, y: 0.4, w: cw, h: ch });
    const tx = 0.6 + cw + 0.6;
    cover.addText(book.title, { x: tx, y: 1.6, w: W - tx - 0.6, h: 2.2, fontFace: headFace, fontSize: 40, bold: true, color: coverText, valign: 'bottom', fit: 'shrink' });
    if (book.subtitle) cover.addText(book.subtitle, { x: tx, y: 3.9, w: W - tx - 0.6, h: 0.9, fontFace: headFace, fontSize: 20, italic: true, color: coverText });
    if (book.author) cover.addText(`${byLabel(book)} ${book.author}`, { x: tx, y: 5.6, w: W - tx - 0.6, h: 0.6, fontFace: bodyFace, fontSize: 16, color: coverText });
  } else {
    cover.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: c2 } });
    cover.addText(book.title, { x: 0.9, y: 1.8, w: W - 1.8, h: 2, fontFace: headFace, fontSize: 48, bold: true, color: coverText, align: 'center', valign: 'middle', fit: 'shrink' });
    if (book.subtitle) cover.addText(book.subtitle, { x: 0.9, y: 3.9, w: W - 1.8, h: 0.8, fontFace: headFace, fontSize: 22, italic: true, color: coverText, align: 'center' });
    if (book.author) cover.addText(book.author, { x: 0.9, y: 5.4, w: W - 1.8, h: 0.6, fontFace: bodyFace, fontSize: 18, color: coverText, align: 'center' });
  }
  cover.addNotes(book.description || book.title);

  // --- contents
  if (options.includeToc && book.chapters.length) {
    const perSlide = 9;
    for (let s = 0; s < book.chapters.length; s += perSlide) {
      const slide = pptx.addSlide();
      slide.background = { color: paper };
      slide.addText(tocLabel(book), { x: 0.8, y: 0.45, w: W - 1.6, h: 0.9, fontFace: headFace, fontSize: 32, bold: true, color: ink });
      slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.35, w: 0.8, h: 0.06, fill: { color: accent } });
      const rows: TextProps[] = book.chapters.slice(s, s + perSlide).map((c, k) => ({
        text: `${s + k + 1}.  ${chapterDisplayTitle(book, c, s + k)}`,
        options: { breakLine: true, paraSpaceAfter: 8 },
      }));
      slide.addText(rows, { x: 0.8, y: 1.6, w: W - 1.6, h: H - 2.2, fontFace: bodyFace, fontSize: 20, color: ink, valign: 'top' });
    }
  }

  // --- chapters
  book.chapters.forEach((ch, ci) => {
    const title = chapterDisplayTitle(book, ch, ci);
    const sec = pptx.addSlide();
    sec.background = { color: c1 };
    sec.addText(chapterLabel(book, ci).toUpperCase(), { x: 0.9, y: 2.3, w: W - 1.8, h: 0.6, fontFace: 'Calibri', fontSize: 16, bold: true, color: hexColor(book.cover.accentColor || '#c4b5fd'), charSpacing: 3 });
    sec.addText(title, { x: 0.9, y: 2.9, w: W - 1.8, h: 1.8, fontFace: headFace, fontSize: 40, bold: true, color: coverText, valign: 'top', fit: 'shrink' });

    for (const cs of paginateChapter(book, ch.blocks, title, assets)) {
      const slide = pptx.addSlide();
      slide.background = { color: paper };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: H, fill: { color: accent } });
      slide.addText(cs.title, { x: 0.7, y: 0.35, w: W - 1.4, h: 0.9, fontFace: headFace, fontSize: 28, bold: true, color: ink, fit: 'shrink' });
      slide.addText(`${ci + 1}`, { x: W - 1.1, y: H - 0.55, w: 0.6, h: 0.35, fontSize: 11, color: '8A8A9A', align: 'right' });
      const top = 1.35, areaH = H - top - 0.7;
      if (cs.image) {
        const a = cs.image.asset;
        const ratio = (a.width || 4) / (a.height || 3);
        let ih = areaH - (cs.image.caption ? 0.5 : 0), iw = ih * ratio;
        if (iw > W - 1.4) { iw = W - 1.4; ih = iw / ratio; }
        slide.addImage({ data: dataUri(a), x: (W - iw) / 2, y: top, w: iw, h: ih });
        if (cs.image.caption) slide.addText(cs.image.caption, { x: 0.7, y: top + ih + 0.05, w: W - 1.4, h: 0.4, fontSize: 13, italic: true, color: '6B6B7B', align: 'center' });
      } else if (cs.table) {
        const rows = cs.table.map((r, ri) => r.map((cell) => ({
          text: cell,
          options: ri === 0 && cs.tableHeader ? { bold: true, fill: { color: 'EDEBFB' }, color: ink } : { color: ink },
        })));
        slide.addTable(rows, { x: 0.7, y: top + 0.1, w: W - 1.4, fontFace: bodyFace, fontSize: 14, border: { type: 'solid', pt: 0.75, color: 'C9C7D9' }, autoPage: false });
      } else {
        const paras: TextProps[] = [];
        for (const it of cs.items) {
          const rs = it.runs.filter((r) => r.text || r.br);
          rs.forEach((r, k) => {
            const last = k === rs.length - 1;
            const o: TextProps['options'] = {
              bold: r.bold, italic: r.italic || it.kind === 'quote' || it.kind === 'note', underline: r.underline ? { style: 'sng' } : undefined,
              color: it.kind === 'quote' || it.kind === 'note' ? accent : ink,
            };
            if (k === 0) {
              if (it.kind === 'bullet') o.bullet = { code: '2022' };
              if (it.kind === 'number') o.bullet = { type: 'number' };
              if (it.kind === 'quote') o.indentLevel = 1;
              o.paraSpaceAfter = it.kind === 'para' || it.kind === 'quote' ? 10 : 4;
            }
            if (last || r.br) o.breakLine = true;
            paras.push({ text: r.text, options: o });
          });
        }
        slide.addText(paras, { x: 0.7, y: top, w: W - 1.4, h: areaH, fontFace: bodyFace, fontSize: 20, color: ink, valign: 'top', lineSpacingMultiple: 1.15 });
      }
    }
  });

  const out = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array | ArrayBuffer;
  return { bytes: u8(out), mime: MIME.pptx, filename: exportFilename(book, 'pptx'), extension: 'pptx' };
}
