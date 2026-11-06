/**
 * Minimal TrueType reader + subsetter that implements the part of the `fontkit` API pdf-lib uses for
 * embedding custom fonts (`doc.registerFontkit(miniFontkit)` + `doc.embedFont(bytes, { subset: true })`).
 *
 * Why: PDF export must keep Cyrillic and Uzbek characters as real Unicode text (searchable, copyable),
 * which needs an embedded TrueType font. The full fontkit package is large; Bookly lays text out itself
 * (no ligatures/kerning), so a cmap + metrics reader and a glyf/loca subsetter are enough.
 *
 * Subset output keeps the tables a CIDFontType2 needs (head, hhea, maxp, hmtx, loca, glyf + OS/2, post),
 * renumbers glyphs sequentially (0 = .notdef) and pulls in components of composite glyphs.
 */

export interface TtfGlyph {
  id: number;
  advanceWidth: number;
  codePoints: number[];
}

interface TableRec { offset: number; length: number }

const tagOf = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export class TtfFont {
  readonly cff = false;
  readonly unitsPerEm: number;
  readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly italicAngle: number;
  readonly postscriptName: string;
  readonly numGlyphs: number;
  /** Fields read by pdf-lib's deriveFontFlags(). */
  readonly head: { macStyle: { italic: boolean; bold: boolean } };
  readonly post: { isFixedPitch: boolean };
  readonly 'OS/2': { sFamilyClass: number };

  readonly tables = new Map<string, TableRec>();
  private readonly view: DataView;
  private readonly cmap = new Map<number, number>();
  private readonly advances: number[] = [];
  private readonly lsbs: number[] = [];
  private readonly locaLong: boolean;
  private readonly glyphCache = new Map<number, TtfGlyph>();

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = this.view;
    const sfnt = v.getUint32(0);
    if (sfnt !== 0x00010000 && sfnt !== 0x74727565) throw new Error('Unsupported font: only TrueType outlines are supported');
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      this.tables.set(tagOf(v, o), { offset: v.getUint32(o + 8), length: v.getUint32(o + 12) });
    }
    for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap']) if (!this.tables.has(t)) throw new Error(`Font is missing the ${t} table`);

    const head = this.t('head');
    this.unitsPerEm = v.getUint16(head + 18);
    this.bbox = { minX: v.getInt16(head + 36), minY: v.getInt16(head + 38), maxX: v.getInt16(head + 40), maxY: v.getInt16(head + 42) };
    const macStyle = v.getUint16(head + 44);
    this.head = { macStyle: { bold: !!(macStyle & 1), italic: !!(macStyle & 2) } };
    this.locaLong = v.getInt16(head + 50) === 1;

    const hhea = this.t('hhea');
    this.ascent = v.getInt16(hhea + 4);
    this.descent = v.getInt16(hhea + 6);
    const numHMetrics = v.getUint16(hhea + 34);
    this.numGlyphs = v.getUint16(this.t('maxp') + 4);

    const hmtx = this.t('hmtx');
    for (let g = 0; g < this.numGlyphs; g++) {
      if (g < numHMetrics) { this.advances.push(v.getUint16(hmtx + g * 4)); this.lsbs.push(v.getInt16(hmtx + g * 4 + 2)); }
      else { this.advances.push(this.advances[numHMetrics - 1]); this.lsbs.push(v.getInt16(hmtx + numHMetrics * 4 + (g - numHMetrics) * 2)); }
    }

    let capHeight = 0, xHeight = 0, familyClass = 0;
    if (this.tables.has('OS/2')) {
      const os2 = this.t('OS/2');
      familyClass = v.getInt16(os2 + 30);
      if (v.getUint16(os2) >= 2 && this.tables.get('OS/2')!.length >= 90) { xHeight = v.getInt16(os2 + 86); capHeight = v.getInt16(os2 + 88); }
    }
    this.capHeight = capHeight || this.ascent;
    this.xHeight = xHeight;
    this['OS/2'] = { sFamilyClass: familyClass };

    let italicAngle = 0, fixed = false;
    if (this.tables.has('post')) {
      const post = this.t('post');
      italicAngle = v.getInt32(post + 4) / 65536;
      fixed = v.getUint32(post + 12) !== 0;
    }
    this.italicAngle = italicAngle;
    this.post = { isFixedPitch: fixed };
    this.postscriptName = this.readPostscriptName() || 'BooklyFont';
    this.readCmap();
  }

  private t(tag: string) { return this.tables.get(tag)!.offset; }

  private readPostscriptName(): string {
    if (!this.tables.has('name')) return '';
    const v = this.view, o = this.t('name');
    const count = v.getUint16(o + 2), strings = o + v.getUint16(o + 4);
    for (let i = 0; i < count; i++) {
      const r = o + 6 + i * 12;
      const platform = v.getUint16(r), nameId = v.getUint16(r + 6), len = v.getUint16(r + 8), off = v.getUint16(r + 10);
      if (nameId !== 6) continue;
      let s = '';
      if (platform === 3 || platform === 0) for (let k = 0; k < len; k += 2) s += String.fromCharCode(v.getUint16(strings + off + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(v.getUint8(strings + off + k));
      if (s) return s.replace(/[^\x21-\x7e]/g, '');
    }
    return '';
  }

  private readCmap() {
    const v = this.view, o = this.t('cmap');
    const n = v.getUint16(o + 2);
    let best = -1, bestScore = -1;
    for (let i = 0; i < n; i++) {
      const r = o + 4 + i * 8;
      const pid = v.getUint16(r), eid = v.getUint16(r + 2), off = o + v.getUint32(r + 4);
      const format = v.getUint16(off);
      const score = format === 12 && (pid === 3 && eid === 10 || pid === 0) ? 3 : format === 4 && (pid === 3 && eid === 1 || pid === 0) ? 2 : 0;
      if (score > bestScore) { bestScore = score; best = off; }
    }
    if (best < 0 || bestScore === 0) throw new Error('Font has no Unicode cmap');
    const format = v.getUint16(best);
    if (format === 4) {
      const segX2 = v.getUint16(best + 6);
      const ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = v.getUint16(ends + s), start = v.getUint16(starts + s), delta = v.getInt16(deltas + s), ro = v.getUint16(ranges + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const gi = v.getUint16(ranges + s + ro + (c - start) * 2);
            g = gi === 0 ? 0 : (gi + delta) & 0xffff;
          }
          if (g) this.cmap.set(c, g);
        }
      }
    } else {
      const groups = v.getUint32(best + 12);
      for (let i = 0; i < groups; i++) {
        const r = best + 16 + i * 12;
        const start = v.getUint32(r), end = v.getUint32(r + 4), g0 = v.getUint32(r + 8);
        for (let c = start; c <= end; c++) this.cmap.set(c, g0 + (c - start));
      }
    }
  }

  /** All code points the font can draw (used by pdf-lib when embedding without subsetting). */
  get characterSet(): number[] { return [...this.cmap.keys()]; }

  hasCodePoint(cp: number) { return this.cmap.has(cp); }

  glyphForCodePoint(cp: number): TtfGlyph {
    const id = this.cmap.get(cp) ?? 0;
    const key = id === 0 ? -cp - 1 : id;
    let g = this.glyphCache.get(key);
    if (!g) { g = { id, advanceWidth: this.advances[id] ?? 0, codePoints: [cp] }; this.glyphCache.set(key, g); }
    return g;
  }

  layout(text: string): { glyphs: TtfGlyph[] } {
    const glyphs: TtfGlyph[] = [];
    for (const ch of text) glyphs.push(this.glyphForCodePoint(ch.codePointAt(0)!));
    return { glyphs };
  }

  createSubset() { return new TtfSubset(this); }

  // ---- raw access for the subsetter
  glyphData(id: number): Uint8Array {
    const v = this.view, loca = this.t('loca'), glyf = this.t('glyf');
    const at = (i: number) => (this.locaLong ? v.getUint32(loca + i * 4) : v.getUint16(loca + i * 2) * 2);
    const start = at(id), end = at(id + 1);
    return this.bytes.subarray(glyf + start, glyf + Math.max(start, end));
  }
  metrics(id: number) { return { advance: this.advances[id] ?? 0, lsb: this.lsbs[id] ?? 0 }; }
  tableBytes(tag: string): Uint8Array | null {
    const r = this.tables.get(tag);
    return r ? this.bytes.slice(r.offset, r.offset + r.length) : null;
  }
}

