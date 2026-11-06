import { useState } from 'react';
import { useUi } from '../../app/AppContext';
import { friendlyError } from '../../services/cloud/client';
import { navigate, routes } from '../../app/router';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { AuthSheet } from './AuthSheet';
import { useCloud } from './CloudContext';
import { fmtTime, PhaseChip } from './CloudPage';

/** Human label for the signed-in account (Telegram accounts use a hidden technical email). */
export function accountLabel(user: { email: string; user_metadata?: { display_name?: string } } | null): string | null {
  if (!user) return null;
  return user.email.endsWith('@telegram.bookly.invalid') ? `Telegram: ${user.user_metadata?.display_name || 'hisob'}` : user.email;
}

export function useCloudEmail(): string | null {
  return accountLabel(useCloud().user);
}

/** Is this a Telegram account (they use a hidden technical email)? */
export const isTelegramAccount = (user: { email: string } | null) => !!user && user.email.endsWith('@telegram.bookly.invalid');

/** Short account status for the profile card — never repeats the person's name. */
export function useAccountStatus(): { label: string; tone: 'ok' | 'muted'; icon: 'check' | 'user' | 'globe' } {
  const cloud = useCloud();
  if (!cloud.available || !cloud.user) {
    return cloud.inTelegram
      ? { label: cloud.telegramBusy ? 'Telegram bilan ulanmoqda…' : 'Telegram bilan ulanmagan', tone: 'muted', icon: 'user' }
      : { label: 'Faqat shu qurilmada', tone: 'muted', icon: 'user' };
  }
  return isTelegramAccount(cloud.user) ? { label: 'Telegram bilan ulangan', tone: 'ok', icon: 'check' } : { label: cloud.user.email, tone: 'ok', icon: 'check' };
}

/** Profile → "Zaxiralash": the cloud part, in plain words. */
export function AccountCard() {
  const cloud = useCloud();
  const [auth, setAuth] = useState<null | 'login' | 'signup'>(null);
  const { toast } = useUi();
  if (!cloud.available) return null;
  if (!cloud.user) {
    return (
      <div className="backup-cloud" data-testid="account-card">
        <div className="backup-cloud-head">
          <span className="quick-icon tone-indigo"><Icon name="globe" size={20} /></span>
          <div>
            <strong>Internetga zaxiralash — ixtiyoriy</strong>
            <p className="muted small">Hozir kitoblaringiz faqat shu qurilmada. Ulansangiz, ular avtomatik saqlanadi va telefon almashsa ham yo‘qolmaydi.</p>
          </div>
        </div>
        {cloud.inTelegram ? (
          <>
            <Button icon="user" block loading={cloud.telegramBusy}
              onClick={() => void cloud.signInWithTelegram().then(() => toast('Telegram bilan ulandi', 'success')).catch((e) => toast(friendlyError(e), 'error'))}
              data-testid="account-telegram">Telegram orqali ulash</Button>
            <button type="button" className="link-btn small" onClick={() => setAuth('login')} data-testid="account-login">Email bilan kirish (ixtiyoriy)</button>
          </>
        ) : (
          <div className="row-actions wrap">
            <Button variant="secondary" onClick={() => setAuth('login')} data-testid="account-login">Kirish</Button>
            <Button icon="user" onClick={() => setAuth('signup')} data-testid="account-signup">Hisob yaratish</Button>
          </div>
        )}
        <AuthSheet open={!!auth} initial={auth ?? 'login'} onClose={() => setAuth(null)} />
      </div>
    );
  }
  const s = cloud.snapshot;
  return (
    <div className="backup-cloud" data-testid="account-card">
      <div className="backup-cloud-head">
        <span className="quick-icon tone-teal"><Icon name="shield" size={20} /></span>
        <div>
          <strong>Avtomatik zaxira yoqilgan</strong>
          <p className="muted small">Oxirgi zaxira: {fmtTime(s.lastBackupAt)} · <span data-testid="account-email">{accountLabel(cloud.user)}</span></p>
        </div>
      </div>
      <PhaseChip />
      <div className="row-actions wrap">
        <Button variant="secondary" icon="upload" disabled={s.phase === 'syncing'} onClick={() => void cloud.sync('backup')} data-testid="account-backup">Hozir zaxiralash</Button>
        <Button variant="ghost" iconRight="chevronRight" onClick={() => navigate(routes.cloud())} data-testid="open-cloud">Batafsil</Button>
      </div>
    </div>
  );
}
