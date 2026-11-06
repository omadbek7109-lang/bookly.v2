/** EPUB 3 exporter (with EPUB 2 NCX fallback) built with JSZip. */
import JSZip from 'jszip';
import type { Block, Book } from '../../models/book';
import { isSingleText } from '../../models/book';
import { fontById } from '../../models/templates';
import { escapeXml, parseInline, type Run } from '../../utils/inline';
import { byLabel, chapterDisplayTitle, chapterLabel, exportFilename, langTag, tocLabel } from './common';
import { MIME, type ExportInput, type ExportOutput, type ResolvedAsset } from './types';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/aac': 'aac' };
const EPUB_CORE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/mp4']);

function inline(runs: Run[]): string {
  return runs.map((r) => {
    let s = escapeXml(r.text);
    if (r.underline) s = `<span class="u">${s}</span>`;
    if (r.italic) s = `<em>${s}</em>`;
    if (r.bold) s = `<strong>${s}</strong>`;
    return r.br ? `${s}<br/>` : s;
  }).join('');
}

function xhtml(book: Book, title: string, body: string, opts: { epubType?: string; bodyClass?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langTag(book)}" lang="${langTag(book)}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}${opts.epubType ? ` epub:type="${opts.epubType}"` : ''}>
${body}
</body>
</html>`;
}

function css(book: Book): string {
  const body = fontById(book.theme.bodyFont).css;
  const head = fontById(book.theme.headingFont).css;
  const accent = book.theme.accent;
  return `@charset "UTF-8";
