import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../app/AppContext';

/**
 * Opening sequence (~4.6 s): lavender wash → 3D book opens → light particles → logo → tagline.
 * Pure CSS animation, skippable, shortened to a fade when reduced motion is requested.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const { t, settings } = useSettings();
  const reduced = settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    setTimeout(onDone, reduced ? 150 : 450);
  };

  useEffect(() => {
    const timer = setTimeout(finish, reduced ? 900 : 4600);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`splash ${reduced ? 'is-reduced' : ''} ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-label="Bookly" data-testid="splash">
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-stage" aria-hidden="true">
        <div className="splash-book">
          <div className="sb-cover sb-left"><span /></div>
          <div className="sb-cover sb-right"><span /></div>
          <div className="sb-page p1" /><div className="sb-page p2" /><div className="sb-page p3" />
          <div className="sb-light" />
        </div>
        <div className="splash-particles">
          {Array.from({ length: 16 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}
        </div>
      </div>
      <div className="splash-brand">
        <div className="splash-logo" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="56" height="56"><defs><linearGradient id="spg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b7cf6" /><stop offset="1" stopColor="#4338ca" /></linearGradient></defs>
            <rect width="64" height="64" rx="18" fill="#1b1a4b" /><path d="M12 20c7-3 14-3 20 1v28c-6-4-13-4-20-1z" fill="url(#spg)" /><path d="M52 20c-7-3-14-3-20 1v28c6-4 13-4 20-1z" fill="#c4b5fd" /></svg>
        </div>
        <h1 className="splash-name">Bookly</h1>
        <p className="splash-tagline">{t('app.slogan')}</p>
      </div>
      <button type="button" className="splash-skip" onClick={finish} data-testid="splash-skip">{t('splash.skip')}</button>
    </div>
  );
}
