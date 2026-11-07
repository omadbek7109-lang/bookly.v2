import { useEffect, useMemo, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { navigate, routes, useRoute } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { BookMenu } from '../../components/BookMenu';
import { Icon } from '../../components/Icon';
import { Button, EmptyState, IconButton, PageHeader, ProgressBar, Segmented, Select } from '../../components/ui';
import { bookProgress, bookWordCount, blockText, type Book, type BookCategory } from '../../models/book';
import type { MessageKey } from '../../i18n';
import { books as repo } from '../../services/storage/repository';

type Tab = 'all' | 'drafts' | 'completed' | 'favorites' | 'recent' | 'trash';
type Sort = 'updated' | 'created' | 'title' | 'words';
const TRASH_DAYS = 30;
const CATS: BookCategory[] = ['education', 'business', 'self-development', 'fiction', 'children', 'academic', 'guide', 'journal', 'technology', 'finance', 'other'];

export default function LibraryPage({ onCreate }: { onCreate: () => void }) {
  const { t } = useSettings();
  const { books, ready } = useLibrary();
  const { confirm, toast } = useUi();
  const route = useRoute();
  const tab = (route.query.get('tab') as Tab) || 'all';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [cat, setCat] = useState<BookCategory | 'all'>('all');
  const [menu, setMenu] = useState<Book | null>(null);

  // Purge books that stayed in the trash longer than 30 days.
  useEffect(() => {
    const limit = Date.now() - TRASH_DAYS * 864e5;
    books.filter((b) => b.deletedAt && b.deletedAt < limit).forEach((b) => void repo.remove(b.id));
  }, [books]);

  const counts = useMemo(() => {
    const live = books.filter((b) => !b.deletedAt);
    return {
      all: live.length, drafts: live.filter((b) => b.status === 'draft').length, completed: live.filter((b) => b.status === 'completed').length,
      favorites: live.filter((b) => b.favorite).length, recent: Math.min(live.length, 10), trash: books.length - live.length,
    };
  }, [books]);

  const list = useMemo(() => {
    let l = books.filter((b) => (tab === 'trash' ? !!b.deletedAt : !b.deletedAt));
    if (tab === 'drafts') l = l.filter((b) => b.status === 'draft');
    if (tab === 'completed') l = l.filter((b) => b.status === 'completed');
    if (tab === 'favorites') l = l.filter((b) => b.favorite);
    if (cat !== 'all') l = l.filter((b) => b.category === cat);
    const needle = q.trim().toLocaleLowerCase();
    if (needle) {
      l = l.filter((b) => [b.title, b.subtitle, b.author, b.description, ...b.metadata.keywords, ...b.chapters.map((c) => c.title)].join(' ').toLocaleLowerCase().includes(needle)
        || b.chapters.some((c) => c.blocks.some((x) => blockText(x).toLocaleLowerCase().includes(needle))));
    }
    const sorters: Record<Sort, (a: Book, b: Book) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, 'uz'),
      words: (a, b) => bookWordCount(b) - bookWordCount(a),
    };
    l = [...l].sort(tab === 'recent' ? (a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt) : tab === 'trash' ? (a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) : sorters[sort]);
    return tab === 'recent' ? l.slice(0, 10) : l;
  }, [books, tab, q, sort, cat]);

  const setTab = (v: Tab) => navigate(routes.books(v === 'all' ? undefined : v), { replace: true });
  const tabs: { value: Tab; label: string; count: number }[] = (['all', 'drafts', 'completed', 'favorites', 'recent', 'trash'] as Tab[]).map((v) => ({ value: v, label: t(`books.tab.${v}` as MessageKey), count: counts[v] }));

  const emptyTrash = async () => {
    if (!(await confirm({ title: t('books.trashEmptyAll'), message: t('books.confirmEmptyTrash'), confirmLabel: t('common.delete'), danger: true }))) return;
    for (const b of books.filter((x) => x.deletedAt)) await repo.remove(b.id);
    toast(t('books.trashEmptyAll'), 'success');
  };

  const filtered = q.trim() || cat !== 'all';
  const empty = (() => {
    if (filtered) return { title: t('books.empty.search'), text: t('books.empty.searchText') };
    switch (tab) {
      case 'trash': return { title: t('books.empty.trash'), text: t('books.empty.trashText') };
      case 'favorites': return { title: t('books.empty.favorites'), text: t('books.empty.favoritesText') };
      case 'drafts': return { title: t('books.empty.drafts'), text: t('books.empty.allText') };
      case 'completed': return { title: t('books.empty.completed'), text: t('books.empty.completedText') };
      default: return { title: t('books.empty.all'), text: t('books.empty.allText') };
    }
  })();

  return (
    <div className="page library">
      <PageHeader title={t('books.title')} actions={<Button size="sm" icon="plus" onClick={onCreate}>{t('nav.create')}</Button>} />
      <div className="search-box">
        <Icon name="search" size={19} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('books.searchPlaceholder')} aria-label={t('common.search')} data-testid="library-search" />
        {q && <IconButton icon="x" label={t('common.close')} onClick={() => setQ('')} size={18} />}
      </div>
      <Segmented value={tab} options={tabs} onChange={setTab} label={t('books.title')} scroll />
      <div className="filters">
        <Select variant="chip" icon="arrowDown" label={t('books.sort')} value={sort} onChange={setSort} disabled={tab === 'recent' || tab === 'trash'} testId="library-sort"
          options={(['updated', 'created', 'title', 'words'] as Sort[]).map((v) => ({ value: v, label: t(`books.sort.${v}` as MessageKey) }))} />
        <Select variant="chip" icon="layers" label={t('creator.category')} value={cat} onChange={setCat} testId="library-category"
          options={[{ value: 'all' as const, label: t('books.filter.all') }, ...CATS.map((c) => ({ value: c, label: t(`category.${c}` as MessageKey) }))]} />
        {tab === 'trash' && counts.trash > 0 && <Button size="sm" variant="danger" icon="trash" onClick={() => void emptyTrash()}>{t('books.trashEmptyAll')}</Button>}
      </div>

      {ready && list.length === 0 ? (
        <EmptyState icon={tab === 'trash' ? 'trash' : filtered ? 'search' : 'bookOpen'} title={empty.title} text={empty.text}
          action={!filtered && tab === 'all' ? <Button icon="sparkles" onClick={() => navigate(routes.create())}>{t('home.empty.cta')}</Button> : undefined} />
      ) : (
        <ul className="book-list" data-testid="book-list">
          {list.map((b) => <BookRow key={b.id} book={b} onMenu={() => setMenu(b)} />)}
        </ul>
      )}
      <BookMenu book={menu} open={!!menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function BookRow({ book, onMenu }: { book: Book; onMenu: () => void }) {
  const { t } = useSettings();
  const p = bookProgress(book);
  const daysLeft = book.deletedAt ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - book.deletedAt) / 864e5)) : 0;
  return (
    <li className="book-row glass" data-testid="book-row">
      <button type="button" className="book-row-main" onClick={() => (book.deletedAt ? onMenu() : navigate(routes.editor(book.id)))}>
        <BookCover cover={book.cover} width={58} />
        <span className="book-row-text">
          <strong>{book.title}</strong>
          <small>
            {book.favorite && <Icon name="star" size={13} fill="currentColor" className="fav" />}
            {t(`category.${book.category}` as MessageKey)} · {t('common.chapters', { n: book.chapters.length })} · {t('common.words', { n: bookWordCount(book) })}
          </small>
          {book.deletedAt ? <small className="danger-text">{t('books.deletedIn', { n: daysLeft })}</small> : <ProgressBar value={p} done={p === 100} />}
        </span>
      </button>
      <IconButton icon="moreV" label={t('common.more')} onClick={onMenu} data-testid="row-menu" />
    </li>
  );
}
