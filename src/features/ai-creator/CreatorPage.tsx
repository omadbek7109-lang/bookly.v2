import { useEffect, useRef, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { Icon } from '../../components/Icon';
import { Button, DemoBadge, Field, IconButton, PageHeader, ProgressBar, Select } from '../../components/ui';
import { createBook, createChapter, defaultCover, blockText, type Block, type BookCategory, type BookLanguage, type WritingTone } from '../../models/book';
import { templateById, TEMPLATES } from '../../models/templates';
import type { MessageKey } from '../../i18n';
import { chapterLabelLang } from '../../services/export/common';
import { getTextAI, type BookBrief, type BookOutline } from '../../services/ai';
import { books } from '../../services/storage/repository';
import { applyTemplate, templateCover } from '../templates/TemplatesPage';

const TONES: WritingTone[] = ['educational', 'professional', 'academic', 'creative', 'informal', 'storytelling'];
const CATS: BookCategory[] = ['education', 'business', 'self-development', 'finance', 'technology', 'fiction', 'children', 'academic', 'guide', 'journal', 'other'];
const LANGS: BookLanguage[] = ['uz', 'en', 'ru'];
type Step = 'idea' | 'outline' | 'write';
type ChapterState = 'pending' | 'writing' | 'done';

const CATEGORY_TEMPLATE: Partial<Record<BookCategory, string>> = {
  education: 'classic-indigo', business: 'executive', 'self-development': 'mindful', fiction: 'novel', children: 'storytime',
  academic: 'scholar', guide: 'handbook', journal: 'journal', finance: 'executive', technology: 'startup',
};

export default function CreatorPage() {
  const { t, settings } = useSettings();
  const { toast } = useUi();
  const [step, setStep] = useState<Step>('idea');
  const [brief, setBrief] = useState<BookBrief>({ topic: '', title: '', language: settings.locale, category: 'education', audience: '', tone: 'educational', chapters: 6, description: '', instructions: '', author: settings.profile.name });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outline, setOutline] = useState<BookOutline | null>(null);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<(Block[] | null)[]>([]);
  const [states, setStates] = useState<ChapterState[]>([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const ai = getTextAI();

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [running]);

  const set = <K extends keyof BookBrief>(k: K, v: BookBrief[K]) => { setBrief((b) => ({ ...b, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (brief.topic.trim().length < 3) e.topic = t('creator.err.topic');
    if (!(brief.chapters >= 3 && brief.chapters <= 20)) e.chapters = t('creator.err.chapters');
    setErrors(e);
    return !Object.keys(e).length;
  };

  const makeOutline = async () => {
    if (!validate()) { document.querySelector<HTMLElement>('.has-error input, .has-error textarea')?.focus(); return; }
    setBusy(true);
    abort.current = new AbortController();
    try {
      const o = await ai.generateBookOutline(brief, abort.current.signal);
      setOutline(o);
      setStep('outline');
      window.scrollTo({ top: 0 });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(String((e as Error).message), 'error');
    } finally { setBusy(false); }
  };

  const editChapter = (i: number, title: string) => setOutline((o) => o && { ...o, chapters: o.chapters.map((c, k) => (k === i ? { ...c, title } : c)) });
  const moveChapter = (i: number, d: -1 | 1) => setOutline((o) => {
    if (!o) return o;
    const j = i + d;
    if (j < 0 || j >= o.chapters.length) return o;
    const c = [...o.chapters]; [c[i], c[j]] = [c[j], c[i]];
    return { ...o, chapters: c };
  });
  const removeChapter = (i: number) => setOutline((o) => o && o.chapters.length > 1 ? { ...o, chapters: o.chapters.filter((_, k) => k !== i) } : o);
  const addChapter = () => setOutline((o) => o && { ...o, chapters: [...o.chapters, { title: chapterLabelLang(brief.language, o.chapters.length), summary: '' }] });

  const write = async (from = 0) => {
    if (!outline) return;
    setStep('write');
    setRunning(true);
    const n = outline.chapters.length;
    setWritten((w) => (w.length === n ? w : Array.from({ length: n }, () => null)));
    setStates((s) => (s.length === n ? s : Array.from({ length: n }, () => 'pending' as ChapterState)));
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      for (let i = from; i < n; i++) {
        setStates((s) => s.map((x, k) => (k === i ? 'writing' : x)));
        const blocks = await ai.generateChapter({ brief: { ...brief, chapters: n }, outline, index: i }, signal);
        setWritten((w) => { const c = [...w]; c[i] = blocks; return c; });
        setStates((s) => s.map((x, k) => (k === i ? 'done' : x)));
      }
      toast(t('creator.writingDone'), 'success');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setStates((s) => s.map((x) => (x === 'writing' ? 'pending' : x)));
        toast(t('creator.stopped'));
      } else toast(String((e as Error).message), 'error');
    } finally { setRunning(false); }
  };

  const doneCount = states.filter((s) => s === 'done').length;
  const total = outline?.chapters.length ?? 0;
  const nextPending = states.findIndex((s) => s !== 'done');

  const save = async (andEdit: boolean) => {
    if (!outline) return;
    const chapters = outline.chapters.map((c, i) => createChapter(c.title, written[i] ?? []));
    const tpl = templateById(CATEGORY_TEMPLATE[brief.category] ?? TEMPLATES[0].id);
    let book = createBook({
      title: outline.title, subtitle: outline.subtitle, description: outline.description, author: brief.author, language: brief.language,
      category: brief.category, chapters, source: 'demo-ai', tone: brief.tone, audience: brief.audience, targetChapters: total,
    });
    book = applyTemplate(book, tpl);
    book.cover = templateCover(tpl, { ...defaultCover(outline.title, brief.author ?? ''), subtitle: outline.subtitle });
    book.metadata.keywords = brief.topic.split(/[,;]+|\s+/).filter((w) => w.length > 3).slice(0, 6);
    const saved = await books.save(book);
    toast(t('creator.savedToLibrary'), 'success');
    navigate(andEdit ? routes.editor(saved.id) : routes.books(), { replace: true });
  };

  const stepIdx = step === 'idea' ? 0 : step === 'outline' ? 2 : 3;

  return (
    <div className="page creator">
      <PageHeader title={<>{t('creator.title')} <DemoBadge /></>} subtitle={t('creator.subtitle')} onBack={() => (step === 'outline' && !running ? setStep('idea') : back(routes.studio()))} />
      <ol className="stepper" aria-label="steps">
        {(['creator.step.idea', 'creator.step.style', 'creator.step.outline', 'creator.step.write'] as MessageKey[]).map((k, i) => (
          <li key={k} className={i <= stepIdx ? 'is-done' : ''} aria-current={i === stepIdx ? 'step' : undefined}><span>{i + 1}</span>{t(k)}</li>
        ))}
      </ol>
      <p className="demo-note"><Icon name="info" size={16} /> {t('creator.demoNote')}</p>

      {step === 'idea' && (
        <form className="form glass" onSubmit={(e) => { e.preventDefault(); void makeOutline(); }} noValidate>
          <Field label={t('creator.topic')} htmlFor="c-topic" error={errors.topic} required>
            <input id="c-topic" className="input" value={brief.topic} onChange={(e) => set('topic', e.target.value)} placeholder={t('creator.topicPh')} maxLength={160} aria-invalid={!!errors.topic} data-testid="creator-topic" />
          </Field>
          <Field label={t('creator.bookTitle')} htmlFor="c-title" hint={t('common.optional')}>
            <input id="c-title" className="input" value={brief.title} onChange={(e) => set('title', e.target.value)} placeholder={t('creator.bookTitlePh')} maxLength={140} />
          </Field>
          <div className="form-row">
            <Field label={t('creator.language')} htmlFor="c-lang">
              <Select id="c-lang" label={t('creator.language')} value={brief.language} onChange={(v) => set('language', v as BookLanguage)} testId="creator-language"
                options={LANGS.map((l) => ({ value: l, label: t(`lang.${l}` as MessageKey) }))} />
            </Field>
            <Field label={t('creator.category')} htmlFor="c-cat">
              <Select id="c-cat" label={t('creator.category')} value={brief.category} onChange={(v) => set('category', v as BookCategory)} testId="creator-category"
                options={CATS.map((c) => ({ value: c, label: t(`category.${c}` as MessageKey) }))} />
            </Field>
          </div>
          <Field label={t('creator.audience')} htmlFor="c-aud">
            <input id="c-aud" className="input" value={brief.audience} onChange={(e) => set('audience', e.target.value)} placeholder={t('creator.audiencePh')} />
          </Field>
          <Field label={t('creator.tone')}>
            <div className="chips" role="radiogroup" aria-label={t('creator.tone')}>
              {TONES.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={brief.tone === x} className={`chip-btn ${brief.tone === x ? 'is-active' : ''}`} onClick={() => set('tone', x)}>{t(`tone.${x}` as MessageKey)}</button>
              ))}
            </div>
          </Field>
          <Field label={`${t('creator.chapters')}: ${brief.chapters}`} htmlFor="c-ch" error={errors.chapters}>
            <input id="c-ch" type="range" min={3} max={20} value={brief.chapters} onChange={(e) => set('chapters', Number(e.target.value))} className="range" data-testid="creator-chapters" />
          </Field>
          <Field label={t('creator.author')} htmlFor="c-author" hint={t('common.optional')}>
            <input id="c-author" className="input" value={brief.author} onChange={(e) => set('author', e.target.value)} />
          </Field>
          <Field label={t('creator.description')} htmlFor="c-desc" hint={t('common.optional')}>
            <textarea id="c-desc" className="input" rows={3} value={brief.description} onChange={(e) => set('description', e.target.value)} placeholder={t('creator.descriptionPh')} />
          </Field>
          <Field label={t('creator.instructions')} htmlFor="c-ins" hint={t('common.optional')}>
            <textarea id="c-ins" className="input" rows={2} value={brief.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder={t('creator.instructionsPh')} />
          </Field>
          <Button type="submit" icon="sparkles" block size="lg" loading={busy} data-testid="creator-outline">{busy ? t('creator.generatingOutline') : t('creator.generateOutline')}</Button>
        </form>
      )}

      {step !== 'idea' && outline && (
        <section className="outline glass">
          <div className="outline-head">
            <input className="input input-title" value={outline.title} onChange={(e) => setOutline({ ...outline, title: e.target.value })} aria-label={t('creator.bookTitle')} disabled={step === 'write'} data-testid="outline-title" />
            <input className="input" value={outline.subtitle} onChange={(e) => setOutline({ ...outline, subtitle: e.target.value })} aria-label={t('editor.subtitlePh')} disabled={step === 'write'} />
            <textarea className="input" rows={3} value={outline.description} onChange={(e) => setOutline({ ...outline, description: e.target.value })} aria-label={t('creator.description')} disabled={step === 'write'} />
          </div>
          {step === 'outline' ? (
            <>
              <h3>{t('creator.outlineTitle')}</h3>
              <p className="muted small">{t('creator.outlineHint')}</p>
              <ol className="outline-list" data-testid="outline-list">
                {outline.chapters.map((c, i) => (
                  <li key={i}>
                    <span className="outline-num">{i + 1}</span>
                    <input className="input" value={c.title} onChange={(e) => editChapter(i, e.target.value)} aria-label={t('editor.chapterN', { n: i + 1 })} />
                    <IconButton icon="arrowUp" label={t('editor.moveUp')} onClick={() => moveChapter(i, -1)} disabled={i === 0} size={18} />
                    <IconButton icon="arrowDown" label={t('editor.moveDown')} onClick={() => moveChapter(i, 1)} disabled={i === outline.chapters.length - 1} size={18} />
                    <IconButton icon="x" label={t('common.delete')} onClick={() => removeChapter(i)} disabled={outline.chapters.length <= 1} size={18} />
                  </li>
                ))}
              </ol>
              <div className="row-actions">
                <Button variant="ghost" icon="plus" onClick={addChapter}>{t('creator.addChapter')}</Button>
                <Button variant="secondary" icon="refresh" onClick={() => void makeOutline()} loading={busy}>{t('creator.regenerate')}</Button>
              </div>
              <Button icon="feather" block size="lg" onClick={() => void write(0)} data-testid="creator-write">{t('creator.startWriting')}</Button>
            </>
          ) : (
            <>
              <div className="write-status" aria-live="polite">
                <strong>{running ? t('creator.writing', { i: Math.min(doneCount + 1, total), n: total }) : doneCount === total ? t('creator.writingDone') : t('creator.stopped')}</strong>
                <ProgressBar value={(doneCount / Math.max(1, total)) * 100} done={doneCount === total} />
              </div>
              <ol className="gen-list" data-testid="gen-list">
                {outline.chapters.map((c, i) => (
                  <li key={i} className={`gen-item is-${states[i] ?? 'pending'}`}>
                    <button type="button" className="gen-head" onClick={() => setOpen(open === i ? null : i)} disabled={!written[i]} aria-expanded={open === i}>
                      <span className="gen-state">{states[i] === 'done' ? <Icon name="check" size={16} strokeWidth={3} /> : states[i] === 'writing' ? <span className="spinner" /> : i + 1}</span>
                      <span className="gen-title">{c.title}</span>
                      <small>{t(states[i] === 'done' ? 'creator.chapterReady' : states[i] === 'writing' ? 'creator.chapterWriting' : 'creator.chapterPending')}</small>
                    </button>
                    {open === i && written[i] && (
                      <div className="gen-preview">{written[i]!.slice(0, 6).map((b) => <p key={b.id}>{blockText(b).slice(0, 320)}</p>)}</div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="row-actions sticky-actions">
                {running ? (
                  <Button variant="secondary" icon="pause" onClick={() => abort.current?.abort()} data-testid="creator-pause">{t('creator.pause')}</Button>
                ) : nextPending >= 0 ? (
                  <Button variant="secondary" icon="play" onClick={() => void write(nextPending)}>{t('creator.resume')}</Button>
                ) : null}
                <Button variant="secondary" icon="save" onClick={() => void save(false)} disabled={running || doneCount === 0} data-testid="creator-save">{t('creator.saveToLibrary')}</Button>
                <Button icon="edit" onClick={() => void save(true)} disabled={running || doneCount === 0} data-testid="creator-save-edit">{t('creator.saveAndEdit')}</Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
