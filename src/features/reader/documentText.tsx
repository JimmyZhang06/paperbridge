import React from 'react';
import type { Paper, Paragraph, Note } from './models';

export const makeParagraphs = (paper: Paper): Paragraph[] => {
  let section = '';
  const heading = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|background|related literature|literature review|method|methods|methodology|participants|procedure|procedures|measures|materials|data analysis|data reduction and analysis|results|discussion|conclusion|limitations|summary and future directions|hypotheses|acknowledgments?|references|appendix(?:\s+[a-z])?)\s*:?$/i;
  return paper.pages.flatMap(page => page.paragraphs.flatMap((text, index) => {
    const block = page.blocks?.[index];
    if (!text.trim() || block?.hidden || block?.kind === 'metadata' || block?.kind === 'title') return [];
    const trimmed = text.trim();
    const numbered = trimmed.match(/^(\d+(?:\.\d+){0,2})\.?\s+([A-Z][\p{L}\s&/-]{1,75})$/u);
    const inferredHeading = heading.test(trimmed) || Boolean(numbered && (heading.test(numbered[2]) || /^(materials and methods|vibroacoustic technology|meditation)$/i.test(numbered[2]) || block?.runs?.every(run => run.bold || !run.text.trim())));
    const kind = block?.kind === 'heading' || inferredHeading ? 'heading' as const : block?.kind;
    if (kind === 'heading') section = trimmed;
    if (kind === 'abstract') section = 'Abstract';
    return [{ id: block?.id || `${page.page}-${index}`, page: page.page, text, kind, headingLevel: kind === 'heading' ? (block?.headingLevel || Math.min(3,numbered?.[1].split('.').length || 1) as 1|2|3) : undefined, runs: block?.runs, bbox: block?.bbox, figureCrop: block?.figureCrop, section }];
  }));
};
export const readingParagraph = (paragraphs: Paragraph[], page: number) => paragraphs.find(item => item.page === page && (item.kind === 'paragraph' || item.kind === 'abstract' || !item.kind)) || paragraphs.find(item => item.page === page && !['heading','authors','affiliation'].includes(item.kind || ''));
export const paragraphAfterHeading = (paragraphs: Paragraph[], heading: Paragraph) => {
  const index = paragraphs.findIndex(item => item.id === heading.id);
  for (const item of paragraphs.slice(index + 1)) {
    if (item.kind === 'heading' && (item.headingLevel || 1) <= (heading.headingLevel || 1)) break;
    if (item.kind === 'paragraph' || item.kind === 'abstract' || !item.kind) return item;
  }
  return heading;
};
export const snippet = (text: string) => text.replace(/\s+/g, ' ').slice(0, 110);
export const withTimesNumerals = (text: string) => text.split(/(\d+(?:[.,]\d+)*)/g).map((part, index) =>
  /^\d/.test(part) ? <span className="paper-number" key={`num-${index}`}>{part}</span> : <React.Fragment key={`text-${index}`}>{part}</React.Fragment>,
);
export const overlapsVisualCrop = (paragraph: Paragraph, pageParagraphs: Paragraph[]) => {
  if (paragraph.kind === 'caption' || paragraph.kind === 'heading' || paragraph.kind === 'title' || paragraph.kind === 'authors') return false;
  const panelLabel = /^[a-h]$/i.test(paragraph.text.trim());
  if (!paragraph.bbox && !panelLabel) return false;
  if (!paragraph.bbox) return false;
  const [x, y, width, height] = paragraph.bbox;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return pageParagraphs.some(caption => {
    const crop = caption.kind === 'caption' ? caption.figureCrop : undefined;
    if (!crop) return false;
    const [cropX, cropY, cropWidth, cropHeight] = crop;
    const nearVisual = panelLabel && centerY >= cropY - 0.1 && centerY <= cropY + cropHeight + 0.06
      && centerX >= cropX - 0.04 && centerX <= cropX + cropWidth + 0.04;
    return nearVisual || (centerX >= cropX && centerX <= cropX + cropWidth && centerY >= cropY && centerY <= cropY + cropHeight);
  });
};
export const progressFor = (paper?: Paper) => Math.round((paper?.completedStages?.length || 0) / 6 * 100);

