import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createProvider, demoTutor, type TutorRequest } from './providers.js';
import { dataDir, ensureStore, publicProvider, readStore, uploadDir, writeStore } from './store.js';
import type { AssistantConversation, GlossaryTerm, LearningNote, Paper, PaperGroup, ProviderConfig, SourceAnchor, StudyTurn } from './types.js';
import { addFigureCropHints, annotatePaperFrontMatter, extractPdf } from './pdfExtraction.js';
import { verifiedSourceAnchor } from './sources.js';
import { enqueueParse, recoverJobs } from './jobs.js';
import { workspaceRoutes } from './workspaceRoutes.js';
import { assistantRoutes } from './assistantRoutes.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = new Set((process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean));

class PdfImportError extends Error {}
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  const isSameOrigin = Boolean(origin && origin === `${req.protocol}://${req.get('host')}`);
  const isLocalDevOrigin = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
  if (origin && (allowedOrigins.has(origin) || isLocalDevOrigin || isSameOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  } else if (origin && process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: '此网站来源未获 API 访问许可。' }); return;
  }
  next();
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 35 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')
    ? cb(null, true) : cb(new Error('目前只支持 PDF 文件。')),
});

function paragraphs(text: string) {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim());
  const headings = /^(Abstract|Introduction|Method|Participants|Procedures|Measures|Data Reduction and Analysis|Results|Discussion|Limitations|Summary and Future Directions|Acknowledgments|References|Hypotheses)$/i;
  const blocks: string[] = [];
  let current = '';
  const flush = () => { if (current.trim()) blocks.push(current.trim()); current = ''; };
  for (const line of lines) {
    if (!line || /^(NIH Public Access|Author Manuscript|Baucom et al\.|Emotion\. Author manuscript)/i.test(line)) { flush(); continue; }
    if (headings.test(line)) { flush(); blocks.push(line); continue; }
    current += `${current ? ' ' : ''}${line}`;
  }
  flush();
  return blocks.flatMap(block => {
    if (headings.test(block) || block.length < 250) return [block];
    const sentences = block.split(/(?<=[.!?])\s+(?=[A-Z0-9“‘(])/).filter(Boolean);
    if (sentences.length < 4) return [block];
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += 3) chunks.push(sentences.slice(i, i + 3).join(' '));
    return chunks;
  }).filter(p => p.length > 25 || headings.test(p));
}

function paperPageParagraphs(page: Paper['pages'][number]) {
  return page.blocks?.length
    ? (annotatePaperFrontMatter(page), addFigureCropHints(page.blocks), page.blocks.map(block => block.text))
    : paragraphs(page.text);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, name: '溯页 API', version: '0.2.0' }));

app.get('/api/groups', async (_req, res) => {
  const store = await readStore();
  res.json(store.groups.map(group => ({ ...group, paperCount: store.papers.filter(paper => paper.groupId === group.id).length })));
});

app.post('/api/groups', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 40) { res.status(400).json({ error: '分组名称需要填写，且不能超过 40 个字符。' }); return; }
  const store = await readStore();
  if (store.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    res.status(409).json({ error: '已经有同名分组。' }); return;
  }
  const group: PaperGroup = { id: randomUUID(), name, createdAt: new Date().toISOString() };
  store.groups.unshift(group);
  await writeStore(store);
  res.status(201).json({ ...group, paperCount: 0 });
});

app.patch('/api/groups/:id', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const store = await readStore();
  const group = store.groups.find(item => item.id === req.params.id);
  if (!group) { res.status(404).json({ error: '找不到这个分组。' }); return; }
  if (!name || name.length > 40) { res.status(400).json({ error: '分组名称需要填写，且不能超过 40 个字符。' }); return; }
  if (store.groups.some(item => item.id !== group.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    res.status(409).json({ error: '已经有同名分组。' }); return;
  }
  group.name = name;
  await writeStore(store);
  res.json({ ...group, paperCount: store.papers.filter(paper => paper.groupId === group.id).length });
});

