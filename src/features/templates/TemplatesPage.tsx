import { useMemo, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Button, ListRow, PageHeader, Segmented, Sheet } from '../../components/ui';
import { createBlock, createBook, createChapter, defaultCover, type Book, type BookCategory, type CoverDesign } from '../../models/book';
import { fontById, TEMPLATE_CATEGORIES, TEMPLATES, type DesignTemplate } from '../../models/templates';
import type { MessageKey } from '../../i18n';
import { books } from '../../services/storage/repository';

export function templateCover(tpl: DesignTemplate, base: CoverDesign): CoverDesign {
  const keepImage = base.background.kind === 'image' && !!base.background.imageAssetId;
  return {
    ...base,
    templateId: tpl.id,
    fontId: tpl.cover.fontId,
    layout: tpl.cover.layout,
    textColor: keepImage ? '#ffffff' : tpl.cover.textColor,
    accentColor: tpl.cover.accentColor,
    overlay: keepImage ? Math.max(base.overlay, 0.3) : tpl.cover.overlay,
    background: keepImage ? base.background : { ...base.background, kind: tpl.cover.kind, colors: tpl.cover.colors },
  };
}

export function applyTemplate(book: Book, tpl: DesignTemplate): Book {
  return { ...book, theme: { ...tpl.theme, templateId: tpl.id }, cover: templateCover(tpl, book.cover) };
}

export function TemplatesView() {
  const { t } = useSettings();
  const { books: all } = useLibrary();
  const { toast } = useUi();
  const [cat, setCat] = useState<BookCategory | 'all'>('all');
  const [preview, setPreview] = useState<DesignTemplate | null>(null);
  const [picking, setPicking] = useState(false);
  const list = useMemo(() => (cat === 'all' ? TEMPLATES : TEMPLATES.filter((x) => x.category === cat)), [cat]);
  const live = all.filter((b) => !b.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);

  const newWith = async (tpl: DesignTemplate) => {
    const title = t('common.untitled');
    const book = applyTemplate(createBook({
      title, category: tpl.category, source: 'template',
      chapters: [createChapter(t('templates.sampleHeading'), [createBlock('paragraph', { html: '' })])],
    }), tpl);
    book.cover = { ...templateCover(tpl, defaultCover(title, '')) };
    const saved = await books.save(book);
    setPreview(null);
    navigate(routes.editor(saved.id));
  };

  const applyTo = async (b: Book) => {
    if (!preview) return;
    await books.save(applyTemplate(b, preview));
    toast(t('templates.applied'), 'success', { label: t('common.open'), run: () => navigate(routes.editor(b.id)) });
    setPicking(false); setPreview(null);
  };

  return (
    <>
      <Segmented value={cat} onChange={setCat} label={t('templates.title')} scroll
        options={[{ value: 'all' as const, label: t('templates.all') }, ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}` as MessageKey) }))]} />
      <div className="template-grid" data-testid="template-grid">
        {list.map((tpl) => (
          <button key={tpl.id} type="button" className="template-card glass" onClick={() => setPreview(tpl)} data-testid={`tpl-${tpl.id}`}>
            <BookCover cover={templateCover(tpl, { ...defaultCover(tpl.name, 'Bookly'), subtitle: t(`category.${tpl.category}` as MessageKey) })} width={150} />
            <strong>{tpl.name}</strong>
            <small>{t(`category.${tpl.category}` as MessageKey)}</small>
          </button>
        ))}
      </div>

      <Sheet open={!!preview && !picking} onClose={() => setPreview(null)} title={preview?.name} size="md"
        footer={preview && <>
          <Button variant="secondary" icon="layers" onClick={() => setPicking(true)} disabled={!live.length} data-testid="tpl-apply-existing">{t('templates.applyTo')}</Button>
          <Button icon="plus" onClick={() => void newWith(preview)} data-testid="tpl-new-book">{t('templates.newBook')}</Button>
        </>}>
        {preview && (
          <div className="tpl-preview">
            <BookCover cover={templateCover(preview, { ...defaultCover(preview.name, 'Bookly'), subtitle: preview.description })} width={150} />
            <div className="tpl-sample" style={{ background: preview.theme.paper, color: preview.theme.ink }}>
              <small style={{ color: preview.theme.accent }}>1-BOB</small>
              <h3 style={{ fontFamily: fontById(preview.theme.headingFont).css }}>{t('templates.sampleHeading')}</h3>
              <span className="tpl-rule" style={{ background: preview.theme.accent }} />
              <p style={{ fontFamily: fontById(preview.theme.bodyFont).css, fontSize: `${preview.theme.baseSize + 3}px` }}>{t('templates.sampleText')}</p>
              <blockquote style={{ borderColor: preview.theme.accent, fontFamily: fontById(preview.theme.bodyFont).css }}>Ming chaqirimlik yo‘l ham bir qadamdan boshlanadi.</blockquote>
            </div>
            <p className="muted">{preview.description}</p>
          </div>
        )}
      </Sheet>

      <Sheet open={picking} onClose={() => setPicking(false)} title={t('home.chooseBook')} size="sm">
        <div className="list">
          {live.map((b) => <ListRow key={b.id} icon="book" title={b.title} subtitle={t('common.chapters', { n: b.chapters.length })} onClick={() => void applyTo(b)} />)}
        </div>
      </Sheet>
    </>
  );
}

export default function TemplatesPage() {
  const { t } = useSettings();
  return (
    <div className="page">
      <PageHeader title={t('templates.title')} subtitle={t('templates.subtitle')} onBack={() => back(routes.studio())} />
      <TemplatesView />
    </div>
  );
}
