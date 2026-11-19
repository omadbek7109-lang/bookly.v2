import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, routes } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, Field, IconButton, PageHeader, ProgressBar, Segmented, Sheet, Spinner, Switch } from '../../components/ui';
import type { MessageKey } from '../../i18n';
import {
  AdminError, adminApi, photoToDataUrl, previewHtml,
  type AdminStats, type AdminUser, type Announcement, type AuditItem, type Broadcast, type FeedbackItem, type OutgoingMessage,
} from '../../services/admin/api';
import { formatBytes } from '../../services/export/prepare';
import { useCloud } from '../cloud/CloudContext';

type Tab = 'stats' | 'send' | 'users' | 'announce' | 'feedback' | 'audit';

/** Turns an admin API error into a sentence for the admin. */
function useErrorText() {
  const { t } = useSettings();
  return (e: unknown) => {
    const code = e instanceof AdminError ? e.code : 'server_error';
    const key = `admin.err.${code}` as MessageKey;
    const text = t(key);
    return text === key ? t('admin.err.server_error') : text;
  };
}

export default function AdminPage() {
  const { t } = useSettings();
  const cloud = useCloud();
  const errText = useErrorText();
  const [state, setState] = useState<'checking' | 'ok' | 'denied' | 'error'>('checking');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('stats');

  useEffect(() => {
    if (!cloud.user) { setState('error'); setError(t('admin.err.needs_login')); return; }
    adminApi.whoami().then((r) => setState(r.admin ? 'ok' : 'denied')).catch((e) => { setState('error'); setError(errText(e)); });
  }, [cloud.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page admin" data-testid="admin-page">
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} onBack={() => back(routes.profile())} />
      {state === 'checking' && <Spinner label={t('common.loading')} />}
      {state === 'denied' && <EmptyState icon="shield" title={t('admin.denied')} text={t('admin.deniedText')} />}
      {state === 'error' && <EmptyState icon="alert" title={t('admin.unavailable')} text={error} />}
      {state === 'ok' && (
        <>
          <Segmented value={tab} onChange={setTab} label={t('admin.title')} scroll options={[
            { value: 'stats', label: t('admin.tab.stats'), icon: 'target' },
            { value: 'send', label: t('admin.tab.send'), icon: 'send' },
            { value: 'users', label: t('admin.tab.users'), icon: 'user' },
            { value: 'announce', label: t('admin.tab.announce'), icon: 'info' },
            { value: 'feedback', label: t('admin.tab.feedback'), icon: 'help' },
            { value: 'audit', label: t('admin.tab.audit'), icon: 'clock' },
          ]} />
          {tab === 'stats' && <StatsTab />}
          {tab === 'send' && <SendTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'announce' && <AnnounceTab />}
          {tab === 'feedback' && <FeedbackTab />}
          {tab === 'audit' && <AuditTab />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ statistics
function StatsTab() {
  const { t, settings } = useSettings();
  const errText = useErrorText();
  const [s, setS] = useState<AdminStats | null>(null);
  const [err, setErr] = useState('');
  const [metric, setMetric] = useState<'users' | 'books' | 'active' | 'subscribers'>('active');
  const load = useCallback(() => { setErr(''); adminApi.stats(14).then(setS).catch((e) => setErr(errText(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  if (err) return <ErrorBox text={err} onRetry={load} />;
  if (!s) return <Spinner label={t('common.loading')} />;
  const num = (n: number) => n.toLocaleString(settings.locale === 'uz' ? 'uz-Latn' : settings.locale);
  const kpis: [IconName, MessageKey, string, string?][] = [
    ['user', 'admin.kpi.users', num(s.users), t('admin.kpi.new7', { n: num(s.users_new_7d) })],
    ['zap', 'admin.kpi.active', num(s.active_7d), t('admin.kpi.last7')],
    ['book', 'admin.kpi.books', num(s.books), t('admin.kpi.new7', { n: num(s.books_new_7d) })],
    ['list', 'admin.kpi.chapters', num(s.chapters)],
    ['send', 'admin.kpi.subscribers', num(s.subscribers_active), t('admin.kpi.blocked', { n: num(s.subscribers - s.subscribers_active) })],
    ['download', 'admin.kpi.exports', num(s.exports_7d), t('admin.kpi.last7')],
    ['folder', 'admin.kpi.storage', formatBytes(s.storage_bytes)],
    ['help', 'admin.kpi.feedback', num(s.feedback_new), t('admin.kpi.unread')],
  ];
  const daily = s.daily ?? [];
  const max = Math.max(1, ...daily.map((d) => d[metric]));
  const formats = Object.entries(s.exports_by_format ?? {}).sort((a, b) => b[1] - a[1]);
  const fmax = Math.max(1, ...formats.map((f) => f[1]));
  return (
    <div className="admin-stats" data-testid="admin-stats">
      <div className="kpi-grid">
        {kpis.map(([icon, label, value, hint]) => (
          <div key={label} className="kpi glass">
            <span className="kpi-icon"><Icon name={icon} size={18} /></span>
            <strong>{value}</strong>
            <span>{t(label)}</span>
            {hint && <small>{hint}</small>}
          </div>
        ))}
      </div>
      <section className="glass chart-card">
        <div className="chart-head">
          <h3>{t('admin.chart.title')}</h3>
          <IconButton icon="refresh" label={t('admin.refresh')} onClick={load} />
        </div>
        <Segmented value={metric} onChange={setMetric} label={t('admin.chart.title')} scroll options={[
          { value: 'active', label: t('admin.chart.active') }, { value: 'users', label: t('admin.chart.users') },
          { value: 'books', label: t('admin.chart.books') }, { value: 'subscribers', label: t('admin.chart.subscribers') },
        ]} />
        <div className="bar-chart" role="img" aria-label={t('admin.chart.title')} data-testid="admin-chart">
          {daily.map((d) => (
            <div key={d.day} className="bar-col" title={`${d.day}: ${d[metric]}`}>
              <span className="bar-val">{d[metric] || ''}</span>
              <span className="bar" style={{ height: `${Math.max(3, (d[metric] / max) * 100)}%` }} />
              <small>{d.day.slice(8, 10)}</small>
            </div>
          ))}
        </div>
      </section>
      {formats.length > 0 && (
        <section className="glass chart-card">
          <h3>{t('admin.formats')}</h3>
          {formats.map(([f, n]) => (
            <div key={f} className="hbar"><span>{f.toUpperCase()}</span><span className="hbar-track"><span style={{ width: `${(n / fmax) * 100}%` }} /></span><b>{n}</b></div>
          ))}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ message composer (broadcast / one user)
function Composer({ onSend, sendLabel, allowTest = true, busyLabel }: { onSend: (m: OutgoingMessage, test: boolean) => Promise<void>; sendLabel: string; allowTest?: boolean; busyLabel?: string }) {
  const { t } = useSettings();
  const { toast } = useUi();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [btnText, setBtnText] = useState('');
  const [btnUrl, setBtnUrl] = useState('');
  const [openApp, setOpenApp] = useState(true);
  const [busy, setBusy] = useState<'' | 'test' | 'send'>('');
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const wrap = (mark: string) => {
    const el = area.current; if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const next = text.slice(0, a) + mark + text.slice(a, b) + mark + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + mark.length, b + mark.length); });
  };
  const msg = (): OutgoingMessage => ({ text, photo, button_text: btnText.trim() || undefined, button_url: btnUrl.trim() || undefined, open_app: openApp });
  const go = async (test: boolean) => {
    if (!text.trim() && !photo) { toast(t('admin.err.empty_message'), 'error'); return; }
    if (photo && text.length > 1000) { toast(t('admin.err.caption_too_long'), 'error'); return; }
    setBusy(test ? 'test' : 'send');
    try { await onSend(msg(), test); if (!test) { setText(''); setPhoto(null); setBtnText(''); setBtnUrl(''); } } finally { setBusy(''); }
  };
  return (
    <div className="composer">
      <div className="composer-tools">
        <button type="button" className="chip-btn" onClick={() => wrap('**')} aria-label={t('editor.bold')}><b>B</b></button>
        <button type="button" className="chip-btn" onClick={() => wrap('__')} aria-label={t('editor.italic')}><i>I</i></button>
        <button type="button" className="chip-btn" onClick={() => file.current?.click()} data-testid="admin-photo-btn"><Icon name="image" size={16} /> {photo ? t('admin.photoChange') : t('admin.photoAdd')}</button>
        {photo && <button type="button" className="chip-btn" onClick={() => setPhoto(null)}><Icon name="x" size={16} /> {t('admin.photoRemove')}</button>}
        <input ref={file} type="file" accept="image/*" hidden data-testid="admin-photo"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { setPhoto(await photoToDataUrl(f)); } catch { toast(t('admin.err.bad_photo'), 'error'); } }} />
      </div>
      <textarea ref={area} className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000}
        placeholder={t('admin.textPh')} aria-label={t('admin.text')} data-testid="admin-text" />
      <p className="muted small">{t('admin.markupHint')} · {text.length}/{photo ? 1000 : 4000}</p>
      <div className="form-row">
        <Field label={t('admin.btnText')} htmlFor="ab-t" hint={t('common.optional')}><input id="ab-t" className="input" value={btnText} onChange={(e) => setBtnText(e.target.value)} maxLength={64} placeholder={t('admin.btnTextPh')} /></Field>
        <Field label={t('admin.btnUrl')} htmlFor="ab-u" hint={t('common.optional')}><input id="ab-u" className="input" type="url" inputMode="url" value={btnUrl} onChange={(e) => setBtnUrl(e.target.value)} placeholder="https://" /></Field>
      </div>
      <Switch id="ab-open" label={t('admin.openAppBtn')} checked={openApp} onChange={setOpenApp} />
      <p className="field-label">{t('admin.preview')}</p>
      <div className="tg-preview" data-testid="admin-preview">
        <div className="tg-bubble">
          {photo && <img src={photo} alt="" />}
          {text.trim() ? <p dangerouslySetInnerHTML={{ __html: previewHtml(text) }} /> : <p className="muted">{t('admin.previewEmpty')}</p>}
        </div>
        {btnText.trim() && btnUrl.trim() && <span className="tg-btn">{btnText} ↗</span>}
        {openApp && <span className="tg-btn">📖 Bookly’ni ochish</span>}
      </div>
      <div className="row-actions">
        {allowTest && <Button variant="secondary" icon="send" loading={busy === 'test'} disabled={!!busy} onClick={() => void go(true)} data-testid="admin-test">{t('admin.testToMe')}</Button>}
        <Button icon="send" loading={busy === 'send'} disabled={!!busy} onClick={() => void go(false)} data-testid="admin-send">{busy === 'send' && busyLabel ? busyLabel : sendLabel}</Button>
      </div>
    </div>
  );
}

function SendTab() {
  const { t } = useSettings();
  const { toast, confirm } = useUi();
  const errText = useErrorText();
  const [list, setList] = useState<Broadcast[]>([]);
  const [subs, setSubs] = useState<number | null>(null);
  const load = useCallback(() => {
    adminApi.broadcasts().then(setList).catch(() => {});
    adminApi.stats(1).then((s) => setSubs(s.subscribers_active)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  // live progress: poll while something is being sent; continue paused ones (long lists go in several runs)
  const running = list.some((b) => b.status === 'sending' || b.status === 'paused');
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      const fresh = await adminApi.broadcasts().catch(() => null);
      if (!fresh) return;
      setList(fresh);
      for (const b of fresh) if (b.status === 'paused') void adminApi.resume(b.id).catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [running]);

  const send = async (m: OutgoingMessage, test: boolean) => {
    try {
      if (test) { await adminApi.test(m); toast(t('admin.testSent'), 'success'); return; }
      const ok = await confirm({ title: t('admin.confirmTitle'), message: t('admin.confirmText', { n: subs ?? '?' }), confirmLabel: t('admin.sendAll') });
      if (!ok) return;
      const b = await adminApi.broadcast(m);
      setList((l) => [b, ...l.filter((x) => x.id !== b.id)]);
      toast(t('admin.broadcastStarted'), 'success');
    } catch (e) { toast(errText(e), 'error'); }
  };

  return (
    <div className="admin-send">
      <section className="glass admin-card">
        <h3><Icon name="send" size={18} /> {t('admin.broadcastTitle')}</h3>
        <p className="muted small">{subs === null ? t('admin.broadcastHint') : t('admin.broadcastWho', { n: subs })}</p>
        <Composer onSend={send} sendLabel={t('admin.sendAll')} />
      </section>
      <h3 className="sub-title">{t('admin.history')}</h3>
      {!list.length && <p className="muted small">{t('admin.historyEmpty')}</p>}
      <ul className="admin-list" data-testid="broadcast-list">
        {list.map((b) => {
          const done = b.sent + b.failed + b.blocked;
          return (
            <li key={b.id} className="glass" data-status={b.status}>
              <div className="admin-row-head">
                <span className={`status-chip is-${b.status}`}>{t(`admin.status.${b.status}` as MessageKey)}</span>
                <small className="muted">{new Date(b.created_at).toLocaleString()}</small>
              </div>
              <p className="admin-msg" dangerouslySetInnerHTML={{ __html: b.text || (b.photo_file_id ? '🖼' : '') }} />
              <ProgressBar value={b.total ? (done / b.total) * 100 : b.status === 'done' ? 100 : 0} done={b.status === 'done'} />
              <small className="muted">{t('admin.progress', { sent: b.sent, total: b.total, blocked: b.blocked, failed: b.failed })}</small>
              {(b.status === 'sending' || b.status === 'paused') && (
                <Button size="sm" variant="ghost" icon="x" onClick={() => void adminApi.cancel(b.id).then(load)}>{t('admin.cancel')}</Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ users
function UsersTab() {
  const { t } = useSettings();
  const { toast } = useUi();
  const errText = useErrorText();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<AdminUser | null>(null);
  useEffect(() => {
    const id = setTimeout(() => { adminApi.users(q.trim()).then((u) => { setUsers(u); setErr(''); }).catch((e) => setErr(errText(e))); }, 250);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="admin-users">
      <label className="search-box"><Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchUsers')} aria-label={t('admin.searchUsers')} data-testid="admin-user-search" />
      </label>
      {err && <ErrorBox text={err} />}
      {!users && !err && <Spinner label={t('common.loading')} />}
      {users && !users.length && <p className="muted small">{t('admin.noUsers')}</p>}
      <ul className="admin-list" data-testid="admin-users">
        {users?.map((u) => (
          <li key={u.id}>
            <button type="button" className="glass user-row" onClick={() => setPick(u)}>
              <span className="user-ava">{(u.display_name || u.email || '?').slice(0, 1).toUpperCase()}</span>
              <span className="user-text">
                <strong>{u.display_name || u.email || t('admin.noName')}</strong>
                <small>{u.telegram_username ? `@${u.telegram_username}` : u.telegram_id ? `Telegram ${u.telegram_id}` : u.email}</small>
              </span>
              <span className="user-meta">
                <b>{u.books}</b><small>{t('admin.booksShort')}</small>
                {u.blocked ? <em className="status-chip is-failed">{t('admin.blocked')}</em> : u.subscribed ? <em className="status-chip is-done">{t('admin.subscribed')}</em> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick?.display_name || pick?.email || ''} size="md">
        {pick && (
          <div className="form">
            <dl className="user-facts">
              <dt>{t('admin.joined')}</dt><dd>{new Date(pick.created_at).toLocaleDateString()}</dd>
              <dt>{t('admin.lastSeen')}</dt><dd>{pick.last_sign_in_at ? new Date(pick.last_sign_in_at).toLocaleString() : '—'}</dd>
              <dt>{t('admin.kpi.books')}</dt><dd>{pick.books}</dd>
              {pick.email && !pick.email.endsWith('.invalid') && <><dt>Email</dt><dd>{pick.email}</dd></>}
              {pick.telegram_id && <><dt>Telegram</dt><dd>{pick.telegram_username ? `@${pick.telegram_username} · ` : ''}{pick.telegram_id}</dd></>}
            </dl>
            {pick.telegram_id ? (
              <>
                <h3 className="sub-title">{t('admin.messageUser')}</h3>
                <Composer allowTest={false} sendLabel={t('admin.sendOne')}
                  onSend={async (m) => { try { await adminApi.messageUser(pick.telegram_id!, m); toast(t('admin.sentOne'), 'success'); } catch (e) { toast(errText(e), 'error'); } }} />
              </>
            ) : <p className="muted small">{t('admin.noTelegram')}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ announcements
function AnnounceTab() {
  const { t } = useSettings();
  const { toast } = useUi();
  const errText = useErrorText();
  const [list, setList] = useState<Announcement[]>([]);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [tone, setTone] = useState<Announcement['tone']>('info');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { adminApi.announcements().then(setList).catch((e) => toast(errText(e), 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const publish = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await adminApi.announce({ text, link_url: link.trim() || undefined, tone, days: Number(days) }); setText(''); setLink(''); toast(t('admin.announced'), 'success'); load(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="admin-announce">
      <section className="glass admin-card form">
        <h3><Icon name="info" size={18} /> {t('admin.announceTitle')}</h3>
        <p className="muted small">{t('admin.announceHint')}</p>
        <textarea className="input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin.announcePh')} data-testid="announce-text" />
        <Field label={t('admin.announceLink')} htmlFor="an-l" hint={t('common.optional')}><input id="an-l" className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></Field>
        <Segmented value={tone} onChange={setTone} label={t('admin.announceTone')} options={[
          { value: 'info', label: t('admin.tone.info') }, { value: 'success', label: t('admin.tone.success') }, { value: 'warning', label: t('admin.tone.warning') },
        ]} />
        <Segmented value={days} onChange={setDays} label={t('admin.announceDays')} options={[
          { value: '1', label: t('admin.days', { n: 1 }) }, { value: '7', label: t('admin.days', { n: 7 }) }, { value: '30', label: t('admin.days', { n: 30 }) }, { value: '0', label: t('admin.forever') },
        ]} />
        {text.trim() && <div className={`announce-bar tone-${tone}`}><Icon name="info" size={18} /><span>{text}</span></div>}
        <Button icon="check" loading={busy} onClick={() => void publish()} data-testid="announce-publish">{t('admin.publish')}</Button>
      </section>
      <ul className="admin-list" data-testid="announce-list">
        {list.map((a) => (
          <li key={a.id} className="glass">
            <div className="admin-row-head">
              <span className={`status-chip ${a.active ? 'is-done' : 'is-cancelled'}`}>{a.active ? t('admin.live') : t('admin.off')}</span>
              <small className="muted">{new Date(a.created_at).toLocaleString()}</small>
            </div>
            <p className="admin-msg">{a.text}</p>
            {a.active && <Button size="sm" variant="ghost" icon="x" onClick={() => void adminApi.announceOff(a.id).then(load)} data-testid="announce-off">{t('admin.turnOff')}</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ feedback inbox
function FeedbackTab() {
  const { t } = useSettings();
  const { toast } = useUi();
  const errText = useErrorText();
  const [list, setList] = useState<FeedbackItem[] | null>(null);
  const [reply, setReply] = useState<FeedbackItem | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(() => { adminApi.feedbackList().then(setList).catch((e) => { setList([]); toast(errText(e), 'error'); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  if (!list) return <Spinner label={t('common.loading')} />;
  return (
    <div>
      {!list.length && <EmptyState icon="help" title={t('admin.noFeedback')} />}
      <ul className="admin-list" data-testid="feedback-list">
        {list.map((f) => (
          <li key={f.id} className={`glass ${f.status === 'new' ? 'is-new' : ''}`}>
            <div className="admin-row-head">
              <strong>{f.name || t('admin.noName')}</strong>
              <span className={`status-chip is-${f.status === 'new' ? 'sending' : f.status === 'answered' ? 'done' : 'cancelled'}`}>{t(`admin.fb.${f.status}` as MessageKey)}</span>
            </div>
            <p className="admin-msg">{f.message}</p>
            <small className="muted">{new Date(f.created_at).toLocaleString()}</small>
            <div className="row-actions">
              {f.status === 'new' && <Button size="sm" variant="ghost" icon="check" onClick={() => void adminApi.feedbackRead(f.id).then(load)}>{t('admin.markRead')}</Button>}
              {f.telegram_id && <Button size="sm" variant="secondary" icon="send" onClick={() => { setReply(f); setText(''); }} data-testid="feedback-reply">{t('admin.reply')}</Button>}
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!reply} onClose={() => setReply(null)} title={t('admin.reply')} size="sm"
        footer={<Button icon="send" onClick={async () => { if (!reply) return; try { await adminApi.feedbackReply(reply.id, text); toast(t('admin.sentOne'), 'success'); setReply(null); load(); } catch (e) { toast(errText(e), 'error'); } }} data-testid="feedback-send">{t('admin.sendOne')}</Button>}>
        {reply && <><blockquote className="fb-quote">{reply.message}</blockquote>
          <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin.replyPh')} data-autofocus data-testid="feedback-reply-text" /></>}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ audit log
function AuditTab() {
  const { t } = useSettings();
  const [list, setList] = useState<AuditItem[] | null>(null);
  useEffect(() => { adminApi.audit().then(setList).catch(() => setList([])); }, []);
  if (!list) return <Spinner label={t('common.loading')} />;
  if (!list.length) return <p className="muted small">{t('admin.auditEmpty')}</p>;
  return (
    <ul className="admin-list audit-list" data-testid="audit-list">
      {list.map((a, i) => (
        <li key={a.id ?? i} className="glass">
          <strong>{t(`admin.act.${a.action}` as MessageKey) === `admin.act.${a.action}` ? a.action : t(`admin.act.${a.action}` as MessageKey)}</strong>
          <small className="muted">{new Date(a.created_at).toLocaleString()}</small>
        </li>
      ))}
    </ul>
  );
}

function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useSettings();
  return (
    <div className="wipe-error" role="alert"><Icon name="alert" size={16} /> <span>{text}</span>
      {onRetry && <button type="button" className="link-btn" onClick={onRetry}>{t('common.retry')}</button>}</div>
  );
}
