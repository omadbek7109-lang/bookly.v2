import { useRef, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon } from '../../components/Icon';
import { Button, PageHeader, Spinner } from '../../components/ui';
import { chapterWordCount } from '../../models/book';
import { importFile, type ImportResult } from '../../services/import';
import { assets, books } from '../../services/storage/repository';

export default function ImportPage() {
  const { t } = useSettings();
  const { toast } = useUi();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (f?: File) => {
    if (!f) return;
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await importFile(f));
    } catch (e) {
      const msg = (e as Error).message === 'UNSUPPORTED' ? t('import.unsupported') : t('import.error', { msg: (e as Error).message });
      setError(msg);
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!result) return;
    for (const a of result.assets) await assets.put(a.blob, a.name, a.id);
    const saved = await books.save(result.book);
    toast(t('import.saved'), 'success');
    navigate(routes.editor(saved.id), { replace: true });
  };

  return (
    <div className="page import">
      <PageHeader title={t('import.title')} subtitle={t('import.subtitle')} onBack={() => back(routes.studio())} />
      <input ref={input} type="file" hidden accept=".txt,.md,.docx,.epub,text/plain,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ''; }} data-testid="import-input" />
      <button type="button" className={`drop-zone big glass ${drag ? 'is-drag' : ''}`} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files[0]); }}>
        <Icon name="upload" size={34} />
        <strong>{t('import.drop')}</strong>
        <small>{t('import.supported')}</small>
      </button>
      {busy && <div className="center"><Spinner label={t('import.parsing')} /></div>}
      {error && <div className="banner banner-error" role="alert" data-testid="import-error"><Icon name="alert" size={18} /> {error}</div>}
      {result && (
        <section className="import-result glass" data-testid="import-result">
          <div className="import-head">
            <BookCover cover={result.book.cover} width={70} />
            <div>
              <strong>{result.book.title}</strong>
              <small>{t('import.result', { n: result.book.chapters.length })}{result.book.author ? ` · ${result.book.author}` : ''}</small>
            </div>
          </div>
          <ol className="import-chapters">
            {result.book.chapters.slice(0, 30).map((c) => <li key={c.id}><span>{c.title}</span><small>{t('common.words', { n: chapterWordCount(c) })}</small></li>)}
          </ol>
          {result.warnings.length > 0 && (
            <div className="banner banner-warn" data-testid="import-warnings">
              <strong><Icon name="alert" size={16} /> {t('import.warnings')}</strong>
              <ul>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <Button icon="check" block size="lg" onClick={() => void save()} data-testid="import-save">{t('import.save')}</Button>
        </section>
      )}
    </div>
  );
}
