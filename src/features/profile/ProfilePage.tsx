import { useEffect, useRef, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Button, Field, ListRow, PageHeader, Segmented, Sheet, Switch } from '../../components/ui';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import type { Locale } from '../../i18n';
import { isSingleText } from '../../models/book';
import { clearAllData, createBackup, restoreBackup } from '../../services/storage/backup';
import { storageEstimate } from '../../services/storage/db';
import { assets } from '../../services/storage/repository';
import { downloadBlob, formatBytes } from '../../services/export/prepare';
import type { ExportFormat } from '../../services/storage/settings';
import { telegramUserName } from '../../services/platform/telegram';
import { AccountCard, isTelegramAccount, useAccountStatus } from '../cloud/AccountCard';
import { useCloud } from '../cloud/CloudContext';

declare const __BOOKLY_VERSION__: string;

/** Language names are shown in their own language so anyone can find theirs. */
const LANG_NAMES: Record<Locale, string> = { uz: 'O‘zbekcha', ru: 'Русский', en: 'English' };
const CONFIRM_WORD = 'O‘CHIRISH';

export default function ProfilePage() {
  const { t, settings, update } = useSettings();
  const { books } = useLibrary();
  const { toast, prompt } = useUi();
  const cloud = useCloud();
  const status = useAccountStatus();
  const [usage, setUsage] = useState<number | null>(null);
  const [sheet, setSheet] = useState<null | 'edit' | 'about' | 'privacy' | 'help'>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const avatar = useAssetUrl(settings.profile.avatarAssetId);
  const live = books.filter((b) => !b.deletedAt);
  const chapterCount = live.filter((b) => !isSingleText(b)).reduce((n, b) => n + b.chapters.length, 0);

  // Name: what the person typed, otherwise their Telegram name (shown once, not repeated elsewhere).
  const tgName = cloud.user && isTelegramAccount(cloud.user) ? String(cloud.user.user_metadata?.display_name ?? '') : (telegramUserName() ?? '');
  const name = settings.profile.name.trim() || tgName || t('profile.namePh');

  useEffect(() => { void storageEstimate().then(setUsage); }, [books.length]);

  const setAvatar = async (f?: File) => {
    if (!f || !f.type.startsWith('image/')) return;
    const a = await assets.put(f, f.name);
    update({ profile: { ...settings.profile, avatarAssetId: a.id } });
  };

  const backup = async () => {
    const blob = await createBackup();
    const r = await downloadBlob(blob, `bookly-zaxira-${new Date().toISOString().slice(0, 10)}.json`);
    if (r === 'saved') toast(t('profile.backupDone'), 'success');
  };

  const restore = async (f?: File) => {
    if (!f) return;
    try { const n = await restoreBackup(f); toast(t('profile.restoreDone', { n }), 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  // Deleting everything needs the word typed exactly — a single tap can never wipe the library.
  const wipe = async () => {
    const typed = await prompt({
      title: 'Barcha ma’lumotlarni o‘chirish',
      message: `Shu qurilmadagi barcha kitoblar, rasmlar va sozlamalar o‘chadi. Bu amalni qaytarib bo‘lmaydi. Tasdiqlash uchun ${CONFIRM_WORD} deb yozing.`,
      placeholder: CONFIRM_WORD,
      confirmLabel: 'O‘chirish',
      danger: true,
    });
    if (typed === null) return;
    const norm = (x: string) => x.trim().toUpperCase().replace(/[‘’ʻʼ`']/g, "'");
    if (norm(typed) !== norm(CONFIRM_WORD)) {
      toast('So‘z mos kelmadi — hech narsa o‘chirilmadi', 'error');
      return;
    }
    await clearAllData();
    toast(t('profile.cleared'), 'success');
    setTimeout(() => location.reload(), 600);
  };

  const initials = name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || 'B';
  const exportSummary = [settings.defaultExport.toUpperCase(), settings.pdfPageSize, settings.exportIncludeCover ? 'muqova' : null, settings.exportIncludeToc ? 'mundarija' : null].filter(Boolean).join(' · ');

  return (
    <div className="page profile">
      <PageHeader title={t('profile.title')} />

      {/* A. Profile card */}
      <section className="profile-card glass">
        <button type="button" className="avatar" onClick={() => avatarInput.current?.click()} aria-label={t('profile.changeAvatar')}>
          {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
          <span className="avatar-edit"><Icon name="image" size={13} /></span>
        </button>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { void setAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="profile-main">
          <strong className="profile-name" data-testid="profile-display-name">{name}</strong>
          <span className={`chip account-chip tone-${status.tone}`} data-testid="account-status"><Icon name={status.icon} size={13} /> {status.label}</span>
          <button type="button" className="profile-edit-btn" onClick={() => setSheet('edit')} data-testid="profile-edit"><Icon name="edit" size={14} /> Profilni tahrirlash</button>
        </div>
      </section>

      {/* B. Stats */}
      <div className="stats-grid stats-2">
        <div className="stat glass"><strong>{live.length}</strong><span>Kitoblarim</span></div>
        <div className="stat glass"><strong>{chapterCount}</strong><span>Boblarim</span></div>
      </div>

      {/* C. Settings */}
      <h2 className="sub-title">{t('profile.settings')}</h2>
      <div className="glass options-card">
        <Field label={t('profile.language')} hint={settings.locale !== 'uz' ? t('profile.languageBeta') : undefined}>
          <Segmented value={settings.locale} label={t('profile.language')} onChange={(v) => update({ locale: v })} options={(['uz', 'ru', 'en'] as Locale[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))} />
        </Field>
        <Field label={t('profile.theme')}>
          <Segmented value={settings.theme} label={t('profile.theme')} onChange={(v) => update({ theme: v })} options={[
            { value: 'system', label: 'Tizim bo‘yicha', icon: 'monitor' }, { value: 'light', label: t('profile.theme.light'), icon: 'sun' }, { value: 'dark', label: t('profile.theme.dark'), icon: 'moon' },
          ]} />
        </Field>
        <Switch id="rm" label={t('profile.reducedMotion')} checked={settings.reducedMotion} onChange={(v) => update({ reducedMotion: v })} />
        <p className="muted small setting-hint">Harakatlanuvchi effektlar va ochilish animatsiyasini o‘chiradi. Boshi aylanadigan yoki sekin telefonlar uchun qulay.</p>
      </div>

      {/* D. Default export — one compact row that opens the options */}
      <h2 className="sub-title">{t('profile.exportDefaults')}</h2>
      <div className="glass options-card compact">
        <button type="button" className="disclosure" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)} data-testid="export-defaults">
          <Icon name="download" size={18} />
          <span><strong>Yuklab olish sozlamalari</strong><small>{exportSummary}</small></span>
          <Icon name={exportOpen ? 'chevronUp' : 'chevronDown'} size={18} />
        </button>
        {exportOpen && (
          <div className="disclosure-body">
            <Field label="Format">
              <Segmented value={settings.defaultExport} label="Format" onChange={(v) => update({ defaultExport: v as ExportFormat })}
                options={(['pdf', 'epub', 'docx', 'pptx'] as const).map((f) => ({ value: f, label: f.toUpperCase() }))} />
            </Field>
            <Field label="Sahifa o‘lchami (PDF)">
              <Segmented value={settings.pdfPageSize} label="Sahifa o‘lchami" onChange={(v) => update({ pdfPageSize: v })} options={[{ value: 'A5', label: 'A5' }, { value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]} />
            </Field>
            <Switch id="dc" label={t('export.includeCover')} checked={settings.exportIncludeCover} onChange={(v) => update({ exportIncludeCover: v })} />
            <Switch id="dt" label={t('export.includeToc')} checked={settings.exportIncludeToc} onChange={(v) => update({ exportIncludeToc: v })} />
          </div>
        )}
      </div>

      {/* E. Backup */}
      <h2 className="sub-title">Zaxiralash</h2>
      <div className="glass options-card backup-card">
        <AccountCard />
        <div className="list">
          <ListRow icon="download" title="Faylga zaxira olish" subtitle="Barcha kitoblar bitta faylda" onClick={() => void backup()} testId="backup" />
          <ListRow icon="upload" title={t('profile.restoreBackup')} subtitle="Avval olingan zaxira faylidan" onClick={() => restoreInput.current?.click()} testId="restore" />
        </div>
        <p className="muted small storage-note" data-testid="storage-info">
          <Icon name="folder" size={14} /> Kitoblar shu qurilmada saqlanadi{cloud.user ? ' va internetga zaxiralanadi' : ''}{usage !== null ? ` · ${formatBytes(usage)} band` : ''}.
        </p>
        <button type="button" className="danger-link" onClick={() => void wipe()} data-testid="clear-all"><Icon name="trash" size={16} /> {t('profile.clearAll')}</button>
      </div>
      <input ref={restoreInput} type="file" accept="application/json,.json" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} />

      {/* F. About */}
      <h2 className="sub-title">Ilova haqida</h2>
      <div className="list glass">
        <ListRow icon="info" title={t('profile.about')} onClick={() => setSheet('about')} />
        <ListRow icon="shield" title={t('profile.privacy')} onClick={() => setSheet('privacy')} />
        <ListRow icon="help" title="Yordam" onClick={() => setSheet('help')} testId="help" />
        <ListRow icon="code" title="Versiya" subtitle={__BOOKLY_VERSION__} />
      </div>

      <Sheet open={sheet === 'edit'} onClose={() => setSheet(null)} title="Profilni tahrirlash" size="sm" footer={<Button onClick={() => setSheet(null)} data-testid="profile-done">Tayyor</Button>}>
        <div className="form">
          <Field label={t('profile.name')} htmlFor="p-name" hint={tgName && !settings.profile.name ? `Bo‘sh qoldirsangiz, Telegram’dagi ismingiz ishlatiladi: ${tgName}` : undefined}>
            <input id="p-name" className="input" value={settings.profile.name} placeholder={tgName || t('profile.namePh')}
              onChange={(e) => update({ profile: { ...settings.profile, name: e.target.value } })} data-testid="profile-name" />
          </Field>
          <div className="row-actions wrap">
            <Button variant="secondary" icon="image" onClick={() => avatarInput.current?.click()}>{t('profile.changeAvatar')}</Button>
            {settings.profile.avatarAssetId && <Button variant="ghost" onClick={() => update({ profile: { ...settings.profile, avatarAssetId: null } })}>{t('profile.removeAvatar')}</Button>}
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'about' || sheet === 'privacy' || sheet === 'help'} onClose={() => setSheet(null)} size="sm"
        title={sheet === 'about' ? t('profile.about') : sheet === 'privacy' ? t('profile.privacy') : 'Yordam'}>
        {sheet === 'about' && <><p>{t('profile.aboutText')}</p><p className="muted small">{t('profile.version', { v: __BOOKLY_VERSION__ })} · {t('app.slogan')}</p></>}
        {sheet === 'privacy' && <p>{t('profile.privacyText')}</p>}
        {sheet === 'help' && (
          <ol className="help-steps">
            <li><strong>Kitob yarating.</strong> Pastdagi «+» tugmasi → «Bo‘sh kitob». Boblar bilan yoki bitta yaxlit matn tanlang.</li>
            <li><strong>Yozing.</strong> Matnni belgilab B / I / U bilan bezang. «Qo‘shish» orqali sarlavha, iqtibos yoki rasm qo‘shing.</li>
            <li><strong>Saqlash avtomatik.</strong> Yuqoridagi «Saqlandi» yozuvi hammasi joyida ekanini bildiradi.</li>
            <li><strong>Yuklab oling.</strong> Kitob → «Eksport»: PDF, EPUB, DOCX yoki PPTX. Telegram’da faylni botga yuborish mumkin.</li>
            <li><strong>Zaxiralang.</strong> Profil → «Zaxiralash». Telegram orqali ulansangiz, kitoblar internetga avtomatik saqlanadi.</li>
          </ol>
        )}
      </Sheet>
    </div>
  );
}
