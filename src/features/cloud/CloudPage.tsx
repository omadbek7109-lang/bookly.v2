import { useEffect, useMemo, useState } from 'react';
import { useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon, type IconName } from '../../components/Icon';
import { Button, EmptyState, IconButton, ListRow, PageHeader, Sheet, Spinner, Switch } from '../../components/ui';
import { friendlyError } from '../../services/cloud/client';
import type { BookSyncStatus, StatusEntry } from '../../services/cloud/sync-core';
import { formatBytes } from '../../services/export/prepare';
import { AuthSheet } from './AuthSheet';
import { useCloud } from './CloudContext';
import { accountLabel } from './AccountCard';

export const STATUS_LABEL: Record<BookSyncStatus, { label: string; icon: IconName; tone: string }> = {
  'local-only': { label: 'Faqat shu qurilmada', icon: 'monitor', tone: 'muted' },
  synced: { label: 'Sinxron', icon: 'check', tone: 'ok' },
  'local-changed': { label: 'Yuklanishi kerak', icon: 'upload', tone: 'warn' },
  'remote-changed': { label: 'Cloud’da yangilangan', icon: 'download', tone: 'info' },
  conflict: { label: 'Konflikt', icon: 'alert', tone: 'danger' },
  'cloud-only': { label: 'Faqat Cloud’da', icon: 'globe', tone: 'info' },
};

