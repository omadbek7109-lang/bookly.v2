import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibrary, useSettings } from '../../app/AppContext';
import { navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { BookMenu } from '../../components/BookMenu';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, IconButton, ProgressBar, SectionTitle } from '../../components/ui';
import { bookProgress, bookWordCount, type Book } from '../../models/book';
import type { MessageKey } from '../../i18n';
import { telegramUserName } from '../../services/platform/telegram';

function greetingKey(): MessageKey {
  const h = new Date().getHours();
  return h < 5 ? 'home.greeting.night' : h < 12 ? 'home.greeting.morning' : h < 18 ? 'home.greeting.day' : h < 23 ? 'home.greeting.evening' : 'home.greeting.night';
}

const HERO: { badge: MessageKey; title: MessageKey; text: MessageKey; cta: MessageKey; to: string; art: 'books' | 'cover' | 'export' }[] = [
  { badge: 'home.hero1.badge', title: 'home.hero1.title', text: 'home.hero1.text', cta: 'home.hero1.cta', to: routes.create(), art: 'books' },
  { badge: 'home.hero2.badge', title: 'home.hero2.title', text: 'home.hero2.text', cta: 'home.hero2.cta', to: routes.cover(), art: 'cover' },
  { badge: 'home.hero3.badge', title: 'home.hero3.title', text: 'home.hero3.text', cta: 'home.hero3.cta', to: routes.export(), art: 'export' },
];

