import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../app/AppContext';
import { Icon, type IconName } from '../../components/Icon';
import { Button, DemoBadge, Sheet, Spinner } from '../../components/ui';
import type { BookLanguage, WritingTone } from '../../models/book';
import type { MessageKey } from '../../i18n';
import { getTextAI } from '../../services/ai';

export type AssistantAction = 'continue' | 'rewrite' | 'expand' | 'summarize' | 'grammar' | 'spelling' | 'tone' | 'translate' | 'titles' | 'intro' | 'conclusion';
export type ApplyMode = 'replace' | 'below' | 'title' | 'start' | 'end';

export interface AssistantTarget {
  /** Selected text inside a block (null when acting on the whole block). */
  selection: string | null;
  blockText: string;
  hasBlock: boolean;
  chapterTitle: string;
  bookTitle: string;
  language: BookLanguage;
}

const ACTIONS: { id: AssistantAction; icon: IconName; label: MessageKey; needsText: boolean }[] = [
  { id: 'continue', icon: 'feather', label: 'assistant.continue', needsText: true },
  { id: 'rewrite', icon: 'refresh', label: 'assistant.rewrite', needsText: true },
  { id: 'expand', icon: 'maximize', label: 'assistant.expand', needsText: true },
  { id: 'summarize', icon: 'minimize', label: 'assistant.summarize', needsText: true },
  { id: 'grammar', icon: 'check', label: 'assistant.grammar', needsText: true },
  { id: 'spelling', icon: 'type', label: 'assistant.spelling', needsText: true },
  { id: 'tone', icon: 'palette', label: 'assistant.tone', needsText: true },
  { id: 'translate', icon: 'languages', label: 'assistant.translate', needsText: true },
  { id: 'titles', icon: 'heading', label: 'assistant.titles', needsText: false },
  { id: 'intro', icon: 'arrowUp', label: 'assistant.intro', needsText: false },
  { id: 'conclusion', icon: 'arrowDown', label: 'assistant.conclusion', needsText: false },
];
const TONES: WritingTone[] = ['educational', 'professional', 'academic', 'creative', 'informal', 'storytelling'];