app.delete('/api/groups/:id', async (req, res) => {
  const store = await readStore();
  const group = store.groups.find(item => item.id === req.params.id);
  if (!group) { res.status(404).json({ error: '找不到这个分组。' }); return; }
  store.groups = store.groups.filter(item => item.id !== group.id);
  store.papers = store.papers.map(paper => paper.groupId === group.id ? { ...paper, groupId: null } : paper);
  await writeStore(store);
  res.json({ ok: true, movedTo: 'ungrouped' });
});

app.get('/api/papers', async (_req, res) => {
  const store = await readStore();
  res.json(store.papers.map(paper => ({ ...paper, groupId: paper.groupId || null, noteCount: store.notes.filter(note => note.paperId === paper.id).length, pages: undefined, extractedPageCount: paper.pages.length })));
});

app.post('/api/papers', upload.single('file'), async (req, res, next) => {
  if (!req.file) { res.status(400).json({ error: '请选择一个 PDF 文件。' }); return; }
  try {
    const fileBytes = await readFile(req.file.path);
    if (fileBytes.length < 8 || fileBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new PdfImportError('这个文件不是有效的 PDF，请重新导出或选择原始 PDF 文件。');
    }
    if (req.body?.async === 'true') {
      const groupId = typeof req.body.groupId === 'string' && req.body.groupId ? req.body.groupId : null;
      const filename = req.file.originalname;
      const fileKey = path.basename(req.file.filename);
      const fileHash = createHash('sha256').update(fileBytes).digest('hex');
      const job = await enqueueParse(req.file.path, 'auto', async result => {
        const current = await readStore();
        if (groupId && !current.groups.some(group => group.id === groupId)) throw new PdfImportError('目标分组已删除，请重新导入。');
        const paper: Paper = { id: randomUUID(), title: result.title.slice(0,220) || filename.replace(/\.pdf$/i,''), author: result.author.slice(0,500),
          filename, fileKey, fileHash, extractionRevision: randomUUID(), groupId, createdAt: new Date().toISOString(),
          pageCount: result.pageCount, pages: result.pages, extraction: result.extraction };
        current.papers.unshift(paper); await writeStore(current); return paper.id;
      });
      res.status(202).json({ job }); return;
    }
    let result;
    try { result = await extractPdf(new Uint8Array(fileBytes)); }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'PasswordException') {
        throw new PdfImportError('这份 PDF 有密码保护，目前请先在本机解锁后再导入。');
      }
      throw error;
    }
    const pages = result.pages;
    const allText = pages.map(p => p.text).join('\n');
    if (allText.replace(/\s/g, '').length < 35) result.extraction.warnings.unshift('文字提取不足，可先阅读 PDF 原页，并在本机安装 OCR 后重新解析。');
    const title = result.title.slice(0, 220) || req.file.originalname.replace(/\.pdf$/i, '');
    const author = result.author.slice(0, 500);
    const store = await readStore();
    const groupId = typeof req.body?.groupId === 'string' && req.body.groupId ? req.body.groupId : null;
    if (groupId && !store.groups.some(group => group.id === groupId)) throw new PdfImportError('目标分组不存在，请刷新文献库后重试。');
    const paper: Paper = {
      id: randomUUID(), title, author, filename: req.file.originalname, fileKey: path.basename(req.file.filename),
      groupId, fileHash: createHash('sha256').update(fileBytes).digest('hex'), extractionRevision: randomUUID(),
      createdAt: new Date().toISOString(), pageCount: result.pageCount, pages, extraction: result.extraction,
    };
    store.papers.unshift(paper);
    await writeStore(store);
    res.status(201).json({ ...paper, pages: paper.pages.map(p => ({ ...p, paragraphs: paperPageParagraphs(p) })) });
  } catch (error) {
    await unlink(req.file.path).catch(() => undefined);
    if (error instanceof PdfImportError) { res.status(422).json({ error: error.message }); return; }
    next(error);
  }
});

