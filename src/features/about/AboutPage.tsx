import { useSettings } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { Button, PageHeader } from '../../components/ui';
import type { MessageKey } from '../../i18n';

declare const __BOOKLY_VERSION__: string;

/** Feature status is stated honestly: what works today, what is a demo, what needs a server connection. */
type Status = 'available' | 'demo' | 'needsSetup';
const FEATURES: { key: string; icon: IconName; status: Status }[] = [
  { key: 'aiCreator', icon: 'sparkles', status: 'demo' },
  { key: 'editor', icon: 'edit', status: 'available' },
  { key: 'cover', icon: 'image', status: 'available' },
  { key: 'preview', icon: 'eye', status: 'available' },
  { key: 'export', icon: 'download', status: 'available' },
  { key: 'library', icon: 'book', status: 'available' },
  { key: 'languages', icon: 'globe', status: 'available' },
  { key: 'layouts', icon: 'list', status: 'available' },
  { key: 'backup', icon: 'shield', status: 'available' },
  { key: 'telegram', icon: 'send', status: 'available' },
  { key: 'aiAssistant', icon: 'feather', status: 'needsSetup' },
];
const PLANNED = ['realAi', 'collab', 'publish'] as const;

export default function AboutPage() {
  const { t } = useSettings();
  const k = (s: string) => t(s as MessageKey);
  return (
    <div className="page about" data-testid="about-page">
      <PageHeader title={t('about.title')} onBack={() => back(routes.profile())} />

      <section className="about-hero glass">
        <span className="about-mark" aria-hidden="true"><Icon name="bookOpen" size={30} /></span>
        <p className="about-lead">{t('about.lead')}</p>
        <p>{t('about.intro1')}</p>
        <p>{t('about.intro2')}</p>
        <p>{t('about.intro3')}</p>
        <p>{t('about.intro4')}</p>
      </section>

      <section className="about-section">
        <h2 className="sub-title">{t('about.missionTitle')}</h2>
        <p>{t('about.mission1')}</p>
        <p>{t('about.mission2')}</p>
      </section>

      <section className="about-section">
        <h2 className="sub-title">{t('about.featuresTitle')}</h2>
        <ul className="about-features" data-testid="about-features">
          {FEATURES.map((f) => (
            <li key={f.key} className="glass" data-status={f.status}>
              <span className="quick-icon tone-violet"><Icon name={f.icon} size={20} /></span>
              <span className="about-feature-text">
                <strong>{k(`about.f.${f.key}`)}</strong>
                <small>{k(`about.f.${f.key}Desc`)}</small>
              </span>
              <span className={`about-status is-${f.status}`}>{k(`about.status.${f.status}`)}</span>
            </li>
          ))}
        </ul>
        <h3 className="about-planned-title">{t('about.plannedTitle')}</h3>
        <ul className="about-planned">
          {PLANNED.map((p) => <li key={p}><Icon name="clock" size={16} /> {k(`about.p.${p}`)}</li>)}
        </ul>
      </section>

      <section className="about-section">
        <h2 className="sub-title">{t('about.approachTitle')}</h2>
        <p>{t('about.approach1')}</p>
        <p>{t('about.approach2')}</p>
      </section>

      <section className="about-section">
        <h2 className="sub-title">{t('about.visionTitle')}</h2>
        <p>{t('about.vision')}</p>
      </section>

      <section className="about-cta glass">
        <h2>{t('about.ctaTitle')}</h2>
        <p>{t('about.cta')}</p>
        <p className="about-motto">{t('about.motto')}</p>
        <p className="about-slogan">Bookly — Your Story, Your Creation.</p>
        <Button icon="plus" onClick={() => navigate(routes.home())} data-testid="about-start">{t('about.start')}</Button>
      </section>

      <p className="muted small about-version">{t('profile.version', { v: __BOOKLY_VERSION__ })}</p>
    </div>
  );
}
