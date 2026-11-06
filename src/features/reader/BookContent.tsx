import type { CSSProperties } from 'react';
import { isSingleText, type Block, type Book, type Chapter } from '../../models/book';
import { fontById } from '../../models/templates';
import { useAssetUrl } from '../../hooks/useAssetUrl';
import { chapterLabel } from '../../services/export/common';
import { sanitizeInline } from '../../utils/inline';

/** Read-only rendering of the document model (reader + live preview). HTML is re-sanitized. */
export function ChapterContent({ book, chapter, index, style }: { book: Book; chapter: Chapter; index: number; style?: CSSProperties }) {
  const label = chapterLabel(book, index);
  return (
    <article className="book-content" style={{ '--accent': book.theme.accent, '--heading-font': fontById(book.theme.headingFont).css, '--body-font': fontById(book.theme.bodyFont).css, ...style } as CSSProperties}>
      {!isSingleText(book) && (
        <>
          <p className="bc-label">{label}</p>
          <h1 className="bc-title">{chapter.title || label}</h1>
          <span className="bc-rule" />
        </>
      )}
      {chapter.blocks.map((b) => <BlockRender key={b.id} b={b} />)}
    </article>
  );
}

function Html({ tag: Tag, html, className }: { tag: 'p' | 'h2' | 'h3' | 'h4' | 'li'; html: string; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: sanitizeInline(html) }} />;
}

function BlockRender({ b }: { b: Block }) {
  switch (b.type) {
    case 'heading': return <Html tag={`h${b.level + 1}` as 'h2'} html={b.html} className={`align-${b.align ?? 'left'}`} />;
    case 'paragraph': return b.html ? <Html tag="p" html={b.html} className={`align-${b.align ?? 'justify'}`} /> : null;
    case 'quote': return <blockquote><Html tag="p" html={b.html} />{b.cite && <cite>— {b.cite}</cite>}</blockquote>;
    case 'list': { const L = b.ordered ? 'ol' : 'ul'; return <L>{b.items.filter((x) => x.trim()).map((x, i) => <Html key={i} tag="li" html={x} />)}</L>; }
    case 'image': return <ImageRender b={b} />;
    case 'table': return (
      <div className="table-scroll"><table>
        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (b.header && ri === 0 ? <th key={ci}>{c}</th> : <td key={ci}>{c}</td>))}</tr>)}</tbody>
      </table></div>
    );
    case 'divider': return <hr />;
    case 'pagebreak': return <div className="bc-pagebreak" aria-hidden="true" />;
    case 'audio': return <AudioRender assetId={b.assetId} title={b.title} />;
    default: return null;
  }
}

function ImageRender({ b }: { b: Extract<Block, { type: 'image' }> }) {
  const url = useAssetUrl(b.assetId);
  if (!url) return null;
  return <figure className={`img-${b.width}`}><img src={url} alt={b.caption} loading="lazy" />{b.caption && <figcaption>{b.caption}</figcaption>}</figure>;
}

function AudioRender({ assetId, title }: { assetId: string | null; title: string }) {
  const url = useAssetUrl(assetId);
  return <div className="bc-audio"><p>♪ {title || 'Audio'}</p>{url && <audio controls src={url} preload="none" />}</div>;
}