app.patch('/api/papers/:id/group', async (req, res) => {
  const store = await readStore();
  const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇文献。' }); return; }
  const groupId = req.body?.groupId || null;
  if (groupId && !store.groups.some(group => group.id === groupId)) { res.status(404).json({ error: '找不到目标分组。' }); return; }
  paper.groupId = groupId;
  await writeStore(store);
  res.json({ ok: true, paperId: paper.id, groupId });
});

app.get('/api/papers/:id', async (req, res) => {
  const store = await readStore();
  const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
  res.json({ ...paper, pages: paper.pages.map(p => ({ ...p, paragraphs: paperPageParagraphs(p) })) });
});

app.patch('/api/papers/:id/corrections', async (req, res) => {
  const store = await readStore();
  const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const author = typeof req.body?.author === 'string' ? req.body.author.trim() : '';
  const pageNumber = Number(req.body?.page);
  const edits = req.body?.blocks;
  const page = paper.pages.find(item => item.page === pageNumber);
  if (!title || title.length > 220 || author.length > 500 || !page || !Array.isArray(edits) || edits.length > 300) {
    res.status(400).json({ error: '校对内容不完整或超过长度限制。' }); return;
  }
  const editMap = new Map<string, { text: string; hidden: boolean }>();
  for (const edit of edits) {
    if (typeof edit?.id !== 'string' || typeof edit?.text !== 'string' || edit.text.length > 5000 || typeof edit?.hidden !== 'boolean') {
      res.status(400).json({ error: '文本块校对格式无效。' }); return;
    }
    editMap.set(edit.id, { text: edit.text.trim(), hidden: edit.hidden });
  }
  paper.title = title;
  paper.author = author;
  paper.metadataCorrected = true;
  if (page.blocks) {
    for (const block of page.blocks) {
      const edit = editMap.get(block.id);
      if (!edit) continue;
      if (block.text !== edit.text) {
        block.originalText ??= block.text;
        block.originalRuns ??= block.runs;
        block.text = edit.text;
        block.runs = undefined;
      }
      block.hidden = edit.hidden;
    }
    page.paragraphs = page.blocks.map(block => block.text);
    page.text = page.blocks.filter(block => !block.hidden).map(block => block.text).join('\n');
  }
  await writeStore(store);
  res.json({ ...paper, pages: paper.pages.map(item => ({ ...item, paragraphs: paperPageParagraphs(item) })) });
});

app.delete('/api/papers/:id', async (req, res) => {
  const store = await readStore();
  const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
  store.papers = store.papers.filter(item => item.id !== paper.id);
  store.notes = store.notes.filter(item => item.paperId !== paper.id);
  store.terms = (store.terms || []).filter(item => item.paperId !== paper.id);
  store.turns = store.turns.filter(item => item.paperId !== paper.id);
  await writeStore(store);
  await unlink(path.join(uploadDir, paper.fileKey)).catch(() => undefined);
  res.json({ ok: true });
});

app.get('/api/papers/:id/file', async (req, res) => {
  const paper = (await readStore()).papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).end(); return; }
  res.type('application/pdf').sendFile(path.join(uploadDir, paper.fileKey));
});

app.get('/api/providers', async (_req, res) => {
  const store = await readStore();
  res.json({ activeProviderId: store.activeProviderId, providers: store.providers.map(publicProvider) });
});

