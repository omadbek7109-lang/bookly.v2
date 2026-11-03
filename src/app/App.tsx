import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { LibraryProvider, SettingsProvider, UiProvider, useLibrary, useSettings, useT } from './AppContext';
import { navigate, routes, useRoute } from './router';
import { Icon, type IconName } from '../components/Icon';
import { Button, DialogHost, EmptyState, ListRow, Sheet, Spinner, ToastHost } from '../components/ui';
import { Splash } from '../features/home/Splash';
import { HomePage } from '../features/home/HomePage';
import { createBook } from '../models/book';
import { books } from '../services/storage/repository';
import type { MessageKey } from '../i18n';

const LibraryPage = lazy(() => import('../features/library/LibraryPage'));
const StudioPage = lazy(() => import('../features/studio/StudioPage'));
const TemplatesPage = lazy(() => import('../features/templates/TemplatesPage'));
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'));
const CreatorPage = lazy(() => import('../features/ai-creator/CreatorPage'));
const EditorPage = lazy(() => import('../features/editor/EditorPage'));
const ReaderPage = lazy(() => import('../features/reader/ReaderPage'));
const CoverPage = lazy(() => import('../features/cover-designer/CoverPage'));
const ExportPage = lazy(() => import('../features/export/ExportPage'));
const ImportPage = lazy(() => import('../features/import/ImportPage'));

const TABS: { path: string; icon: IconName; label: MessageKey; match: (p: string) => boolean }[] = [
  { path: routes.home(), icon: 'home', label: 'nav.home', match: (p) => p === '/' },
  { path: routes.books(), icon: 'bookOpen', label: 'nav.books', match: (p) => p.startsWith('/books') },
  { path: routes.studio(), icon: 'layers', label: 'nav.studio', match: (p) => p.startsWith('/studio') || p.startsWith('/templates') || p.startsWith('/create') || p.startsWith('/cover') || p.startsWith('/export') || p.startsWith('/import') },
  { path: routes.profile(), icon: 'user', label: 'nav.profile', match: (p) => p.startsWith('/profile') },
];

const SIDE: { path: string; icon: IconName; label: MessageKey; match: (p: string) => boolean }[] = [
  TABS[0], TABS[1],
  { path: routes.studio(), icon: 'sparkles', label: 'nav.studio', match: (p) => p.startsWith('/studio') || p.startsWith('/create') },
  { path: routes.templates(), icon: 'layout', label: 'nav.templates', match: (p) => p.startsWith('/templates') },
  { path: routes.export(), icon: 'download', label: 'nav.export', match: (p) => p.startsWith('/export') },
  TABS[3],
];

/** Full-screen routes hide the tab bar to give the editor/reader the whole viewport. */
const isImmersive = (p: string) => p.startsWith('/editor/') || p.startsWith('/reader/');

export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const newBlank = async () => {
    onClose();
    const b = await books.save(createBook({ title: t('common.untitled') }));
    navigate(routes.editor(b.id));
  };
  const go = (to: string) => () => { onClose(); navigate(to); };
  return (
    <Sheet open={open} onClose={onClose} title={t('create.title')} size="sm">
      <div className="list create-list">
        <ListRow icon="sparkles" title={t('create.ai')} subtitle={t('create.aiDesc')} onClick={go(routes.create())} testId="create-ai" />
        <ListRow icon="filePlus" title={t('create.blank')} subtitle={t('create.blankDesc')} onClick={() => void newBlank()} testId="create-blank" />
        <ListRow icon="layout" title={t('create.template')} subtitle={t('create.templateDesc')} onClick={go(routes.templates())} testId="create-template" />
        <ListRow icon="upload" title={t('create.import')} subtitle={t('create.importDesc')} onClick={go(routes.import())} testId="create-import" />
      </div>
    </Sheet>
  );
}

