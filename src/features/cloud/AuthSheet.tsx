import { useEffect, useState } from 'react';
import { useUi } from '../../app/AppContext';
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
    if (!EMAIL.test(email.trim())) { setError('Email manzilini to‘g‘ri kiriting.'); return; }
    if (mode !== 'forgot' && password.length < 8) { setError('Parol kamida 8 ta belgidan iborat bo‘lsin.'); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        await cloud.signIn(email, password);
        toast('Hisobingizga kirdingiz', 'success');
        setPassword('');
        onClose();
      } else if (mode === 'signup') {
        const r = await cloud.signUp(email, password, name);
        setPassword('');
        if (r.needsConfirmation) setNotice(`Tasdiqlash havolasi ${email.trim()} manziliga yuborildi. Pochtangizni oching, havolani bosing va shu yerga qayting.`);
        else { toast('Hisob yaratildi', 'success'); onClose(); }
      } else {
        await cloud.resetPassword(email);
        setNotice('Agar bu email ro‘yxatdan o‘tgan bo‘lsa, parolni tiklash havolasi yuborildi.');
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally { setBusy(false); }
  };

  const title = mode === 'login' ? 'Hisobga kirish' : mode === 'signup' ? 'Hisob yaratish' : 'Parolni tiklash';
  return (
    <Sheet open={open} onClose={onClose} title={title} size="sm">
      <p className="muted small">Hisob ixtiyoriy. U kitoblaringizni Cloud’da zaxiralash va boshqa qurilmalarda ochish uchun kerak. Hisobsiz ham Bookly to‘liq ishlaydi.</p>
      {mode !== 'forgot' && (
        <Segmented value={mode} label={title} onChange={(v) => { setMode(v); setError(null); setNotice(null); }}
          options={[{ value: 'login', label: 'Kirish' }, { value: 'signup', label: 'Ro‘yxatdan o‘tish' }]} />
      )}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        {mode === 'signup' && (
          <Field label="Ism" htmlFor="au-name" hint="ixtiyoriy">
            <input id="au-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} data-testid="auth-name" />
          </Field>
        )}
        <Field label="Email" htmlFor="au-email">
          <input id="au-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus data-testid="auth-email" />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Parol" htmlFor="au-pass" hint={mode === 'signup' ? 'Kamida 8 ta belgi' : undefined}>
            <input id="au-pass" className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="auth-password" />
          </Field>
        )}
        {error && <div className="banner banner-error" role="alert" data-testid="auth-error"><Icon name="alert" size={16} /> {error}</div>}
        {notice && <div className="banner banner-info" role="status" data-testid="auth-notice"><Icon name="info" size={16} /> {notice}</div>}
        <Button type="submit" block size="lg" loading={busy} data-testid="auth-submit">
          {mode === 'login' ? 'Kirish' : mode === 'signup' ? 'Hisob yaratish' : 'Havola yuborish'}
        </Button>
        {mode === 'login' && <button type="button" className="link center-link" onClick={() => { setMode('forgot'); setError(null); }} data-testid="auth-forgot">Parolni unutdingizmi?</button>}
        {mode === 'forgot' && <button type="button" className="link center-link" onClick={() => setMode('login')}>Kirishga qaytish</button>}
      </form>
    </Sheet>
  );
}

/** Opened from a password-reset email link. */
export function NewPasswordSheet() {
  const cloud = useCloud();
  const { toast } = useUi();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (pw.length < 8) { setError('Parol kamida 8 ta belgidan iborat bo‘lsin.'); return; }
    setBusy(true); setError(null);
    try { await cloud.updatePassword(pw); toast('Yangi parol saqlandi', 'success'); cloud.clearRecovery(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={cloud.recovery} onClose={cloud.clearRecovery} title="Yangi parol" size="sm">
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Yangi parol" htmlFor="np"><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus /></Field>
        {error && <div className="banner banner-error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
        <Button type="submit" block loading={busy}>Saqlash</Button>
      </form>
    </Sheet>
  );
}

/** One-time question after the first sign-in on this device. */
export function BackupPromptSheet() {
  const cloud = useCloud();
  const [busy, setBusy] = useState(false);
  const localCount = cloud.snapshot.entries.filter((e) => e.status === 'local-only').length;
  const cloudCount = cloud.snapshot.entries.filter((e) => e.status === 'cloud-only').length;
  const open = cloud.backupPrompt && cloud.snapshot.phase !== 'signed-out';
  return (
    <Sheet open={open} onClose={() => void cloud.answerBackupPrompt(false)} title="Cloud zaxira" size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => void cloud.answerBackupPrompt(false)} data-testid="prompt-later">Keyinroq</Button>
        <Button icon="upload" loading={busy} onClick={async () => { setBusy(true); await cloud.answerBackupPrompt(true); setBusy(false); }} data-testid="prompt-backup">Hozir zaxiralash</Button>
      </>}>
      <p>Shu qurilmada <b>{localCount}</b> ta kitob hali Cloud’da yo‘q{cloudCount ? <>, Cloud’da esa <b>{cloudCount}</b> ta kitob bor</> : null}.</p>
      <p className="muted small">“Hozir zaxiralash” kitoblarni yuklaydi va Cloud’dagilarni shu qurilmaga qo‘shadi. Lokal kitoblar hech qachon o‘chirilmaydi. “Keyinroq” desangiz, istalgan payt Profil → Cloud bo‘limidan qilishingiz mumkin.</p>
    </Sheet>
  );
}
