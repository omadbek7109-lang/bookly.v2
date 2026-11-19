import { track } from '../../services/stats/track';
import { useMemo, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon } from '../../components/Icon';
import { Button, Field, IconButton, PageHeader, Select } from '../../components/ui';
import { createBlock, createBook, createChapter, defaultCover, type BookCategory, type BookLanguage, type BookLayout } from '../../models/book';
import { templateName, TEMPLATES, type DesignTemplate } from '../../models/templates';
import type { MessageKey } from '../../i18n';
import { books } from '../../services/storage/repository';
import { applyTemplate, templateCover } from '../templates/TemplatesPage';

export const CATS: BookCategory[] = ['education', 'business', 'self-development', 'finance', 'technology', 'fiction', 'children', 'academic', 'guide', 'journal', 'other'];
const LANGS: BookLanguage[] = ['uz', 'en', 'ru'];
type Step = 0 | 1 | 2;

const CATEGORY_TEMPLATE: Partial<Record<BookCategory, string>> = {
  education: 'classic-indigo', business: 'executive', 'self-development': 'mindful', fiction: 'novel', children: 'storytime',
  academic: 'scholar', guide: 'handbook', journal: 'journal', finance: 'executive', technology: 'startup',
};

/** Starting chapter plans per kind of book. Plain titles the author edits; no text is generated. */
const PLANS: { id: string; label: MessageKey; chapters: MessageKey[] }[] = [
  { id: 'simple', label: 'wizard.plan.simple', chapters: ['wizard.ch.intro', 'wizard.ch.part1', 'wizard.ch.part2', 'wizard.ch.outro'] },
  { id: 'guide', label: 'wizard.plan.guide', chapters: ['wizard.ch.intro', 'wizard.ch.basics', 'wizard.ch.steps', 'wizard.ch.mistakes', 'wizard.ch.practice', 'wizard.ch.outro'] },
  { id: 'story', label: 'wizard.plan.story', chapters: ['wizard.ch.s1', 'wizard.ch.s2', 'wizard.ch.s3', 'wizard.ch.s4', 'wizard.ch.s5'] },
  { id: 'empty', label: 'wizard.plan.empty', chapters: ['wizard.ch.first'] },
];

/**
 * New-book wizard: 1) about the book, 2) structure (chapters or one text), 3) design.
 * It only arranges what the author enters — nothing is written for them.
 */
