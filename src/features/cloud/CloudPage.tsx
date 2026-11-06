import { useEffect, useMemo, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, IconButton, ListRow, PageHeader, Sheet, Spinner, Switch } from '../../components/ui';
import { friendlyError } from '../../services/cloud/client';
import type { BookSyncStatus, StatusEntry } from '../../services/cloud/sync-core';
import { formatBytes } from '../../services/export/prepare';
import { currentLocale, tr, type MessageKey } from '../../i18n';
import { AuthSheet } from './AuthSheet';
import { useCloud } from './CloudContext';
import { accountLabel } from './AccountCard';

export const STATUS_LABEL: Record<BookSyncStatus, { label: MessageKey; icon: IconName; tone: string }> = {
  'local-only': { label: 'cloud.status.localOnly', icon: 'monitor', tone: 'muted' },
  synced: { label: 'cloud.status.synced', icon: 'check', tone: 'ok' },
  'local-changed': { label: 'cloud.status.localChanged', icon: 'upload', tone: 'warn' },
  'remote-changed': { label: 'cloud.status.remoteChanged', icon: 'download', tone: 'info' },
  conflict: { label: 'cloud.status.conflict', icon: 'alert', tone: 'danger' },
  'cloud-only': { label: 'cloud.status.cloudOnly', icon: 'globe', tone: 'info' },
};

const INTL: Record<string, string> = { uz: 'uz-Latn', ru: 'ru', en: 'en' };

