import { useCallback } from 'react';
import { useT, useUi } from '../app/AppContext';
import { navigate, routes } from '../app/router';
import { duplicateBook, type Book } from '../models/book';
import { books } from '../services/storage/repository';

export function useBookActions() {
  const t = useT();
  const { toast, confirm, prompt } = useUi();

  const toggleFavorite = useCallback(async (b: Book) => {
    await books.save({ ...b, favorite: !b.favorite }, { touch: false });
  }, []);

  const rename = useCallback(async (b: Book) => {
    const name = await prompt({ title: t('common.rename'), value: b.title, placeholder: t('books.newTitle'), confirmLabel: t('common.save') });
    if (!name || name === b.title) return;
    const cover = b.cover.title === b.title || !b.cover.title ? { ...b.cover, title: name } : b.cover;
    await books.save({ ...b, title: name, cover });
    toast(t('books.renamed'), 'success');
  }, [prompt, t, toast]);

  const duplicate = useCallback(async (b: Book) => {
    const copy = await books.save(duplicateBook(b, ` (${t('books.copySuffix')})`));
    toast(t('books.duplicated'), 'success', { label: t('common.open'), run: () => navigate(routes.editor(copy.id)) });
    return copy;
  }, [t, toast]);

  const trash = useCallback(async (b: Book) => {
    await books.save({ ...b, deletedAt: Date.now() }, { touch: false });
    toast(t('books.movedToTrash'), 'info', { label: t('common.restore'), run: () => void books.save({ ...b, deletedAt: null }, { touch: false }) });
  }, [t, toast]);

  const restore = useCallback(async (b: Book) => {
    await books.save({ ...b, deletedAt: null }, { touch: false });
    toast(t('books.restored'), 'success');
  }, [t, toast]);

  const deleteForever = useCallback(async (b: Book) => {
    if (!(await confirm({ title: t('books.deleteForever'), message: t('books.confirmDeleteForever'), confirmLabel: t('common.delete'), danger: true }))) return false;
    await books.remove(b.id);
    return true;
  }, [confirm, t]);

  const setStatus = useCallback(async (b: Book, status: Book['status']) => {
    await books.save({ ...b, status });
  }, []);

  return { toggleFavorite, rename, duplicate, trash, restore, deleteForever, setStatus };
}