export function OriginalTextBlock({ paragraph, index, active, marked, onSelect }: { paragraph: Paragraph; index: number; active: boolean; marked?: Note; onSelect: () => void }) {
  const start = marked?.passage ? paragraph.text.indexOf(marked.passage) : -1;
  const end = start >= 0 ? start + marked!.passage.length : -1;
  let offset = 0;
  const content = paragraph.runs?.length ? paragraph.runs.map((run, runIndex) => {
    const from = offset;
    const to = from + run.text.length;
    offset = to;
    const segments = start >= 0 && start < to && end > from
      ? [run.text.slice(0, Math.max(0, start - from)), run.text.slice(Math.max(0, start - from), Math.min(run.text.length, end - from)), run.text.slice(Math.min(run.text.length, end - from))].filter(Boolean)
      : [run.text];
    return segments.map((segment, segmentIndex) => {
      const segmentStart = from + segments.slice(0, segmentIndex).reduce((sum, text) => sum + text.length, 0);
      const highlighted = start >= 0 && segmentStart < end && segmentStart + segment.length > start;
      let node: React.ReactNode = withTimesNumerals(segment);
      if (highlighted) node = <mark className={`paper-mark paper-mark-${marked?.highlightColor || 'yellow'}`}>{node}</mark>;
      if (run.vertical) {
        // Author affiliation markers are always superscripts in journal bylines;
        // PDFs sometimes encode one marker with a noisy lower baseline.
        const affiliationMarker = paragraph.kind === 'authors' && /^[\d\s,;–—-]+$/.test(run.text);
        node = run.vertical === 'super' || affiliationMarker ? <sup>{node}</sup> : <sub>{node}</sub>;
      }
      if (run.italic) node = <em>{node}</em>;
      if (run.bold) node = <strong>{node}</strong>;
      return <React.Fragment key={`${runIndex}-${segmentIndex}`}>{node}</React.Fragment>;
    });
  }) : withTimesNumerals(paragraph.text);
  const common = { 'data-paragraph-id': paragraph.id, onClick: () => { if (!window.getSelection()?.toString().trim()) onSelect(); } };
  if (paragraph.kind === 'metadata' || paragraph.kind === 'title') return null;
  if (paragraph.kind === 'authors') return <p {...common} className={`paper-authors-block ${active ? 'paragraph-active' : ''}`}>{content}</p>;
  if (paragraph.kind === 'affiliation') return <p {...common} className={`paper-affiliation ${active ? 'paragraph-active' : ''}`}>{content}</p>;
  if (paragraph.kind === 'abstract') return <section className="paper-abstract"><h2>Abstract</h2><p {...common} className={`paper-paragraph paper-abstract-copy ${active ? 'paragraph-active' : ''}`}>{content}</p></section>;
  if (paragraph.kind === 'heading') {
    const Heading = paragraph.headingLevel === 3 ? 'h4' : paragraph.headingLevel === 2 ? 'h3' : 'h2';
    return <Heading {...common} className={`paper-section-heading paper-heading-level-${paragraph.headingLevel || 1} ${active ? 'paragraph-active' : ''}`}>{content}</Heading>;
  }
  if (paragraph.kind === 'caption') return <p {...common} className={`paper-paragraph paper-caption ${active ? 'paragraph-active' : ''}`}><span className="paragraph-index">{String(index + 1).padStart(2, '0')}</span>{content}</p>;
  return <p {...common} className={`paper-paragraph ${paragraph.kind === 'reference' ? 'paper-reference' : ''} ${active ? 'paragraph-active' : ''}`}><span className="paragraph-index">{String(index + 1).padStart(2, '0')}</span>{content}</p>;
}
