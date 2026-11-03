/**
 * DemoImageAIProvider — procedurally paints a cover background on a canvas.
 * Deterministic for a given prompt + style, clearly labelled as DEMO in the UI.
 */
import { sleep, type ImageAIProvider, type ImageRequest } from './types';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number, alpha = 1): string {
  const [r1, g1, b1] = hexToRgb(a); const [r2, g2, b2] = hexToRgb(b);
  return `rgba(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)},${alpha})`;
}

/** Paints the procedural artwork. Exported for reuse/testing. */
export function paintDemoArt(ctx: CanvasRenderingContext2D, req: Pick<ImageRequest, 'prompt' | 'style' | 'colors' | 'width' | 'height'>): void {
  const { width: w, height: h, colors: [c1, c2], style } = req;
  const r = rng(hash(`${req.prompt}|${style}|${c1}${c2}`));
  const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  if (style === 'cosmic') {
    for (let i = 0; i < 3; i++) {
      const x = r() * w, y = r() * h * 0.8, rad = w * (0.3 + r() * 0.5);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, mix(c2, '#ffffff', 0.4, 0.55)); rg.addColorStop(1, mix(c2, c1, 0.5, 0));
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.8})`;
      const s = r() < 0.94 ? r() * 1.8 + 0.4 : r() * 3 + 2;
      ctx.beginPath(); ctx.arc(r() * w, r() * h, s * (w / 600), 0, Math.PI * 2); ctx.fill();
    }
    const px = w * (0.25 + r() * 0.5), py = h * (0.55 + r() * 0.2), pr = w * (0.16 + r() * 0.1);
    const pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, mix(c2, '#ffffff', 0.6)); pg.addColorStop(1, mix(c1, '#000000', 0.3));
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'landscape') {
    const sun = ctx.createRadialGradient(w * 0.7, h * 0.35, 0, w * 0.7, h * 0.35, w * 0.35);
    sun.addColorStop(0, 'rgba(255,240,210,0.9)'); sun.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 5; layer++) {
      const base = h * (0.45 + layer * 0.11);
      ctx.fillStyle = mix(c2, c1, 0.25 + layer * 0.18, 0.92);
      ctx.beginPath(); ctx.moveTo(0, h);
      let x = 0;
      ctx.lineTo(0, base);
      while (x < w) {
        const peak = base - (r() * h * 0.18) / (layer * 0.5 + 1);
        const step = w * (0.12 + r() * 0.2);
        ctx.lineTo(x + step / 2, peak); ctx.lineTo(x + step, base - r() * h * 0.03);
        x += step;
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
  } else if (style === 'geometric') {
    const n = 14 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.globalAlpha = 0.12 + r() * 0.35;
      ctx.fillStyle = mix(c1, r() > 0.5 ? '#ffffff' : c2, r());
      ctx.translate(r() * w, r() * h); ctx.rotate(r() * Math.PI);
      const s = w * (0.1 + r() * 0.4);
      if (r() > 0.5) ctx.fillRect(-s / 2, -s / 2, s, s);
      else { ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.lineTo(-s / 2, s / 2); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
  } else if (style === 'watercolor') {
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = r() * h, rad = w * (0.08 + r() * 0.35);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const col = r() > 0.5 ? c2 : '#ffffff';
      rg.addColorStop(0, mix(c1, col, 0.4 + r() * 0.6, 0.22)); rg.addColorStop(1, mix(c1, col, 0.5, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // abstract flowing ribbons
    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = mix(c2, '#ffffff', r() * 0.8, 0.15 + r() * 0.3);
      ctx.lineWidth = w * (0.01 + r() * 0.05);
      ctx.beginPath();
      const y0 = r() * h;
      ctx.moveTo(-20, y0);
      ctx.bezierCurveTo(w * 0.3, y0 - h * (r() - 0.5), w * 0.7, y0 + h * (r() - 0.5), w + 20, r() * h);
      ctx.stroke();
    }
  }
  // grain for a printed feel
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}

export class DemoImageAIProvider implements ImageAIProvider {
  readonly id = 'demo-image';
  readonly isDemo = true;
  constructor(private latency = 1200) {}

  private async render(req: ImageRequest): Promise<Blob> {
    await sleep(this.latency, req.signal);
    const canvas = document.createElement('canvas');
    canvas.width = req.width; canvas.height = req.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not supported');
    paintDemoArt(ctx, req);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9));
  }

  generateCover(req: ImageRequest) { return this.render(req); }
  generateIllustration(req: ImageRequest) { return this.render({ ...req, height: Math.round(req.width * 0.66) }); }
}