export function HomePage({ onCreate }: { onCreate: () => void }) {
  const { t, settings, update } = useSettings();
  const { books, ready } = useLibrary();
  const [menuBook, setMenuBook] = useState<Book | null>(null);
  const live = useMemo(() => books.filter((b) => !b.deletedAt), [books]);
  const recent = useMemo(() => [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [live]);
  const favorites = useMemo(() => live.filter((b) => b.favorite).sort((a, b) => b.updatedAt - a.updatedAt), [live]);
  const continueBook = useMemo(() => [...live].filter((b) => b.status === 'draft').sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))[0], [live]);
  const stats = useMemo(() => ({
    books: live.length,
    chapters: live.reduce((n, b) => n + b.chapters.length, 0),
    words: live.reduce((n, b) => n + bookWordCount(b), 0),
    done: live.filter((b) => b.status === 'completed').length,
  }), [live]);
  const name = settings.profile.name || telegramUserName() || '';

  useEffect(() => { if (!settings.profile.name && telegramUserName()) update({ profile: { ...settings.profile, name: telegramUserName()! } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const qa: { icon: IconName; label: MessageKey; run: () => void; testId: string }[] = [
    { icon: 'plus', label: 'home.qa.new', run: onCreate, testId: 'qa-new' },
    { icon: 'sparkles', label: 'home.qa.studio', run: () => navigate(routes.studio()), testId: 'qa-studio' },
    { icon: 'layers', label: 'home.qa.templates', run: () => navigate(routes.templates()), testId: 'qa-templates' },
    { icon: 'image', label: 'home.qa.cover', run: () => navigate(routes.cover()), testId: 'qa-cover' },
    { icon: 'bookOpen', label: 'home.qa.library', run: () => navigate(routes.books()), testId: 'qa-library' },
    { icon: 'upload', label: 'home.qa.exports', run: () => navigate(routes.export()), testId: 'qa-exports' },
    { icon: 'folder', label: 'home.qa.import', run: () => navigate(routes.import()), testId: 'qa-import' },
    { icon: 'settings', label: 'home.qa.settings', run: () => navigate(routes.profile()), testId: 'qa-settings' },
  ];

  return (
    <div className="page home">
      <header className="home-header">
        <div className="app-badge" aria-hidden="true"><LogoMark /></div>
        <div className="home-title">
          <h1>{t('app.name')}</h1>
          <p>{t('app.tagline')}</p>
        </div>
        <IconButton icon="search" label={t('common.search')} onClick={() => navigate(routes.books())} />
        <IconButton icon="user" label={t('nav.profile')} onClick={() => navigate(routes.profile())} className="desktop-hide" />
      </header>

      <p className="home-greeting">{t(greetingKey())}{name ? `, ${name}` : ''} 👋</p>

      <HeroCarousel />

      <div className="qa-grid" role="list">
        {qa.map((q) => (
          <button key={q.label} type="button" role="listitem" className="qa-tile" onClick={q.run} data-testid={q.testId}>
            <Icon name={q.icon} size={26} strokeWidth={1.7} />
            <span>{t(q.label)}</span>
          </button>
        ))}
      </div>

      {ready && live.length === 0 && (
        <EmptyState title={t('home.empty.title')} text={t('home.empty.text')} action={<Button icon="sparkles" onClick={() => navigate(routes.create())}>{t('home.empty.cta')}</Button>} />
      )}

      {continueBook && (
        <>
          <SectionTitle>{t('home.continue')}</SectionTitle>
          <button type="button" className="continue-card glass" onClick={() => navigate(routes.editor(continueBook.id))} data-testid="continue-card">
            <BookCover cover={continueBook.cover} width={64} />
            <span className="continue-text">
              <strong>{continueBook.title}</strong>
              <small>{t('common.chapters', { n: continueBook.chapters.length })} · {t('common.words', { n: bookWordCount(continueBook) })}</small>
              <ProgressBar value={bookProgress(continueBook)} />
            </span>
            <span className="continue-go"><Icon name="arrowRight" size={20} /></span>
          </button>
        </>
      )}

      {recent.length > 0 && (
        <>
          <SectionTitle action={<a className="link" href={`#${routes.books('recent')}`}>{t('common.seeAll')} <Icon name="chevronRight" size={16} /></a>}>{t('home.recent')}</SectionTitle>
          <div className="book-rail" role="list" data-testid="recent-books">
            {recent.map((b) => <BookTile key={b.id} book={b} onMenu={() => setMenuBook(b)} />)}
          </div>
        </>
      )}

      {favorites.length > 0 && (
        <>
          <SectionTitle action={<a className="link" href={`#${routes.books('favorites')}`}>{t('common.seeAll')} <Icon name="chevronRight" size={16} /></a>}>{t('home.favorites')}</SectionTitle>
          <div className="book-rail" role="list">
            {favorites.map((b) => <BookTile key={b.id} book={b} onMenu={() => setMenuBook(b)} />)}
          </div>
        </>
      )}

      <SectionTitle>{t('home.quick')}</SectionTitle>
      <div className="quick-grid">
        <QuickCard icon="zap" tone="violet" title={t('home.quick.topic')} text={t('home.quick.topicDesc')} onClick={() => navigate(routes.create())} />
        <QuickCard icon="sparkles" tone="indigo" title={t('home.quick.write')} text={t('home.quick.writeDesc')} onClick={() => continueBook ? navigate(routes.editor(continueBook.id)) : onCreate()} />
        <QuickCard icon="image" tone="blue" title={t('home.quick.cover')} text={t('home.quick.coverDesc')} onClick={() => navigate(routes.cover())} />
        <QuickCard icon="file" tone="rose" title={t('home.quick.export')} text={t('home.quick.exportDesc')} onClick={() => navigate(routes.export())} />
      </div>

      {live.length > 0 && (
        <>
          <SectionTitle>{t('home.stats')}</SectionTitle>
          <div className="stats-grid" data-testid="stats">
            <Stat value={stats.books} label={t('home.stats.books')} />
            <Stat value={stats.chapters} label={t('home.stats.chapters')} />
            <Stat value={stats.words.toLocaleString(settings.locale === 'uz' ? 'uz-Latn' : settings.locale)} label={t('home.stats.words')} />
            <Stat value={stats.done} label={t('home.stats.done')} />
          </div>
        </>
      )}

      <BookMenu book={menuBook} open={!!menuBook} onClose={() => setMenuBook(null)} />
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return <div className="stat glass"><strong>{value}</strong><span>{label}</span></div>;
}

function QuickCard({ icon, tone, title, text, onClick }: { icon: IconName; tone: string; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className="quick-card glass" onClick={onClick}>
      <span className={`quick-icon tone-${tone}`}><Icon name={icon} size={24} /></span>
      <span className="quick-text"><strong>{title}</strong><small>{text}</small></span>
    </button>
  );
}

export function BookTile({ book, onMenu }: { book: Book; onMenu: () => void }) {
  const { t } = useSettings();
  const p = bookProgress(book);
  return (
    <div className="book-tile" role="listitem">
      <button type="button" className="book-tile-main" onClick={() => navigate(routes.editor(book.id))} aria-label={`${book.title} — ${t('common.open')}`}>
        <BookCover cover={book.cover} width={170} />
        <span className="book-tile-shade" />
        <span className="book-tile-info">
          <strong>{book.title}</strong>
          <small>{t('common.chapters', { n: book.chapters.length })} <span aria-hidden="true">·</span> {p}%</small>
          <ProgressBar value={p} done={p === 100} />
        </span>
        {p === 100 && <span className="book-tile-done" aria-hidden="true"><Icon name="check" size={14} strokeWidth={3} /></span>}
      </button>
      <IconButton icon="moreH" label={t('common.more')} className="book-tile-menu" onClick={onMenu} data-testid="book-menu" />
    </div>
  );
}

function HeroCarousel() {
  const { t, settings } = useSettings();
  const [i, setI] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  useEffect(() => {
    if (settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => { if (!paused.current) setI((x) => (x + 1) % HERO.length); }, 6000);
    return () => clearInterval(id);
  }, [settings.reducedMotion]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
  }, [i]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== i) setI(idx);
  };

  return (
    <section className="hero" aria-roledescription="carousel" aria-label="Bookly" onPointerEnter={() => (paused.current = true)} onPointerLeave={() => (paused.current = false)} onFocus={() => (paused.current = true)}>
      <div className="hero-track" ref={track} onScroll={onScroll}>
        {HERO.map((h, k) => (
          <article key={h.badge} className="hero-slide" aria-roledescription="slide" aria-label={`${k + 1} / ${HERO.length}`} aria-hidden={k !== i}>
            <div className="hero-copy">
              <span className="chip"><Icon name="sparkles" size={15} /> {t(h.badge)}</span>
              <h2>{t(h.title)}</h2>
              <p>{t(h.text)}</p>
              <Button variant="primary" className="hero-cta" iconRight="arrowRight" onClick={() => navigate(h.to)} tabIndex={k === i ? 0 : -1} data-testid={k === 0 ? 'hero-cta' : undefined}>{t(h.cta)}</Button>
            </div>
            <HeroArt kind={h.art} />
          </article>
        ))}
      </div>
      <div className="hero-dots" role="tablist">
        {HERO.map((h, k) => <button key={h.badge} type="button" role="tab" aria-selected={k === i} aria-label={`${k + 1}`} className={k === i ? 'is-active' : ''} onClick={() => setI(k)} />)}
      </div>
    </section>
  );
}

function HeroArt({ kind }: { kind: 'books' | 'cover' | 'export' }) {
  if (kind === 'cover') {
    return (
      <svg className="hero-art" viewBox="0 0 200 180" aria-hidden="true">
        <defs><linearGradient id="hc1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#312e81" /></linearGradient></defs>
        <rect x="58" y="18" width="96" height="140" rx="8" fill="url(#hc1)" transform="rotate(8 106 88)" opacity=".55" />
        <rect x="50" y="22" width="96" height="140" rx="8" fill="url(#hc1)" />
        <circle cx="120" cy="52" r="26" fill="#c4b5fd" opacity=".35" />
        <rect x="66" y="96" width="64" height="8" rx="4" fill="#fff" opacity=".9" /><rect x="74" y="110" width="48" height="5" rx="2.5" fill="#fff" opacity=".55" />
        <path d="M166 40l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#e9d5ff" />
      </svg>
    );
  }
  if (kind === 'export') {
    return (
      <svg className="hero-art" viewBox="0 0 200 180" aria-hidden="true">
        {[['PDF', '#e11d48', 30], ['EPUB', '#7c3aed', 70], ['DOCX', '#2563eb', 110], ['PPTX', '#ea580c', 150]].map(([l, c, x]) => (
          <g key={l as string} transform={`translate(${(x as number) - 22} ${(x as number) === 70 || (x as number) === 150 ? 70 : 40})`}>
            <rect width="44" height="56" rx="7" fill="#1e1b4b" stroke={c as string} strokeWidth="2" />
            <text x="22" y="34" fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="system-ui">{l as string}</text>
          </g>
        ))}
        <path d="M100 150v-24m0 24-10-10m10 10 10-10" stroke="#c4b5fd" strokeWidth="4" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg className="hero-art" viewBox="0 0 200 180" aria-hidden="true">
      <defs>
        <linearGradient id="hb1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#4338ca" /></linearGradient>
        <linearGradient id="hb2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ede9fe" /><stop offset="1" stopColor="#c4b5fd" /></linearGradient>
        <filter id="hglow"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <ellipse cx="108" cy="150" rx="78" ry="12" fill="#8b5cf6" opacity=".45" filter="url(#hglow)" />
      <path d="M28 128l84-28 70 22-84 30z" fill="url(#hb1)" />
      <path d="M28 128l84-28v10l-84 28z" fill="url(#hb2)" />
      <path d="M38 106l84-28 64 20-84 30z" fill="url(#hb1)" opacity=".95" />
      <path d="M38 106l84-28v10l-84 28z" fill="url(#hb2)" />
      <path d="M72 130l-6 22 8-6 6 7 2-24z" fill="#f0abfc" />
      <g transform="rotate(-10 128 52)">
        <rect x="96" y="22" width="64" height="58" rx="14" fill="#6d28d9" />
        <rect x="96" y="22" width="64" height="58" rx="14" fill="none" stroke="#c4b5fd" strokeWidth="2" />
        <text x="128" y="63" fill="#fff" fontSize="30" fontWeight="800" fontStyle="italic" textAnchor="middle" fontFamily="system-ui, sans-serif">AI</text>
      </g>
      <path d="M58 30l3 8 8 3-8 3-3 8-3-8-8-3 8-3zM176 96l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#e9d5ff" />
    </svg>
  );
}

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs><linearGradient id="lmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a5b4fc" /><stop offset="1" stopColor="#6366f1" /></linearGradient></defs>
      <path d="M8 18c8-4 16-4 24 1v32c-8-5-16-5-24-1z" fill="url(#lmg)" />
      <path d="M56 18c-8-4-16-4-24 1v32c8-5 16-5 24-1z" fill="#c7d2fe" />
      <path d="M32 19v32" stroke="#312e81" strokeWidth="2" />
    </svg>
  );
}
