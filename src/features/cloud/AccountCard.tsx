import { useState } from 'react';
import { navigate, routes } from '../../app/router';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { AuthSheet } from './AuthSheet';
import { useCloud } from './CloudContext';
import { fmtTime, PhaseChip } from './CloudPage';

export function useCloudEmail(): string | null {
  return useCloud().user?.email ?? null;
}

/** Profile → Account: optional sign-in for cloud backup, or the signed-in summary. */
export function AccountCard() {
  const cloud = useCloud();
  const [auth, setAuth] = useState<null | 'login' | 'signup'>(null);
  if (!cloud.available) return null;
  if (!cloud.user) {
    return (
      <section className="account-card glass" data-testid="account-card">
        <div className="account-head">
          <span className="quick-icon tone-indigo"><Icon name="globe" size={22} /></span>
          <div>
            <strong>Cloud zaxira — ixtiyoriy</strong>
            <p className="muted small">Hisobsiz ham hamma narsa shu qurilmada ishlaydi. Hisob ochsangiz, kitoblar Cloud’ga zaxiralanadi va boshqa qurilmalarda ham ochiladi.</p>
          </div>
        </div>
        <div className="row-actions wrap">
          <Button variant="secondary" onClick={() => setAuth('login')} data-testid="account-login">Kirish</Button>
          <Button icon="user" onClick={() => setAuth('signup')} data-testid="account-signup">Hisob yaratish</Button>
        </div>
        <AuthSheet open={!!auth} initial={auth ?? 'login'} onClose={() => setAuth(null)} />
      </section>
    );
  }
  const s = cloud.snapshot;
  return (
    <section className="account-card glass" data-testid="account-card">
      <div className="account-head">
        <span className="quick-icon tone-teal"><Icon name="shield" size={22} /></span>
        <div>
          <strong data-testid="account-email">{cloud.user.email}</strong>
          <p className="muted small">Oxirgi zaxira: {fmtTime(s.lastBackupAt)}</p>
        </div>
      </div>
      <PhaseChip />
      <div className="row-actions wrap">
        <Button variant="secondary" icon="upload" disabled={s.phase === 'syncing'} onClick={() => void cloud.sync('backup')} data-testid="account-backup">Hozir zaxiralash</Button>
        <Button icon="globe" onClick={() => navigate(routes.cloud())} data-testid="open-cloud">Cloud boshqaruvi</Button>
      </div>
    </section>
  );
}