export function AssistantSheet({ open, onClose, target, onApply }: {
  open: boolean; onClose: () => void; target: AssistantTarget; onApply: (mode: ApplyMode, text: string) => void;
}) {
  const { t } = useSettings();
  const ai = getTextAI();
  const [action, setAction] = useState<AssistantAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [titles, setTitles] = useState<string[] | null>(null);
  const [tone, setTone] = useState<WritingTone>('professional');
  const [lang, setLang] = useState<BookLanguage>(target.language === 'uz' ? 'en' : 'uz');
  const abort = useRef<AbortController | null>(null);
  const source = target.selection ?? target.blockText;

  useEffect(() => { if (!open) { abort.current?.abort(); setAction(null); setResult(null); setTitles(null); setBusy(false); } }, [open]);

  const run = async (a: AssistantAction, opts: { tone?: WritingTone; lang?: BookLanguage } = {}) => {
    setAction(a); setResult(null); setTitles(null);
    if ((a === 'tone' && !opts.tone) || (a === 'translate' && !opts.lang)) return; // wait for option choice
    abort.current?.abort();
    abort.current = new AbortController();
    const o = { signal: abort.current.signal, language: target.language, context: target.chapterTitle };
    setBusy(true);
    try {
      let r: string | string[];
      switch (a) {
        case 'continue': r = await ai.continueText(source, o); break;
        case 'rewrite': r = await ai.rewriteText(source, o); break;
        case 'expand': r = await ai.expandText(source, o); break;
        case 'summarize': r = await ai.summarizeText(source, o); break;
        case 'grammar': r = await ai.improveGrammar(source, o); break;
        case 'spelling': r = await ai.fixSpelling(source, o); break;
        case 'tone': r = await ai.changeTone(source, opts.tone!, o); break;
        case 'translate': r = await ai.translateText(source, opts.lang!, { ...o, language: undefined }); break;
        case 'titles': r = await ai.generateChapterTitles(target.bookTitle || target.chapterTitle, 5, o); break;
        case 'intro': r = await ai.generateIntroduction(target.chapterTitle || target.bookTitle, o); break;
        case 'conclusion': r = await ai.generateConclusion(target.chapterTitle || target.bookTitle, o); break;
      }
      if (Array.isArray(r)) setTitles(r); else setResult(r);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setResult(null);
    } finally { setBusy(false); }
  };

  const current = ACTIONS.find((x) => x.id === action);
  const accept = (mode: ApplyMode) => { if (result) { onApply(mode, result); onClose(); } };

  return (
    <Sheet open={open} onClose={onClose} size="md" title={<><Icon name="sparkles" size={20} /> {t('assistant.title')} <DemoBadge /></>}>
      <div className="assistant">
        <div className="assistant-target">
          <small>{target.selection ? t('assistant.selection') : t('assistant.wholeBlock')}</small>
          <p>{source ? (source.length > 220 ? `${source.slice(0, 220)}…` : source) : <em className="muted">{t('assistant.noTarget')}</em>}</p>
        </div>

        {!action || (!busy && !result && !titles && action !== 'tone' && action !== 'translate') ? (
          <div className="assistant-actions" role="list">
            {ACTIONS.map((a) => (
              <button key={a.id} type="button" role="listitem" className="assistant-action" disabled={a.needsText && !source.trim()} onClick={() => void run(a.id)} data-testid={`ai-${a.id}`}>
                <Icon name={a.icon} size={18} /><span>{t(a.label)}</span>
              </button>
            ))}
          </div>
        ) : null}

        {action === 'tone' && !busy && !result && (
          <div>
            <p className="muted small">{t('assistant.targetTone')}</p>
            <div className="chips">{TONES.map((x) => <button key={x} type="button" className={`chip-btn ${tone === x ? 'is-active' : ''}`} onClick={() => { setTone(x); void run('tone', { tone: x }); }}>{t(`tone.${x}` as MessageKey)}</button>)}</div>
          </div>
        )}
        {action === 'translate' && !busy && !result && (
          <div>
            <p className="muted small">{t('assistant.targetLang')}</p>
            <div className="chips">{(['uz', 'en', 'ru'] as BookLanguage[]).map((x) => <button key={x} type="button" className={`chip-btn ${lang === x ? 'is-active' : ''}`} onClick={() => { setLang(x); void run('translate', { lang: x }); }}>{t(`lang.${x}` as MessageKey)}</button>)}</div>
          </div>
        )}

        {busy && <div className="assistant-busy"><Spinner label={t('assistant.working')} /></div>}

        {result && current && (
          <div className="assistant-result" data-testid="ai-result">
            {current.needsText && (
              <div className="diff-old"><small>{t('assistant.original')}</small><p>{source}</p></div>
            )}
            <div className="diff-new"><small>{t('assistant.suggestion')}</small><p>{result}</p></div>
            <div className="row-actions">
              <Button variant="ghost" icon="x" onClick={() => { setResult(null); setAction(null); }} data-testid="ai-reject">{t('common.reject')}</Button>
              {action === 'intro' ? <Button icon="check" onClick={() => accept('start')} data-testid="ai-accept">{t('common.accept')}</Button>
                : action === 'conclusion' ? <Button icon="check" onClick={() => accept('end')} data-testid="ai-accept">{t('common.accept')}</Button>
                : (
                  <>
                    <Button variant="secondary" icon="plus" onClick={() => accept('below')} disabled={!target.hasBlock} data-testid="ai-insert">{t('assistant.insertBelow')}</Button>
                    {action !== 'continue' && <Button icon="check" onClick={() => accept('replace')} disabled={!target.hasBlock} data-testid="ai-accept">{t('assistant.replace')}</Button>}
                  </>
                )}
            </div>
          </div>
        )}

        {titles && (
          <div className="assistant-titles">
            <p className="muted small">{t('assistant.pickTitle')}</p>
            <div className="list">
              {titles.map((x) => <button key={x} type="button" className="list-row" onClick={() => { onApply('title', x); onClose(); }}><Icon name="heading" size={18} /><span className="list-row-text"><span>{x}</span></span></button>)}
            </div>
            <Button variant="ghost" icon="x" onClick={() => { setTitles(null); setAction(null); }}>{t('common.reject')}</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
