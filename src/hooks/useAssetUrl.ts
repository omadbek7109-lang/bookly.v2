import { useEffect, useState } from 'react';
import { assets } from '../services/storage/repository';

export function useAssetUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (id) void assets.url(id).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}

/** Tracks the on-screen keyboard height (iOS/Android/Telegram) as the CSS variable --kb. */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let last = '';
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const v = `${inset > 60 ? Math.round(inset) : 0}px`;
      if (v === last) return; // visualViewport 'scroll' fires constantly while scrolling; skip no-op style writes
      last = v;
      document.documentElement.style.setProperty('--kb', v);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); document.documentElement.style.setProperty('--kb', '0px'); };
  }, []);
}