const COMPOSITE_FLAGS = { ARG_WORDS: 0x0001, HAVE_SCALE: 0x0008, MORE: 0x0020, XY_SCALE: 0x0040, TWO_BY_TWO: 0x0080 };

/** Lists composite components (offset of the glyphIndex field + original glyph id). */
function components(data: Uint8Array): { at: number; id: number }[] {
  if (data.length < 10) return [];
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getInt16(0) >= 0) return [];
  const out: { at: number; id: number }[] = [];
  let p = 10;
  for (;;) {
    const flags = v.getUint16(p);
    out.push({ at: p + 2, id: v.getUint16(p + 2) });
    p += 4 + (flags & COMPOSITE_FLAGS.ARG_WORDS ? 4 : 2);
    if (flags & COMPOSITE_FLAGS.HAVE_SCALE) p += 2;
    else if (flags & COMPOSITE_FLAGS.XY_SCALE) p += 4;
    else if (flags & COMPOSITE_FLAGS.TWO_BY_TWO) p += 8;
    if (!(flags & COMPOSITE_FLAGS.MORE)) break;
  }
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;

function checksum(b: Uint8Array): number {
  const padded = new Uint8Array(pad4(b.length));
  padded.set(b);
  const v = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

export class TtfSubset {
  readonly cff = false;
  private readonly map = new Map<number, number>([[0, 0]]);
  private readonly order: number[] = [0];

  constructor(private readonly font: TtfFont) {}

  /** Adds a glyph; returns its id inside the subset. */
  includeGlyph(glyph: number | { id: number }): number {
    const id = typeof glyph === 'number' ? glyph : glyph.id;
    let n = this.map.get(id);
    if (n === undefined) { n = this.order.length; this.map.set(id, n); this.order.push(id); }
    return n;
  }

  encode(): Uint8Array {
    const f = this.font;
    // pull in components of composite glyphs (the list grows while we walk it)
    for (let i = 0; i < this.order.length; i++) for (const c of components(f.glyphData(this.order[i]))) this.includeGlyph(c.id);

    const n = this.order.length;
    const glyphParts: Uint8Array[] = [];
    const offsets: number[] = [0];
    let pos = 0;
    for (const old of this.order) {
      const src = f.glyphData(old);
      const data = new Uint8Array(pad4(src.length));
      data.set(src);
      if (src.length) {
        const dv = new DataView(data.buffer);
        for (const c of components(src)) dv.setUint16(c.at, this.map.get(c.id)!);
      }
      glyphParts.push(data);
      pos += data.length;
      offsets.push(pos);
    }
    const glyf = new Uint8Array(pos);
    { let p = 0; for (const g of glyphParts) { glyf.set(g, p); p += g.length; } }
    const loca = new Uint8Array(4 * (n + 1));
    { const dv = new DataView(loca.buffer); offsets.forEach((o, i) => dv.setUint32(i * 4, o)); }
    const hmtx = new Uint8Array(4 * n);
    { const dv = new DataView(hmtx.buffer); this.order.forEach((old, i) => { const m = f.metrics(old); dv.setUint16(i * 4, m.advance); dv.setInt16(i * 4 + 2, m.lsb); }); }

    const head = f.tableBytes('head')!;
    const hv = new DataView(head.buffer);
    hv.setUint32(8, 0); // checkSumAdjustment, fixed below
    hv.setInt16(50, 1); // long loca
    const hhea = f.tableBytes('hhea')!;
    new DataView(hhea.buffer).setUint16(34, n);
    const maxp = f.tableBytes('maxp')!;
    new DataView(maxp.buffer).setUint16(4, n);

    const tables: [string, Uint8Array][] = [['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', loca], ['maxp', maxp]];
    const os2 = f.tableBytes('OS/2');
    if (os2) tables.push(['OS/2', os2]);
    const postSrc = f.tableBytes('post');
    if (postSrc && postSrc.length >= 32) {
      const post = postSrc.slice(0, 32);
      new DataView(post.buffer).setUint32(0, 0x00030000); // format 3: no glyph names
      tables.push(['post', post]);
    }
    tables.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    const numTables = tables.length;
    let entrySelector = 0;
    while (1 << (entrySelector + 1) <= numTables) entrySelector++;
    const searchRange = (1 << entrySelector) * 16;
    const headerLen = 12 + numTables * 16;
    let total = headerLen;
    for (const [, b] of tables) total += pad4(b.length);
    const out = new Uint8Array(total);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, 0x00010000);
    ov.setUint16(4, numTables);
    ov.setUint16(6, searchRange);
    ov.setUint16(8, entrySelector);
    ov.setUint16(10, numTables * 16 - searchRange);
    let off = headerLen, headOffset = 0;
    tables.forEach(([tag, b], i) => {
      const r = 12 + i * 16;
      for (let k = 0; k < 4; k++) ov.setUint8(r + k, tag.charCodeAt(k));
      ov.setUint32(r + 4, checksum(b));
      ov.setUint32(r + 8, off);
      ov.setUint32(r + 12, b.length);
      out.set(b, off);
      if (tag === 'head') headOffset = off;
      off += pad4(b.length);
    });
    ov.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
    return out;
  }

  /** Node-stream-like interface expected by pdf-lib's CustomFontSubsetEmbedder. */
  encodeStream() {
    const handlers: Record<string, ((x?: unknown) => void)[]> = {};
    const emitter = {
      on(ev: string, cb: (x?: unknown) => void) { (handlers[ev] ??= []).push(cb); return emitter; },
    };
    setTimeout(() => {
      try {
        const bytes = this.encode();
        handlers.data?.forEach((h) => h(bytes));
        handlers.end?.forEach((h) => h());
      } catch (e) { handlers.error?.forEach((h) => h(e)); }
    }, 0);
    return emitter;
  }
}

/** The object passed to `PDFDocument.registerFontkit()`. */
export const miniFontkit = {
  create(data: Uint8Array | ArrayBuffer) {
    return new TtfFont(data instanceof Uint8Array ? data : new Uint8Array(data));
  },
};
