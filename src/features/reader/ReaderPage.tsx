import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSettings } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, IconButton, ListRow, Segmented, Sheet, Spinner } from '../../components/ui';
import type { Book } from '../../models/book';
import { books } from '../../services/storage/repository';
import { ChapterContent } from './BookContent';

const MODES = { light: { bg: '#ffffff', ink: '#1c1b29' }, sepia: { bg: '#f6efe1', ink: '#3b2f22' }, dark: { bg: '#101126', ink: '#e6e4f5' } };

export default function ReaderPage({ bookId }: { bookId: string }) {
  const { t, settings, update } = useSettings();
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [idx, setIdx] = useState<number>(-1); // -1 = cover page
  const [sheet, setSheet] = useState<null | 'toc' | 'settings'>(null);
  const [full, setFull] = useState(false);
  const [ratio, setRatio] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const r = settings.reader;

  useEffect(() => {
    books.get(bookId).then((b) => {
      setBook(b && !b.deletedAt ? b : null);
      if (b) {
        const i = b.chapters.findIndex((c) => c.id === b.reading.chapterId);
        if (i >= 0) setIdx(i);
      }
    }).catch(() => setBook(null));
  }, [bookId]);

  const total = book?.chapters.length ?? 0;
  const go = useCallback((i: number) => {
    setIdx(Math.max(-1, Math.min(total - 1, i)));
    window.scrollTo({ top: 0 });
  }, [total]);

  // progress tracking & persistence (debounced, does not bump updatedAt)
  useEffect(() => {
    if (!book) return;
    let tm: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const local = max > 0 ? Math.min(1, scrollY / max) : 1;
      setRatio(local);
      clearTimeout(tm);
      tm = setTimeout(() => {
        if (idx < 0) return;
        const overall = (idx + local) / total;
        const chapterId = book.chapters[idx].id;
        void books.get(book.id).then((fresh) => fresh && books.save({ ...fresh, reading: { chapterId, ratio: overall } }, { touch: false })).catch(() => {});
      }, 600);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(tm); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, book?.id, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return;
      if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
      else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); scrollBy({ top: innerHeight * 0.85, behavior: 'smooth' }); }
      else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); scrollBy({ top: -innerHeight * 0.85, behavior: 'smooth' }); }
      else if (e.key === 'Escape' && full) toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleFull = async () => {
    try {
      if (!document.fullscreenElement && !full) { await root.current?.requestFullscreen?.(); setFull(true); }
      else { if (document.fullscreenElement) await document.exitFullscreen(); setFull(false); }
    } catch { setFull((f) => !f); } // Telegram / iOS: fall back to hiding chrome
  };
  useEffect(() => {
    const fn = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  if (book === undefined) return <div className="page-loading"><Spinner label={t('common.loading')} /></div>;
  if (!book) return <EmptyState icon="alert" title={t('editor.notFound')} action={<Button onClick={() => navigate(routes.books())}>{t('editor.goLibrary')}</Button>} />;

  const mode = MODES[r.mode];
  const overall = idx < 0 ? 0 : Math.round(((idx + ratio) / total) * 100);
  const style = { '--reader-bg': mode.bg, '--reader-ink': mode.ink, '--reader-size': `${r.fontSize}px`, '--reader-lh': r.lineHeight } as CSSProperties;

  return (
    <div ref={root} className={`reader mode-${r.mode} font-${r.font} ${full ? 'is-full' : ''}`} style={style} data-testid="reader">
      <header className="reader-bar">
        <IconButton icon="chevronLeft" label={t('common.back')} onClick={() => back(routes.books())} />
        <div className="reader-title"><strong>{book.title}</strong><small>{idx < 0 ? book.author : t('reader.chapterOf', { i: idx + 1, n: total })}</small></div>
        <IconButton icon="list" label={t('reader.toc')} onClick={() => setSheet('toc')} data-testid="reader-toc" />
        <IconButton icon="type" label={t('reader.settings')} onClick={() => setSheet('settings')} data-testid="reader-settings" />
        <IconButton icon={full ? 'minimize' : 'maximize'} label={full ? t('reader.exitFullscreen') : t('reader.fullscreen')} onClick={() => void toggleFull()} />
      </header>
      <div className="reader-progress" aria-hidden="true"><span style={{ width: `${overall}%` }} /></div>

      <main className="reader-body">
        {idx < 0 ? (
          <section className="reader-cover">
            <BookCover cover={book.cover} width={260} />
            <h1>{book.title}</h1>
            {book.subtitle && <p className="reader-sub">{book.subtitle}</p>}
            {book.author && <p className="reader-author">{t('reader.by', { a: book.author })}</p>}
            {book.description && <p className="reader-desc">{book.description}</p>}
            <Button icon="bookOpen" size="lg" onClick={() => go(0)} data-testid="reader-start">{t('reader.startReading')}</Button>
            <h2 className="reader-toc-title">{t('reader.toc')}</h2>
            <ol className="reader-toc">
              {book.chapters.map((c, i) => <li key={c.id}><button type="button" onClick={() => go(i)}><span>{i + 1}.</span> {c.title || `${i + 1}-bob`}</button></li>)}
            </ol>
          </section>
        ) : (
          <ChapterContent book={book} chapter={book.chapters[idx]} index={idx} />
        )}
        {idx === total - 1 && <p className="reader-end">— {t('reader.end')} —</p>}
      </main>

      <footer className="reader-nav">
        <Button variant="ghost" icon="chevronLeft" onClick={() => go(idx - 1)} disabled={idx < 0} data-testid="reader-prev">{t('common.prev')}</Button>
        <span className="reader-pct" aria-live="polite">{t('reader.progress', { p: overall })}</span>
        <Button variant="ghost" iconRight="chevronRight" onClick={() => go(idx + 1)} disabled={idx >= total - 1} data-testid="reader-next">{t('common.next')}</Button>
      </footer>

      <Sheet open={sheet === 'toc'} onClose={() => setSheet(null)} title={t('reader.toc')} size="md">
        <div className="list">
          <ListRow icon="book" title={book.title} subtitle={book.author} onClick={() => { go(-1); setSheet(null); }} />
          {book.chapters.map((c, i) => (
            <ListRow key={c.id} icon={i === idx ? 'bookOpen' : 'file'} title={`${i + 1}. ${c.title || `${i + 1}-bob`}`} onClick={() => { go(i); setSheet(null); }} testId="toc-item" />
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'settings'} onClose={() => setSheet(null)} title={t('reader.settings')} size="sm">
        <div className="form">
          <div className="field">
            <label>{t('reader.fontSize')}: {r.fontSize}px</label>
            <div className="stepper-row">
              <IconButton icon="minus" label="-" onClick={() => update({ reader: { ...r, fontSize: Math.max(14, r.fontSize - 1) } })} data-testid="font-dec" />
              <input type="range" className="range" min={14} max={28} value={r.fontSize} onChange={(e) => update({ reader: { ...r, fontSize: Number(e.target.value) } })} aria-label={t('reader.fontSize')} />
              <IconButton icon="plus" label="+" onClick={() => update({ reader: { ...r, fontSize: Math.min(28, r.fontSize + 1) } })} data-testid="font-inc" />
            </div>
          </div>
          <div className="field">
            <label>{t('reader.lineHeight')}: {r.lineHeight.toFixed(1)}</label>
            <input type="range" className="range" min={1.3} max={2.2} step={0.1} value={r.lineHeight} onChange={(e) => update({ reader: { ...r, lineHeight: Number(e.target.value) } })} aria-label={t('reader.lineHeight')} />
          </div>
          <div className="field">
            <label>{t('reader.font')}</label>
            <Segmented value={r.font} label={t('reader.font')} onChange={(v) => update({ reader: { ...r, font: v } })} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]} />
          </div>
          <div className="field">
            <label>{t('reader.mode')}</label>
            <Segmented value={r.mode} label={t('reader.mode')} onChange={(v) => update({ reader: { ...r, mode: v } })}
              options={[{ value: 'light', label: t('reader.mode.light'), icon: 'sun' }, { value: 'sepia', label: t('reader.mode.sepia'), icon: 'bookOpen' }, { value: 'dark', label: t('reader.mode.dark'), icon: 'moon' }]} />
          </div>
        </div>
      </Sheet>
      <span className="sr-only"><Icon name="book" /></span>
    </div>
  );
}
