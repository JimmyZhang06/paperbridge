import type { SourceAnchor } from '../../../server/types';
export type { SourceAnchor, SourceEvidence } from '../../../server/types';

export function textKey(text: string) {
  let hash = 2166136261, second = 5381;
  for (const character of text) { const value = character.codePointAt(0)!; hash = Math.imul(hash ^ value,16777619); second = Math.imul(second,33) ^ value; }
  return `${(hash>>>0).toString(16)}${(second>>>0).toString(16)}`;
}
export const cleanQuote = (text: string) => text.normalize('NFKC').replace(/\s+/g,' ').trim();
export function makeAnchor(paper: { id: string; fileHash?: string; extractionRevision?: string }, paragraph: { id: string; page: number; text: string; bbox?: [number,number,number,number]; anchor?: SourceAnchor }): SourceAnchor {
  return paragraph.anchor || { paperId: paper.id, fileHash: paper.fileHash || `legacy-${paper.id}`, extractionRevision: paper.extractionRevision || 'legacy', pageIndex: paragraph.page-1,
    blockId: paragraph.id, quote: { exact: paragraph.text, prefix: '', suffix: '' }, rects: paragraph.bbox ? [paragraph.bbox] : undefined };
}
export function locateSource<T extends { id: string; page: number; text: string }>(paragraphs: T[], anchor?: SourceAnchor, page?: number, text?: string): T | undefined {
  const pageNumber = anchor ? anchor.pageIndex+1 : page;
  const candidates = paragraphs.filter(item => item.page === pageNumber);
  const exact = cleanQuote(anchor?.quote?.exact || text || '');
  const byId = candidates.find(item => item.id === anchor?.blockId && (!exact || cleanQuote(item.text).includes(exact)));
  if (byId) return byId;
  const matches = candidates.filter(item => exact && cleanQuote(item.text).includes(exact));
  if (matches.length === 1) return matches[0];
  return matches.find(item => anchor?.quote?.prefix && cleanQuote(item.text).includes(cleanQuote(anchor.quote.prefix)));
}
