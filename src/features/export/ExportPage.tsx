import { useMemo, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, Field, PageHeader, Segmented, Switch } from '../../components/ui';
import type { MessageKey } from '../../i18n';
import { bookWordCount } from '../../models/book';
import { downloadBytes, exportBook, formatBytes } from '../../services/export/prepare';
import type { ExportFormat, ExportOutput } from '../../services/export/types';

const FORMATS: { id: ExportFormat; icon: IconName; label: MessageKey; desc: MessageKey; tone: string }[] = [
  { id: 'pdf', icon: 'file', label: 'export.pdf', desc: 'export.pdfDesc', tone: 'rose' },
  { id: 'epub', icon: 'bookOpen', label: 'export.epub', desc: 'export.epubDesc', tone: 'violet' },
  { id: 'docx', icon: 'edit', label: 'export.docx', desc: 'export.docxDesc', tone: 'blue' },
  { id: 'pptx', icon: 'presentation', label: 'export.pptx', desc: 'export.pptxDesc', tone: 'amber' },
];

const history: { name: string; size: number; at: number; out: ExportOutput }[] = [];

export default function ExportPage({ bookId }: { bookId?: string }) {
  const { t, settings, update } = useSettings();
  const { books, ready } = useLibrary();
  const { toast } = useUi();
  const live = useMemo(() => books.filter((b) => !b.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt), [books]);
  const [selected, setSelected] = useState<string | undefined>(bookId);
  const book = live.find((b) => b.id === (selected ?? live[0]?.id));
  const [format, setFormat] = useState<ExportFormat>(settings.defaultExport);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ExportOutput | null>(null);
  const [, refresh] = useState(0);
  const opts = { includeCover: settings.exportIncludeCover, includeToc: settings.exportIncludeToc, pageSize: settings.pdfPageSize };

  const run = async () => {
    if (!book) return;
    setBusy(true); setLast(null);
    try {
      const out = await exportBook(book, format, opts);
      if (!out.bytes.length) throw new Error('empty file');
      downloadBytes(out.bytes, out.filename, out.mime);
      setLast(out);
      history.unshift({ name: out.filename, size: out.bytes.length, at: Date.now(), out });
      history.splice(6);
      refresh((x) => x + 1);
      toast(t('export.success', { name: out.filename, size: formatBytes(out.bytes.length) }), 'success');
    } catch (e) {
      console.error(e);
      toast(t('export.error', { msg: (e as Error).message || String(e) }), 'error');
    } finally { setBusy(false); }
  };

  if (ready && !live.length) {
    return (
      <div className="page">
        <PageHeader title={t('export.title')} onBack={() => back(routes.studio())} />
        <EmptyState icon="download" title={t('export.noBooks')} action={<Button icon="sparkles" onClick={() => navigate(routes.create())}>{t('home.empty.cta')}</Button>} />
      </div>
    );
  }

  return (
    <div className="page export">
      <PageHeader title={t('export.title')} subtitle={t('export.subtitle')} onBack={() => back(routes.studio())} />
      {book && (
        <div className="export-book glass">
          <BookCover cover={book.cover} width={72} />
          <div className="export-book-text">
            <strong>{book.title}</strong>
            <small>{t('common.chapters', { n: book.chapters.length })} · {t('common.words', { n: bookWordCount(book) })}</small>
            {live.length > 1 && (
              <label className="select-wrap">
                <span className="sr-only">{t('export.book')}</span>
                <Icon name="book" size={16} />
                <select value={book.id} onChange={(e) => { setSelected(e.target.value); setLast(null); }} data-testid="export-book">
                  {live.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      )}

      <h2 className="sub-title">{t('export.format')}</h2>
      <div className="format-grid" role="radiogroup" aria-label={t('export.format')}>
        {FORMATS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={format === f.id} className={`format-card glass ${format === f.id ? 'is-active' : ''}`} onClick={() => setFormat(f.id)} data-testid={`fmt-${f.id}`}>
            <span className={`quick-icon tone-${f.tone}`}><Icon name={f.icon} size={22} /></span>
            <strong>{t(f.label)}</strong>
            <small>{t(f.desc)}</small>
            <span className="format-ext">.{f.id}</span>
          </button>
        ))}
      </div>

      <h2 className="sub-title">{t('export.options')}</h2>
      <div className="glass options-card">
        <Switch id="opt-cover" label={t('export.includeCover')} checked={opts.includeCover} onChange={(v) => update({ exportIncludeCover: v })} />
        <Switch id="opt-toc" label={t('export.includeToc')} checked={opts.includeToc} onChange={(v) => update({ exportIncludeToc: v })} />
        {(format === 'pdf' || format === 'docx') && (
          <Field label={t('export.pageSize')}>
            <Segmented value={opts.pageSize} label={t('export.pageSize')} onChange={(v) => update({ pdfPageSize: v })} options={[{ value: 'A5', label: 'A5' }, { value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]} />
          </Field>
        )}
        {format === 'pdf' && <p className="muted small"><Icon name="info" size={14} /> {t('export.pdfNote')}</p>}
      </div>

      <Button icon="download" size="lg" block loading={busy} onClick={() => void run()} disabled={!book} data-testid="export-run">
        {busy ? t('export.running') : t('export.run', { f: format.toUpperCase() })}
      </Button>

      {last && (
        <div className="export-done glass" role="status" data-testid="export-done">
          <Icon name="check" size={20} />
          <span><strong>{last.filename}</strong><small>{formatBytes(last.bytes.length)} · {last.mime.split('/').pop()?.split('.').pop()}</small></span>
          <Button size="sm" variant="secondary" icon="download" onClick={() => downloadBytes(last.bytes, last.filename, last.mime)}>{t('export.downloadAgain')}</Button>
        </div>
      )}

      {history.length > 0 && (
        <>
          <h2 className="sub-title">{t('export.history')}</h2>
          <ul className="list">
            {history.map((h) => (
              <li key={h.at} className="list-row">
                <span className="list-row-icon"><Icon name="file" size={18} /></span>
                <span className="list-row-text"><span>{h.name}</span><small>{formatBytes(h.size)} · {new Date(h.at).toLocaleTimeString()}</small></span>
                <Button size="sm" variant="ghost" icon="download" onClick={() => downloadBytes(h.out.bytes, h.out.filename, h.out.mime)} aria-label={t('export.downloadAgain')} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