function Shell() {
  const route = useRoute();
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const immersive = isImmersive(route.path);
  const { error } = useLibrary();

  let page: ReactNode;
  const [a, b] = route.parts;
  switch (a) {
    case undefined: page = <HomePage onCreate={() => setCreateOpen(true)} />; break;
    case 'books': page = <LibraryPage onCreate={() => setCreateOpen(true)} />; break;
    case 'studio': page = <StudioPage />; break;
    case 'templates': page = <TemplatesPage />; break;
    case 'profile': page = <ProfilePage />; break;
    case 'create': page = <CreatorPage />; break;
    case 'editor': page = b ? <EditorPage key={b} bookId={b} /> : null; break;
    case 'reader': page = b ? <ReaderPage key={b} bookId={b} /> : null; break;
    case 'cover': page = <CoverPage key={b ?? 'pick'} bookId={b} />; break;
    case 'export': page = <ExportPage key={b ?? 'pick'} bookId={b} />; break;
    case 'import': page = <ImportPage />; break;
    default: page = <EmptyState icon="alert" title={t('notFound.title')} action={<Button onClick={() => navigate('/')}>{t('nav.home')}</Button>} />;
  }

  return (
    <div className={`shell ${immersive ? 'is-immersive' : ''}`}>
      {!immersive && (
        <aside className="sidenav" aria-label={t('nav.main')}>
          <a className="brand" href="#/"><span className="brand-mark"><Icon name="bookOpen" size={20} /></span><span><b>{t('app.name')}</b><small>{t('app.tagline')}</small></span></a>
          <Button icon="plus" block onClick={() => setCreateOpen(true)} data-testid="side-create">{t('nav.create')}</Button>
          <nav>
            {SIDE.map((s) => (
              <a key={s.label + s.path} href={`#${s.path}`} className={s.match(route.path) ? 'is-active' : ''} aria-current={s.match(route.path) ? 'page' : undefined}>
                <Icon name={s.icon} size={20} /><span>{t(s.label)}</span>
              </a>
            ))}
          </nav>
        </aside>
      )}
      <main className="main" id="main">
        {error && <div className="banner banner-error" role="alert"><Icon name="alert" size={18} /> {t('error.storage')} <small>({error})</small></div>}
        <Suspense fallback={<div className="page-loading"><Spinner label={t('common.loading')} /></div>}>
          <ErrorBoundary>{page}</ErrorBoundary>
        </Suspense>
      </main>
      {!immersive && (
        <nav className="tabbar" aria-label={t('nav.main')}>
          {TABS.slice(0, 2).map((s) => <TabLink key={s.path} {...s} active={s.match(route.path)} label={t(s.label)} />)}
          <button type="button" className="tab-fab" onClick={() => setCreateOpen(true)} aria-label={t('nav.create')} data-testid="fab-create">
            <Icon name="plus" size={28} strokeWidth={2.2} />
          </button>
          {TABS.slice(2).map((s) => <TabLink key={s.path} {...s} active={s.match(route.path)} label={t(s.label)} />)}
        </nav>
      )}
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

function TabLink({ path, icon, label, active }: { path: string; icon: IconName; label: string; active: boolean }) {
  return (
    <a href={`#${path}`} className={`tab ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={23} /><span>{label}</span>
    </a>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error('[bookly] UI error', err); }
  render() {
    if (this.state.err) {
      return (
        <EmptyState icon="alert" title="Nimadir noto‘g‘ri ketdi" text={`Sahifani qayta yuklang. Maʼlumotlaringiz saqlangan. (${this.state.err.message})`}
          action={<Button icon="refresh" onClick={() => location.reload()}>Qayta yuklash</Button>} />
      );
    }
    return this.props.children;
  }
}

function Root() {
  const { settings, update } = useSettings();
  const [showIntro, setShowIntro] = useState(() => !settings.introSeen && !/[?&]noIntro=1/.test(location.search));
  return (
    <>
      {showIntro && <Splash onDone={() => { update({ introSeen: true }); setShowIntro(false); }} />}
      <Shell />
    </>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <UiProvider>
        <LibraryProvider>
          <Root />
        </LibraryProvider>
      </UiProvider>
    </SettingsProvider>
  );
}
