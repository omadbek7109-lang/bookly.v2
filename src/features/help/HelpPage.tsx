import { useMemo, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { Button, PageHeader } from '../../components/ui';
import type { MessageKey } from '../../i18n';
import { AdminError, sendFeedback } from '../../services/admin/api';
import { useCloud } from '../cloud/CloudContext';
import { RobotFace, useRobot } from '../robot/Robot';

declare const __BOOKLY_VERSION__: string;

const JOURNEY: { icon: IconName; title: MessageKey; text: MessageKey; to: string }[] = [
  { icon: 'list', title: 'help.j1.title', text: 'help.j1.text', to: routes.create() },
  { icon: 'feather', title: 'help.j2.title', text: 'help.j2.text', to: routes.books() },
  { icon: 'brush', title: 'help.j3.title', text: 'help.j3.text', to: routes.cover() },
  { icon: 'download', title: 'help.j4.title', text: 'help.j4.text', to: routes.export() },
];
const FAQ: { q: MessageKey; a: MessageKey; to?: string; cta?: MessageKey }[] = [
  { q: 'help.q.start', a: 'help.a.start', to: routes.create(), cta: 'help.go.wizard' },
  { q: 'help.q.image', a: 'help.a.image' },
  { q: 'help.q.style', a: 'help.a.style' },
  { q: 'help.q.cover', a: 'help.a.cover', to: routes.cover(), cta: 'help.go.cover' },
  { q: 'help.q.pdf', a: 'help.a.pdf', to: routes.export(), cta: 'help.go.export' },
  { q: 'help.q.telegram', a: 'help.a.telegram' },
  { q: 'help.q.backup', a: 'help.a.backup', to: routes.cloud(), cta: 'help.go.backup' },
  { q: 'help.q.delete', a: 'help.a.delete', to: routes.books(), cta: 'help.go.books' },
  { q: 'help.q.design', a: 'help.a.design', to: routes.profile(), cta: 'help.go.profile' },
  { q: 'help.q.offline', a: 'help.a.offline' },
  { q: 'help.q.import', a: 'help.a.import', to: routes.import(), cta: 'help.go.import' },
  { q: 'help.q.robot', a: 'help.a.robot', to: routes.profile(), cta: 'help.go.profile' },
];

export default function HelpPage() {
  const { t } = useSettings();
  const { toast } = useUi();
  const robot = useRobot();
  const cloud = useCloud();
  const [q, setQ] = useState('');
  const [openQ, setOpenQ] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return FAQ.map((f, i) => ({ ...f, i })).filter((f) => !s || `${t(f.q)} ${t(f.a)}`.toLowerCase().includes(s));
  }, [q, t]);

  const submit = async () => {
    if (!msg.trim()) return;
    setBusy(true);
    try { await sendFeedback(msg.trim(), __BOOKLY_VERSION__); setMsg(''); setSent(true); toast(t('help.fb.sent'), 'success'); }
    catch (e) {
      const code = e instanceof AdminError ? e.code : '';
      toast(code === 'needs_login' ? t('help.fb.needLogin') : code === 'rate_limited' ? t('help.fb.rate') : code === 'admin_not_ready' ? t('help.fb.notReady') : t('help.fb.error'), 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="page help" data-testid="help-page">
      <PageHeader title={t('help.title')} onBack={() => back(routes.profile())} />

      <section className="help-hero glass">
        <RobotFace size={76} mood="happy" />
        <div>
          <h2>{t('help.heroTitle')}</h2>
          <p>{t('help.heroText')}</p>
          <Button icon="play" onClick={robot.startTour} data-testid="help-tour">{t('help.tour')}</Button>
        </div>
      </section>

      <h3 className="sub-title">{t('help.journey')}</h3>
      <ol className="journey" data-testid="help-journey">
        {JOURNEY.map((j, i) => (
          <li key={j.title} className="glass">
            <span className="journey-num">{i + 1}</span>
            <span className="quick-icon tone-violet"><Icon name={j.icon} size={20} /></span>
            <strong>{t(j.title)}</strong>
            <small>{t(j.text)}</small>
            <button type="button" className="link-btn" onClick={() => navigate(j.to)}>{t('help.open')} →</button>
          </li>
        ))}
      </ol>

      <h3 className="sub-title">{t('help.faq')}</h3>
      <label className="search-box"><Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('help.search')} aria-label={t('help.search')} data-testid="help-search" />
      </label>
      <div className="faq" data-testid="help-faq">
        {list.map((f) => (
          <div key={f.q} className={`faq-item glass ${openQ === f.i ? 'is-open' : ''}`}>
            <button type="button" className="faq-q" aria-expanded={openQ === f.i} onClick={() => setOpenQ(openQ === f.i ? null : f.i)}>
              <span>{t(f.q)}</span><Icon name={openQ === f.i ? 'chevronUp' : 'chevronDown'} size={18} />
            </button>
            {openQ === f.i && (
              <div className="faq-a">
                <p>{t(f.a)}</p>
                {f.to && <Button size="sm" variant="secondary" iconRight="arrowRight" onClick={() => navigate(f.to!)}>{t(f.cta!)}</Button>}
              </div>
            )}
          </div>
        ))}
        {!list.length && <p className="muted small">{t('help.noResults')}</p>}
      </div>

      <h3 className="sub-title">{t('help.fb.title')}</h3>
      <section className="glass help-feedback form">
        <p className="muted small">{t('help.fb.text')}</p>
        {sent ? <p className="help-thanks" data-testid="help-thanks">💜 {t('help.fb.thanks')}</p> : (
          <>
            <textarea className="input" rows={4} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('help.fb.ph')} data-testid="help-feedback" />
            {!cloud.user && <p className="muted small">{t('help.fb.needLogin')}</p>}
            <Button icon="send" loading={busy} disabled={!msg.trim()} onClick={() => void submit()} data-testid="help-feedback-send">{t('help.fb.send')}</Button>
          </>
        )}
        <a className="link-btn" href="https://t.me/Booklym_app_Bot" target="_blank" rel="noreferrer"><Icon name="send" size={15} /> {t('help.bot')}</a>
      </section>
    </div>
  );
}