export function fmtTime(ms: number | null | undefined) {
  if (!ms) return tr('cloud.never');
  const d = new Date(ms);
  const loc = INTL[currentLocale()] ?? 'uz-Latn';
  const today = new Date().toDateString() === d.toDateString();
  return today ? tr('cloud.today', { time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) }) : d.toLocaleString(loc, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function PhaseChip() {
  const cloud = useCloud();
  const { t } = useSettings();
  const s = cloud.snapshot;
  const conflicts = s.entries.filter((e) => e.status === 'conflict').length;
  const pending = s.entries.filter((e) => e.status === 'local-only' || e.status === 'local-changed').length;
  let label = t('cloud.phase.synced'); let tone = 'ok'; let icon: IconName = 'check';
  if (!cloud.online || s.phase === 'offline') { label = t('cloud.phase.offline'); tone = 'muted'; icon = 'globe'; }
  else if (s.phase === 'syncing') { label = s.progress?.total ? t('cloud.phase.syncingN', { done: s.progress.done, total: s.progress.total }) : t('cloud.phase.syncing'); tone = 'info'; icon = 'refresh'; }
  else if (s.phase === 'error') { label = t('cloud.phase.error'); tone = 'danger'; icon = 'alert'; }
  else if (conflicts) { label = t('cloud.phase.conflicts', { n: conflicts }); tone = 'danger'; icon = 'alert'; }
  else if (pending) { label = t('cloud.phase.pending', { n: pending }); tone = 'warn'; icon = 'upload'; }
  return <span className={`sync-chip tone-${tone} ${s.phase === 'syncing' ? 'is-spinning' : ''}`} role="status" data-testid="sync-chip"><Icon name={icon} size={14} /> {label}</span>;
}

export default function CloudPage() {
  const cloud = useCloud();
  const { settings, update, t } = useSettings();
  const { toast, confirm } = useUi();
  const [auth, setAuth] = useState<null | 'login' | 'signup'>(null);
  const [usage, setUsage] = useState<{ books: number; assets: number; asset_bytes: number } | null>(null);
  const [conflict, setConflict] = useState<StatusEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const s = cloud.snapshot;

  useEffect(() => {
    if (!cloud.user || !cloud.engine) return;
    void cloud.engine.refreshStatus().catch(() => {});
  }, [cloud.user, cloud.engine]);

  useEffect(() => {
    if (!cloud.user || !cloud.engine || s.phase === 'syncing') return;
    cloud.engine.usage().then((u) => u && setUsage(u)).catch(() => {});
  }, [cloud.user, cloud.engine, s.phase, s.lastSyncAt]);

  const groups = useMemo(() => {
    const order: BookSyncStatus[] = ['conflict', 'local-changed', 'local-only', 'remote-changed', 'cloud-only', 'synced'];
    return [...s.entries].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [s.entries]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast(done, 'success'); } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(null); }
  };

  if (!cloud.available) {
    return <div className="page"><PageHeader title={t('backup.title')} onBack={() => back(routes.profile())} /><EmptyState icon="globe" title={t('cloud.notConfigured')} text={t('cloud.notConfiguredText')} /></div>;
  }

  if (!cloud.user) {
    return (
      <div className="page cloud-page">
        <PageHeader title={t('backup.title')} subtitle={t('cloud.optional')} onBack={() => back(routes.profile())} />
        <section className="cloud-hero glass">
          <span className="quick-icon tone-indigo"><Icon name="globe" size={24} /></span>
          <div>
            <h2>{t('cloud.hero.title')}</h2>
            <p className="muted">{t('cloud.hero.text')}</p>
          </div>
          <ul className="cloud-points">
            <li><Icon name="shield" size={16} /> {t('cloud.hero.p1')}</li>
            <li><Icon name="refresh" size={16} /> {t('cloud.hero.p2')}</li>
            <li><Icon name="bookOpen" size={16} /> {t('cloud.hero.p3')}</li>
          </ul>
          <div className="row-actions wrap">
            <Button variant="secondary" onClick={() => setAuth('login')} data-testid="cloud-login">{t('auth.tab.login')}</Button>
            <Button icon="user" onClick={() => setAuth('signup')} data-testid="cloud-signup">{t('auth.title.signup')}</Button>
          </div>
        </section>
        <AuthSheet open={!!auth} initial={auth ?? 'login'} onClose={() => setAuth(null)} />
      </div>
    );
  }

  return (
    <div className="page cloud-page">
      <PageHeader title={t('backup.title')} subtitle={accountLabel(cloud.user) ?? undefined} onBack={() => back(routes.profile())}
        actions={<IconButton icon="refresh" label={t('cloud.refresh')} onClick={() => void run('refresh', () => cloud.engine!.refreshStatus())} />} />

      <section className="cloud-summary glass" data-testid="cloud-summary">
        <PhaseChip />
        <dl className="cloud-facts">
          <div><dt>{t('cloud.lastBackup')}</dt><dd data-testid="last-backup">{fmtTime(s.lastBackupAt)}</dd></div>
          <div><dt>{t('cloud.lastSync')}</dt><dd>{fmtTime(s.lastSyncAt)}</dd></div>
          <div><dt>{t('cloud.booksInCloud')}</dt><dd>{usage?.books ?? '—'}</dd></div>
          <div><dt>{t('cloud.filesSize')}</dt><dd>{usage ? t('cloud.filesValue', { size: formatBytes(usage.asset_bytes), n: usage.assets }) : '—'}</dd></div>
        </dl>
        <div className="row-actions wrap">
          <Button icon="upload" loading={busy === 'backup'} disabled={!!busy || s.phase === 'syncing'} data-testid="backup-now"
            onClick={() => void run('backup', async () => { const r = await cloud.engine!.sync('backup'); toast(r.conflicts ? t('cloud.backedUpConflicts', { n: r.uploaded, c: r.conflicts }) : t('cloud.backedUp', { n: r.uploaded }), r.conflicts ? 'info' : 'success'); })}>{t('backup.now')}</Button>
          <Button variant="secondary" icon="download" loading={busy === 'restore'} disabled={!!busy || s.phase === 'syncing'} data-testid="restore-all"
            onClick={() => void run('restore', async () => { const r = await cloud.engine!.sync('restore'); toast(t('profile.restoreDone', { n: r.downloaded }), 'success'); })}>{t('cloud.restoreAll')}</Button>
        </div>
        <Switch id="auto-sync" label={t('cloud.autoSync')} checked={settings.cloudAutoSync} onChange={(v) => { update({ cloudAutoSync: v }); if (v) void cloud.sync(); }} />
        {s.message && s.phase === 'error' && <p className="field-error">{s.message}</p>}
      </section>

      <h2 className="sub-title">{t('home.stats.books')}</h2>
      {s.phase === 'syncing' && !s.entries.length ? <Spinner label={t('common.loading')} /> : !groups.length ? (
        <EmptyState icon="bookOpen" title={t('cloud.empty')} text={t('cloud.emptyText')} />
      ) : (
        <ul className="book-list" data-testid="cloud-list">
          {groups.map((e) => {
            const st = STATUS_LABEL[e.status];
            return (
              <li key={e.localId} className="book-row glass" data-testid="cloud-row" data-status={e.status}>
                <div className="book-row-main">
                  <BookCover cover={(e.local?.cover ?? e.remote?.cover)!} width={46} />
                  <span className="book-row-text">
                    <strong>{e.local?.title ?? e.title}</strong>
                    <small className={`status-text tone-${st.tone}`}><Icon name={st.icon} size={13} /> {t(st.label)}</small>
                  </span>
                </div>
                <div className="cloud-actions">
                  {e.status === 'conflict' && <Button size="sm" variant="danger" onClick={() => setConflict(e)} data-testid="resolve">{t('cloud.choose')}</Button>}
                  {(e.status === 'local-only' || e.status === 'local-changed') && <IconButton icon="upload" label={t('cloud.upload')} disabled={!!busy} onClick={() => void run(e.localId, () => cloud.engine!.sync('backup', [e.localId]), t('cloud.uploaded'))} data-testid="row-upload" />}
                  {(e.status === 'cloud-only' || e.status === 'remote-changed') && <IconButton icon="download" label={t('cloud.restoreOne')} disabled={!!busy} onClick={() => void run(e.localId, () => cloud.engine!.sync('restore', [e.localId]), t('cloud.restored'))} data-testid="row-restore" />}
                  {e.local && <IconButton icon="edit" label={t('common.open')} onClick={() => navigate(routes.editor(e.localId))} />}
                  {e.remote && (
                    <IconButton icon="trash" label={t('cloud.removeCopy')} disabled={!!busy} data-testid="row-remove-cloud"
                      onClick={async () => {
                        if (!(await confirm({ title: t('cloud.removeCopy'), message: e.local ? t('cloud.removeCopyLocal') : t('cloud.removeCopyOnly'), confirmLabel: t('common.delete'), danger: true }))) return;
                        await run(e.localId, () => cloud.engine!.removeFromCloud(e.localId), t('cloud.copyRemoved'));
                      }} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="list glass">
        <ListRow icon="trash" title={t('cloud.clean')} subtitle={t('cloud.cleanSub')} testId="clean-orphans"
          onClick={() => void run('clean', async () => {
            const rows = await cloud.engine!.orphanAssets();
            if (!rows.length) { toast(t('cloud.cleanNone'), 'success'); return; }
            const bytes = rows.reduce((n, r) => n + r.size_bytes, 0);
            if (!(await confirm({ title: t('cloud.clean'), message: t('cloud.cleanConfirm', { n: rows.length, size: formatBytes(bytes) }), confirmLabel: t('cloud.cleanBtn'), danger: true }))) return;
            const n = await cloud.engine!.cleanOrphans(rows);
            toast(t('cloud.cleaned', { n }), 'success');
          })} />
        <ListRow icon="arrowLeft" danger title={t('cloud.logout')} subtitle={t('cloud.logoutSub')} testId="logout"
          onClick={async () => {
            if (!(await confirm({ title: t('cloud.logout'), message: t('cloud.logoutConfirm'), confirmLabel: t('cloud.logoutBtn') }))) return;
            await cloud.signOut();
            toast(t('cloud.loggedOut'), 'success');
          }} />
      </div>

      <ConflictSheet entry={conflict} onClose={() => setConflict(null)} />
    </div>
  );
}

function ConflictSheet({ entry, onClose }: { entry: StatusEntry | null; onClose: () => void }) {
  const cloud = useCloud();
  const { toast } = useUi();
  const { t } = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  if (!entry) return null;
  const pick = async (choice: 'device' | 'cloud' | 'both') => {
    setBusy(choice);
    try {
      await cloud.engine!.resolve(entry.localId, choice);
      toast(choice === 'both' ? t('conflict.keptBoth') : choice === 'device' ? t('conflict.keptDevice') : t('conflict.keptCloud'), 'success');
      onClose();
    } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(null); }
  };
  return (
    <Sheet open onClose={onClose} title={t('conflict.title')} size="sm">
      <p className="muted small">{t('conflict.text', { title: entry.local?.title ?? entry.title })}</p>
      <dl className="cloud-facts">
        <div><dt>{t('conflict.device')}</dt><dd>{fmtTime(entry.local?.updatedAt)}</dd></div>
        <div><dt>{t('conflict.cloud')}</dt><dd>{entry.remote ? fmtTime(Date.parse(entry.remote.updated_at)) : '—'}</dd></div>
      </dl>
      <div className="list">
        <ListRow icon="copy"  title={t('conflict.both')} subtitle={t('conflict.bothSub')} onClick={() => void pick('both')} testId="conflict-both" right={busy === 'both' ? <Spinner /> : undefined} />
        <ListRow icon="monitor" title={t('conflict.deviceVer')} subtitle={t('conflict.deviceVerSub')} onClick={() => void pick('device')} testId="conflict-device" right={busy === 'device' ? <Spinner /> : undefined} />
        <ListRow icon="globe" title={t('conflict.cloudVer')} subtitle={t('conflict.cloudVerSub')} onClick={() => void pick('cloud')} testId="conflict-cloud" right={busy === 'cloud' ? <Spinner /> : undefined} />
      </div>
    </Sheet>
  );
}
