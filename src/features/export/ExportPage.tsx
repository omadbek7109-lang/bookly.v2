import { useMemo, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, Field, PageHeader, Segmented, Switch } from '../../components/ui';
import type { MessageKey } from '../../i18n';
import { bookWordCount } from '../../models/book';
import { downloadBytes, exportBook, formatBytes } from '../../services/export/prepare';
import { friendlyError } from '../../services/cloud/client';
import { haptic, telegramInitData } from '../../services/platform/telegram';
import { sendFileToTelegram } from '../../services/platform/telegram-send';
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

  const inTelegram = !!telegramInitData();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const download = async (out: ExportOutput) => {
    const saved = await downloadBytes(out.bytes, out.filename, out.mime);
    if (saved === 'failed') toast(inTelegram ? 'Yuklab bo‘lmadi. «Telegram’ga yuborish» ni tanlang — fayl chatingizga keladi.' : 'Faylni saqlab bo‘lmadi', 'error');
    else if (saved === 'saved') toast(t('export.success', { name: out.filename, size: formatBytes(out.bytes.length) }), 'success');
  };

  const sendToTelegram = async (out: ExportOutput) => {
    setSending(true);
    try {
      await sendFileToTelegram(out.bytes, out.filename, out.mime, book ? `📘 ${book.title}` : '');
      setSent(out.filename);
      haptic('success');
      toast('Fayl Telegram chatingizga yuborildi ✅', 'success');
    } catch (e) {
      haptic('error');
      toast(friendlyError(e), 'error');
    } finally { setSending(false); }
  };

  const share = async (out: ExportOutput) => {
    try {
      const file = new File([out.bytes as BlobPart], out.filename, { type: out.mime });
      await navigator.share({ files: [file], title: out.filename });
    } catch (e) { if ((e as Error).name !== 'AbortError') void download(out); }
  };
  const canShare = (out: ExportOutput) => {
    try { return !!navigator.canShare?.({ files: [new File([out.bytes as BlobPart], out.filename, { type: out.mime })] }); } catch { return false; }
  };

  const run = async () => {
    if (!book) return;
    setBusy(true); setLast(null); setSent(null);
    try {
      const out = await exportBook(book, format, opts);
      if (!out.bytes.length) throw new Error('empty file');
      setLast(out);
      history.unshift({ name: out.filename, size: out.bytes.length, at: Date.now(), out });
      history.splice(6);
      refresh((x) => x + 1);
      // In Telegram the user chooses: download, or receive the file in the bot chat (kept there).
      if (inTelegram) { haptic('success'); toast(t('export.success', { name: out.filename, size: formatBytes(out.bytes.length) }), 'success'); }
      else await download(out);
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
          <div className="export-done-head">
            <Icon name="check" size={20} />
            <span><strong>{last.filename}</strong><small>{formatBytes(last.bytes.length)} · tayyor</small></span>
          </div>
          <p className="muted small">Faylni qanday olmoqchisiz?</p>
          <div className="export-choice">
            <button type="button" className="choice-card" onClick={() => void download(last)} data-testid="export-download">
              <span className="quick-icon tone-blue"><Icon name="download" size={22} /></span>
              <strong>Yuklab olish</strong>
              <small>Qurilmaga saqlash</small>
            </button>
            {inTelegram ? (
              <button type="button" className="choice-card" disabled={sending} onClick={() => void sendToTelegram(last)} data-testid="export-telegram">
                <span className="quick-icon tone-teal">{sending ? <span className="spinner sm" /> : <Icon name={sent === last.filename ? 'check' : 'send'} size={22} />}</span>
                <strong>{sent === last.filename ? 'Yuborildi' : 'Telegram’ga yuborish'}</strong>
                <small>Bot chatida saqlanadi</small>
              </button>
            ) : canShare(last) ? (
              <button type="button" className="choice-card" onClick={() => void share(last)} data-testid="export-share">
                <span className="quick-icon tone-violet"><Icon name="share" size={22} /></span>
                <strong>Ulashish</strong>
                <small>Telegram, pochta va boshqalar</small>
              </button>
            ) : null}
          </div>
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
                {inTelegram && <Button size="sm" variant="ghost" icon="send" disabled={sending} onClick={() => void sendToTelegram(h.out)} aria-label="Telegram’ga yuborish" />}
                <Button size="sm" variant="ghost" icon="download" onClick={() => void download(h.out)} aria-label={t('export.downloadAgain')} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
