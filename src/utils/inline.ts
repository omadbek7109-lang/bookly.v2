/**
 * Inline rich-text helpers.
 *
 * Text blocks store a tiny, sanitized HTML subset: <b>, <i>, <u>, <br>.
 * Everything here is DOM-free so it runs identically in the browser, in exporters and in Node tests.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** A forced line break (rendered after `text`). */
  br?: boolean;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 32);
    return m;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeXml(s: string): string {
  // Also strips characters that are illegal in XML 1.0.
  // eslint-disable-next-line no-control-regex
  return escapeHtml(s).replace(/'/g, '&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

const TAG_RE = /<\s*(\/?)\s*([a-z0-9]+)[^>]*?(\/?)\s*>/gi;
const BOLD = new Set(['b', 'strong']);
const ITALIC = new Set(['i', 'em']);
const UNDER = new Set(['u', 'ins']);
const BLOCKISH = new Set(['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr']);

/** Parses the inline subset into formatted runs. Unknown tags are dropped, their text kept. */
export function parseInline(html: string): Run[] {
  const runs: Run[] = [];
  let b = 0, i = 0, u = 0;
  let last = 0;
  let sawContent = false;
  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw.replace(/[\r\n\t]+/g, ' '));
    if (!text) return;
    sawContent = true;
    const prev = runs[runs.length - 1];
    const fmt = { bold: b > 0, italic: i > 0, underline: u > 0 };
    if (prev && !prev.br && !!prev.bold === fmt.bold && !!prev.italic === fmt.italic && !!prev.underline === fmt.underline) {
      prev.text += text;
    } else {
      runs.push({ text, ...clean(fmt) });
    }
  };
  const pushBreak = () => {
    const prev = runs[runs.length - 1];
    if (prev && !prev.br) prev.br = true;
    else runs.push({ text: '', br: true });
  };
  html.replace(TAG_RE, (m, close: string, name: string, _self: string, offset: number) => {
    pushText(html.slice(last, offset));
    last = offset + m.length;
    const tag = name.toLowerCase();
    const d = close ? -1 : 1;
    if (BOLD.has(tag)) b = Math.max(0, b + d);
    else if (ITALIC.has(tag)) i = Math.max(0, i + d);
    else if (UNDER.has(tag)) u = Math.max(0, u + d);
    else if (tag === 'br') pushBreak();
    else if (BLOCKISH.has(tag) && close === '' && sawContent) pushBreak();
    return m;
  });
  pushText(html.slice(last));
  // A trailing break produced by browsers (<div><br></div>) carries no meaning.
  const tail = runs[runs.length - 1];
  if (tail && tail.br && tail.text === '' && runs.length > 1) runs.pop();
  else if (tail && tail.br && runs.length === 1 && tail.text === '') runs.pop();
  return runs;
}

function clean(f: { bold: boolean; italic: boolean; underline: boolean }): Partial<Run> {
  const r: Partial<Run> = {};
  if (f.bold) r.bold = true;
  if (f.italic) r.italic = true;
  if (f.underline) r.underline = true;
  return r;
}

/** Serializes runs back into the canonical inline subset. */
export function runsToHtml(runs: Run[]): string {
  return runs
    .map((r) => {
      let s = escapeHtml(r.text);
      if (r.underline) s = `<u>${s}</u>`;
      if (r.italic) s = `<i>${s}</i>`;
      if (r.bold) s = `<b>${s}</b>`;
      return r.br ? `${s}<br>` : s;
    })
    .join('');
}

/** Normalizes arbitrary (pasted / contentEditable) HTML to the safe inline subset. */
export function sanitizeInline(html: string): string {
  return runsToHtml(parseInline(html));
}

export function plainText(html: string): string {
  return parseInline(html).map((r) => r.text + (r.br ? '\n' : '')).join('').replace(/ /g, ' ');
}

export function textToInline(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}ʻ'‘’-]+/gu);
  return m ? m.length : 0;
}
