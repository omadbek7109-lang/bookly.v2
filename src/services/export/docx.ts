/** DOCX exporter built with the `docx` library from the unified Bookly model. */
import {
  AlignmentType, BorderStyle, Bookmark, Document, HeadingLevel, ImageRun, InternalHyperlink, LevelFormat, Packer, PageBreak,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import type { Align, Block } from '../../models/book';
import { fontById } from '../../models/templates';
import { parseInline, type Run } from '../../utils/inline';
import { audioNote, byLabel, chapterDisplayTitle, chapterLabel, exportFilename, hexColor, tocLabel, u8 } from './common';
import { MIME, type ExportInput, type ExportOutput } from './types';

const PAGE_TWIPS = { A4: { w: 11906, h: 16838 }, A5: { w: 8391, h: 11906 }, Letter: { w: 12240, h: 15840 } } as const;
const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};

function runs(rs: Run[], extra: { size?: number; color?: string; italics?: boolean; bold?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  rs.forEach((r) => {
    out.push(new TextRun({
      text: r.text,
      bold: r.bold || extra.bold,
      italics: r.italic || extra.italics,
      underline: r.underline ? {} : undefined,
      size: extra.size,
      color: extra.color,
    }));
    if (r.br) out.push(new TextRun({ text: '', break: 1 }));
  });
  return out;
}

export async function exportDocx(input: ExportInput): Promise<ExportOutput> {
  const { book, assets, options } = input;
  const accent = hexColor(book.theme.accent);
  const ink = hexColor(book.theme.ink, '1c1b29');
  const bodyFont = fontById(book.theme.bodyFont).office;
  const headFont = fontById(book.theme.headingFont).office;
  const basePt = book.theme.baseSize || 12;
  const page = PAGE_TWIPS[options.pageSize] ?? PAGE_TWIPS.A5;
  const marginTw = options.pageSize === 'A5' ? 1000 : 1300;
  const contentPx = Math.round(((page.w - marginTw * 2) / 1440) * 96);

  const children: (Paragraph | Table)[] = [];
  const front: (Paragraph | Table)[] = [];

  // --- cover & title page
  if (options.includeCover && input.cover && (input.cover.mime === 'image/jpeg' || input.cover.mime === 'image/png')) {
    const w = contentPx;
    const h = Math.round(w * ((input.cover.height || 1600) / (input.cover.width || 1066)));
    const maxH = Math.round(((page.h - marginTw * 2) / 1440) * 96) - 10;
    const scale = h > maxH ? maxH / h : 1;
    front.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: input.cover.mime === 'image/png' ? 'png' : 'jpg', data: input.cover.bytes, transformation: { width: Math.round(w * scale), height: Math.round(h * scale) }, altText: { name: 'cover', title: book.title, description: 'Cover' } })],
    }));
    front.push(new Paragraph({ children: [new PageBreak()] }));
  }
  front.push(new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE, children: [new TextRun({ text: book.title, bold: true, size: 56, font: headFont, color: ink })] }));
  if (book.subtitle) front.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: book.subtitle, italics: true, size: 30, color: '6B6B7B', font: headFont })] }));
  if (book.author) front.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, children: [new TextRun({ text: `${byLabel(book)} ${book.author}`, size: 26, font: headFont })] }));
  if (book.description) front.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 800 }, children: runs(parseInline(book.description), { size: 20, color: '6B6B7B' }) }));

  // --- table of contents (static, with internal links)
  if (options.includeToc && book.chapters.length) {
    front.push(new Paragraph({ children: [new PageBreak()] }));
    front.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 300 }, children: [new TextRun({ text: tocLabel(book) })] }));
    book.chapters.forEach((ch, i) => {
      front.push(new Paragraph({
        spacing: { after: 120 },
        children: [new InternalHyperlink({ anchor: `ch_${i + 1}`, children: [new TextRun({ text: `${i + 1}. ${chapterDisplayTitle(book, ch, i)}`, color: ink })] })],
      }));
    });
  }

  // --- chapters
  book.chapters.forEach((ch, ci) => {
    children.push(new Paragraph({
      pageBreakBefore: true,
      spacing: { before: 1200, after: 80 },
      children: [new TextRun({ text: chapterLabel(book, ci).toUpperCase(), bold: true, size: 18, color: accent, font: 'Calibri' })],
    }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 400 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 8 } },
      children: [new Bookmark({ id: `ch_${ci + 1}`, children: [new TextRun({ text: chapterDisplayTitle(book, ch, ci) })] })],
    }));
    for (const b of ch.blocks) children.push(...blockToDocx(b));
  });

  function blockToDocx(b: Block): (Paragraph | Table)[] {
    switch (b.type) {
      case 'heading': {
        const level = b.level === 1 ? HeadingLevel.HEADING_2 : b.level === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
        return [new Paragraph({ heading: level, alignment: b.align ? ALIGN[b.align] : undefined, children: runs(parseInline(b.html)) })];
      }
      case 'paragraph':
        return [new Paragraph({ alignment: ALIGN[b.align ?? 'justify'], spacing: { after: 160, line: 320 }, children: runs(parseInline(b.html)) })];
      case 'quote': {
        const out = [new Paragraph({
          indent: { left: 567 }, spacing: { before: 120, after: b.cite ? 40 : 200 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 12 } },
          children: runs(parseInline(b.html), { italics: true }),
        })];
        if (b.cite) out.push(new Paragraph({ indent: { left: 567 }, spacing: { after: 200 }, children: [new TextRun({ text: `— ${b.cite}`, color: '6B6B7B', size: (basePt - 1) * 2 })] }));
        return out;
      }
      case 'list':
        return b.items.filter((it) => it.trim()).map((it) => new Paragraph({
          numbering: { reference: b.ordered ? 'bookly-ordered' : 'bookly-bullet', level: 0, instance: b.ordered ? hashId(b.id) : undefined },
          spacing: { after: 80 },
          children: runs(parseInline(it)),
        }));
      case 'image': {
        const a = b.assetId ? assets[b.assetId] : undefined;
        if (!a || (a.mime !== 'image/png' && a.mime !== 'image/jpeg')) return [];
        const ratio = b.width === 'small' ? 0.45 : b.width === 'medium' ? 0.7 : 1;
        const w = Math.round(contentPx * ratio);
        const h = Math.round(w * ((a.height || 1) / (a.width || 1)));
        const out = [new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 },
          children: [new ImageRun({ type: a.mime === 'image/png' ? 'png' : 'jpg', data: a.bytes, transformation: { width: w, height: h }, altText: { name: a.id, title: b.caption || 'image', description: b.caption || 'image' } })],
        })];
        if (b.caption) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: b.caption, italics: true, size: (basePt - 2) * 2, color: '6B6B7B' })] }));
        return out;
      }
      case 'table': {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9C7D9' };
        return [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map((row, ri) => new TableRow({
            tableHeader: b.header && ri === 0,
            children: Array.from({ length: cols }, (_, ci) => new TableCell({
              shading: b.header && ri === 0 ? { type: ShadingType.CLEAR, fill: 'EDEBFB', color: 'auto' } : undefined,
              borders: { top: border, bottom: border, left: border, right: border },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: row[ci] ?? '', bold: b.header && ri === 0, size: (basePt - 1) * 2 })] })],
            })),
          })),
        }), new Paragraph({ spacing: { after: 120 }, children: [] })];
      }
      case 'divider':
        return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 }, children: [new TextRun({ text: '* * *', color: accent })] })];
      case 'audio':
        return [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `♪ ${audioNote(book, b.title)}`, italics: true, color: accent })] })];
      case 'pagebreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      default:
        return [];
    }
  }

  const doc = new Document({
    creator: book.author || 'Bookly',
    title: book.title,
    subject: book.subtitle || undefined,
    description: book.description || undefined,
    keywords: book.metadata.keywords.join(', ') || undefined,
    lastModifiedBy: 'Bookly 2.0',
    styles: {
      default: {
        document: { run: { font: bodyFont, size: basePt * 2, color: ink } },
        heading1: { run: { font: headFont, size: 44, bold: true, color: ink } },
        heading2: { run: { font: headFont, size: 34, bold: true, color: ink }, paragraph: { spacing: { before: 300, after: 120 } } },
        heading3: { run: { font: headFont, size: 28, bold: true, color: ink }, paragraph: { spacing: { before: 240, after: 100 } } },
        heading4: { run: { font: headFont, size: 24, bold: true, color: ink }, paragraph: { spacing: { before: 200, after: 80 } } },
        title: { run: { font: headFont, size: 56, bold: true, color: ink } },
      },
    },
    numbering: {
      config: [
        { reference: 'bookly-bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 283 } } } }] },
        { reference: 'bookly-ordered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] },
      ],
    },
    sections: [
      { properties: { page: { size: { width: page.w, height: page.h }, margin: { top: marginTw, bottom: marginTw, left: marginTw, right: marginTw } } }, children: [...front, ...children] },
    ],
  });

  const buf = await Packer.toArrayBuffer(doc);
  return { bytes: u8(buf), mime: MIME.docx, filename: exportFilename(book, 'docx'), extension: 'docx' };
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 100000) + 1;
}

