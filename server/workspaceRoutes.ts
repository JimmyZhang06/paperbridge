import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getDocument, putDocument, putLatestDocument, readStore, uploadDir, writeStore } from './store.js';
import { enqueueParse, getJob } from './jobs.js';
import { normalizeText, reconcileAnchors, sourceAnchor } from './sources.js';
import type { LearningNote } from './types.js';

export const workspaceRoutes = Router();
workspaceRoutes.patch('/api/notes/:id',async(req,res)=>{
  const store=await readStore();const note=store.notes.find(item=>item.id===req.params.id);
  if(!note){res.status(404).json({error:'找不到这条笔记。'});return;}
  for(const field of ['firstAttempt','revisedUnderstanding','uncertainty','aiAnswer'] as const){
    const value=req.body[field];
    if(value!==undefined){if(typeof value!=='string'||value.length>(field==='aiAnswer'?60000:5000)){res.status(400).json({error:'笔记内容过长或格式无效。'});return;}note[field]=value;}
  }
  if(req.body.tags!==undefined){if(!Array.isArray(req.body.tags)||req.body.tags.length>20||req.body.tags.some((tag:unknown)=>typeof tag!=='string'||tag.length>40)){res.status(400).json({error:'标签最多 20 项，每项不超过 40 字。'});return;}note.tags=[...new Set<string>(req.body.tags)];}
  note.updatedAt=new Date().toISOString();await writeStore(store);res.json(note);
});
workspaceRoutes.get('/api/jobs/:id', async (req,res) => {
  const job = await getJob(req.params.id);
  if (!job) { res.status(404).json({ error: '找不到这项解析任务。' }); return; }
  res.json(job);
});
workspaceRoutes.post('/api/papers/:id/reparse', async (req,res) => {
  const store = await readStore();
  const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇文献。' }); return; }
  const engine = req.body.engine || 'auto';
  if (!['auto','pdfjs','pymupdf'].includes(engine)) { res.status(400).json({ error: '无效的解析引擎。' }); return; }
  const revision = paper.extractionRevision;
  const job = await enqueueParse(path.join(uploadDir,paper.fileKey), engine, async result => {
    const current = await readStore();
    const target = current.papers.find(item => item.id === paper.id);
    if (!target) throw new Error('文献已被删除。');
    if (target.extractionRevision !== revision) throw new Error('文献已产生其他解析版本，请刷新后重试。');
    const corrections = target.pages.flatMap(page => (page.blocks || []).filter(block => block.originalText !== undefined || block.hidden || block.manualFigureCrop).map(block => ({ page: page.page, block })));
    let unresolved = 0;
    for (const { page, block } of corrections) {
      const next = result.pages.find(item => item.page === page)?.blocks.find(item => normalizeText(item.text) === normalizeText(block.originalText || block.text));
      if (!next) { unresolved++; continue; }
      next.originalText = next.text; next.originalRuns = next.runs; next.text = block.text; next.hidden = block.hidden; next.runs = block.originalText ? block.runs : next.runs;
      if(block.manualFigureCrop){next.figureCrop=block.manualFigureCrop;next.manualFigureCrop=block.manualFigureCrop;}
    }
    for (const page of result.pages) page.text = page.blocks.filter(block => !block.hidden).map(block => block.text).join('\n\n');
    target.pages = result.pages; target.extraction = result.extraction; target.pageCount = result.pageCount; target.extractionRevision = randomUUID();
    if (unresolved) target.extraction.warnings.unshift(`${unresolved} 处旧校对未能自动匹配，旧解析版本仍保留在本地数据库中。`);
    if (!target.metadataCorrected) { target.title = result.title || target.title; target.author = result.author; }
    reconcileAnchors(target, [...current.notes,...current.turns,...current.terms].filter(item => item.paperId === target.id));
    await writeStore(current); return target.id;
  }, paper.id);
  res.status(202).json({ job });
});
workspaceRoutes.get('/api/workspace/:paperId', async (req,res) => res.json(await getDocument(`workspace:${req.params.paperId}`) || {}));
workspaceRoutes.patch('/api/papers/:id/figures/:blockId',async(req,res)=>{
  const crop=req.body.crop;
  if(!Array.isArray(crop)||crop.length!==4||!crop.every(Number.isFinite)||crop[0]<0||crop[1]<0||crop[2]<=0||crop[3]<=0||crop[0]+crop[2]>1.001||crop[1]+crop[3]>1.001){res.status(400).json({error:'图表范围必须位于原始页面内。'});return;}
  const store=await readStore();const paper=store.papers.find(item=>item.id===req.params.id);
  const block=paper?.pages.flatMap(page=>page.blocks||[]).find(block=>block.id===req.params.blockId&&block.kind==='caption');
  if(!block){res.status(404).json({error:'找不到这个图表。'});return;}
  block.figureCrop=crop as [number,number,number,number];block.manualFigureCrop=block.figureCrop;await writeStore(store);res.json({ok:true});
});
workspaceRoutes.put('/api/workspace/:paperId', async (req,res) => {
  const paper = (await readStore()).papers.find(item => item.id === req.params.paperId);
  if (!paper) { res.status(404).json({ error: '找不到这篇文献。' }); return; }
  if (JSON.stringify(req.body).length > 24000 || !Number.isInteger(req.body.page) || req.body.page < 1 || req.body.page > paper.pageCount) { res.status(400).json({ error: '阅读位置无效。' }); return; }
  if(typeof req.body.savedAt !== 'number' || !Number.isFinite(req.body.savedAt)){res.status(400).json({error:'阅读记录时间无效。'});return;}
  if(!await putLatestDocument(`workspace:${paper.id}`, 'workspace', paper.id, req.body)){res.status(409).json({error:'已有更新的阅读位置，请刷新同步。'});return;}res.json({ ok: true });
});
workspaceRoutes.get('/api/drafts/:key', async (req,res) => res.json(await getDocument(`draft:${req.params.key}`) || {}));
workspaceRoutes.put('/api/drafts/:key', async (req,res) => {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(req.params.key) || !Object.hasOwn(req.body, 'value') || JSON.stringify(req.body).length > 200000 || typeof req.body.savedAt !== 'number') { res.status(400).json({ error: '草稿格式无效。' }); return; }
  const paperId = typeof req.body.paperId === 'string' ? req.body.paperId : null;
  if (paperId && !(await readStore()).papers.some(item => item.id === paperId)) { res.status(404).json({ error: '文献已被删除。' }); return; }
  if(!Number.isFinite(req.body.savedAt)){res.status(400).json({error:'草稿时间无效。'});return;}
  if(!await putLatestDocument(`draft:${req.params.key}`, 'draft', paperId, req.body)){res.status(409).json({error:'服务器已有更新的草稿，本地草稿仍保留。'});return;}res.json({ok:true});
});
workspaceRoutes.patch('/api/papers/:id/study', async (req,res) => {
  const store = await readStore(); const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
  if (!['background','gap','question','method','findings','contribution'].includes(req.body.stage) || typeof req.body.completed !== 'boolean') { res.status(400).json({ error: '学习阶段无效。' }); return; }
  const stages = new Set(paper.completedStages || []);
  if (req.body.completed) stages.add(req.body.stage); else stages.delete(req.body.stage);
  paper.completedStages = [...stages]; await writeStore(store); res.json({ completedStages: paper.completedStages });
});
workspaceRoutes.post('/api/assistant/conversations/:id/messages/:messageId/note', async (req,res) => {
  const store = await readStore();
  const conversation = store.conversations.find(item => item.id === req.params.id);
  const message = conversation?.messages.find(item => item.id === req.params.messageId && item.role === 'assistant');
  const source = message?.sources?.[0];
  const paper = store.papers.find(item => item.id === (source?.anchor.paperId || message?.paperId));
  if (!message || !paper) { res.status(400).json({ error: '这条回答没有关联到可保存的文献，请先结合论文提问。' }); return; }
  const existing = store.notes.find(item => item.originMessageId === message.id);
  if (existing) { res.json(existing); return; }
  const now = new Date().toISOString();
  const page = source?.page || 1;
  const passage = source?.text || paper.pages.find(item => item.page === page)?.blocks?.find(block => !block.hidden && block.text.length > 35)?.text || paper.pages[0]?.text || '';
  const note: LearningNote = { id: randomUUID(), paperId: paper.id, page, passage, anchor: source?.anchor || sourceAnchor(paper,page,passage),
    firstAttempt: '', revisedUnderstanding: '', aiAnswer: message.content, kind: 'ai', originMessageId: message.id, createdAt: now, updatedAt: now };
  store.notes.unshift(note); await writeStore(store); res.status(201).json(note);
});
workspaceRoutes.get('/api/papers/:id/export', async (req,res) => {
  const store = await readStore(); const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇文献。' }); return; }
  const notes = store.notes.filter(item => item.paperId === paper.id);
  const terms = store.terms.filter(item => item.paperId === paper.id);
  const markdown = `# ${paper.title}\n\n${paper.author}\n\n` + notes.map(note => `## ${note.kind === 'ai' ? 'AI 收藏' : note.kind === 'highlight' ? '原文标注' : '学习记录'} · PDF p.${note.page}\n\n> ${note.passage.replace(/\n/g,'\n> ')}\n\n${note.aiAnswer || ''}\n\n${note.firstAttempt ? `最初理解：${note.firstAttempt}\n\n` : ''}${note.revisedUnderstanding ? `修订理解：${note.revisedUnderstanding}\n\n` : ''}${note.uncertainty ? `待核实：${note.uncertainty}\n\n` : ''}${note.tags?.length ? `标签：${note.tags.join('、')}\n\n` : ''}`).join('\n---\n\n')
    + (terms.length ? '\n## 本文术语\n\n' + terms.map(term => `### ${term.term} · PDF p.${term.page}\n\n${term.meaning}`).join('\n\n') : '');
  res.type('text/markdown').setHeader('Content-Disposition', `attachment; filename="notes.md"; filename*=UTF-8''${encodeURIComponent(paper.title.slice(0,80)+'.md')}`);
  res.send(markdown);
});