app.post('/api/providers', async (req, res) => {
  const input = req.body as Partial<ProviderConfig>;
  if (!input.name?.trim() || !input.baseUrl?.trim() || !input.model?.trim()) {
    res.status(400).json({ error: '供应商名称、兼容接口地址和模型名称都需要填写。' }); return;
  }
  let baseUrl: URL;
  try { baseUrl = new URL(input.baseUrl); } catch { res.status(400).json({ error: 'API 地址格式无效。' }); return; }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) { res.status(400).json({ error: 'API 地址必须使用 HTTP 或 HTTPS。' }); return; }
  const store = await readStore();
  const exists = input.id ? store.providers.find(p => p.id === input.id) : undefined;
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : exists?.apiKey || '';
  if (apiKey && !/^[\x21-\x7E]+$/.test(apiKey)) {
    res.status(400).json({ error: 'API Key 含有非 ASCII 字符，请粘贴服务商提供的原始 Key。' }); return;
  }
  const provider: ProviderConfig = {
    id: exists?.id || randomUUID(), name: input.name.trim(), kind: 'openai-compatible',
    baseUrl: baseUrl.toString().replace(/\/$/, ''), model: input.model.trim(),
    protocol: input.protocol === 'responses' ? 'responses' : 'chat-completions',
    apiKey,
    enabled: true,
  };
  store.providers = exists ? store.providers.map(p => p.id === exists.id ? provider : p) : [provider, ...store.providers];
  if (!provider.apiKey && store.activeProviderId === provider.id) {
    store.activeProviderId = store.providers.find(item => item.id !== provider.id && item.enabled && item.apiKey)?.id || null;
  } else if (!store.activeProviderId && provider.apiKey) store.activeProviderId = provider.id;
  await writeStore(store);
  res.status(exists ? 200 : 201).json({ activeProviderId: store.activeProviderId, provider: publicProvider(provider) });
});

app.put('/api/providers/active', async (req, res) => {
  const store = await readStore();
  const id = req.body?.providerId;
  if (id !== null && !store.providers.some(p => p.id === id)) { res.status(404).json({ error: '找不到这个供应商。' }); return; }
  if (id) {
    const provider = store.providers.find(p => p.id === id);
    const local = provider && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(provider.baseUrl).hostname);
    if (!provider || (!local && !provider.apiKey)) { res.status(400).json({ error: '这个供应商尚未设置有效的 API Key，请先补全配置。' }); return; }
  }
  store.activeProviderId = id || null;
  await writeStore(store);
  res.json({ activeProviderId: store.activeProviderId });
});

app.delete('/api/providers/:id', async (req, res) => {
  const store = await readStore();
  store.providers = store.providers.filter(p => p.id !== req.params.id);
  if (store.activeProviderId === req.params.id) store.activeProviderId = store.providers[0]?.id || null;
  await writeStore(store);
  res.json({ activeProviderId: store.activeProviderId, providers: store.providers.map(publicProvider) });
});

app.post('/api/providers/:id/test', async (req, res, next) => {
  try {
    const provider = (await readStore()).providers.find(p => p.id === req.params.id);
    if (!provider) { res.status(404).json({ error: '找不到这个供应商。' }); return; }
    const answer = await createProvider(provider).complete({ paperTitle: 'Connection test', page: 1, passage: 'The sentence is: “A quick connection check.”', learnerAttempt: 'The connection is being checked.', action: 'check' });
    res.json({ ok: true, preview: answer.slice(0, 240) });
  } catch (error) { next(error); }
});

app.get('/api/assistant/conversations', async (_req, res) => {
  const store = await readStore();
  const query = typeof _req.query.q === 'string' ? _req.query.q.trim().toLowerCase() : '';
  res.json(store.conversations.filter(item => !query || `${item.title} ${item.messages.map(message => message.content).join(' ')}`.toLowerCase().includes(query)).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, createdAt, updatedAt, messages }) => ({
    id, title, createdAt, updatedAt, messageCount: messages.length, preview: messages.at(-1)?.content.slice(0,120),
  })));
});

app.post('/api/assistant/conversations', async (_req, res) => {
  const store = await readStore();
  const now = new Date().toISOString();
  const conversation: AssistantConversation = { id: randomUUID(), title: '新对话', createdAt: now, updatedAt: now, messages: [] };
  store.conversations.unshift(conversation);
  await writeStore(store);
  res.status(201).json(conversation);
});

app.get('/api/assistant/conversations/:id', async (req, res) => {
  const conversation = (await readStore()).conversations.find(item => item.id === req.params.id);
  if (!conversation) { res.status(404).json({ error: '找不到这条对话记录。' }); return; }
  res.json(conversation);
});

