import { memo, useEffect, useRef } from 'react';
import type { CoverDesign } from '../models/book';
import { COVER_RATIO, loadAssetImage, renderCover } from '../services/cover/renderCover';

/** Live-rendered cover thumbnail (same renderer as exports). */
export const BookCover = memo(function BookCover({ cover, width = 160, className = '', label }: { cover: CoverDesign; width?: number; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(cover);
  useEffect(() => {
    let cancelled = false;
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(width * dpr);
    const h = Math.round(w * COVER_RATIO);
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    renderCover(ctx, cover, w, h);
    if (cover.background.kind === 'image' && cover.background.imageAssetId) {
      void loadAssetImage(cover.background.imageAssetId).then((img) => {
        if (!cancelled && img) renderCover(ctx, cover, w, h, { image: img.img, imageSize: { w: img.w, h: img.h } });
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width]);
  return <canvas ref={ref} className={`book-cover ${className}`} role="img" aria-label={label ?? cover.title} style={{ aspectRatio: `1 / ${COVER_RATIO}` }} />;
});
