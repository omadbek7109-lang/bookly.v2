import { useSettings } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Field, Segmented } from '../../components/ui';
import type { MessageKey } from '../../i18n';
import { SKINS, type Corners } from '../../services/storage/settings';

/**
 * Interface design picker. Each card carries its own data-skin/data-theme, so the same CSS that themes the app
 * paints the card — the preview is exactly what you get.
 */
export function SkinPicker() {
  const { t, settings, update, resolvedTheme } = useSettings();
  return (
    <>
      <Field label={t('skin.title')}>
        <div className="skin-grid" role="radiogroup" aria-label={t('skin.title')} data-testid="skin-picker">
          {SKINS.map((s) => {
            const on = settings.skin === s;
            return (
              <button key={s} type="button" role="radio" aria-checked={on} className={`skin-card ${on ? 'is-active' : ''}`} onClick={() => update({ skin: s })} data-testid={`skin-${s}`}>
                <span className="skin-mini" data-skin={s} data-theme={resolvedTheme} style={{ background: 'var(--bg)' }} aria-hidden="true">
                  <i style={{ width: '55%', background: 'var(--text)' }} />
                  <span className="sm-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                    <b style={{ background: 'linear-gradient(135deg, var(--violet), var(--primary-2))' }} /><i style={{ background: 'var(--text-3)' }} />
                  </span>
                  <span className="sm-btn" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-2))' }} />
                </span>
                <strong>{t(`skin.${s}` as MessageKey)}</strong>
                {on && <span className="skin-check"><Icon name="check" size={13} strokeWidth={3} /></span>}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label={t('skin.corners')}>
        <Segmented value={settings.corners} label={t('skin.corners')} onChange={(v: Corners) => update({ corners: v })}
          options={[{ value: 'round', label: t('skin.corners.round') }, { value: 'soft', label: t('skin.corners.soft') }, { value: 'sharp', label: t('skin.corners.sharp') }]} />
      </Field>
    </>
  );
}
