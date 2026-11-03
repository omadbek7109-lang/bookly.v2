import { useEffect, useRef, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { replayIntro } from '../../app/intro';
import { Icon } from '../../components/Icon';
import { Button, Field, ListRow, PageHeader, Segmented, Sheet, Switch } from '../../components/ui';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { LOCALES } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { bookWordCount } from '../../models/book';
import { clearAllData, createBackup, restoreBackup } from '../../services/storage/backup';
import { storageEstimate } from '../../services/storage/db';
import { assets } from '../../services/storage/repository';
import { downloadBlob, formatBytes } from '../../services/export/prepare';
import type { ExportFormat } from '../../services/storage/settings';

declare const __BOOKLY_VERSION__: string;

export default function ProfilePage() {
  const { t, settings, update } = useSettings();
  const { books } = useLibrary();
  const { toast, confirm } = useUi();
  const [usage, setUsage] = useState<number | null>(null);
  const [info, setInfo] = useState<null | 'about' | 'privacy'>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const avatar = useAssetUrl(settings.profile.avatarAssetId);
  const live = books.filter((b) => !b.deletedAt);

  useEffect(() => { void storageEstimate().then(setUsage); }, [books.length]);

  const setAvatar = async (f?: File) => {
    if (!f || !f.type.startsWith('image/')) return;
    const a = await assets.put(f, f.name);
    update({ profile: { ...settings.profile, avatarAssetId: a.id } });
  };

  const backup = async () => {
    const blob = await createBackup();
    downloadBlob(blob, `bookly-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast(t('profile.backupDone'), 'success');
  };

  const restore = async (f?: File) => {
    if (!f) return;
    try { const n = await restoreBackup(f); toast(t('profile.restoreDone', { n }), 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  const wipe = async () => {
    if (!(await confirm({ title: t('profile.clearAll'), message: t('profile.confirmClear'), confirmLabel: t('common.delete'), danger: true }))) return;
    await clearAllData();
    toast(t('profile.cleared'), 'success');
    setTimeout(() => location.reload(), 600);
  };

  const initials = (settings.profile.name || 'B').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="page profile">
      <PageHeader title={t('profile.title')} />
      <section className="profile-card glass">
        <button type="button" className="avatar" onClick={() => avatarInput.current?.click()} aria-label={t('profile.changeAvatar')}>
          {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
          <span className="avatar-edit"><Icon name="edit" size={14} /></span>
        </button>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { void setAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="profile-main">
          <input className="input input-name" value={settings.profile.name} placeholder={t('profile.namePh')} aria-label={t('profile.name')}
            onChange={(e) => update({ profile: { ...settings.profile, name: e.target.value } })} data-testid="profile-name" />
          <span className="chip"><Icon name="user" size={14} /> {t('profile.demo')}</span>
        </div>
        {settings.profile.avatarAssetId && <Button size="sm" variant="ghost" onClick={() => update({ profile: { ...settings.profile, avatarAssetId: null } })}>{t('profile.removeAvatar')}</Button>}
      </section>
      <p className="demo-note"><Icon name="shield" size={16} /> {t('profile.demoNote')}</p>

      <div className="stats-grid">
        <div className="stat glass"><strong>{live.length}</strong><span>{t('home.stats.books')}</span></div>
        <div className="stat glass"><strong>{live.reduce((n, b) => n + b.chapters.length, 0)}</strong><span>{t('home.stats.chapters')}</span></div>
        <div className="stat glass"><strong>{live.reduce((n, b) => n + bookWordCount(b), 0).toLocaleString()}</strong><span>{t('home.stats.words')}</span></div>
        <div className="stat glass"><strong>{live.filter((b) => b.status === 'completed').length}</strong><span>{t('home.stats.done')}</span></div>
      </div>

      <h2 className="sub-title">{t('profile.settings')}</h2>
      <div className="glass options-card">
        <Field label={t('profile.language')} hint={t('profile.languageBeta')}>
          <Segmented value={settings.locale} label={t('profile.language')} onChange={(v) => update({ locale: v })} options={LOCALES.map((l) => ({ value: l, label: t(`lang.${l}` as MessageKey) }))} />
        </Field>
        <Field label={t('profile.theme')}>
          <Segmented value={settings.theme} label={t('profile.theme')} onChange={(v) => update({ theme: v })} options={[
            { value: 'system', label: t('profile.theme.system'), icon: 'monitor' }, { value: 'light', label: t('profile.theme.light'), icon: 'sun' }, { value: 'dark', label: t('profile.theme.dark'), icon: 'moon' },
          ]} />
        </Field>
        <Switch id="rm" label={t('profile.reducedMotion')} checked={settings.reducedMotion} onChange={(v) => update({ reducedMotion: v })} />
      </div>

      <h2 className="sub-title">{t('profile.exportDefaults')}</h2>
      <div className="glass options-card">
        <Field label={t('profile.defaultFormat')}>
          <Segmented value={settings.defaultExport} label={t('profile.defaultFormat')} onChange={(v) => update({ defaultExport: v as ExportFormat })}
            options={(['pdf', 'epub', 'docx', 'pptx'] as const).map((f) => ({ value: f, label: f.toUpperCase() }))} />
        </Field>
        <Field label={t('export.pageSize')}>
          <Segmented value={settings.pdfPageSize} label={t('export.pageSize')} onChange={(v) => update({ pdfPageSize: v })} options={[{ value: 'A5', label: 'A5' }, { value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]} />
        </Field>
        <Switch id="dc" label={t('export.includeCover')} checked={settings.exportIncludeCover} onChange={(v) => update({ exportIncludeCover: v })} />
        <Switch id="dt" label={t('export.includeToc')} checked={settings.exportIncludeToc} onChange={(v) => update({ exportIncludeToc: v })} />
      </div>

      <h2 className="sub-title">{t('profile.data')}</h2>
      <div className="list glass">
        {usage !== null && <ListRow icon="folder" title={t('profile.storageUsed', { size: formatBytes(usage) })} />}
        <ListRow icon="download" title={t('profile.backup')} onClick={() => void backup()} testId="backup" />
        <ListRow icon="upload" title={t('profile.restoreBackup')} onClick={() => restoreInput.current?.click()} />
        <ListRow icon="play" title={t('profile.replayIntro')} onClick={replayIntro} testId="replay-intro" />
        <ListRow icon="trash" danger title={t('profile.clearAll')} onClick={() => void wipe()} testId="clear-all" />
      </div>
      <input ref={restoreInput} type="file" accept="application/json,.json" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="list glass">
        <ListRow icon="info" title={t('profile.about')} onClick={() => setInfo('about')} />
        <ListRow icon="shield" title={t('profile.privacy')} onClick={() => setInfo('privacy')} />
      </div>
      <p className="muted small center">{t('profile.version', { v: __BOOKLY_VERSION__ })}</p>

      <Sheet open={!!info} onClose={() => setInfo(null)} title={info === 'about' ? t('profile.about') : t('profile.privacy')} size="sm">
        <p>{info === 'about' ? t('profile.aboutText') : t('profile.privacyText')}</p>
        {info === 'about' && <p className="muted small">{t('profile.version', { v: __BOOKLY_VERSION__ })} · {t('app.slogan')}</p>}
      </Sheet>
    </div>
  );
}
