import { useT } from '../app/AppContext';
import { navigate, routes } from '../app/router';
import { useBookActions } from '../hooks/useBookActions';
import type { Book } from '../models/book';
import { BookCover } from './BookCover';
import { ListRow, Sheet } from './ui';

/** Action sheet with every library action for a book. */
export function BookMenu({ book, open, onClose }: { book: Book | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const a = useBookActions();
  if (!book) return null;
  const run = (fn: () => unknown) => () => { onClose(); void fn(); };
  const inTrash = !!book.deletedAt;
  return (
    <Sheet open={open} onClose={onClose} title={book.title} size="sm">
      <div className="menu-book">
        <BookCover cover={book.cover} width={56} />
        <div>
          <strong>{book.title}</strong>
          <small>{t('common.chapters', { n: book.chapters.length })} · {t(book.status === 'completed' ? 'status.completed' : 'status.draft')}</small>
        </div>
      </div>
      <div className="list" role="menu">
        {inTrash ? (
          <>
            <ListRow icon="restore" title={t('common.restore')} onClick={run(() => a.restore(book))} testId="menu-restore" />
            <ListRow icon="trash" danger title={t('books.deleteForever')} onClick={run(() => a.deleteForever(book))} testId="menu-delete-forever" />
          </>
        ) : (
          <>
            <ListRow icon="edit" title={t('common.edit')} onClick={run(() => navigate(routes.editor(book.id)))} testId="menu-edit" />
            <ListRow icon="eye" title={t('common.preview')} onClick={run(() => navigate(routes.reader(book.id)))} testId="menu-preview" />
            <ListRow icon="image" title={t('books.cover')} onClick={run(() => navigate(routes.cover(book.id)))} />
            <ListRow icon="download" title={t('common.export')} onClick={run(() => navigate(routes.export(book.id)))} testId="menu-export" />
            <ListRow icon="star" title={book.favorite ? t('common.unfavorite') : t('common.favorite')} onClick={run(() => a.toggleFavorite(book))} testId="menu-favorite" />
            <ListRow icon="type" title={t('common.rename')} onClick={run(() => a.rename(book))} testId="menu-rename" />
            <ListRow icon="copy" title={t('common.duplicate')} onClick={run(() => a.duplicate(book))} testId="menu-duplicate" />
            <ListRow icon="check" title={book.status === 'completed' ? t('books.markDraft') : t('books.markCompleted')}
              onClick={run(() => a.setStatus(book, book.status === 'completed' ? 'draft' : 'completed'))} testId="menu-status" />
            <ListRow icon="trash" danger title={t('common.delete')} onClick={run(() => a.trash(book))} testId="menu-delete" />
          </>
        )}
      </div>
    </Sheet>
  );
}
