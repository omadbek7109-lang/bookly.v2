import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Button, Sheet, Spinner } from '../../components/ui';
import { CloudError, friendlyError } from '../../services/cloud/client';
import { wipeLocalBooks } from '../../services/storage/backup';
import { cloudClient, useCloud } from '../cloud/CloudContext';

/**
 * "Delete all data" = delete all of this person's BOOKS (books, chapters, book images/audio).
 * The account, profile, settings and avatar are kept.
 *
 * Signed in → the server (Edge Function `wipe-books`) creates a random 4-digit code bound to the user and this
 * session (5 min, max 5 attempts, single use), checks it and deletes the cloud copies; then this device is cleared.
 * Not signed in → only this device holds the books, so the code is generated and checked here with
 * crypto.getRandomValues (there is nothing on a server to protect).
 */
type Mode = 'server' | 'local';
interface Session { mode: Mode; requestId: string; code: string; expiresAt: number }
type Phase = 'starting' | 'ready' | 'checking' | 'done' | 'error';

const ATTEMPTS = 5;
const TTL_MS = 5 * 60 * 1000;

export function localCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4294960000) return String(buf[0] % 10000).padStart(4, '0');
  }
}

export function WipeSheet({ open, onClose, keepAssetIds }: { open: boolean; onClose: () => void; keepAssetIds: (string | null)[] }) {
  const { t } = useSettings();
  const { toast } = useUi();
  const cloud = useCloud();
  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<Session | null>(null);
  const [value, setValue] = useState('');
  const [left, setLeft] = useState(ATTEMPTS);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mode: Mode = cloud.available && cloud.user ? 'server' : 'local';

  const start = useCallback(async () => {
    setPhase('starting'); setValue(''); setMessage(null); setLeft(ATTEMPTS); setSession(null);
    if (mode === 'local') {
      setSession({ mode, requestId: 'local', code: localCode(), expiresAt: Date.now() + TTL_MS });
      setPhase('ready');
      return;
    }
    try {
      const client = cloudClient();
      if (!client) throw new CloudError('not configured', 'not_configured');
      const r = await client.invoke<{ request_id?: string; code?: string; expires_at?: string; error?: string }>('wipe-books', { action: 'start' });
      if (r.status !== 200 || !r.body.code || !r.body.request_id) throw new CloudError(r.body.error ?? 'error', r.body.error ?? 'server_error', r.status);
      setSession({ mode, requestId: r.body.request_id, code: r.body.code, expiresAt: Date.parse(r.body.expires_at ?? '') || Date.now() + TTL_MS });
      setPhase('ready');
    } catch (e) {
      setMessage(friendlyError(e));
      setPhase('error');
    }
  }, [mode]);

  useEffect(() => { if (open) void start(); else { setSession(null); setValue(''); } }, [open, start]);
  useEffect(() => {
    if (!open || phase !== 'ready') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, phase]);

  const expired = !!session && now > session.expiresAt;
  const secondsLeft = session ? Math.max(0, Math.ceil((session.expiresAt - now) / 1000)) : 0;

  const finishLocal = async (serverBooks: number | null, filesFailed = 0) => {
    try {
      const localCount = await wipeLocalBooks(keepAssetIds);
      await cloud.engine?.resetAfterWipe().catch(() => {});
      const n = serverBooks ?? localCount;
      setPhase('done');
      toast(filesFailed ? t('wipe.doneFilesLeft', { n, f: filesFailed }) : t('wipe.done', { n: Math.max(n, localCount) }), filesFailed ? 'info' : 'success');
      onClose();
    } catch (e) {
      setPhase('error');
      setMessage(serverBooks !== null ? t('wipe.localFailedAfterServer', { msg: (e as Error).message }) : t('wipe.localFailed', { msg: (e as Error).message }));
    }
  };

  const confirm = async () => {
    if (!session || busy.current || value.length !== 4) return;
    if (expired) { setMessage(t('wipe.expired')); return; }
    busy.current = true;
    setPhase('checking'); setMessage(null);
    try {
      if (session.mode === 'local') {
        if (value !== session.code) {
          const l = left - 1;
          setLeft(l); setValue(''); setPhase(l > 0 ? 'ready' : 'error');
          setMessage(l > 0 ? t('wipe.wrong', { n: l }) : t('wipe.locked'));
          return;
        }
        await finishLocal(null);
        return;
      }
      const client = cloudClient()!;
      const r = await client.invoke<{ status?: string; attempts_left?: number; books?: number; files_failed?: number; error?: string }>('wipe-books', { action: 'confirm', request_id: session.requestId, code: value });
      const st = r.body.status;
      if (r.status === 200 && st === 'ok') { await finishLocal(r.body.books ?? 0, r.body.files_failed ?? 0); return; }
      setValue('');
      if (st === 'wrong') { setLeft(r.body.attempts_left ?? 0); setPhase('ready'); setMessage(t('wipe.wrong', { n: r.body.attempts_left ?? 0 })); return; }
      setPhase('error');
      setMessage(st === 'locked' ? t('wipe.locked') : st === 'expired' ? t('wipe.expired') : st === 'invalid' ? t('wipe.invalid') : friendlyError(new CloudError(r.body.error ?? 'server_error', r.body.error ?? 'server_error', r.status)));
    } catch (e) {
      setPhase('error');
      setMessage(friendlyError(e));
    } finally { busy.current = false; }
  };

  const digits = (session?.code ?? '····').split('');
  return (
    <Sheet open={open} onClose={onClose} size="sm" title={t('profile.clearAll')}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        {phase === 'error' || expired
          ? <Button icon="refresh" onClick={() => void start()} data-testid="wipe-new-code">{t('wipe.newCode')}</Button>
          : <Button variant="danger" icon="trash" loading={phase === 'checking'} disabled={phase !== 'ready' || value.length !== 4} onClick={() => void confirm()} data-testid="wipe-confirm">{t('common.delete')}</Button>}
      </>}>
      <div className="wipe" data-testid="wipe-sheet" data-mode={mode}>
        <div className="wipe-scope">
          <p><Icon name="trash" size={16} /> {t('wipe.deletes')}</p>
          <p><Icon name="shield" size={16} /> {t('wipe.keeps')}</p>
          <p className="muted small">{mode === 'server' ? t('wipe.scopeServer') : t('wipe.scopeLocal')}</p>
        </div>
        {phase === 'starting' ? <Spinner label={t('wipe.creating')} /> : session && (
          <>
            <p className="wipe-label">{t('wipe.enterCode')}</p>
            <div className="wipe-code" aria-label={t('wipe.codeAria', { code: digits.join(' ') })} data-testid="wipe-code">
              {digits.map((d, i) => <span key={i} aria-hidden="true">{d}</span>)}
            </div>
            <input
              ref={inputRef}
              className="input wipe-input"
              data-autofocus
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              value={value}
              disabled={phase === 'checking' || expired}
              placeholder="0000"
              aria-label={t('wipe.inputAria')}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirm(); } }}
              data-testid="wipe-input"
            />
            <p className="muted small wipe-meta" aria-live="polite">
              {expired ? t('wipe.expired') : t('wipe.timer', { m: Math.floor(secondsLeft / 60), s: String(secondsLeft % 60).padStart(2, '0') })} · {t('wipe.attempts', { n: left })}
            </p>
          </>
        )}
        {message && <p className="wipe-error" role="alert" data-testid="wipe-message"><Icon name="alert" size={16} /> {message}</p>}
      </div>
    </Sheet>
  );
}