app.delete('/api/assistant/conversations/:id', async (req, res) => {
  const store = await readStore();
  const before = store.conversations.length;
  store.conversations = store.conversations.filter(item => item.id !== req.params.id);
  if (store.conversations.length === before) { res.status(404).json({ error: '找不到这条对话记录。' }); return; }
  await writeStore(store);
  res.json({ ok: true });
});

app.post('/api/assistant/turn', async (req, res, next) => {
  try {
    const input = req.body as TutorRequest & { paperId: string };
    if (!input.paperId || !input.passage?.trim() || !['hint', 'explain', 'check'].includes(input.action)) {
      res.status(400).json({ error: '缺少论文、原文段落或有效的学习操作。' }); return;
    }
    if (input.passage.length > 12_000 || (input.learnerAttempt || '').length > 5_000) {
      res.status(400).json({ error: '本次内容过长，请选择一个较短段落。' }); return;
    }
    const store = await readStore();
    const paper = store.papers.find(p => p.id === input.paperId);
    if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
    const verifiedAnchor = await verifiedSourceAnchor(paper,input.page,input.passage,(req.body as {anchor?:SourceAnchor}).anchor);
    const provider = store.providers.find(p => p.id === store.activeProviderId && p.enabled);
    const answer = provider ? await createProvider(provider).complete({ ...input, paperTitle: paper.title }) : demoTutor({ ...input, paperTitle: paper.title });
    const turn: StudyTurn = {
      id: randomUUID(), paperId: paper.id, page: input.page, action: input.action,
      passage: input.passage, answer, createdAt: new Date().toISOString(), provider: provider?.name || '演示模式',
    };
    store.turns.unshift(turn);
    turn.anchor = verifiedAnchor;
    await writeStore(store);
    res.json({ ...turn, mode: provider ? 'provider' : 'demo' });
  } catch (error) { next(error); }
});

app.get('/api/papers/:id/learning', async (req, res) => {
  const store = await readStore();
  res.json({ notes: store.notes.filter(n => n.paperId === req.params.id), turns: store.turns.filter(t => t.paperId === req.params.id) });
});