export default function NewBookPage() {
  const { t, settings } = useSettings();
  const { toast } = useUi();
  const [step, setStep] = useState<Step>(0);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [author, setAuthor] = useState(settings.profile.name);
  const [category, setCategory] = useState<BookCategory>('education');
  const [language, setLanguage] = useState<BookLanguage>(settings.locale);
  const [layout, setLayout] = useState<BookLayout>('chapters');
  const [plan, setPlan] = useState('simple');
  const [chapters, setChapters] = useState<string[]>(() => PLANS[0].chapters.map((k) => t(k)));
  const [tplId, setTplId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const recommended = CATEGORY_TEMPLATE[category] ?? TEMPLATES[0].id;
  const chosen = tplId ?? recommended;
  const ordered = useMemo(() => [...TEMPLATES].sort((a, b) => Number(b.category === category) - Number(a.category === category)), [category]);
  const coverFor = (tpl: DesignTemplate) => ({ ...templateCover(tpl, defaultCover(title.trim() || t('common.untitled'), author.trim())), subtitle: subtitle.trim() });

  const pickPlan = (id: string) => { setPlan(id); setChapters(PLANS.find((p) => p.id === id)!.chapters.map((k) => t(k))); };
  const editCh = (i: number, v: string) => setChapters((c) => c.map((x, k) => (k === i ? v : x)));
  const moveCh = (i: number, d: -1 | 1) => setChapters((c) => { const j = i + d; if (j < 0 || j >= c.length) return c; const n = [...c]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const next = () => {
    if (step === 0 && title.trim().length < 2) { setError(t('wizard.err.title')); document.getElementById('w-title')?.focus(); return; }
    setError('');
    setStep((s) => Math.min(2, s + 1) as Step);
    window.scrollTo({ top: 0 });
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const tpl = TEMPLATES.find((x) => x.id === chosen) ?? TEMPLATES[0];
      const chs = layout === 'single'
        ? [createChapter('', [createBlock('paragraph', { html: '' })])]
        : chapters.map((c, i) => createChapter(c.trim() || t('editor.chapterN', { n: i + 1 }), [createBlock('paragraph', { html: '' })]));
      let book = createBook({ title, subtitle: subtitle.trim(), author, language, category, layout, chapters: chs, source: 'manual', targetChapters: chs.length });
      book = applyTemplate(book, tpl);
      book.cover = coverFor(tpl);
      const saved = await books.save(book);
      track('book_created', 'wizard');
      toast(t('wizard.created'), 'success');
      navigate(routes.editor(saved.id), { replace: true });
    } catch (e) {
      toast(String((e as Error).message), 'error');
      setBusy(false);
    }
  };

  const steps: MessageKey[] = ['wizard.step.about', 'wizard.step.structure', 'wizard.step.design'];
  return (
    <div className="page wizard" data-testid="wizard">
      <PageHeader title={t('wizard.title')} subtitle={t('wizard.subtitle')} onBack={() => (step > 0 ? setStep((s) => (s - 1) as Step) : back(routes.home()))} />
      <ol className="stepper is-3" aria-label={t('wizard.title')}>
        {steps.map((k, i) => (
          <li key={k} className={i <= step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}</span>{t(k)}</li>
        ))}
      </ol>

      {step === 0 && (
        <form className="form glass wizard-card" onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
          <Field label={t('creator.bookTitle')} htmlFor="w-title" error={error} required>
            <input id="w-title" className="input input-title" value={title} onChange={(e) => { setTitle(e.target.value); setError(''); }} placeholder={t('wizard.titlePh')} maxLength={140} aria-invalid={!!error} data-testid="wizard-title" />
          </Field>
          <Field label={t('wizard.subtitleLabel')} htmlFor="w-sub" hint={t('common.optional')}>
            <input id="w-sub" className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder={t('editor.subtitlePh')} maxLength={160} data-testid="wizard-subtitle" />
          </Field>
          <Field label={t('creator.author')} htmlFor="w-author" hint={t('common.optional')}>
            <input id="w-author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('editor.authorPh')} maxLength={80} data-testid="wizard-author" />
          </Field>
          <div className="form-row">
            <Field label={t('creator.category')} htmlFor="w-cat">
              <Select id="w-cat" label={t('creator.category')} value={category} onChange={(v) => { setCategory(v); setTplId(null); }} testId="wizard-category"
                options={CATS.map((c) => ({ value: c, label: t(`category.${c}` as MessageKey) }))} />
            </Field>
            <Field label={t('creator.language')} htmlFor="w-lang">
              <Select id="w-lang" label={t('creator.language')} value={language} onChange={(v) => setLanguage(v)} testId="wizard-language"
                options={LANGS.map((l) => ({ value: l, label: t(`lang.${l}` as MessageKey) }))} />
            </Field>
          </div>
          <Button type="submit" iconRight="arrowRight" block size="lg" data-testid="wizard-next">{t('wizard.next')}</Button>
        </form>
      )}

      {step === 1 && (
        <section className="form glass wizard-card">
          <p className="field-label">{t('create.layoutQ')}</p>
          <div className="mode-cards" role="radiogroup" aria-label={t('create.layoutQ')}>
            {([['chapters', 'list', 'create.layout.chapters', 'create.layout.chaptersDesc'], ['single', 'file', 'create.layout.single', 'create.layout.singleDesc']] as const).map(([v, icon, l, d]) => (
              <button key={v} type="button" role="radio" aria-checked={layout === v} className={`mode-card ${layout === v ? 'is-active' : ''}`} onClick={() => setLayout(v)} data-testid={`wizard-mode-${v}`}>
                <span className="quick-icon tone-violet"><Icon name={icon} size={22} /></span>
                <strong>{t(l)}</strong>
                <small>{t(d)}</small>
                <span className="mode-check" aria-hidden="true"><Icon name="check" size={14} strokeWidth={3} /></span>
              </button>
            ))}
          </div>
          {layout === 'chapters' ? (
            <>
              <p className="field-label">{t('wizard.plan')}</p>
              <div className="chips" role="radiogroup" aria-label={t('wizard.plan')}>
                {PLANS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={plan === p.id} className={`chip-btn ${plan === p.id ? 'is-active' : ''}`} onClick={() => pickPlan(p.id)} data-testid={`wizard-plan-${p.id}`}>{t(p.label)}</button>)}
              </div>
              <ol className="outline-list" data-testid="wizard-chapters">
                {chapters.map((c, i) => (
                  <li key={i}>
                    <span className="outline-num">{i + 1}</span>
                    <input className="input" value={c} onChange={(e) => editCh(i, e.target.value)} aria-label={t('editor.chapterN', { n: i + 1 })} maxLength={120} />
                    <IconButton icon="arrowUp" label={t('editor.moveUp')} onClick={() => moveCh(i, -1)} disabled={i === 0} size={18} />
                    <IconButton icon="arrowDown" label={t('editor.moveDown')} onClick={() => moveCh(i, 1)} disabled={i === chapters.length - 1} size={18} />
                    <IconButton icon="x" label={t('common.delete')} onClick={() => setChapters((x) => x.filter((_, k) => k !== i))} disabled={chapters.length <= 1} size={18} />
                  </li>
                ))}
              </ol>
              <Button variant="ghost" icon="plus" onClick={() => setChapters((c) => [...c, t('editor.chapterN', { n: c.length + 1 })])} disabled={chapters.length >= 60} data-testid="wizard-add-chapter">{t('creator.addChapter')}</Button>
            </>
          ) : <p className="muted small">{t('create.layoutHint')}</p>}
          <Button iconRight="arrowRight" block size="lg" onClick={next} data-testid="wizard-next">{t('wizard.next')}</Button>
        </section>
      )}

      {step === 2 && (
        <section className="wizard-design">
          <div className="wizard-preview glass">
            <BookCover cover={coverFor(TEMPLATES.find((x) => x.id === chosen) ?? TEMPLATES[0])} width={150} />
            <div>
              <strong>{title}</strong>
              <small>{layout === 'single' ? t('create.layout.single') : t('common.chapters', { n: chapters.length })}</small>
              <small>{t('wizard.designHint')}</small>
            </div>
          </div>
          <div className="wizard-templates" role="radiogroup" aria-label={t('wizard.step.design')}>
            {ordered.map((tpl) => (
              <button key={tpl.id} type="button" role="radio" aria-checked={chosen === tpl.id} className={`wizard-tpl ${chosen === tpl.id ? 'is-active' : ''}`} onClick={() => setTplId(tpl.id)} data-testid={`wizard-tpl-${tpl.id}`}>
                <BookCover cover={coverFor(tpl)} width={96} />
                <span>{templateName(tpl)}</span>
                {tpl.id === recommended && <em>{t('wizard.recommended')}</em>}
              </button>
            ))}
          </div>
          <div className="row-actions sticky-actions">
            <Button icon="check" block size="lg" loading={busy} onClick={() => void create()} data-testid="wizard-create">{t('wizard.create')}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
