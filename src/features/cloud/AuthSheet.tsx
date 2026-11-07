import { useEffect, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Button, Field, Segmented, Sheet } from '../../components/ui';
import { friendlyError } from '../../services/cloud/client';
import { useCloud } from './CloudContext';

type Mode = 'login' | 'signup' | 'forgot';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Sign in / create account / forgot password — one bottom sheet with three tabs. */
export function AuthSheet({ open, onClose, initial = 'login' }: { open: boolean; onClose: () => void; initial?: Mode }) {
  const cloud = useCloud();
  const { toast } = useUi();
  const { t } = useSettings();
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { if (open) { setMode(initial); setError(null); setNotice(null); } }, [open, initial]);

  const submit = async () => {
    setError(null); setNotice(null);
    if (!EMAIL.test(email.trim())) { setError(t('auth.err.email')); return; }
    if (mode !== 'forgot' && password.length < 8) { setError(t('auth.err.password')); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        await cloud.signIn(email, password);
        toast(t('auth.signedIn'), 'success');
        setPassword('');
        onClose();
      } else if (mode === 'signup') {
        const r = await cloud.signUp(email, password, name);
        setPassword('');
        if (r.needsConfirmation) setNotice(t('auth.confirmSent', { email: email.trim() }));
        else { toast(t('auth.created'), 'success'); onClose(); }
      } else {
        await cloud.resetPassword(email);
        setNotice(t('auth.resetSent'));
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally { setBusy(false); }
  };

  const title = mode === 'login' ? t('auth.title.login') : mode === 'signup' ? t('auth.title.signup') : t('auth.title.forgot');
  return (
    <Sheet open={open} onClose={onClose} title={title} size="sm">
      <p className="muted small">{t('auth.optionalNote')}</p>
      {mode !== 'forgot' && (
        <Segmented value={mode} label={title} onChange={(v) => { setMode(v); setError(null); setNotice(null); }}
          options={[{ value: 'login', label: t('auth.tab.login') }, { value: 'signup', label: t('auth.tab.signup') }]} />
      )}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        {mode === 'signup' && (
          <Field label={t('profile.name')} htmlFor="au-name" hint={t('common.optional')}>
            <input id="au-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} data-testid="auth-name" />
          </Field>
        )}
        <Field label={t('auth.email')} htmlFor="au-email">
          <input id="au-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus data-testid="auth-email" />
        </Field>
        {mode !== 'forgot' && (
          <Field label={t('auth.password')} htmlFor="au-pass" hint={mode === 'signup' ? t('auth.passwordHint') : undefined}>
            <input id="au-pass" className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="auth-password" />
          </Field>
        )}
        {error && <div className="banner banner-error" role="alert" data-testid="auth-error"><Icon name="alert" size={16} /> {error}</div>}
        {notice && <div className="banner banner-info" role="status" data-testid="auth-notice"><Icon name="info" size={16} /> {notice}</div>}
        <Button type="submit" block size="lg" loading={busy} data-testid="auth-submit">
          {mode === 'login' ? t('auth.tab.login') : mode === 'signup' ? t('auth.title.signup') : t('auth.sendLink')}
        </Button>
        {mode === 'login' && <button type="button" className="link center-link" onClick={() => { setMode('forgot'); setError(null); }} data-testid="auth-forgot">{t('auth.forgot')}</button>}
        {mode === 'forgot' && <button type="button" className="link center-link" onClick={() => setMode('login')}>{t('auth.backToLogin')}</button>}
      </form>
    </Sheet>
  );
}

/** Opened from a password-reset email link. */
export function NewPasswordSheet() {
  const cloud = useCloud();
  const { toast } = useUi();
  const { t } = useSettings();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (pw.length < 8) { setError(t('auth.err.password')); return; }
    setBusy(true); setError(null);
    try { await cloud.updatePassword(pw); toast(t('auth.newPasswordSaved'), 'success'); cloud.clearRecovery(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={cloud.recovery} onClose={cloud.clearRecovery} title={t('auth.newPassword')} size="sm">
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t('auth.newPassword')} htmlFor="np"><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus /></Field>
        {error && <div className="banner banner-error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
        <Button type="submit" block loading={busy}>{t('common.save')}</Button>
      </form>
    </Sheet>
  );
}

/** One-time question after the first sign-in on this device. */
export function BackupPromptSheet() {
  const cloud = useCloud();
  const { t } = useSettings();
  const [busy, setBusy] = useState(false);
  const localCount = cloud.snapshot.entries.filter((e) => e.status === 'local-only').length;
  const cloudCount = cloud.snapshot.entries.filter((e) => e.status === 'cloud-only').length;
  // Only ask when there is something to back up or restore (an empty "0 books" question is just noise).
  const nothingToMove = cloud.snapshot.phase === 'idle' && localCount === 0 && cloudCount === 0;
  const open = cloud.backupPrompt && cloud.snapshot.phase !== 'signed-out' && !nothingToMove;
  // A new account on an empty device: nothing to ask about — just turn on automatic backup quietly.
  useEffect(() => { if (cloud.backupPrompt && nothingToMove) void cloud.answerBackupPrompt(true); }, [cloud.backupPrompt, nothingToMove]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={() => void cloud.answerBackupPrompt(false)} title={t('backup.promptTitle')} size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => void cloud.answerBackupPrompt(false)} data-testid="prompt-later">{t('backup.later')}</Button>
        <Button icon="upload" loading={busy} onClick={async () => { setBusy(true); await cloud.answerBackupPrompt(true); setBusy(false); }} data-testid="prompt-backup">{t('backup.now')}</Button>
      </>}>
      <p>{t('backup.promptLocal', { n: localCount })}{cloudCount ? ` ${t('backup.promptCloud', { n: cloudCount })}` : ''}</p>
      <p className="muted small">{t('backup.promptNote')}</p>
    </Sheet>
  );
}
