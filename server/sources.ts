import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument as openPdf } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { uploadDir } from './store.js';
import type { Paper, SourceAnchor } from './types.js';

export const normalizeText = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

export function sourceAnchor(paper: Paper, pageNumber: number, passage: string, hint?: Partial<SourceAnchor>): SourceAnchor {
  const page = paper.pages.find(item => item.page === pageNumber);
  if (!page) throw Object.assign(new Error('原文页码不在这篇论文中。'),{status:400});
  const exact = normalizeText(passage);
  if (!exact || !normalizeText(page.text).includes(exact)) throw Object.assign(new Error('所选内容无法在原文中完整核对，请重新选择。'),{status:400});
  const block = page.blocks?.find(item => item.id === hint?.blockId && normalizeText(item.text).includes(exact))
    || page.blocks?.find(item => !item.hidden && normalizeText(item.text).includes(exact));
  const text = normalizeText(block?.text || page.text);
  const start = text.indexOf(exact);
  const rects = hint?.rects?.filter(rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite)
    && rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0 && rect[0] + rect[2] <= 1.005 && rect[1] + rect[3] <= 1.005).slice(0, 200);
  return {
    paperId: paper.id, fileHash: paper.fileHash || `legacy-${paper.id}`,
    extractionRevision: paper.extractionRevision || 'legacy', pageIndex: pageNumber - 1,
    blockId: block?.id,
    quote: { exact: passage.trim(), prefix: text.slice(Math.max(0, start - 80), start), suffix: text.slice(start + exact.length, start + exact.length + 80) },
    rects: rects?.length ? rects : block ? [block.bbox] : undefined,
  };
}

export function reconcileAnchors(paper: Paper, records: Array<{ anchor?: SourceAnchor; page: number; passage: string }>) {
  for (const record of records) {
    try { record.anchor = sourceAnchor(paper, record.page, record.passage); }
    catch { /* Preserve the original version and quote; the UI offers the original page. */ }
  }
}

const originalPageCache=new Map<string,string>();
/** A PDF selection may have different spacing or subscript order from the reconstructed text. */
export async function verifiedSourceAnchor(paper:Paper,pageNumber:number,passage:string,hint?:Partial<SourceAnchor>) {
  try { return sourceAnchor(paper,pageNumber,passage,hint); }
  catch(error) {
    if(!paper.pages.some(page=>page.page===pageNumber))throw error;
    const key=`${paper.fileHash || paper.id}:${pageNumber}`;
    let original=originalPageCache.get(key);
    if(original===undefined){
      const task=openPdf({data:new Uint8Array(await readFile(path.join(uploadDir,paper.fileKey))),useSystemFonts:true});
      try {
        const document=await task.promise;
        const content=await (await document.getPage(pageNumber)).getTextContent();
        original=content.items.map(item=>'str' in item ? item.str : '').join(' ');
        originalPageCache.set(key,original);
        if(originalPageCache.size>32)originalPageCache.delete(originalPageCache.keys().next().value!);
      } finally {await task.destroy();}
    }
    if(!normalizeText(original).includes(normalizeText(passage)))throw error;
    const originalPaper={...paper,pages:paper.pages.map(page=>page.page===pageNumber?{...page,text:original!,blocks:[]}:page)};
    return sourceAnchor(originalPaper,pageNumber,passage,hint);
  }
}
