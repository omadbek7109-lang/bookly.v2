import { useEffect, useRef, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { Icon, type IconName } from '../../components/Icon';
import { Button, DemoBadge, Sheet, Spinner } from '../../components/ui';
import type { BookLanguage } from '../../models/book';
import { assistErrorText, TASK_NEEDS_TEXT, type AssistTask, type WritingAssistant } from '../../services/ai/assistant';
import { AuthSheet } from '../cloud/AuthSheet';
import { useCloud } from '../cloud/CloudContext';
import { friendlyError } from '../../services/cloud/client';
import type { AssistantStatus } from './useAssistant';
import type { MessageKey } from '../../i18n';

/** insert = add below the current paragraph (or at the end); replace = swap the selected text / paragraph. */
export type ApplyMode = 'insert' | 'replace' | 'title';

export interface AssistantTarget {
  /** Selected text inside a block (null when acting on the whole paragraph). */
  selection: string | null;
  blockText: string;
  hasBlock: boolean;
  chapterTitle: string;
  bookTitle: string;
  language: BookLanguage;
  /** One continuous text (no chapters): title suggestions become headings. */
  single: boolean;
}

const TASKS: { id: AssistTask; icon: IconName; label: MessageKey; hint: MessageKey }[] = [
  { id: 'continue', icon: 'feather', label: 'assist.task.continue', hint: 'assist.task.continueHint' },
  { id: 'rewrite', icon: 'refresh', label: 'assist.task.rewrite', hint: 'assist.task.rewriteHint' },
  { id: 'grammar', icon: 'check', label: 'assist.task.grammar', hint: 'assist.task.grammarHint' },
  { id: 'shorten', icon: 'minimize', label: 'assist.task.shorten', hint: 'assist.task.shortenHint' },
  { id: 'expand', icon: 'maximize', label: 'assist.task.expand', hint: 'assist.task.expandHint' },
  { id: 'ideas', icon: 'zap', label: 'assist.task.ideas', hint: 'assist.task.ideasHint' },
  { id: 'dialog', icon: 'quote', label: 'assist.task.dialog', hint: 'assist.task.dialogHint' },
  { id: 'titles', icon: 'heading', label: 'assist.task.titles', hint: 'assist.task.titlesHint' },
];

export function AssistantSheet({ open, onClose, target, onApply, assistant, status }: {
  open: boolean; onClose: () => void; target: AssistantTarget; onApply: (mode: ApplyMode, text: string) => void;
  assistant: WritingAssistant | null; status: AssistantStatus;
}) {
  const { t } = useSettings();
  const { toast } = useUi();
  const cloud = useCloud();
  const [task, setTask] = useState<AssistTask | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; items?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const source = (target.selection ?? target.blockText).trim();

  useEffect(() => {
    if (!open) { abort.current?.abort(); setTask(null); setResult(null); setError(null); setBusy(false); setNote(''); }
  }, [open]);

  const run = async (id: AssistTask) => {
    if (!assistant) return;
    setTask(id); setResult(null); setError(null);
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    try {
      const r = await assistant.run({
        task: id, text: source, note, language: target.language, bookTitle: target.bookTitle, chapterTitle: target.chapterTitle, signal: abort.current.signal,
      });
      setResult(r);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(assistErrorText(e));
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.text); toast(t('assist.copied'), 'success'); }
    catch { toast(t('assist.copyFailed'), 'error'); }
  };
  const apply = (mode: ApplyMode, text = result?.text ?? '') => { if (text) { onApply(mode, text); onClose(); } };
  const current = TASKS.find((x) => x.id === task);
  const replaceable = !!source && target.hasBlock && !!task && TASK_NEEDS_TEXT[task] && task !== 'continue';

  const title = <><Icon name="sparkles" size={20} /> {t('assistant.title')} {status === 'demo' && <DemoBadge />}</>;

  if (status === 'needs-login') {
    return (
      <Sheet open={open} onClose={onClose} size="sm" title={title}>
        <div className="assistant">
          <p>{t('assist.needsLogin')}</p>
          {cloud.inTelegram ? (
            <Button icon="user" block loading={cloud.telegramBusy} onClick={() => void cloud.signInWithTelegram().catch((e) => toast(friendlyError(e), 'error'))} data-testid="ai-login">{t('assist.loginTelegram')}</Button>
          ) : (
            <Button icon="user" block onClick={() => setLogin(true)} data-testid="ai-login">{t('auth.title.login')}</Button>
          )}
          <AuthSheet open={login} initial="login" onClose={() => setLogin(false)} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} size="md" title={title}>
      <div className="assistant" data-testid="assistant">
        <div className="assistant-target">
          <small>{target.selection ? t('assistant.selection') : t('assist.currentParagraph')}</small>
          <p>{source ? (source.length > 200 ? `${source.slice(0, 200)}…` : source) : <em className="muted">{t('assist.noText')}</em>}</p>
        </div>

        {!task && (
          <>
            <div className="assistant-actions" role="list">
              {TASKS.map((a) => (
                <button key={a.id} type="button" role="listitem" className="assistant-action" disabled={!assistant || (TASK_NEEDS_TEXT[a.id] && !source)} onClick={() => void run(a.id)} data-testid={`ai-${a.id}`}>
                  <Icon name={a.icon} size={18} />
                  <span><strong>{t(a.label)}</strong><small>{t(a.hint)}</small></span>
                </button>
              ))}
            </div>
            <label className="assistant-note">
              <span className="muted small">{t('assist.note')}</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('assist.notePh')} data-testid="ai-note" />
            </label>
            <p className="muted small">{t('assist.promise')}</p>
          </>
        )}

        {busy && <div className="assistant-busy"><Spinner label={`${current ? t(current.label) : ''}: ${t('assistant.working')}`} /></div>}

        {error && !busy && (
          <div className="assistant-error" role="alert">
            <Icon name="alert" size={18} /> <span>{error}</span>
            <div className="row-actions">
              <Button variant="ghost" onClick={() => { setTask(null); setError(null); }}>{t('common.back')}</Button>
              {task && <Button icon="refresh" onClick={() => void run(task)}>{t('common.retry')}</Button>}
            </div>
          </div>
        )}

        {result && current && !busy && (
          <div className="assistant-result" data-testid="ai-result">
            <small className="muted">{t(current.label)}</small>
            {result.items?.length ? (
              <div className="list">
                {result.items.map((x) => (
                  <button key={x} type="button" className="list-row" onClick={() => apply('title', x)} data-testid="ai-title-item">
                    <Icon name="heading" size={18} /><span className="list-row-text"><span>{x}</span><small>{target.single ? t('assist.asHeading') : t('assist.asChapterTitle')}</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="diff-new"><p className="selectable">{result.text}</p></div>
            )}
            <div className="assistant-choices">
              {!result.items?.length && <Button icon="plus" onClick={() => apply('insert')} data-testid="ai-insert">{t('assist.insert')}</Button>}
              {!result.items?.length && replaceable && <Button variant="secondary" icon="check" onClick={() => apply('replace')} data-testid="ai-accept">{t('assist.replace')}</Button>}
              <Button variant="secondary" icon="refresh" onClick={() => void run(current.id)} data-testid="ai-retry">{t('common.retry')}</Button>
              <Button variant="ghost" icon="copy" onClick={() => void copy()} data-testid="ai-copy">{t('assist.copy')}</Button>
              <Button variant="ghost" icon="chevronLeft" onClick={() => { setTask(null); setResult(null); }} data-testid="ai-reject">{t('assist.otherTask')}</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
