import { useEffect, useState } from 'react';
import { useSettings } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { cloudClient, useCloud } from '../cloud/CloudContext';

interface Ann { id: string; text: string; link_url: string | null; tone: 'info' | 'success' | 'warning' }
const DISMISSED = 'bookly.ann.dismissed';
let cache: Promise<Ann | null> | null = null;

/**
 * News from the Bookly team (set in the admin panel). Fetched once per app start; can be closed.
 * Only for signed-in people (Telegram users are signed in automatically): without an account Bookly makes
 * no network requests at all.
 */
export function AnnouncementBar() {
  const { t } = useSettings();
  const cloud = useCloud();
  const signedIn = !!cloud.user;
  const [ann, setAnn] = useState<Ann | null>(null);
  useEffect(() => {
    const c = cloudClient();
    if (!c || !signedIn) return;
    cache ??= c.publicSelect<Ann>('announcements', 'select=id,text,link_url,tone&order=created_at.desc&limit=1').then((r) => r[0] ?? null).catch(() => null);
    let alive = true;
    void cache.then((a) => {
      let gone = '';
      try { gone = localStorage.getItem(DISMISSED) || ''; } catch { /* ignore */ }
      if (alive && a && a.id !== gone) setAnn(a);
    });
    return () => { alive = false; };
  }, [signedIn]);
  if (!ann) return null;
  const close = () => { try { localStorage.setItem(DISMISSED, ann.id); } catch { /* ignore */ } setAnn(null); };
  return (
    <div className={`announce-bar tone-${ann.tone}`} role="status" data-testid="announcement">
      <Icon name={ann.tone === 'warning' ? 'alert' : ann.tone === 'success' ? 'check' : 'info'} size={18} />
      <span>{ann.text}</span>
      {ann.link_url && <a href={ann.link_url} target="_blank" rel="noreferrer" className="announce-link">{t('common.open')}</a>}
      <button type="button" className="announce-x" onClick={close} aria-label={t('common.close')} data-testid="announcement-close"><Icon name="x" size={16} /></button>
    </div>
  );
}
