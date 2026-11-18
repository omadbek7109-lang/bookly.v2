import type { CSSProperties } from 'react';
import { useSettings } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Segmented, Sheet } from '../../components/ui';
import type { Book } from '../../models/book';
import { fontById, fontLabel, FONTS, templateName, TEMPLATES } from '../../models/templates';
import { applyTemplate } from '../templates/TemplatesPage';

/** Accent colours that print well on white paper and in dark e-readers alike. */
export const ACCENTS = ['#4f46e5', '#7c3aed', '#c026d3', '#e11d48', '#ea580c', '#b45309', '#059669', '#0e7490', '#2563eb', '#1f2937'];
const SIZES = [11, 12, 13, 14] as const;

/**
 * "Book style": how the finished book looks — design, heading and body fonts, accent colour and text size.
 * Everything here is stored in book.theme and is used by the preview, the reader and every export format.
 */
export function BookStyleSheet({ open, onClose, book, onChange }: { open: boolean; onClose: () => void; book: Book; onChange: (fn: (b: Book) => Book) => void }) {
  const { t } = useSettings();
  const th = book.theme;
  const setTheme = (patch: Partial<Book['theme']>) => onChange((b) => ({ ...b, theme: { ...b.theme, ...patch } }));
  const sample: CSSProperties = { background: th.paper, color: th.ink, '--accent': th.accent } as CSSProperties;

  return (
    <Sheet open={open} onClose={onClose} title={t('style.title')} size="md">
      <div className="style-sheet" data-testid="style-sheet">
        <div className="style-sample" style={sample} aria-hidden="true">
          <small style={{ color: th.accent, fontFamily: fontById(th.headingFont).css }}>{t('style.sampleKicker')}</small>
          <strong style={{ fontFamily: fontById(th.headingFont).css, fontWeight: fontById(th.headingFont).weight, color: th.accent }}>{book.title || t('common.untitled')}</strong>
          <p style={{ fontFamily: fontById(th.bodyFont).css, fontSize: `${th.baseSize + 3}px` }}>{t('style.sampleText')}</p>
        </div>

        <p className="field-label">{t('style.design')}</p>
        <div className="style-designs" role="radiogroup" aria-label={t('style.design')}>
          {TEMPLATES.map((tpl) => (
            <button key={tpl.id} type="button" role="radio" aria-checked={th.templateId === tpl.id}
              className={`style-design ${th.templateId === tpl.id ? 'is-active' : ''}`}
              onClick={() => onChange((b) => applyTemplate(b, tpl))} data-testid={`style-tpl-${tpl.id}`}>
              <span className="style-design-swatch" style={{ background: `linear-gradient(135deg, ${tpl.cover.colors[0]}, ${tpl.cover.colors[1]})` }}>
                <b style={{ fontFamily: fontById(tpl.theme.headingFont).css, color: tpl.cover.textColor }}>Aa</b>
              </span>
              <span>{templateName(tpl)}</span>
            </button>
          ))}
        </div>
        <p className="muted small">{t('style.designHint')}</p>

        <p className="field-label">{t('style.headingFont')}</p>
        <div className="chips" role="radiogroup" aria-label={t('style.headingFont')}>
          {FONTS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={th.headingFont === f.id} className={`chip-btn ${th.headingFont === f.id ? 'is-active' : ''}`}
              style={{ fontFamily: f.css }} onClick={() => setTheme({ headingFont: f.id })} data-testid={`style-hfont-${f.id}`}>{fontLabel(f)}</button>
          ))}
        </div>

        <p className="field-label">{t('style.bodyFont')}</p>
        <div className="chips" role="radiogroup" aria-label={t('style.bodyFont')}>
          {FONTS.filter((f) => f.id !== 'display').map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={th.bodyFont === f.id} className={`chip-btn ${th.bodyFont === f.id ? 'is-active' : ''}`}
              style={{ fontFamily: f.css }} onClick={() => setTheme({ bodyFont: f.id })} data-testid={`style-bfont-${f.id}`}>{fontLabel(f)}</button>
          ))}
        </div>

        <p className="field-label">{t('style.accent')}</p>
        <div className="swatches" role="radiogroup" aria-label={t('style.accent')}>
          {ACCENTS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={th.accent.toLowerCase() === c} aria-label={c}
              className={`swatch ${th.accent.toLowerCase() === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setTheme({ accent: c })} data-testid={`style-accent-${c.slice(1)}`}>
              {th.accent.toLowerCase() === c && <Icon name="check" size={16} strokeWidth={3} />}
            </button>
          ))}
        </div>

        <p className="field-label">{t('style.size')}</p>
        <Segmented value={String(SIZES.includes(th.baseSize as 12) ? th.baseSize : 12)} onChange={(v) => setTheme({ baseSize: Number(v) })} label={t('style.size')}
          options={SIZES.map((n) => ({ value: String(n), label: t(`style.size.${n}` as 'style.size.12') }))} />
        <p className="muted small">{t('style.exportNote')}</p>
      </div>
    </Sheet>
  );
}