body { font-family: ${body}; line-height: 1.6; color: ${book.theme.ink}; margin: 0 5%; }
h1, h2, h3, h4 { font-family: ${head}; line-height: 1.25; page-break-after: avoid; }
h1.chapter-title { font-size: 1.8em; margin: 0.2em 0 1em; padding-bottom: 0.4em; border-bottom: 2px solid ${accent}; }
p.chapter-label { font-family: sans-serif; text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75em; color: ${accent}; margin: 3em 0 0; font-weight: bold; }
p { margin: 0 0 0.8em; text-align: justify; }
.align-left { text-align: left; } .align-center { text-align: center; } .align-right { text-align: right; } .align-justify { text-align: justify; }
blockquote { margin: 1.2em 0; padding: 0.2em 0 0.2em 1em; border-left: 3px solid ${accent}; font-style: italic; }
blockquote cite { display: block; font-style: normal; font-size: 0.85em; color: #6b6b7b; margin-top: 0.3em; }
.u { text-decoration: underline; }
figure { margin: 1.2em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figure.small img { max-width: 45%; } figure.medium img { max-width: 70%; }
figcaption { font-size: 0.85em; color: #6b6b7b; font-style: italic; margin-top: 0.4em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #c9c7d9; padding: 0.35em 0.5em; text-align: left; vertical-align: top; }
th { background: #edebfb; }
hr { border: 0; border-top: 1px solid ${accent}; width: 30%; margin: 2em auto; }
.pagebreak { page-break-after: always; break-after: page; }
.audio { margin: 1em 0; padding: 0.6em; border: 1px solid #e3e1f0; border-radius: 6px; }
.audio p { margin: 0 0 0.4em; font-size: 0.9em; color: ${accent}; }
.title-page { text-align: center; margin-top: 20%; }
.title-page h1 { font-size: 2.2em; margin-bottom: 0.2em; }
.title-page .subtitle { font-style: italic; color: #6b6b7b; text-align: center; }
.title-page .author { margin-top: 2em; text-align: center; }
.title-page .description { margin-top: 2em; font-size: 0.9em; color: #6b6b7b; text-align: center; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
nav ol { list-style: none; padding-left: 0; } nav li { margin: 0.4em 0; } nav a { text-decoration: none; color: inherit; }
`;
}

export async function exportEpub(input: ExportInput): Promise<ExportOutput> {
  const { book, assets, options } = input;
  const single = isSingleText(book);
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const manifest: string[] = [];
  const spine: string[] = [];
  const usedMedia = new Map<string, { href: string; mime: string }>();
  const mediaHref = (a: ResolvedAsset): string | null => {
    if (!EPUB_CORE_MEDIA.has(a.mime) && !a.mime.startsWith('audio/')) return null;
    const existing = usedMedia.get(a.id);
    if (existing) return existing.href;
    const folder = a.mime.startsWith('audio/') ? 'audio' : 'images';
    const href = `${folder}/${a.id}.${EXT[a.mime] ?? 'bin'}`;
    zip.file(`OEBPS/${href}`, a.bytes);
    usedMedia.set(a.id, { href, mime: a.mime });
    return href;
  };

  zip.file('OEBPS/css/style.css', css(book));
  manifest.push('<item id="css" href="css/style.css" media-type="text/css"/>');

  // --- cover
  if (options.includeCover && input.cover) {
    const ext = input.cover.mime === 'image/png' ? 'png' : 'jpg';
    zip.file(`OEBPS/images/cover.${ext}`, input.cover.bytes);
    manifest.push(`<item id="cover-image" href="images/cover.${ext}" media-type="${input.cover.mime}" properties="cover-image"/>`);
    zip.file('OEBPS/cover.xhtml', xhtml(book, book.title, `<section class="cover" epub:type="cover"><img src="images/cover.${ext}" alt="${escapeXml(book.title)}"/></section>`));
    manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="cover" linear="yes"/>');
  }

  // --- title page
  const titleBody = `<section class="title-page" epub:type="titlepage">
  <h1>${escapeXml(book.title)}</h1>
  ${book.subtitle ? `<p class="subtitle">${escapeXml(book.subtitle)}</p>` : ''}
  ${book.author ? `<p class="author">${escapeXml(byLabel(book))} ${escapeXml(book.author)}</p>` : ''}
  ${book.description ? `<p class="description">${inline(parseInline(book.description))}</p>` : ''}
</section>`;
  zip.file('OEBPS/title.xhtml', xhtml(book, book.title, titleBody));
  manifest.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>');
  spine.push('<itemref idref="title"/>');

  // --- nav (always present in EPUB 3; shown in reading order only if includeToc)
  const navItems = single
    ? `<li><a href="chapter-1.xhtml">${escapeXml(book.title)}</a></li>`
    : book.chapters.map((c, i) => `<li><a href="chapter-${i + 1}.xhtml">${escapeXml(chapterDisplayTitle(book, c, i))}</a></li>`).join('\n      ');
  const nav = `<nav epub:type="toc" id="toc"><h1>${escapeXml(tocLabel(book))}</h1>
    <ol>
      ${navItems}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden"><ol>
    <li><a epub:type="titlepage" href="title.xhtml">${escapeXml(book.title)}</a></li>
    <li><a epub:type="bodymatter" href="chapter-1.xhtml">${escapeXml(chapterDisplayTitle(book, book.chapters[0], 0))}</a></li>
  </ol></nav>`;
  zip.file('OEBPS/nav.xhtml', xhtml(book, tocLabel(book), nav));
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  spine.push(`<itemref idref="nav" linear="${options.includeToc && !single ? 'yes' : 'no'}"/>`);

  // --- chapters
  book.chapters.forEach((ch, i) => {
    const title = chapterDisplayTitle(book, ch, i);
    const body = [`<section epub:type="${single ? 'bodymatter' : 'chapter'}" id="chapter-${i + 1}">`,
      ...(single ? [] : [`<p class="chapter-label">${escapeXml(chapterLabel(book, i))}</p>`, `<h1 class="chapter-title">${escapeXml(title)}</h1>`]),
      ...ch.blocks.map((b) => blockHtml(b)),
      '</section>'].join('\n');
    zip.file(`OEBPS/chapter-${i + 1}.xhtml`, xhtml(book, single ? book.title : title, body));
    manifest.push(`<item id="ch${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i + 1}"/>`);
  });

  function blockHtml(b: Block): string {
    const al = 'align' in b && b.align ? ` class="align-${b.align}"` : '';
    switch (b.type) {
      case 'heading': return `<h${b.level + 1}${al}>${inline(parseInline(b.html))}</h${b.level + 1}>`;
      case 'paragraph': { const c = inline(parseInline(b.html)); return c ? `<p${al}>${c}</p>` : ''; }
      case 'quote': return `<blockquote><p>${inline(parseInline(b.html))}</p>${b.cite ? `<cite>— ${escapeXml(b.cite)}</cite>` : ''}</blockquote>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = b.items.filter((x) => x.trim()).map((x) => `<li>${inline(parseInline(x))}</li>`).join('');
        return items ? `<${tag}>${items}</${tag}>` : '';
      }
      case 'image': {
        const a = b.assetId ? assets[b.assetId] : undefined;
        const href = a ? mediaHref(a) : null;
        if (!href) return '';
        return `<figure class="${b.width}"><img src="${href}" alt="${escapeXml(b.caption || 'image')}"/>${b.caption ? `<figcaption>${escapeXml(b.caption)}</figcaption>` : ''}</figure>`;
      }
      case 'table': {
        const rows = b.rows.map((r, ri) => {
          const tag = b.header && ri === 0 ? 'th' : 'td';
          return `<tr>${r.map((c) => `<${tag}>${escapeXml(c)}</${tag}>`).join('')}</tr>`;
        });
        const head = b.header && rows.length ? `<thead>${rows[0]}</thead>` : '';
        const bodyRows = (b.header ? rows.slice(1) : rows).join('');
        return `<table>${head}<tbody>${bodyRows}</tbody></table>`;
      }
      case 'divider': return '<hr/>';
      case 'pagebreak': return '<div class="pagebreak"></div>';
      case 'audio': {
        const a = b.assetId ? assets[b.assetId] : undefined;
        const href = a ? mediaHref(a) : null;
        const label = escapeXml(b.title || 'Audio');
        if (!href) return `<div class="audio"><p>♪ ${label}</p></div>`;
        return `<div class="audio"><p>♪ ${label}</p><audio controls="controls" src="${href}"><a href="${href}">${label}</a></audio></div>`;
      }
      default: return '';
    }
  }

  const imgCounter = { n: 0 };
  for (const [id, m] of usedMedia) {
    manifest.push(`<item id="m-${++imgCounter.n}-${id}" href="${m.href}" media-type="${m.mime}"/>`);
  }

  // --- NCX (EPUB 2 readers)
  const uuid = toUuid(book.id);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${langTag(book)}">
  <head><meta name="dtb:uid" content="urn:uuid:${uuid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${(single ? book.chapters.slice(0, 1) : book.chapters).map((c, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(chapterDisplayTitle(book, c, i))}</text></navLabel><content src="chapter-${i + 1}.xhtml"/></navPoint>`).join('\n')}
  </navMap>
</ncx>`;
  zip.file('OEBPS/toc.ncx', ncx);
  manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

  const modified = new Date(book.updatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${langTag(book)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>${langTag(book)}</dc:language>
    <dc:creator id="author">${escapeXml(book.author || 'Bookly')}</dc:creator>
    ${book.description ? `<dc:description>${escapeXml(book.description)}</dc:description>` : ''}
    ${book.metadata.publisher ? `<dc:publisher>${escapeXml(book.metadata.publisher)}</dc:publisher>` : ''}
    ${book.metadata.rights ? `<dc:rights>${escapeXml(book.metadata.rights)}</dc:rights>` : ''}
    <dc:subject>${escapeXml(book.category)}</dc:subject>
    ${book.metadata.keywords.map((k) => `<dc:subject>${escapeXml(k)}</dc:subject>`).join('\n    ')}
    <dc:date>${new Date(book.createdAt).toISOString().slice(0, 10)}</dc:date>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="generator" content="Bookly 2.0"/>
    ${options.includeCover && input.cover ? '<meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spine.join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf.replace(/\n\s*\n/g, '\n'));

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/epub+zip' });
  return { bytes, mime: MIME.epub, filename: exportFilename(book, 'epub'), extension: 'epub' };
}

function toUuid(id: string): string {
  let h = '';
  for (let i = 0; h.length < 32; i++) h += ((id.charCodeAt(i % id.length) * (i + 7)) % 16).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
