/**
 * Single cover renderer used everywhere: designer preview, library cards, PNG/JPG download
 * and the cover image embedded in PDF/DOCX/PPTX/EPUB exports.
 */
import type { Book, CoverDesign } from '../../models/book';
import { fontById, motifFor } from '../../models/templates';
import { assets } from '../storage/repository';

export const COVER_RATIO = 1.5; // height / width (6×9 in trade paperback)

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawMotif(ctx: CanvasRenderingContext2D, motif: string, w: number, h: number, accent: string, text: string) {
  ctx.save();
  switch (motif) {
    case 'orbs': {
      const orb = (x: number, y: number, r: number, a: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(accent, a)); g.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      };
      orb(w * 0.85, h * 0.12, w * 0.55, 0.45); orb(w * 0.1, h * 0.85, w * 0.6, 0.3);
      break;
    }
    case 'frame':
      ctx.strokeStyle = rgba(text, 0.55); ctx.lineWidth = w * 0.006;
      ctx.strokeRect(w * 0.06, w * 0.06, w * 0.88, h - w * 0.12);
      ctx.lineWidth = w * 0.002; ctx.strokeRect(w * 0.08, w * 0.08, w * 0.84, h - w * 0.16);
      break;
    case 'lines':
      ctx.strokeStyle = rgba(accent, 0.35); ctx.lineWidth = w * 0.004;
      for (let i = 0; i < 9; i++) { const y = h * 0.08 + i * w * 0.035; ctx.beginPath(); ctx.moveTo(w * 0.08, y); ctx.lineTo(w * (0.92 - i * 0.07), y); ctx.stroke(); }
      break;
    case 'waves':
      ctx.strokeStyle = rgba(accent, 0.4); ctx.lineWidth = w * 0.005;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        const y0 = h * 0.7 + i * w * 0.045;
        ctx.moveTo(0, y0);
        for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, y0 + Math.sin(x / w * Math.PI * 3 + i) * w * 0.03);
        ctx.stroke();
      }
      break;
    case 'grid':
      ctx.strokeStyle = rgba(accent, 0.18); ctx.lineWidth = Math.max(1, w * 0.0015);
      for (let x = 0; x < w; x += w / 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += w / 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      break;
    case 'stars': {
      let s = 7;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      ctx.fillStyle = rgba(accent, 0.9);
      for (let i = 0; i < 70; i++) { ctx.globalAlpha = 0.3 + r() * 0.7; ctx.beginPath(); ctx.arc(r() * w, r() * h * 0.6, (r() * 2.2 + 0.6) * (w / 500), 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'blocks':
      ctx.fillStyle = rgba(accent, 0.28);
      ctx.fillRect(w * 0.62, 0, w * 0.38, h * 0.32);
      ctx.fillStyle = rgba(accent, 0.16);
      ctx.fillRect(0, h * 0.78, w * 0.5, h * 0.22);
      break;
  }
  ctx.restore();
}

export interface RenderOptions { image?: CanvasImageSource | null; imageSize?: { w: number; h: number } }

export function renderCover(ctx: CanvasRenderingContext2D, cover: CoverDesign, w: number, h: number, opts: RenderOptions = {}) {
  const bg = cover.background;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (bg.kind === 'solid') { ctx.fillStyle = bg.colors[0]; ctx.fillRect(0, 0, w, h); }
  else {
    const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
    g.addColorStop(0, bg.colors[0]); g.addColorStop(1, bg.colors[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (bg.kind === 'image' && opts.image && opts.imageSize) {
    const { w: iw, h: ih } = opts.imageSize;
    const scale = Math.max(w / iw, h / ih) * Math.max(1, bg.imageScale);
    const dw = iw * scale, dh = ih * scale;
    const dx = (w - dw) * bg.imageX, dy = (h - dh) * bg.imageY;
    ctx.drawImage(opts.image, dx, dy, dw, dh);
  }
  if (cover.overlay > 0) {
    const o = ctx.createLinearGradient(0, 0, 0, h);
    o.addColorStop(0, `rgba(10,8,30,${cover.overlay * 0.6})`);
    o.addColorStop(1, `rgba(10,8,30,${Math.min(0.9, cover.overlay * 1.2)})`);
    ctx.fillStyle = o; ctx.fillRect(0, 0, w, h);
  }
  if (bg.kind !== 'image') drawMotif(ctx, motifFor(cover.templateId), w, h, cover.accentColor, cover.textColor);

  // --- typography
  const font = fontById(cover.fontId);
  const pad = w * 0.1;
  const maxW = w - pad * 2;
  const align: CanvasTextAlign = cover.layout === 'left' ? 'left' : 'center';
  const x = align === 'left' ? pad : w / 2;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = cover.textColor;

  const title = (font.uppercase ? cover.title.toLocaleUpperCase() : cover.title) || ' ';
  let size = w * (title.length > 40 ? 0.085 : title.length > 22 ? 0.1 : 0.12);
  let lines: string[];
  for (;;) {
    ctx.font = `${font.weight} ${size}px ${font.css}`;
    lines = wrapLines(ctx, title, maxW);
    if (lines.length <= 4 || size < w * 0.05) break;
    size *= 0.9;
  }
  const lh = size * 1.12;
  const subSize = w * 0.045;
  const blockH = lines.length * lh + (cover.subtitle ? subSize * 2.2 : 0);
  let y: number;
  if (cover.layout === 'top') y = h * 0.16 + size;
  else if (cover.layout === 'bottom') y = h * 0.78 - blockH + size;
  else if (cover.layout === 'left') y = h * 0.42 - blockH / 2 + size;
  else y = h * 0.45 - blockH / 2 + size;

  if ('letterSpacing' in ctx && font.letterSpacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${font.letterSpacing * size}px`;
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = size * 0.15;
  for (const l of lines) { ctx.fillText(l, x, y); y += lh; }
  ctx.shadowBlur = 0;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';

  // accent rule
  ctx.fillStyle = cover.accentColor;
  const ruleW = w * 0.12;
  ctx.fillRect(align === 'left' ? pad : (w - ruleW) / 2, y - lh + size * 0.45, ruleW, Math.max(2, w * 0.006));
  ctx.fillStyle = cover.textColor;

  if (cover.subtitle) {
    ctx.globalAlpha = 0.88;
    ctx.font = `italic 400 ${subSize}px ${font.css}`;
    let sy = y - lh + size * 0.45 + subSize * 1.9;
    for (const l of wrapLines(ctx, cover.subtitle, maxW).slice(0, 3)) { ctx.fillText(l, x, sy); sy += subSize * 1.3; }
    ctx.globalAlpha = 1;
  }
  if (cover.author) {
    ctx.font = `600 ${w * 0.048}px ${fontById('sans').css}`;
    if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${w * 0.006}px`;
    ctx.fillText(cover.author.toLocaleUpperCase(), x, cover.layout === 'top' ? h * 0.9 : h * 0.92 - (cover.layout === 'bottom' ? 0 : 0));
  }
  ctx.restore();
}

const imageCache = new Map<string, Promise<{ img: CanvasImageSource; w: number; h: number } | null>>();

export function loadAssetImage(id: string | null) {
  if (!id) return Promise.resolve(null);
  let p = imageCache.get(id);
  if (!p) {
    p = (async () => {
      const a = await assets.get(id);
      if (!a) return null;
      const bmp = await createImageBitmap(a.blob);
      return { img: bmp, w: bmp.width, h: bmp.height };
    })().catch(() => null);
    imageCache.set(id, p);
  }
  return p;
}

/** Renders a book cover to a Blob (default 1600×2400 JPEG). */
export async function renderCoverBlob(cover: CoverDesign, opts: { width?: number; mime?: 'image/jpeg' | 'image/png'; quality?: number } = {}): Promise<Blob> {
  const w = opts.width ?? 1600;
  const h = Math.round(w * COVER_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  const img = cover.background.kind === 'image' ? await loadAssetImage(cover.background.imageAssetId) : null;
  try { await document.fonts?.ready; } catch { /* ignore */ }
  renderCover(ctx, cover, w, h, img ? { image: img.img, imageSize: { w: img.w, h: img.h } } : {});
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Cover render failed'))), opts.mime ?? 'image/jpeg', opts.quality ?? 0.9));
}

/** Keeps the cover text in sync with book details unless the user customised it. */
export function syncCoverText(book: Book, prev: { title: string; subtitle: string; author: string }): CoverDesign {
  const c = { ...book.cover };
  if (!c.title || c.title === prev.title) c.title = book.title;
  if (!c.subtitle || c.subtitle === prev.subtitle) c.subtitle = book.subtitle;
  if (!c.author || c.author === prev.author) c.author = book.author;
  return c;
}
