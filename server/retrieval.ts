import { createHash } from 'node:crypto';
import type { Paper, SourceEvidence } from './types.js';
import { searchBlocks } from './store.js';
import { sourceAnchor } from './sources.js';

const expansions: Array<[RegExp, string[]]> = [
  [/研究对象|受试|招募|participants|subjects|population/i,['participants','sample','recruited','adolescents','cohort']],
  [/方法|设计|测量|样本|流程|method|design|sample/i, ['method','methods','participants','sample','procedure','measures','analysis']],
  [/结果|发现|证据|result|finding/i, ['results','findings','significant','association','effect']],
  [/局限|不足|limitation/i, ['limitations','limitation','caution','future']],
  [/背景|意义|贡献|background|contribution/i, ['introduction','background','discussion','contribution']],
  [/问题|假设|目的|question|hypothes/i, ['aim','hypothesis','hypotheses','investigate']],
  [/皮质醇/, ['cortisol']], [/情绪/, ['emotion','emotional','arousal']],
  [/正念/, ['mindfulness','meditation']], [/语音|声音/, ['speech','voice','vocal','acoustic']],
];
export function documentBlocks(paper: Paper) {
  let section = '', majorSection = '';
  return paper.pages.flatMap(page => (page.blocks || (page.paragraphs || [page.text]).map((text, index) => ({ id: `${page.page}-${index}`, text, kind: 'paragraph', hidden: false, headingLevel: 1 }))).flatMap(block => {
    if (block.hidden || ['title','metadata','authors','affiliation','reference'].includes(block.kind)) return [];
    if (block.kind === 'heading') {
      if ((block.headingLevel || 1) === 1) majorSection = block.text;
      section = majorSection === block.text ? block.text : `${majorSection} / ${block.text}`;
      return [];
    }
    return block.text.trim().length > 35 ? [{ ...block, page: page.page, section: block.kind === 'abstract' ? 'Abstract' : section }] : [];
  }));
}
export async function retrieveEvidence(paper: Paper, question: string): Promise<SourceEvidence[]> {
  const tokens = new Set((question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|\d+(?:\.\d+)?/g) || []).filter(term => !/^(the|this|that|what|how|and|paper|please|from|with)$/.test(term)));
  for (const [pattern, terms] of expansions) if (pattern.test(question)) terms.forEach(term => tokens.add(term));
  const hits = await searchBlocks(paper.id, [...tokens]);
  const ranks = new Map(hits.map((hit, index) => [hit.id, (hits.length - index) / Math.max(1, hits.length)]));
  const blocks = documentBlocks(paper);
  const methodTask = /方法|样本|研究对象|受试|招募|流程|测量|method|design|sample/i.test(question);
  const resultTask = /结果|发现|result|finding/i.test(question);
  const broad = /梳理|概括|总结|全文|主要|综述|summari|overview|contribution|limitations/i.test(question) || /方法|设计|method|design/i.test(question);
  const limit=broad ? 28 : 12;
  const ranked = blocks.map((block, index) => ({ ...block, index, score:
    (ranks.get(block.id) || 0) * 4 + [...tokens].reduce((score, token) => score + (block.text.toLowerCase().includes(token) ? 1 : 0), 0)
    + (methodTask && /method|material|participant|procedure|measure|analysis/i.test(block.section) ? 5 : 0)
    + (resultTask && /result/i.test(block.section) ? 4 : 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = new Map<number, typeof ranked[number]>();
  const add = (item: typeof ranked[number] | undefined) => { if (item && chosen.size < limit) chosen.set(item.index, item); };
  if (broad) {
    const sections = new Set<string>();
    for (const item of ranked) if (!sections.has(item.section)) { sections.add(item.section); add(item); }
  }
  for (const item of ranked) {
    if (chosen.size >= limit) break;
    add(item);
    if (item.score > 0 && !broad) add(ranked.find(candidate => candidate.index === item.index + 1));
  }
  let budget = 42_000;
  const selected=[...chosen.values()].sort((a,b) => a.index - b.index);
  const perSource=Math.min(2400,Math.floor(budget/Math.max(1,selected.length)));
  return selected.flatMap(item => {
    const text = item.text.slice(0, Math.min(perSource, budget));
    if (text.length < 36) return [];
    budget -= text.length;
    const id = `S${createHash('sha256').update(`${paper.extractionRevision}:${item.id}:${text}`).digest('hex').slice(0, 10)}`;
    return [{ id, page: item.page, text, section: item.section, anchor: sourceAnchor(paper, item.page, text, { blockId: item.id }) }];
  });
}
export function citedEvidence(answer: string, sources: SourceEvidence[]) {
  const references = new Set([...answer.matchAll(/\[(S[a-f0-9]{10})\]/g)].map(match => match[1]));
  return sources.filter(source => references.has(source.id));
}
