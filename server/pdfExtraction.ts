import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfBlockKind, PdfExtractionSummary, PdfPageQuality, PdfTextBlock } from './types.js';

export type RawText = { text: string; x: number; y: number; baseline: number; width: number; height: number; fontSize: number; fontName: string; bold: boolean; italic: boolean; hasEOL: boolean };
type PdfJsTextItem = { str: string; transform: number[] | Float32Array; width: number; height: number; fontName: string; hasEOL: boolean };
type TextLine = { items: RawText[]; text: string; x: number; y: number; width: number; height: number; fontSize: number; headingCandidate?: boolean; column: 'left' | 'right' | 'full' | 'single' };
type ParsedPage = { page: number; width: number; height: number; lines: TextLine[]; itemCount: number };
type ExtractedPage = { page: number; text: string; blocks: PdfTextBlock[]; quality: PdfPageQuality };

const sectionHeading = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|background|related work|method(?:s|ology)?|participants|procedure|measures|materials|data (?:collection|analysis|reduction)|results|discussion|conclusion|limitations?|future directions|acknowledg(?:e)?ments?|references|supplement(?:ary)?(?: materials?)?|appendix(?:\s+[a-z])?)\s*:?$/i;
const captionStart = /^(?:(?:supplementary|extended data)\s+)?(?:figure|fig\.?|table)\s*(?:\d+[a-z]?(?=[.:\s]|$)|\d+(?=[A-Z][a-z])|[IVX]+)(?:[.:\s]|$|(?=[A-Z][a-z]))/i;
const captionDiscussion = /^(?:figure|fig\.?|table)\s*\d+[a-z]?\s+(?:also\s+)?(?:shows?|presents?|illustrates?|summari[sz]es?|reports?|depicts?|provides?|demonstrates?|indicates?|lists?|displays?|compares?|contains?|is\b|was\b|can\b)/i;
const referenceStart = /^(?:\[\d{1,3}\]|\d{1,3}\.\s+|[A-Z][A-Za-z'’-]+,?\s+.{0,80}\(\d{4}[a-z]?\))/;
const doiPattern = /\b10\.\d{4,9}\/[\w.()/:;-]+/i;

function cleanText(value: string) {
  return value.replace(/\u00ad/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizedLine(value: string) {
  return cleanText(value).toLocaleLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}#]+/gu, ' ').trim();
}

function isStyledHeading(line: TextLine, medianFont: number) {
  const text = line.text.trim();
  if (text.length < 3) return false;
  const boldFraction = line.items.filter(item => item.bold).length / Math.max(1, line.items.length);
  return sectionHeading.test(text)
    || (text.length < 130 && !/[.!?]["')\]]?$/.test(text)
      && (line.fontSize > medianFont * 1.75 || (boldFraction > 0.7 && line.fontSize > medianFont * 1.2)))
    || Boolean(line.headingCandidate);
}

function isTextItem(item: unknown): item is PdfJsTextItem {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<PdfJsTextItem>;
  return typeof candidate.str === 'string' && (Array.isArray(candidate.transform) || candidate.transform instanceof Float32Array);
}

function linesFromItems(items: RawText[], pageWidth: number): TextLine[] {
  // Place normal-size runs before smaller glyphs, so superscripts/subscripts
  // attach to their visual line instead of becoming a separate trailing row.
  const sizes=items.map(item=>item.fontSize).sort((a,b)=>a-b);
  const bodySize=sizes[Math.floor(sizes.length/2)] || 10;
  const ordered=[...items].sort((a,b)=>Number(b.fontSize>=bodySize*.9)-Number(a.fontSize>=bodySize*.9) || a.y-b.y || a.x-b.x);
  const rows:RawText[][]=[];
  for(const item of ordered){
    const candidates=rows.flatMap(row=>{
      const anchor=row.reduce((best,current)=>current.fontSize>best.fontSize?current:best,row[0]!);
      const normal=Math.abs(anchor.y-item.y)<=Math.max(2.2,Math.min(5,item.fontSize*.38));
      const small=item.fontSize<anchor.fontSize*.88;
      const nearX=row.some(run=>item.x<=run.x+run.width+anchor.fontSize*.8 && item.x+item.width>=run.x-anchor.fontSize*.8);
      const script=small && nearX && Math.abs(item.baseline-anchor.baseline)<=anchor.fontSize*.6;
      return normal || script ? [{row,distance:Math.abs(item.baseline-anchor.baseline)}] : [];
    }).sort((a,b)=>a.distance-b.distance);
    if(candidates[0])candidates[0].row.push(item);else rows.push([item]);
  }
  const repeatedColumnStarts = new Map<number, number>();
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index++) {
      const previous = sorted[index - 1]!;
      const item = sorted[index]!;
      const gap = item.x - (previous.x + previous.width);
      if (gap < Math.max(5, item.fontSize * 0.55, pageWidth * 0.008)) continue;
      if (item.x < pageWidth * 0.46 || item.x > pageWidth * 0.63) continue;
      if (previous.x + previous.width < pageWidth * 0.36 || previous.x + previous.width > pageWidth * 0.53) continue;
      const bucket = Math.round(item.x / 3) * 3;
      repeatedColumnStarts.set(bucket, (repeatedColumnStarts.get(bucket) || 0) + 1);
    }
  }
  const likelyColumnStart = [...repeatedColumnStarts].sort((a, b) => b[1] - a[1])[0];
  const columnStartX = likelyColumnStart && likelyColumnStart[1] >= 5 ? likelyColumnStart[0] : null;
  const lines: TextLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // A PDF text layer often emits left and right columns as one visual row.
    // Keep ordinary word spacing together, but split at a clear horizontal
    // gutter so the later column classifier can restore natural reading order.
    const clusters: RawText[][] = [];
    let cluster: RawText[] = [];
    let endX = Number.NEGATIVE_INFINITY;
    for (const item of row) {
      const gap = item.x - endX;
      const gutterGap = Math.max(5, item.fontSize * 0.55, pageWidth * 0.008);
      // First lines of paragraphs are sometimes indented by one text run.
      const crossesLikelyGutter = columnStartX !== null && Math.abs(item.x - columnStartX) <= 16;
      const crossesWideGutter = item.x >= pageWidth * 0.29 && item.x <= pageWidth * 0.7
        && endX <= pageWidth * 0.49 && gap > pageWidth * 0.045;
      if (cluster.length && gap > gutterGap && (crossesLikelyGutter || crossesWideGutter)) {
        clusters.push(cluster);
        cluster = [];
      }
      cluster.push(item);
      endX = Math.max(endX, item.x + item.width);
    }
    if (cluster.length) clusters.push(cluster);
    for (const group of clusters) {
      let text = '';
      let groupEndX = Number.NEGATIVE_INFINITY;
      let trailingSpace = false;
      for (const item of group) {
        const value = item.text.replace(/\s+$/g, '');
        if (!value) { trailingSpace = trailingSpace || /\s/.test(item.text);continue; }
        const gap = item.x - groupEndX;
        if (text && !/\s$/.test(text) && !/^\s/.test(value) && (trailingSpace || gap > Math.max(1.2, item.fontSize * 0.16)) && !/[-‐‑]$/.test(text)) text += ' ';
        text += value;
        trailingSpace = /\s$/.test(item.text);
        groupEndX = Math.max(groupEndX, item.x + item.width);
      }
      if (!text.trim()) continue;
      const first = group[0]!;
      const x = Math.min(...group.map(item => item.x));
      const right = Math.max(...group.map(item => item.x + item.width));
      const fontSize = group.reduce((sum, item) => sum + item.fontSize, 0) / group.length;
      lines.push({ items: group, text: cleanText(text), x, y: first.y, width: right - x, height: Math.max(...group.map(item => item.height)), fontSize, column: 'single' });
    }
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

function findColumnGutter(lines: TextLine[], pageWidth: number) {
  // Full-width title, abstract, and table lines should not hide a two-column
  // body layout. Use shorter body-like lines to estimate the central gutter.
  const candidatesLines = lines.filter(line => line.width <= pageWidth * 0.58);
  if (candidatesLines.length < 16) return null;
  const candidates: Array<{ x: number; score: number; left: number; right: number; crossing: number }> = [];
  for (let x = pageWidth * 0.25; x <= pageWidth * 0.65; x += pageWidth * 0.008) {
    const band = pageWidth * 0.004;
    let left = 0, right = 0, crossing = 0;
    for (const line of candidatesLines) {
      if (line.x + line.width < x - band) left++;
      else if (line.x > x + band) right++;
      else crossing++;
    }
    if (left < 8 || right < 8) continue;
    const score = (crossing / Math.max(1, lines.length)) + Math.abs(left - right) / Math.max(left, right) * 0.08;
    candidates.push({ x, score, left, right, crossing });
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (!best || best.crossing / candidatesLines.length > 0.36) return null;
  return best.x;
}

function paragraphGroups(lines: TextLine[], medianFont: number) {
  const groups: TextLine[][] = [];
  let current: TextLine[] = [];
  const expandedLines: TextLine[] = [];
  for (const line of lines) {
    const previous = expandedLines.at(-1);
    if (previous && sectionHeading.test(previous.text.trim())) {
      let splitHeading = false;
      for (let itemIndex = 1; itemIndex < line.items.length; itemIndex++) {
        const headingText = cleanText(line.items.slice(0, itemIndex).map(item => item.text).join(' '));
        const continuation = cleanText(line.items.slice(itemIndex).map(item => item.text).join(' '));
        if (headingText.length > 10 && headingText.length < 100 && /[.!?]$/.test(headingText)
          && !headingText.includes(',') && /^(?:We|This|These|The|In|Here|To|For|Overall|First|Second)\b/.test(continuation)) {
          const createLine = (items: RawText[], text: string, headingCandidate = false): TextLine => ({
            ...line,
            items,
            text,
            x: Math.min(...items.map(item => item.x)),
            width: Math.max(...items.map(item => item.x + item.width)) - Math.min(...items.map(item => item.x)),
            height: Math.max(...items.map(item => item.height)),
            fontSize: items.reduce((sum, item) => sum + item.fontSize, 0) / items.length,
            ...(headingCandidate ? { headingCandidate: true } : {}),
          });
          expandedLines.push(createLine(line.items.slice(0, itemIndex), headingText, true));
          expandedLines.push(createLine(line.items.slice(itemIndex), continuation));
          splitHeading = true;
          break;
        }
      }
      if (!splitHeading) expandedLines.push(line);
    } else expandedLines.push(line);
  }
  for (const line of expandedLines) {
    const previous = current.at(-1);
    const isHeading = isStyledHeading(line, medianFont);
    const isCaption = captionStart.test(line.text);
    const gap = previous ? line.y - (previous.y + previous.height) : 0;
    const indent = previous ? Math.abs(line.x - previous.x) : 0;
    const priorLooksComplete = previous && /[.!?]["')\]]?$/.test(previous.text);
    const priorIsHeading = previous && isStyledHeading(previous, medianFont);
    const split = Boolean(current.length && (
      gap > Math.max(5, medianFont * 0.82)
      || Boolean(priorIsHeading)
      || (priorLooksComplete && indent > medianFont * 1.05)
      || isHeading || isCaption
      || (line.text.length < 100 && sectionHeading.test(line.text))
    ));
    if (split) { groups.push(current); current = []; }
    current.push(line);
  }
  if (current.length) groups.push(current);
  return groups;
}

function blockKind(text: string, fontSize: number, medianFont: number, inReferences: boolean): PdfBlockKind {
  if (captionStart.test(text) && !captionDiscussion.test(text)) return 'caption';
  if (sectionHeading.test(text) || (text.length > 2 && text.length < 130 && !/[.!?]["')\]]?$/.test(text) && fontSize > medianFont * 1.75)) return 'heading';
  if (inReferences || referenceStart.test(text)) return 'reference';
  return text.length > 25 ? 'paragraph' : 'other';
}

function makeRuns(lines: TextLine[]) {
  const runs: Array<{ text: string; bold?: boolean; italic?: boolean; vertical?: 'super' | 'sub' }> = [];
  for (const line of lines) {
    const lineFontSize = Math.max(...line.items.map(item=>item.fontSize));
    const baselineValues = line.items.filter(item=>item.fontSize>=lineFontSize*.9).map(item => item.baseline).sort((a, b) => a - b);
    const baseline = baselineValues[Math.floor(baselineValues.length / 2)] || 0;
    let endX = Number.NEGATIVE_INFINITY;
    let trailingSpace = false;
    for (const item of line.items) {
      const value = item.text.replace(/\s+$/g, '');
      if (!value) {trailingSpace = trailingSpace || /\s/.test(item.text);continue;}
      const gap = item.x - endX;
      if (runs.length && !/\s$/.test(runs.at(-1)!.text) && !/^\s/.test(value) && (trailingSpace || gap > Math.max(1.2, item.fontSize * 0.16)) && !/[-‐‑]$/.test(runs.at(-1)!.text)) {
        const previous = runs.at(-1)!;
        previous.text += ' ';
      }
      const delta = item.baseline - baseline;
      // Baseline jitter in PDF text layers can make ordinary digits look like
      // alternating superscripts/subscripts. Only treat a glyph as raised or
      // lowered when it is both displaced and materially smaller than its line.
      const vertical = item.fontSize <= lineFontSize * 0.84 && Math.abs(delta) > Math.max(2, item.fontSize * 0.25)
        ? (delta > 0 ? 'super' as const : 'sub' as const) : undefined;
      const current = runs.at(-1);
      if (current && current.bold === (item.bold || undefined) && current.italic === (item.italic || undefined) && current.vertical === vertical) current.text += value;
      else runs.push({ text: value, ...(item.bold ? { bold: true } : {}), ...(item.italic ? { italic: true } : {}), ...(vertical ? { vertical } : {}) });
      endX = Math.max(endX, item.x + item.width);
      trailingSpace = /\s$/.test(item.text);
    }
    if (runs.length) runs.at(-1)!.text += ' ';
  }
  if (runs.length) runs.at(-1)!.text = runs.at(-1)!.text.trimEnd();
  return runs;
}

function makeBlock(page: ParsedPage, lines: TextLine[], medianFont: number, inReferences: boolean): PdfTextBlock {
  const text = cleanText(lines.map((line, index) => {
    const previous = lines[index - 1]?.text.trim();
    return index > 0 && previous && /^[A-Z]$/.test(previous) && /^[a-z]/.test(line.text.trim()) ? line.text : `${index ? ' ' : ''}${line.text}`;
  }).join(''));
  const x = Math.max(0, Math.min(...lines.map(line => line.x)));
  const y = Math.max(0, Math.min(...lines.map(line => line.y)));
  const right = Math.min(page.width, Math.max(...lines.map(line => line.x + line.width)));
  const bottom = Math.min(page.height, Math.max(...lines.map(line => line.y + line.height)));
  const fontSize = lines.reduce((sum, line) => sum + line.fontSize, 0) / lines.length;
  const suspicious = /\ufffd|(?:\S){45,}/.test(text);
  return {
    id: `${page.page}-${Math.round(y * 10)}-${Math.round(x * 10)}`,
    kind: lines.some(line => line.headingCandidate) ? 'heading' : blockKind(text, fontSize, medianFont, inReferences),
    text,
    fontSize,
    bbox: [x / page.width, y / page.height, Math.max(0, right - x) / page.width, Math.max(0, bottom - y) / page.height],
    confidence: suspicious ? 0.62 : 0.94,
    runs: makeRuns(lines),
    source: 'text-layer',
  };
}

function joinCaptionLegends(blocks: PdfTextBlock[]) {
  for(let index=0;index<blocks.length;index++) {
    const caption=blocks[index]!;
    if(caption.kind!=='caption' || !/^(?:(?:extended data|supplementary)\s+)?(?:figure|fig\.?|table)\s*\d+[a-z]?\.?$/i.test(caption.text.trim()))continue;
    for(let count=0;count<5;count++) {
      const next=blocks[index+1];
      if(!next || !['paragraph','other'].includes(next.kind) || captionStart.test(next.text) || next.text.length>1800)break;
      const gap=next.bbox[1]-(caption.bbox[1]+caption.bbox[3]);
      if(gap<-.002 || gap>.018 || Math.abs(next.bbox[0]-caption.bbox[0])>.035 || (next.fontSize || 10)>(caption.fontSize || 10)*1.45 || next.bbox[3]>.12)break;
      const right=Math.max(caption.bbox[0]+caption.bbox[2],next.bbox[0]+next.bbox[2]);
      const bottom=Math.max(caption.bbox[1]+caption.bbox[3],next.bbox[1]+next.bbox[3]);
      caption.runs=[...(caption.runs || [{text:caption.text}]),{text:' '},...(next.runs || [{text:next.text}])];
      caption.text+=' '+next.text;
      caption.bbox=[caption.bbox[0],caption.bbox[1],right-caption.bbox[0],bottom-caption.bbox[1]];
      blocks.splice(index+1,1);
    }
  }
}

export function addFigureCropHints(blocks: PdfTextBlock[]) {
  for (let index = 0; index < blocks.length; index++) {
    const caption = blocks[index]!;
    if (caption.kind !== 'caption') continue;
    if (caption.figureCrop) continue;
    const isFigure = /^(?:figure|fig\.?)[\s\d]/i.test(caption.text);
    const isTable = /^table[\s\d]/i.test(caption.text) && !/^table\s*\d+\s*[.:|–—-]?\s*note\s*:/i.test(caption.text);
    if (!isFigure && !isTable) continue;
    const previous = blocks.filter((block, candidateIndex) => candidateIndex !== index && block.bbox[1] + block.bbox[3] <= caption.bbox[1])
      .sort((a, b) => b.bbox[1] + b.bbox[3] - (a.bbox[1] + a.bbox[3]))[0];
    const next = blocks.filter((block, candidateIndex) => candidateIndex !== index && block.bbox[1] >= caption.bbox[1] + caption.bbox[3])
      .sort((a, b) => a.bbox[1] - b.bbox[1])[0];
    const beforeStart = previous ? previous.bbox[1] + previous.bbox[3] : 0.1;
    const beforeEnd = caption.bbox[1];
    const afterStart = caption.bbox[1] + caption.bbox[3];
    const afterEnd = next ? next.bbox[1] : 0.9;
    const beforeGap = beforeEnd - beforeStart;
    const afterGap = afterEnd - afterStart;
    const maxCropHeight = 0.58;
    const nextLooksLikeTable = Boolean(isTable && next && next.bbox[3] >= 0.14 && next.bbox[1] > afterStart);
    const followingProse = isTable ? blocks.filter((block, candidateIndex) => candidateIndex !== index
      && block.bbox[1] >= afterStart && block.kind === 'paragraph' && block.text.length > 100
      && /[.!?]["')\]]?$/.test(block.text.trim())
      && (block.text.match(/[A-Za-z]{3,}/g) || []).length >= 12)
      .sort((a, b) => a.bbox[1] - b.bbox[1])[0] : undefined;
    if (isTable && !nextLooksLikeTable && !followingProse && Math.max(beforeGap, afterGap) < 0.12) continue;
    let top: number, bottom: number;
    if (isFigure) {
      // Figures in journal PDFs usually sit above their caption. Text labels
      // and axis ticks inside the artwork can make the apparent whitespace
      // gap disappear, so use a bounded visual window ending at the caption.
      const height = Math.min(0.52, Math.max(0.12, caption.bbox[1] - 0.045));
      bottom = Math.max(0.05, caption.bbox[1] - 0.006);
      top = Math.max(0.06, bottom - height);
    } else if (isTable) {
      // Table cells often have no useful whitespace boundary. Include the area
      // after the caption through the first narrative paragraph, or a bounded
      // default height when extraction cannot identify where the table ends.
      top = Math.min(0.94, afterStart + 0.006);
      const inferredBottom = followingProse ? followingProse.bbox[1] - 0.012 : top + 0.42;
      bottom = Math.min(inferredBottom, top + maxCropHeight, 0.94);
    } else if (afterGap >= beforeGap) {
      top = Math.min(0.94, afterStart + 0.012);
      bottom = Math.min(afterEnd - 0.012, top + maxCropHeight);
    } else {
      bottom = Math.max(0.04, beforeEnd - 0.012);
      top = Math.max(beforeStart + 0.012, bottom - maxCropHeight);
    }
    const height = bottom - top;
    if (height >= 0.1) caption.figureCrop = [0.065, top, 0.87, height];
  }
}

/** Recover common first-page structure for old and newly imported papers. */
export function annotatePaperFrontMatter(page: { page: number; blocks?: PdfTextBlock[] }) {
  if (!page.blocks?.length) return;
  const blocks = page.blocks;
  for (const block of blocks) {
    if (block.kind !== 'heading') continue;
    const numbered = block.text.trim().match(/^(\d+(?:\.\d+)*)(?:[.)]|\s+)/);
    if (numbered) block.headingLevel = Math.min(3, numbered[1]!.split('.').length) as 1 | 2 | 3;
    else if (/^(?:abstract|introduction|background|related work|method(?:s|ology)?|results|discussion|conclusion|limitations?|references|appendix|supplement(?:ary)?)/i.test(block.text.trim())) block.headingLevel = 1;
    else block.headingLevel = 2;
  }
  if (page.page !== 1) return;
  for (const block of blocks) {
    const text = block.text.trim();
    if (block.bbox[1] < 0.14 && /^(?:articles?|research article|original research|type\b|published\b|open access\b|doi\b|nih public access|author manuscript|nih-pa author manuscript|published in final edited form)/i.test(text)) block.kind = 'metadata';
  }
  const titleCandidates = blocks.filter(block => (block.kind === 'heading' || block.kind === 'paragraph')
    && block.bbox[1] >= 0.14 && block.bbox[1] < 0.31 && block.bbox[2] > 0.25
    && block.text.trim().length > 12 && block.text.length < 180
    && !/^(?:open access|reviewed by|edited by|abstract|keywords|doi\b)/i.test(block.text)
    && !/\b(?:university|department|institute|centre|center|correspondence)\b/i.test(block.text));
  const titleSeed = [...titleCandidates].sort((a, b) => (b.fontSize || b.bbox[3]) - (a.fontSize || a.bbox[3]) || a.bbox[1] - b.bbox[1])[0];
  if (!titleSeed) return;
  const titleBlocks = titleCandidates.filter(block => Math.abs(block.bbox[0] - titleSeed.bbox[0]) < 0.07
    && block.bbox[1] >= titleSeed.bbox[1] - 0.005 && block.bbox[1] <= titleSeed.bbox[1] + 0.16
    && (block.fontSize || block.bbox[3]) >= (titleSeed.fontSize || titleSeed.bbox[3]) * 0.86);
  const mainColumnX = titleSeed.bbox[0];
  if (mainColumnX > 0.29) {
    for (const block of blocks) {
      const right = block.bbox[0] + block.bbox[2];
      if (block.bbox[1] < 0.72 && right < mainColumnX - 0.025) block.kind = 'metadata';
    }
  }
  for (const block of titleBlocks) block.kind = 'title';
  const titleBottom = Math.max(...titleBlocks.map(block => block.bbox[1] + block.bbox[3]));
  const abstractHeading = blocks.find(block => /^abstract\s*:?$/i.test(block.text.trim()) && block.bbox[1] > titleBottom);
  const byline = blocks.filter(block => block.kind !== 'metadata' && block.kind !== 'title'
    && block.bbox[0] >= mainColumnX - 0.03 && block.bbox[1] > titleBottom + 0.005
    && block.bbox[1] < Math.min(0.35, titleBottom + 0.09, (abstractHeading?.bbox[1] || 1) - 0.005))
    .sort((a, b) => a.bbox[1] - b.bbox[1]);
  if (byline[0]) byline[0].kind = 'authors';
  for (const block of byline.slice(1)) block.kind = 'affiliation';
  const authorBlock = byline[0];
  const affiliationStart = authorBlock?.text.search(/\b(?:Department of|Centre for|Center for|School of|Faculty of|University of|Institute of)\b/i) ?? -1;
  if (authorBlock && affiliationStart > 0) {
    const affiliationText = authorBlock.text.slice(affiliationStart).trim();
    authorBlock.text = authorBlock.text.slice(0, affiliationStart).trim().replace(/[;,\s]+$/, '');
    authorBlock.runs = undefined;
    blocks.splice(blocks.indexOf(authorBlock) + 1, 0, {
      ...authorBlock, id: `${authorBlock.id}-affiliation`, kind: 'affiliation', text: affiliationText, runs: undefined,
    });
  }
  const abstractStart = Math.max(titleBottom, ...byline.map(block => block.bbox[1] + block.bbox[3]));
  const abstract = blocks.filter(block => block.kind === 'paragraph' && block.bbox[0] >= mainColumnX - 0.03
    && block.bbox[1] > Math.max(abstractStart, abstractHeading?.bbox[1] || 0) && block.bbox[1] < 0.67 && block.text.replace(/\s/g, '').length > 240)
    .sort((a, b) => a.bbox[1] - b.bbox[1])[0];
  if (abstract) {
    abstract.kind = 'abstract';
    if (abstractHeading) abstractHeading.kind = 'metadata';
  }
}

function buildBlocks(page: ParsedPage, inReferences: boolean) {
  if (!page.lines.length) return [];
  const fontSizes = page.lines.map(line => line.fontSize).sort((a, b) => a - b);
  const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] || 10;
  const gutter = findColumnGutter(page.lines, page.width);
  const lines = page.lines.map(line => {
    if (!gutter) return { ...line, column: 'single' as const };
    const center = line.x + line.width / 2;
    const crosses = line.x < gutter - page.width * 0.004 && line.x + line.width > gutter + page.width * 0.004;
    return { ...line, column: crosses ? 'full' as const : center < gutter ? 'left' as const : 'right' as const };
  });
  const blocks: PdfTextBlock[] = [];
  if (!gutter) {
    for (const group of paragraphGroups(lines, medianFont)) blocks.push(makeBlock(page, group, medianFont, inReferences));
    return blocks;
  }

  // Full-width lines divide a page into reading zones. Within each zone, read
  // the left column before the right column to avoid row-wise column mixing.
  const fullLines = lines.filter(line => line.column === 'full');
  const fullGroups = paragraphGroups(fullLines, medianFont);
  let zoneStart = Number.NEGATIVE_INFINITY;
  const flushZone = (zoneEnd: number) => {
    const zone = lines.filter(line => line.column !== 'full' && line.y >= zoneStart && line.y < zoneEnd);
    for (const column of ['left', 'right'] as const) {
      for (const group of paragraphGroups(zone.filter(line => line.column === column), medianFont)) {
        blocks.push(makeBlock(page, group, medianFont, inReferences));
      }
    }
  };
  for (const group of fullGroups) {
    const first = group[0]!;
    const last = group.at(-1)!;
    flushZone(first.y);
    blocks.push(makeBlock(page, group, medianFont, inReferences));
    zoneStart = last.y + last.height;
  }
  flushZone(Number.POSITIVE_INFINITY);
  return blocks;
}

function repeatedMarginLines(pages: ParsedPage[]) {
  const counts = new Map<string, number>();
  for (const page of pages) for (const line of page.lines) {
    const position = line.y / page.height;
    if (position > 0.12 && position < 0.88) continue;
    const key = normalizedLine(line.text);
    if (key.length < 3 || /^\d{1,4}$/.test(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const minimum = Math.max(3, Math.ceil(pages.length * 0.2));
  return new Set([...counts].filter(([, count]) => count >= minimum).map(([key]) => key));
}

function metadataString(value: unknown) {
  return typeof value === 'string' ? cleanText(value) : '';
}

export type NativeExtraction = { pages: Array<{ page: number; width: number; height: number; items: RawText[]; visuals: Array<[number, number, number, number]>; ocr?: boolean }>; title: string; author: string; warnings: string[] };
export async function extractPdf(buffer: Uint8Array, native?: NativeExtraction, onProgress?: (page: number, total: number) => void): Promise<{
  pages: ExtractedPage[];
  pageCount: number;
  title: string;
  author: string;
  extraction: PdfExtractionSummary;
}> {
  const loadingTask = getDocument({ data: buffer, useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    const parsedPages: ParsedPage[] = [];
    const pdfMetadata = await document.getMetadata().catch(() => null);
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      onProgress?.(pageNumber, document.numPages);
      const nativePage = native?.pages[pageNumber - 1];
      if (nativePage) {
        parsedPages.push({ page: pageNumber, width: nativePage.width, height: nativePage.height, lines: linesFromItems(nativePage.items, nativePage.width), itemCount: nativePage.items.length });
        continue;
      }
      const pdfPage = await document.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent({ includeMarkedContent: false });
      // The text layer exposes stable font ids; resolving the page operator
      // list lets PDF.js populate the corresponding embedded font descriptors
      // (including bold/italic flags and the original PostScript font name).
      await pdfPage.getOperatorList();
      const raw: RawText[] = [];
      for (const candidate of content.items) {
        if (!isTextItem(candidate)) continue;
        const text = candidate.str.trim();
        if (!text) continue;
        const [a, b, c, d] = candidate.transform;
        // Vertical watermarks and rotated margin labels share visual rows with
        // body text in PDF.js, but they do not belong to the reading flow.
        if (Math.abs(b || 0) > Math.abs(a || 0) * 0.7 || Math.abs(c || 0) > Math.abs(d || 0) * 0.7) continue;
        const fontSize = Math.max(1, Math.hypot(candidate.transform[2] || 0, candidate.transform[3] || 0));
        const fontObject = pdfPage.commonObjs.get(candidate.fontName) as { name?: string; bold?: boolean; italic?: boolean };
        const fontFamily = fontObject.name || content.styles[candidate.fontName]?.fontFamily || candidate.fontName;
        raw.push({
          text,
          x: candidate.transform[4],
          y: viewport.height - candidate.transform[5] - Math.max(candidate.height, fontSize),
          baseline: candidate.transform[5],
          width: candidate.width,
          height: Math.max(candidate.height, fontSize),
          fontSize,
          fontName: fontFamily,
          bold: Boolean(fontObject.bold) || /bold|black|heavy|semibold|demi/i.test(fontFamily),
          italic: Boolean(fontObject.italic) || /italic|oblique/i.test(fontFamily),
          hasEOL: candidate.hasEOL,
        });
      }
      parsedPages.push({ page: pageNumber, width: viewport.width, height: viewport.height, lines: linesFromItems(raw, viewport.width), itemCount: raw.length });
      pdfPage.cleanup();
    }

    const repeated = repeatedMarginLines(parsedPages);
    for (const page of parsedPages) page.lines = page.lines.filter(line => !repeated.has(normalizedLine(line.text)) && !/^\d{1,4}$/.test(line.text));
    let inReferences = false;
    const pages: ExtractedPage[] = parsedPages.map(page => {
      const blocks = buildBlocks(page, inReferences);
      joinCaptionLegends(blocks);
      annotatePaperFrontMatter({ page: page.page, blocks });
      for (const block of blocks) {
        if (/^(?:references|bibliography)$/i.test(block.text)) { inReferences = true; block.kind = 'heading'; }
        else if (inReferences && block.kind === 'paragraph') block.kind = 'reference';
      }
      addFigureCropHints(blocks);
      const nativePage = native?.pages[page.page - 1];
      if (nativePage?.ocr) for (const block of blocks) block.source = 'ocr';
      for (const caption of blocks.filter(block => block.kind === 'caption')) {
        const candidates = nativePage?.visuals.filter(rect => rect[2] > 0.12 && rect[3] > 0.07)
          .map(rect => ({ rect, distance: Math.abs(rect[1] + rect[3] - caption.bbox[1]) }))
          .sort((a,b) => a.distance - b.distance);
        if (candidates?.[0] && candidates[0].distance < 0.15) caption.figureCrop = candidates[0].rect;
      }
      const text = blocks.map(block => block.text).join('\n\n').trim();
      const characterCount = text.replace(/\s/g, '').length;
      const embeddedMarginLabel = blocks.some(block => /\bNIH-PA Author Manuscript\b/i.test(block.text));
      const status: PdfPageQuality['status'] = characterCount === 0 ? 'empty' : characterCount < 35 ? 'low-text'
        : embeddedMarginLabel ? 'needs-review' : 'good';
      const warnings = status === 'empty'
        ? ['没有从这一页提取到文字；可能是扫描页、图片页或受保护内容。']
        : status === 'low-text' ? ['这一页可提取文字较少；请在原 PDF 中确认是否有遗漏。']
          : embeddedMarginLabel ? ['页边标记可能混入正文，请对照 PDF 原页。'] : [];
      return { page: page.page, text, blocks, quality: { status, characterCount, textItemCount: page.itemCount, warnings } };
    });

    const info = (pdfMetadata?.info || {}) as Record<string, unknown>;
    const firstPage = pages[0];
    const titleBlocks = (firstPage?.blocks || []).filter(block => block.kind === 'title').sort((a, b) => a.bbox[1] - b.bbox[1]);
    const titleCandidates = (firstPage?.blocks || []).filter(block => block.bbox[1] < 0.42 && block.text.length >= 12 && block.text.length <= 220 && block.kind !== 'heading' && block.kind !== 'caption' && block.kind !== 'metadata');
    const metadataTitle = native?.title || metadataString(info.Title);
    const metadataAuthor = native?.author || metadataString(info.Author);
    const visualTitle = titleBlocks.map(block => block.text).join(' ').trim();
    const usableMetadataTitle = metadataTitle.length >= 8 && !/^(untitled|microsoft word|document|author manuscript|nih public access|original research|research article)$/i.test(metadataTitle);
    const selectedTitle = visualTitle.length >= 18 ? visualTitle
      : usableMetadataTitle ? metadataTitle
      : [...titleCandidates].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[3] - b.bbox[3])[0]?.text || '';
    if (firstPage && visualTitle.length >= 18 && usableMetadataTitle) {
      const words = (value: string) => new Set(value.toLocaleLowerCase().match(/[a-z\d]{3,}/g) || []);
      const visualWords = words(visualTitle);
      const metadataWords = words(metadataTitle);
      const overlap = [...visualWords].filter(word => metadataWords.has(word)).length / Math.max(visualWords.size, metadataWords.size, 1);
      if (overlap < 0.45) {
        firstPage.quality.status = 'needs-review';
        firstPage.quality.warnings.push('PDF 元数据标题与首页标题不一致，请对照原页核对。');
      }
    }
    if (firstPage && (!titleBlocks.length || /^(?:author manuscript|original research|research article|untitled)$/i.test(selectedTitle.trim()))) {
      firstPage.quality.status = 'needs-review';
      firstPage.quality.warnings.push('标题未能可靠识别，请对照 PDF 原页并在“解析校对”中修正。');
    }
    const authorCandidate = (firstPage?.blocks || []).find(block => block.kind === 'authors')
      || (firstPage?.blocks || []).find(block => block.bbox[1] > (titleBlocks.at(-1)?.bbox[1] || 0.1) && block.bbox[1] < 0.48 && /\b[A-Z][a-z'’-]+(?:,\s*|\s+)[A-Z]/.test(block.text));
    const authorSource = metadataAuthor && !/^(unknown|anonymous)$/i.test(metadataAuthor) ? metadataAuthor : authorCandidate?.text || '';
    const author = authorSource.split(/\b(?:Department of|Centre for|Center for|School of|Faculty of|University of|Institute of)\b/i)[0]!.trim().replace(/[;,\s]+$/, '');
    const doi = pages.slice(0, 3).map(page => page.text.match(doiPattern)?.[0]).find(Boolean)?.replace(/[.,;)]*$/, '');
    const lowTextPages = pages.filter(page => page.quality.status === 'empty' || page.quality.status === 'low-text').map(page => page.page);
    const reviewPages = pages.filter(page => page.quality.status === 'needs-review').map(page => page.page);
    const warnings = [
      ...(native?.warnings || []),
      ...(lowTextPages.length ? [`${lowTextPages.length} 页文字较少或未提取到文字，可能需要 OCR 或人工核对。`] : []),
      ...(reviewPages.length ? [`第 ${reviewPages.slice(0, 6).join('、')}${reviewPages.length > 6 ? ' 等' : ''} 页版面或标题需要核对。`] : []),
    ];
    return {
      pages,
      pageCount: document.numPages,
      title: selectedTitle,
      author,
      extraction: { engine: native ? 'pymupdf-layout-v2' : 'pdfjs-layout-v8', quality: warnings.length ? 'partial' : 'good', warnings, lowTextPages, reviewPages, ...(doi ? { doi } : {}) },
    };
  } finally {
    await loadingTask.destroy();
  }
}