export function fmtTime(ms: number | null | undefined) {
  if (!ms) return 'hali yo‘q';
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `bugun ${d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('uz', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function PhaseChip() {
  const cloud = useCloud();
  const s = cloud.snapshot;
  const conflicts = s.entries.filter((e) => e.status === 'conflict').length;
  const pending = s.entries.filter((e) => e.status === 'local-only' || e.status === 'local-changed').length;
  let label = 'Sinxron'; let tone = 'ok'; let icon: IconName = 'check';
  if (!cloud.online || s.phase === 'offline') { label = 'Oflayn — internet qaytganda davom etadi'; tone = 'muted'; icon = 'globe'; }
  else if (s.phase === 'syncing') { label = s.progress?.total ? `Sinxronlanmoqda ${s.progress.done}/${s.progress.total}` : 'Sinxronlanmoqda…'; tone = 'info'; icon = 'refresh'; }
  else if (s.phase === 'error') { label = 'Xatolik — qayta urinib ko‘ring'; tone = 'danger'; icon = 'alert'; }
  else if (conflicts) { label = `${conflicts} ta konflikt — tanlov kerak`; tone = 'danger'; icon = 'alert'; }
  else if (pending) { label = `${pending} ta kitob yuklanmagan`; tone = 'warn'; icon = 'upload'; }
  return <span className={`sync-chip tone-${tone} ${s.phase === 'syncing' ? 'is-spinning' : ''}`} role="status" data-testid="sync-chip"><Icon name={icon} size={14} /> {label}</span>;
}

export default function CloudPage() {
  const cloud = useCloud();
  const { settings, update } = useSettings();
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
    return <div className="page"><PageHeader title="Cloud zaxira" onBack={() => back(routes.profile())} /><EmptyState icon="globe" title="Cloud sozlanmagan" text="Bu nashrda Supabase manzili ko‘rsatilmagan. Ilova lokal rejimda to‘liq ishlaydi." /></div>;
  }

  if (!cloud.user) {
    return (
      <div className="page cloud-page">
        <PageHeader title="Cloud zaxira" subtitle="Ixtiyoriy" onBack={() => back(routes.profile())} />
        <section className="cloud-hero glass">
          <span className="quick-icon tone-indigo"><Icon name="globe" size={24} /></span>
          <div>
            <h2>Kitoblaringiz har doim yoningizda</h2>
            <p className="muted">Hisob ochsangiz, kitoblar va rasmlar xavfsiz Cloud’ga zaxiralanadi va telefon, kompyuter yoki Telegram’da bir xil ko‘rinadi. Hisobsiz ham hamma narsa shu qurilmada ishlayveradi.</p>
          </div>
          <ul className="cloud-points">
            <li><Icon name="shield" size={16} /> Kitoblaringizni faqat siz ko‘rasiz</li>
            <li><Icon name="refresh" size={16} /> Qurilmalararo sinxronlash</li>
            <li><Icon name="bookOpen" size={16} /> Lokal kitoblar o‘chirilmaydi</li>
          </ul>
          <div className="row-actions wrap">
            <Button variant="secondary" onClick={() => setAuth('login')} data-testid="cloud-login">Kirish</Button>
            <Button icon="user" onClick={() => setAuth('signup')} data-testid="cloud-signup">Hisob yaratish</Button>
          </div>
        </section>
        <AuthSheet open={!!auth} initial={auth ?? 'login'} onClose={() => setAuth(null)} />
      </div>
    );
  }

  return (
    <div className="page cloud-page">
      <PageHeader title="Cloud zaxira" subtitle={accountLabel(cloud.user) ?? undefined} onBack={() => back(routes.profile())}
        actions={<IconButton icon="refresh" label="Holatni yangilash" onClick={() => void run('refresh', () => cloud.engine!.refreshStatus())} />} />

      <section className="cloud-summary glass" data-testid="cloud-summary">
        <PhaseChip />
        <dl className="cloud-facts">
          <div><dt>Oxirgi zaxira</dt><dd data-testid="last-backup">{fmtTime(s.lastBackupAt)}</dd></div>
          <div><dt>Oxirgi sinxron</dt><dd>{fmtTime(s.lastSyncAt)}</dd></div>
          <div><dt>Cloud’dagi kitoblar</dt><dd>{usage?.books ?? '—'}</dd></div>
          <div><dt>Fayllar hajmi</dt><dd>{usage ? `${formatBytes(usage.asset_bytes)} · ${usage.assets} ta` : '—'}</dd></div>
        </dl>
        <div className="row-actions wrap">
          <Button icon="upload" loading={busy === 'backup'} disabled={!!busy || s.phase === 'syncing'} data-testid="backup-now"
            onClick={() => void run('backup', async () => { const r = await cloud.engine!.sync('backup'); toast(`${r.uploaded} ta kitob zaxiralandi${r.conflicts ? `, ${r.conflicts} ta konflikt` : ''}`, r.conflicts ? 'info' : 'success'); })}>Hozir zaxiralash</Button>
          <Button variant="secondary" icon="download" loading={busy === 'restore'} disabled={!!busy || s.phase === 'syncing'} data-testid="restore-all"
            onClick={() => void run('restore', async () => { const r = await cloud.engine!.sync('restore'); toast(`${r.downloaded} ta kitob tiklandi`, 'success'); })}>Cloud’dan tiklash</Button>
        </div>
        <Switch id="auto-sync" label="Avtomatik sinxronlash" checked={settings.cloudAutoSync} onChange={(v) => { update({ cloudAutoSync: v }); if (v) void cloud.sync(); }} />
        {s.message && s.phase === 'error' && <p className="field-error">{s.message}</p>}
      </section>

      <h2 className="sub-title">Kitoblar</h2>
      {s.phase === 'syncing' && !s.entries.length ? <Spinner label="Yuklanmoqda…" /> : !groups.length ? (
        <EmptyState icon="bookOpen" title="Hali kitob yo‘q" text="Kitob yarating — u avtomatik Cloud’ga zaxiralanadi." />
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
                    <small className={`status-text tone-${st.tone}`}><Icon name={st.icon} size={13} /> {st.label}</small>
                  </span>
                </div>
                <div className="cloud-actions">
                  {e.status === 'conflict' && <Button size="sm" variant="danger" onClick={() => setConflict(e)} data-testid="resolve">Tanlash</Button>}
                  {(e.status === 'local-only' || e.status === 'local-changed') && <IconButton icon="upload" label="Cloud’ga yuklash" disabled={!!busy} onClick={() => void run(e.localId, () => cloud.engine!.sync('backup', [e.localId]), 'Yuklandi')} data-testid="row-upload" />}
                  {(e.status === 'cloud-only' || e.status === 'remote-changed') && <IconButton icon="download" label="Qurilmaga tiklash" disabled={!!busy} onClick={() => void run(e.localId, () => cloud.engine!.sync('restore', [e.localId]), 'Tiklandi')} data-testid="row-restore" />}
                  {e.local && <IconButton icon="edit" label="Ochish" onClick={() => navigate(routes.editor(e.localId))} />}
                  {e.remote && (
                    <IconButton icon="trash" label="Cloud nusxasini o‘chirish" disabled={!!busy} data-testid="row-remove-cloud"
                      onClick={async () => {
                        if (!(await confirm({ title: 'Cloud nusxasini o‘chirish', message: e.local ? 'Kitob Cloud’dan o‘chiriladi, lekin shu qurilmada qoladi.' : 'Bu kitob faqat Cloud’da. O‘chirilsa, uni qaytarib bo‘lmaydi.', confirmLabel: 'O‘chirish', danger: true }))) return;
                        await run(e.localId, () => cloud.engine!.removeFromCloud(e.localId), 'Cloud nusxasi o‘chirildi');
                      }} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="list glass">
        <ListRow icon="trash" title="Cloud joyini tozalash" subtitle="Hech bir kitob ishlatmayotgan fayllarni o‘chirish" testId="clean-orphans"
          onClick={() => void run('clean', async () => {
            const rows = await cloud.engine!.orphanAssets();
            if (!rows.length) { toast('Keraksiz fayl yo‘q', 'success'); return; }
            const bytes = rows.reduce((n, r) => n + r.size_bytes, 0);
            if (!(await confirm({ title: 'Cloud joyini tozalash', message: `${rows.length} ta ishlatilmayotgan fayl (${formatBytes(bytes)}) o‘chiriladi. Kitoblaringizga ta’sir qilmaydi.`, confirmLabel: 'Tozalash', danger: true }))) return;
            const n = await cloud.engine!.cleanOrphans(rows);
            toast(`${n} ta fayl o‘chirildi`, 'success');
          })} />
        <ListRow icon="arrowLeft" danger title="Hisobdan chiqish" subtitle="Kitoblar shu qurilmada qoladi" testId="logout"
          onClick={async () => {
            if (!(await confirm({ title: 'Hisobdan chiqish', message: 'Shu qurilmadagi kitoblar o‘chirilmaydi. Keyin qayta kirib sinxronlashni davom ettirishingiz mumkin.', confirmLabel: 'Chiqish' }))) return;
            await cloud.signOut();
            toast('Hisobdan chiqdingiz', 'success');
          }} />
      </div>

      <ConflictSheet entry={conflict} onClose={() => setConflict(null)} />
    </div>
  );
}

function ConflictSheet({ entry, onClose }: { entry: StatusEntry | null; onClose: () => void }) {
  const cloud = useCloud();
  const { toast } = useUi();
  const [busy, setBusy] = useState<string | null>(null);
  if (!entry) return null;
  const pick = async (choice: 'device' | 'cloud' | 'both') => {
    setBusy(choice);
    try {
      await cloud.engine!.resolve(entry.localId, choice);
      toast(choice === 'both' ? 'Ikkala versiya saqlandi' : choice === 'device' ? 'Shu qurilma versiyasi Cloud’ga yozildi' : 'Cloud versiyasi olindi', 'success');
      onClose();
    } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(null); }
  };
  return (
    <Sheet open onClose={onClose} title="Qaysi versiyani saqlaymiz?" size="sm">
      <p className="muted small">“{entry.local?.title ?? entry.title}” kitobi bir vaqtda shu qurilmada ham, boshqa qurilmada ham o‘zgartirilgan. Avtomatik hech narsa o‘chirilmadi.</p>
      <dl className="cloud-facts">
        <div><dt>Shu qurilma</dt><dd>{fmtTime(entry.local?.updatedAt)}</dd></div>
        <div><dt>Cloud</dt><dd>{entry.remote ? fmtTime(Date.parse(entry.remote.updated_at)) : '—'}</dd></div>
      </dl>
      <div className="list">
        <ListRow icon="copy" title="Ikkalasini saqlash (tavsiya)" subtitle="Shu qurilma versiyasi alohida kitob bo‘lib qoladi" onClick={() => void pick('both')} testId="conflict-both" right={busy === 'both' ? <Spinner /> : undefined} />
        <ListRow icon="monitor" title="Shu qurilma versiyasi" subtitle="Cloud nusxasi shu bilan almashtiriladi" onClick={() => void pick('device')} testId="conflict-device" right={busy === 'device' ? <Spinner /> : undefined} />
        <ListRow icon="globe" title="Cloud versiyasi" subtitle="Shu qurilmadagi o‘zgarishlar almashtiriladi" onClick={() => void pick('cloud')} testId="conflict-cloud" right={busy === 'cloud' ? <Spinner /> : undefined} />
      </div>
    </Sheet>
  );
}
