import { useEffect, useRef, useState } from 'react';
import { useLibrary, useSettings, useUi } from '../../app/AppContext';
import { back, navigate, routes } from '../../app/router';
import { BookCover } from '../../components/BookCover';
import { Icon } from '../../components/Icon';
import { Button, DemoBadge, EmptyState, Field, ListRow, PageHeader, Segmented, Spinner } from '../../components/ui';
import type { Book, CoverDesign } from '../../models/book';
import { COVER_TEMPLATES, FONTS, PALETTES } from '../../models/templates';
import type { MessageKey } from '../../i18n';
import { getImageAI, type CoverStyle } from '../../services/ai';
import { COVER_RATIO, loadAssetImage, renderCover, renderCoverBlob } from '../../services/cover/renderCover';
import { downloadBlob } from '../../services/export/prepare';
import { assets, books, MAX_ASSET_BYTES } from '../../services/storage/repository';
import { slugify } from '../../utils/id';

type Tab = 'text' | 'layout' | 'colors' | 'image' | 'ai';
const STYLES: CoverStyle[] = ['cosmic', 'landscape', 'abstract', 'geometric', 'watercolor'];

export default function CoverPage({ bookId }: { bookId?: string }) {
  const { t } = useSettings();
  const { books: all, ready } = useLibrary();
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  useEffect(() => {
    if (!bookId) { setBook(undefined); return; }
    books.get(bookId).then((b) => setBook(b && !b.deletedAt ? b : null)).catch(() => setBook(null));
  }, [bookId]);

  if (!bookId) {
    const live = all.filter((b) => !b.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    return (
      <div className="page">
        <PageHeader title={t('cover.title')} subtitle={t('cover.pickBook')} onBack={() => back(routes.studio())} />
        {ready && !live.length ? <EmptyState title={t('home.chooseBookEmpty')} action={<Button icon="sparkles" onClick={() => navigate(routes.create())}>{t('home.empty.cta')}</Button>} /> : (
          <div className="pick-grid">
            {live.map((b) => (
              <button key={b.id} type="button" className="pick-card" onClick={() => navigate(routes.cover(b.id), { replace: true })} data-testid="cover-pick">
                <BookCover cover={b.cover} width={140} /><span>{b.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (book === undefined) return <div className="page-loading"><Spinner /></div>;
  if (!book) return <EmptyState icon="alert" title={t('editor.notFound')} action={<Button onClick={() => navigate(routes.books())}>{t('editor.goLibrary')}</Button>} />;
  return <Designer book={book} />;
}

function Designer({ book }: { book: Book }) {
  const { t } = useSettings();
  const { toast } = useUi();
  const [cover, setCover] = useState<CoverDesign>(() => ({ ...book.cover, title: book.cover.title || book.title, author: book.cover.author || book.author }));
  const [tab, setTab] = useState<Tab>('text');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [prompt, setPrompt] = useState(book.cover.aiPrompt || book.title);
  const [style, setStyle] = useState<CoverStyle>('cosmic');
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(cover);
  latest.current = cover;

  // live preview
  useEffect(() => {
    let alive = true;
    const c = canvas.current;
    if (!c) return;
    const w = 600, h = Math.round(w * COVER_RATIO);
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    renderCover(ctx, cover, w, h);
    if (cover.background.kind === 'image') void loadAssetImage(cover.background.imageAssetId).then((img) => { if (alive && img) renderCover(ctx, cover, w, h, { image: img.img, imageSize: { w: img.w, h: img.h } }); });
    return () => { alive = false; };
  }, [cover]);

  // autosave (debounced)
  useEffect(() => {
    if (saved) return;
    const id = setTimeout(() => void persist(), 800);
    return () => clearTimeout(id);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async () => {
    const fresh = await books.get(book.id);
    if (!fresh) return;
    await books.save({ ...fresh, cover: latest.current });
    setSaved(true);
  };
  useEffect(() => () => { void persist(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<CoverDesign>) => { setCover((c) => ({ ...c, ...patch })); setSaved(false); };
  const setBg = (patch: Partial<CoverDesign['background']>) => { setCover((c) => ({ ...c, background: { ...c.background, ...patch } })); setSaved(false); };

  const upload = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast(t('editor.unsupportedFile'), 'error'); return; }
    if (f.size > MAX_ASSET_BYTES) { toast(t('editor.fileTooLarge', { mb: 15 }), 'error'); return; }
    const a = await assets.put(f, f.name);
    setBg({ kind: 'image', imageAssetId: a.id, imageX: 0.5, imageY: 0.5, imageScale: 1 });
    set({ overlay: Math.max(cover.overlay, 0.3), textColor: '#ffffff', aiGenerated: false });
  };

  const generate = async () => {
    setBusy(true);
    try {
      const blob = await getImageAI().generateCover({ prompt, style, colors: cover.background.colors, width: 1000, height: 1500 });
      const a = await assets.put(blob, `ai-cover-${Date.now()}.jpg`);
      setBg({ kind: 'image', imageAssetId: a.id, imageX: 0.5, imageY: 0.5, imageScale: 1 });
      set({ aiGenerated: true, aiPrompt: prompt, overlay: Math.max(cover.overlay, 0.2), textColor: '#ffffff' });
    } catch (e) { toast(String((e as Error).message), 'error'); } finally { setBusy(false); }
  };

  const download = async (mime: 'image/png' | 'image/jpeg') => {
    const blob = await renderCoverBlob(latest.current, { width: 1600, mime });
    downloadBlob(blob, `${slugify(book.title)}-cover.${mime === 'image/png' ? 'png' : 'jpg'}`);
    toast(`${slugify(book.title)}-cover.${mime === 'image/png' ? 'png' : 'jpg'}`, 'success');
  };

  return (
    <div className="page cover-page">
      <PageHeader title={t('cover.title')} subtitle={book.title} onBack={() => { void persist(); back(routes.editor(book.id)); }}
        actions={<Button size="sm" icon="check" onClick={() => void persist().then(() => toast(t('cover.saved'), 'success'))} data-testid="cover-save">{t('common.save')}</Button>} />
      <div className="cover-layout">
        <div className="cover-preview">
          <canvas ref={canvas} className="cover-canvas" role="img" aria-label={cover.title} data-testid="cover-canvas" />
          {cover.aiGenerated && <span className="cover-ai-tag"><DemoBadge /> AI</span>}
          <div className="row-actions">
            <Button variant="secondary" size="sm" icon="download" onClick={() => void download('image/png')} data-testid="cover-png">{t('cover.downloadPng')}</Button>
            <Button variant="secondary" size="sm" icon="download" onClick={() => void download('image/jpeg')} data-testid="cover-jpg">{t('cover.downloadJpg')}</Button>
          </div>
        </div>
        <div className="cover-controls glass">
          <Segmented value={tab} onChange={setTab} label={t('cover.title')} scroll options={[
            { value: 'text', label: t('cover.tab.text'), icon: 'type' }, { value: 'layout', label: t('cover.tab.layout'), icon: 'layout' },
            { value: 'colors', label: t('cover.tab.colors'), icon: 'palette' }, { value: 'image', label: t('cover.tab.image'), icon: 'image' },
            { value: 'ai', label: t('cover.tab.ai'), icon: 'sparkles' },
          ]} />
          {tab === 'text' && (
            <div className="form">
              <Field label={t('cover.coverTitle')} htmlFor="cv-title"><input id="cv-title" className="input" value={cover.title} onChange={(e) => set({ title: e.target.value })} data-testid="cover-title" /></Field>
              <Field label={t('cover.subtitle')} htmlFor="cv-sub"><input id="cv-sub" className="input" value={cover.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
              <Field label={t('cover.author')} htmlFor="cv-author"><input id="cv-author" className="input" value={cover.author} onChange={(e) => set({ author: e.target.value })} /></Field>
              <Field label={t('cover.font')}>
                <div className="chips">{FONTS.map((f) => <button key={f.id} type="button" className={`chip-btn ${cover.fontId === f.id ? 'is-active' : ''}`} style={{ fontFamily: f.css, fontWeight: f.weight > 600 ? 700 : 500 }} onClick={() => set({ fontId: f.id })}>{f.label}</button>)}</div>
              </Field>
            </div>
          )}
          {tab === 'layout' && (
            <div className="form">
              <div className="cover-tpl-grid">
                {COVER_TEMPLATES.map((ct) => {
                  const pal = PALETTES.find((p) => p.id === ct.palette)!;
                  const preview: CoverDesign = { ...cover, templateId: ct.id, layout: ct.layout, fontId: ct.fontId, textColor: pal.text, accentColor: pal.accent, background: { ...cover.background, kind: 'gradient', colors: pal.colors } };
                  return (
                    <button key={ct.id} type="button" className={`cover-tpl ${cover.templateId === ct.id ? 'is-active' : ''}`} data-testid={`cover-tpl-${ct.id}`}
                      onClick={() => { set({ templateId: ct.id, layout: ct.layout, fontId: ct.fontId, textColor: cover.background.kind === 'image' ? cover.textColor : pal.text, accentColor: pal.accent }); if (cover.background.kind !== 'image') setBg({ colors: pal.colors, kind: 'gradient' }); }}>
                      <BookCover cover={preview} width={90} /><span>{ct.name}</span>
                    </button>
                  );
                })}
              </div>
              <Field label={t('cover.layout')}>
                <Segmented value={cover.layout} label={t('cover.layout')} onChange={(v) => set({ layout: v })} options={(['center', 'top', 'bottom', 'left'] as const).map((v) => ({ value: v, label: t(`cover.layout.${v}` as MessageKey) }))} />
              </Field>
            </div>
          )}
          {tab === 'colors' && (
            <div className="form">
              <Field label={t('cover.palette')}>
                <div className="palette-grid">
                  {PALETTES.map((p) => (
                    <button key={p.id} type="button" className={`palette ${cover.background.colors[0] === p.colors[0] && cover.background.colors[1] === p.colors[1] ? 'is-active' : ''}`} title={p.label} aria-label={p.label}
                      style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }} onClick={() => { setBg({ colors: p.colors, kind: cover.background.kind === 'image' ? 'image' : cover.background.kind }); set({ textColor: cover.background.kind === 'image' ? cover.textColor : p.text, accentColor: p.accent }); }} data-testid={`palette-${p.id}`} />
                  ))}
                </div>
              </Field>
              <Field label={t('cover.bgKind')}>
                <Segmented value={cover.background.kind} label={t('cover.bgKind')} onChange={(v) => setBg({ kind: v })}
                  options={[{ value: 'gradient', label: t('cover.bg.gradient') }, { value: 'solid', label: t('cover.bg.solid') }, ...(cover.background.imageAssetId ? [{ value: 'image' as const, label: t('cover.bg.image') }] : [])]} />
              </Field>
              <div className="form-row">
                <Field label={t('cover.color1')} htmlFor="c1"><input id="c1" type="color" className="color" value={cover.background.colors[0]} onChange={(e) => setBg({ colors: [e.target.value, cover.background.colors[1]] })} /></Field>
                <Field label={t('cover.color2')} htmlFor="c2"><input id="c2" type="color" className="color" value={cover.background.colors[1]} onChange={(e) => setBg({ colors: [cover.background.colors[0], e.target.value] })} /></Field>
                <Field label={t('cover.textColor')} htmlFor="c3"><input id="c3" type="color" className="color" value={cover.textColor} onChange={(e) => set({ textColor: e.target.value })} /></Field>
              </div>
              <Field label={`${t('cover.overlay')}: ${Math.round(cover.overlay * 100)}%`} htmlFor="ov"><input id="ov" type="range" className="range" min={0} max={0.8} step={0.05} value={cover.overlay} onChange={(e) => set({ overlay: Number(e.target.value) })} /></Field>
            </div>
          )}
          {tab === 'image' && (
            <div className="form">
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} data-testid="cover-upload-input" />
              <Button icon="upload" variant="secondary" block onClick={() => fileInput.current?.click()}>{t('cover.upload')}</Button>
              {cover.background.imageAssetId && cover.background.kind === 'image' && (
                <>
                  <Field label={t('cover.posX')} htmlFor="px"><input id="px" type="range" className="range" min={0} max={1} step={0.01} value={cover.background.imageX} onChange={(e) => setBg({ imageX: Number(e.target.value) })} /></Field>
                  <Field label={t('cover.posY')} htmlFor="py"><input id="py" type="range" className="range" min={0} max={1} step={0.01} value={cover.background.imageY} onChange={(e) => setBg({ imageY: Number(e.target.value) })} /></Field>
                  <Field label={`${t('cover.zoom')}: ${cover.background.imageScale.toFixed(1)}×`} htmlFor="pz"><input id="pz" type="range" className="range" min={1} max={3} step={0.05} value={cover.background.imageScale} onChange={(e) => setBg({ imageScale: Number(e.target.value) })} /></Field>
                  <Field label={`${t('cover.overlay')}: ${Math.round(cover.overlay * 100)}%`} htmlFor="ov2"><input id="ov2" type="range" className="range" min={0} max={0.8} step={0.05} value={cover.overlay} onChange={(e) => set({ overlay: Number(e.target.value) })} /></Field>
                  <Button variant="ghost" icon="x" onClick={() => setBg({ kind: 'gradient' })}>{t('cover.removeImage')}</Button>
                </>
              )}
            </div>
          )}
          {tab === 'ai' && (
            <div className="form">
              <p className="demo-note"><Icon name="info" size={16} /> {t('cover.demoNote')}</p>
              <Field label={t('cover.aiPrompt')} htmlFor="aip"><textarea id="aip" className="input" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('cover.aiPromptPh')} /></Field>
              <Field label={t('cover.aiStyle')}>
                <div className="chips">{STYLES.map((s) => <button key={s} type="button" className={`chip-btn ${style === s ? 'is-active' : ''}`} onClick={() => setStyle(s)}>{t(`cover.style.${s}` as MessageKey)}</button>)}</div>
              </Field>
              <Button icon="sparkles" block loading={busy} onClick={() => void generate()} data-testid="cover-ai-generate">{busy ? t('cover.aiGenerating') : t('cover.aiGenerate')}</Button>
            </div>
          )}
          <p className="muted small center">{saved ? t('common.saved') : t('common.unsaved')}</p>
        </div>
      </div>
      <div className="row-actions center">
        <ListRow icon="download" title={t('common.export')} onClick={() => { void persist(); navigate(routes.export(book.id)); }} />
      </div>
    </div>
  );
}