app.post('/api/papers/:id/notes', async (req, res) => {
  const store = await readStore();
  const paper = store.papers.find(p => p.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
  const { page, passage, firstAttempt, revisedUnderstanding, uncertainty, stageId, noteId, kind, aiAnswer, highlightColor, anchor, tags, originMessageId } = req.body as Partial<LearningNote> & { noteId?: string };
  if (!Number.isInteger(page) || !passage?.trim()) { res.status(400).json({ error: '请先选择原文段落。' }); return; }
  const now = new Date().toISOString();
  const existing = noteId ? store.notes.find(note => note.id === noteId && note.paperId === paper.id) : undefined;
  const note: LearningNote = {
    id: existing?.id || randomUUID(), paperId: paper.id, page: page as number, passage,
    firstAttempt: firstAttempt || '', revisedUnderstanding: revisedUnderstanding || '',
    uncertainty: uncertainty || '',
    stageId: stageId || existing?.stageId,
    kind: kind || existing?.kind || 'learning',
    aiAnswer: aiAnswer || existing?.aiAnswer,
    highlightColor: highlightColor || existing?.highlightColor,
    createdAt: existing?.createdAt || now, updatedAt: now,
    anchor: await verifiedSourceAnchor(paper, page as number, passage, anchor),
    tags: Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string').slice(0,20).map(tag => tag.slice(0,40)) : existing?.tags,
    originMessageId: originMessageId || existing?.originMessageId,
  };
  store.notes = existing ? store.notes.map(item => item.id === note.id ? note : item) : [note, ...store.notes];
  await writeStore(store);
  res.status(existing ? 200 : 201).json(note);
});

app.delete('/api/notes/:id', async (req, res) => {
  const store = await readStore();
  store.notes = store.notes.filter(note => note.id !== req.params.id);
  await writeStore(store);
  res.json({ ok: true });
});

app.get('/api/notes', async (_req, res) => {
  const store = await readStore();
  const paperNames = new Map(store.papers.map(paper => [paper.id, paper.title]));
  res.json(store.notes.map(note => ({ ...note, paperTitle: paperNames.get(note.paperId) || '已移除的文献' })));
});

app.get('/api/papers/:id/terms', async (req, res) => {
  const store = await readStore();
  res.json((store.terms || []).filter(term => term.paperId === req.params.id));
});

app.get('/api/terms', async (_req, res) => {
  const store = await readStore();
  const paperNames = new Map(store.papers.map(paper => [paper.id, paper.title]));
  res.json((store.terms || []).map(term => ({ ...term, paperTitle: paperNames.get(term.paperId) || '已移除的文献' })));
});

app.post('/api/papers/:id/terms', async (req, res) => {
  const store = await readStore();
  const paper = store.papers.find(item => item.id === req.params.id);
  if (!paper) { res.status(404).json({ error: '找不到这篇论文。' }); return; }
  const { term, meaning, passage, page } = req.body as Partial<GlossaryTerm>;
  if (!term?.trim() || term.trim().length > 120 || !meaning?.trim() || meaning.trim().length > 4000 || !passage?.trim() || !Number.isInteger(page)) {
    res.status(400).json({ error: '术语、解释、原文出处和页码都需要有效填写。' }); return;
  }
  const sourcePage = paper.pages.find(item => item.page === page);
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (!sourcePage || !normalize(sourcePage.text).includes(normalize(passage).slice(0, 36)) || !normalize(passage).includes(normalize(term))) {
    res.status(400).json({ error: '术语或出处无法在指定页的原文中核对。' }); return;
  }
  const existing = (store.terms || []).find(item => item.paperId === paper.id && normalize(item.term) === normalize(term));
  const glossaryTerm: GlossaryTerm = {
    id: existing?.id || randomUUID(), paperId: paper.id, term: term.trim(), meaning: meaning.trim(), passage,
    page: page as number, createdAt: existing?.createdAt || new Date().toISOString(), anchor: await verifiedSourceAnchor(paper, page as number, passage),
  };
  store.terms = existing ? store.terms.map(item => item.id === existing.id ? glossaryTerm : item) : [glossaryTerm, ...(store.terms || [])];
  await writeStore(store);
  res.status(existing ? 200 : 201).json(glossaryTerm);
});

app.delete('/api/terms/:id', async (req, res) => {
  const store = await readStore();
  store.terms = (store.terms || []).filter(term => term.id !== req.params.id);
  await writeStore(store);
  res.json({ ok: true });
});

app.use(assistantRoutes);
app.use(workspaceRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : '请求失败。';
  const status = message.includes('File too large') ? 413 : (error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500);
  if (status === 500) console.error('[溯页]', error);
  res.status(status).json({ error: status === 413 ? 'PDF 文件不能超过 35 MB。' : message });
});

let staticFilesMounted = false;

export async function startServer(options: { host?: string; port?: number; staticDir?: string } = {}) {
  if (options.staticDir && !staticFilesMounted) {
    app.use(express.static(options.staticDir));
    app.get('/{*path}',(req,res,next)=>{if(req.path.startsWith('/api/') || path.extname(req.path)){next();return;}res.sendFile(path.join(options.staticDir!,'index.html'));});
    staticFilesMounted = true;
  }
  await ensureStore();
  await recoverJobs();
  const host = options.host || process.env.HOST || '127.0.0.1';
  const listenPort = options.port ?? port;
  const server = await new Promise<import('node:http').Server>((resolve, reject) => {
    const listener = app.listen(listenPort, host, () => resolve(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法读取本地服务地址。');
  if (process.env.PAPERBRIDGE_EMBEDDED === '1') allowedOrigins.add(`http://${host}:${address.port}`);
  console.log(`溯页 API listening on http://${host}:${address.port}`);
  return { server, host, port: address.port };
}

if (process.env.PAPERBRIDGE_EMBEDDED !== '1') {
  const staticDir = process.env.NODE_ENV === 'production' ? path.resolve(dataDir, '..', 'dist') : undefined;
  await startServer({ staticDir });
}
