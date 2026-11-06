import type { BookCategory, BookTheme, CoverDesign } from './book';
import { tr, type MessageKey } from '../i18n';

/** Display names in the current UI language (the data below keeps the Uzbek names as defaults). */
export const fontLabel = (f: { id: string }) => tr(`font.${f.id}` as MessageKey);
export const paletteLabel = (p: { id: string }) => tr(`palette.${p.id}` as MessageKey);
export const templateName = (t: { id: string }) => tr(`tpl.${t.id}.name` as MessageKey);
export const templateDesc = (t: { id: string }) => tr(`tpl.${t.id}.desc` as MessageKey);
export const coverTemplateName = (c: { id: string }) => tr(`coverTpl.${c.id}` as MessageKey);

export interface FontDef {
  id: string;
  label: string;
  css: string;
  /** Name used in DOCX / PPTX / EPUB CSS. */
  office: string;
  pdf: 'Times' | 'Helvetica' | 'Courier';
  weight: number;
  uppercase?: boolean;
  letterSpacing?: number;
}

export const FONTS: FontDef[] = [
  { id: 'serif', label: 'Klassik serif', css: "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Noto Serif', serif", office: 'Georgia', pdf: 'Times', weight: 700 },
  { id: 'sans', label: 'Zamonaviy sans', css: "'Inter', 'Segoe UI', Roboto, system-ui, -apple-system, sans-serif", office: 'Calibri', pdf: 'Helvetica', weight: 700 },
  { id: 'display', label: 'Display', css: "'Inter', 'Segoe UI', Roboto, system-ui, sans-serif", office: 'Arial Black', pdf: 'Helvetica', weight: 900, uppercase: true, letterSpacing: 0.06 },
  { id: 'elegant', label: 'Nafis', css: "'Didot', 'Bodoni 72', 'Playfair Display', Georgia, serif", office: 'Garamond', pdf: 'Times', weight: 500, letterSpacing: 0.02 },
  { id: 'rounded', label: 'Yumshoq', css: "'Nunito', 'Quicksand', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif", office: 'Trebuchet MS', pdf: 'Helvetica', weight: 800 },
  { id: 'mono', label: 'Monospace', css: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace", office: 'Consolas', pdf: 'Courier', weight: 700 },
];

export function fontById(id: string): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export interface Palette { id: string; label: string; colors: [string, string]; text: string; accent: string }

export const PALETTES: Palette[] = [
  { id: 'indigo', label: 'Indigo tun', colors: ['#1e1b4b', '#4338ca'], text: '#ffffff', accent: '#c4b5fd' },
  { id: 'lavender', label: 'Lavanda', colors: ['#ede9fe', '#c4b5fd'], text: '#2e1065', accent: '#6d28d9' },
  { id: 'violet', label: 'Binafsha', colors: ['#4c1d95', '#a855f7'], text: '#ffffff', accent: '#f5d0fe' },
  { id: 'navy', label: 'Chuqur navy', colors: ['#0b1026', '#1e3a8a'], text: '#f8fafc', accent: '#93c5fd' },
  { id: 'sunset', label: 'Shafaq', colors: ['#7c2d12', '#f59e0b'], text: '#fff7ed', accent: '#fde68a' },
  { id: 'rose', label: 'Atirgul', colors: ['#881337', '#f472b6'], text: '#fff1f2', accent: '#fecdd3' },
  { id: 'paper', label: 'Qog‘oz', colors: ['#faf7f2', '#efe7da'], text: '#1f2937', accent: '#7c3aed' },
  { id: 'forest', label: 'O‘rmon', colors: ['#052e2b', '#0f766e'], text: '#f0fdfa', accent: '#99f6e4' },
  { id: 'graphite', label: 'Grafit', colors: ['#111827', '#374151'], text: '#f9fafb', accent: '#a5b4fc' },
  { id: 'sky', label: 'Osmon', colors: ['#dbeafe', '#a5b4fc'], text: '#1e1b4b', accent: '#4338ca' },
];

export interface DesignTemplate {
  id: string;
  name: string;
  category: BookCategory;
  description: string;
  theme: Omit<BookTheme, 'templateId'>;
  cover: Pick<CoverDesign, 'fontId' | 'layout' | 'textColor' | 'accentColor' | 'overlay'> & { colors: [string, string]; kind: 'gradient' | 'solid' };
  /** Decorative motif drawn by the cover renderer. */
  motif: 'orbs' | 'lines' | 'frame' | 'waves' | 'grid' | 'stars' | 'blocks' | 'none';
}

const T = (t: DesignTemplate) => t;

export const TEMPLATES: DesignTemplate[] = [
  T({ id: 'classic-indigo', name: 'Klassik Indigo', category: 'education', description: 'Toza serif matn, indigo sarlavhalar — darsliklar uchun.',
    theme: { headingFont: 'serif', bodyFont: 'serif', accent: '#4338ca', paper: '#ffffff', ink: '#1c1b29', baseSize: 12 },
    cover: { fontId: 'serif', layout: 'center', textColor: '#ffffff', accentColor: '#c4b5fd', overlay: 0.2, colors: ['#1e1b4b', '#4338ca'], kind: 'gradient' }, motif: 'frame' }),
  T({ id: 'study-notes', name: 'O‘quv qo‘llanma', category: 'education', description: 'Aniq tuzilma va ochiq ranglar, mashqlar uchun qulay.',
    theme: { headingFont: 'sans', bodyFont: 'sans', accent: '#2563eb', paper: '#ffffff', ink: '#111827', baseSize: 11 },
    cover: { fontId: 'sans', layout: 'top', textColor: '#1e1b4b', accentColor: '#2563eb', overlay: 0, colors: ['#dbeafe', '#a5b4fc'], kind: 'gradient' }, motif: 'grid' }),
  T({ id: 'executive', name: 'Executive', category: 'business', description: 'Qat’iy, minimal biznes uslubi.',
    theme: { headingFont: 'sans', bodyFont: 'serif', accent: '#1e3a8a', paper: '#ffffff', ink: '#0f172a', baseSize: 11 },
    cover: { fontId: 'display', layout: 'bottom', textColor: '#f8fafc', accentColor: '#93c5fd', overlay: 0.3, colors: ['#0b1026', '#1e3a8a'], kind: 'gradient' }, motif: 'lines' }),
  T({ id: 'startup', name: 'Startap', category: 'business', description: 'Yorqin aksentli zamonaviy taqdimot uslubi.',
    theme: { headingFont: 'display', bodyFont: 'sans', accent: '#7c3aed', paper: '#ffffff', ink: '#111827', baseSize: 11 },
    cover: { fontId: 'display', layout: 'left', textColor: '#ffffff', accentColor: '#f5d0fe', overlay: 0.15, colors: ['#4c1d95', '#a855f7'], kind: 'gradient' }, motif: 'blocks' }),
  T({ id: 'mindful', name: 'Mindful', category: 'self-development', description: 'Iliq, havodor tipografiya — shaxsiy rivojlanish kitoblari uchun.',
    theme: { headingFont: 'elegant', bodyFont: 'serif', accent: '#b45309', paper: '#fffbf5', ink: '#292524', baseSize: 12 },
    cover: { fontId: 'elegant', layout: 'center', textColor: '#fff7ed', accentColor: '#fde68a', overlay: 0.2, colors: ['#7c2d12', '#f59e0b'], kind: 'gradient' }, motif: 'waves' }),
  T({ id: 'growth', name: 'O‘sish', category: 'self-development', description: 'Lavanda va oq — yengil va ilhomlantiruvchi.',
    theme: { headingFont: 'sans', bodyFont: 'serif', accent: '#6d28d9', paper: '#ffffff', ink: '#1f1937', baseSize: 12 },
    cover: { fontId: 'sans', layout: 'bottom', textColor: '#2e1065', accentColor: '#6d28d9', overlay: 0, colors: ['#ede9fe', '#c4b5fd'], kind: 'gradient' }, motif: 'orbs' }),
  T({ id: 'novel', name: 'Roman', category: 'fiction', description: 'Adabiy, nafis serif va keng hoshiyalar.',
    theme: { headingFont: 'elegant', bodyFont: 'serif', accent: '#9f1239', paper: '#fdfaf6', ink: '#1c1917', baseSize: 12 },
    cover: { fontId: 'elegant', layout: 'center', textColor: '#fff1f2', accentColor: '#fecdd3', overlay: 0.35, colors: ['#881337', '#1e1b4b'], kind: 'gradient' }, motif: 'stars' }),
  T({ id: 'noir', name: 'Noir', category: 'fiction', description: 'Qorong‘i, sirli detektiv uslubi.',
    theme: { headingFont: 'display', bodyFont: 'serif', accent: '#a5b4fc', paper: '#ffffff', ink: '#111827', baseSize: 12 },
    cover: { fontId: 'display', layout: 'bottom', textColor: '#f9fafb', accentColor: '#a5b4fc', overlay: 0.45, colors: ['#111827', '#374151'], kind: 'gradient' }, motif: 'lines' }),
  T({ id: 'storytime', name: 'Ertak vaqti', category: 'children', description: 'Katta harflar va quvnoq ranglar bolalar uchun.',
    theme: { headingFont: 'rounded', bodyFont: 'rounded', accent: '#db2777', paper: '#fffdf7', ink: '#1f2937', baseSize: 14 },
    cover: { fontId: 'rounded', layout: 'top', textColor: '#ffffff', accentColor: '#fef08a', overlay: 0, colors: ['#ec4899', '#8b5cf6'], kind: 'gradient' }, motif: 'stars' }),
  T({ id: 'scholar', name: 'Akademik', category: 'academic', description: 'Ilmiy ishlar uchun qat’iy va o‘qishli formatlash.',
    theme: { headingFont: 'serif', bodyFont: 'serif', accent: '#334155', paper: '#ffffff', ink: '#0f172a', baseSize: 11 },
    cover: { fontId: 'serif', layout: 'top', textColor: '#1f2937', accentColor: '#4338ca', overlay: 0, colors: ['#faf7f2', '#efe7da'], kind: 'gradient' }, motif: 'frame' }),
  T({ id: 'handbook', name: 'Qo‘llanma', category: 'guide', description: 'Bosqichma-bosqich yo‘riqnomalar uchun aniq uslub.',
    theme: { headingFont: 'sans', bodyFont: 'sans', accent: '#0f766e', paper: '#ffffff', ink: '#111827', baseSize: 11 },
    cover: { fontId: 'sans', layout: 'left', textColor: '#f0fdfa', accentColor: '#99f6e4', overlay: 0.2, colors: ['#052e2b', '#0f766e'], kind: 'gradient' }, motif: 'grid' }),
  T({ id: 'journal', name: 'Kundalik', category: 'journal', description: 'Shaxsiy yozuvlar uchun yumshoq qog‘oz uslubi.',
    theme: { headingFont: 'elegant', bodyFont: 'serif', accent: '#7c3aed', paper: '#faf7f2', ink: '#292524', baseSize: 12 },
    cover: { fontId: 'elegant', layout: 'center', textColor: '#3b0764', accentColor: '#7c3aed', overlay: 0, colors: ['#faf7f2', '#e9d5ff'], kind: 'gradient' }, motif: 'waves' }),
];

export const TEMPLATE_CATEGORIES: BookCategory[] = ['education', 'business', 'self-development', 'fiction', 'children', 'academic', 'guide', 'journal'];

export function templateById(id: string): DesignTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

/** Cover-only layout presets offered by the cover designer. */
export const COVER_TEMPLATES: { id: string; name: string; layout: CoverDesign['layout']; fontId: string; palette: string; motif: DesignTemplate['motif'] }[] = [
  { id: 'aurora', name: 'Aurora', layout: 'center', fontId: 'serif', palette: 'indigo', motif: 'orbs' },
  { id: 'minimal', name: 'Minimal', layout: 'top', fontId: 'sans', palette: 'paper', motif: 'none' },
  { id: 'bold', name: 'Bold', layout: 'bottom', fontId: 'display', palette: 'violet', motif: 'blocks' },
  { id: 'classic', name: 'Klassik', layout: 'center', fontId: 'elegant', palette: 'navy', motif: 'frame' },
  { id: 'editorial', name: 'Editorial', layout: 'left', fontId: 'display', palette: 'graphite', motif: 'lines' },
  { id: 'dream', name: 'Orzu', layout: 'center', fontId: 'rounded', palette: 'rose', motif: 'stars' },
  { id: 'calm', name: 'Sokin', layout: 'bottom', fontId: 'elegant', palette: 'lavender', motif: 'waves' },
  { id: 'blueprint', name: 'Blueprint', layout: 'top', fontId: 'mono', palette: 'sky', motif: 'grid' },
];

export function motifFor(templateId: string): DesignTemplate['motif'] {
  return COVER_TEMPLATES.find((c) => c.id === templateId)?.motif ?? TEMPLATES.find((t) => t.id === templateId)?.motif ?? 'orbs';
}
