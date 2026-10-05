import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { createProvider, type ChatMessage, type TranslationContext } from './providers.js';
import { chatPrompt, translationPrompt } from './prompts.js';
import { readStore, writeStore, getDocument, putDocument, putLatestDocument } from './store.js';
import { documentBlocks, retrieveEvidence, citedEvidence } from './retrieval.js';
import { normalizeText, verifiedSourceAnchor } from './sources.js';
import type { AssistantChatMessage, SourceEvidence, SourceAnchor } from './types.js';

export const assistantRoutes = Router();
const inFlight = new Set<string>();

assistantRoutes.post('/api/assistant/chat', async (req, res, next) => {
  let conversationId = '', assistant: AssistantChatMessage | undefined;
  let streaming = false;
  let acquired = false;
  let sources: SourceEvidence[] = [];
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const emit = (event: unknown) => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  const persist = async () => {
    if (!assistant) return;
    const store = await readStore();
    const conversation = store.conversations.find(item => item.id === conversationId);
    if (!conversation) return;
    assistant.sources = citedEvidence(assistant.content, sources);
    const index=conversation.messages.findIndex(item=>item.id===assistant!.id);
    if(index>=0)conversation.messages[index]=assistant;else conversation.messages.push(assistant);
    conversation.updatedAt = new Date().toISOString();
    await writeStore(store);
  };
  try {
    const { content, paperId } = req.body as { content?: string; paperId?: string };
    conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : '';
    if (!conversationId || typeof content !== 'string' || !content.trim() || content.length > 8000 || (paperId !== undefined && typeof paperId !== 'string')) {
      res.status(400).json({ error: '请选择对话，并输入不超过 8,000 字的问题。' }); return;
    }
    if (inFlight.has(conversationId)) { res.status(409).json({ error: '这个对话仍在生成中，请等待或停止当前回答。' }); return; }
    const store = await readStore();
    const conversation = store.conversations.find(item => item.id === conversationId);
    if (!conversation) { res.status(404).json({ error: '这条对话已不存在，请新建对话。' }); return; }
    const paper = paperId ? store.papers.find(item => item.id === paperId) : undefined;
    if (paperId && !paper) { res.status(404).json({ error: '找不到关联的文献。' }); return; }
    if (inFlight.has(conversationId)) { res.status(409).json({ error: '这个对话仍在生成中。' }); return; }
    inFlight.add(conversationId); acquired = true;
    sources = paper ? await retrieveEvidence(paper, content) : [];
    const user: AssistantChatMessage = { id: randomUUID(), role: 'user', content: content.trim(), createdAt: new Date().toISOString(),
      ...(paper ? { paperId: paper.id, paperTitle: paper.title, paperPageCount: paper.pageCount, paperScope: 'full-paper', sources } : {}) };
    conversation.messages.push(user);
    if (conversation.title === '新对话') conversation.title = user.content.replace(/\s+/g, ' ').slice(0, 38);
    conversation.updatedAt = user.createdAt;
    await writeStore(store);
    const provider = store.providers.find(item => item.id === store.activeProviderId && item.enabled);
    assistant = { id: randomUUID(), role: 'assistant', content: '', createdAt: new Date().toISOString(), provider: provider?.name || '演示模式', mode: provider ? 'provider' : 'demo', status: 'complete', paperId: paper?.id, paperTitle: paper?.title };
    streaming = req.body.stream === true;
    if (streaming) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
      emit({ type: 'start', user, assistant });
    }
    const recent = conversation.messages.filter(message=>message.content.trim()).slice(-30);
    let budget = 65_000;
    const messages: ChatMessage[] = [];
    for (const message of [...recent].reverse()) {
      const evidence = message.id === user.id ? sources : (message.sources || []).slice(0,4).map(source => ({ ...source, text: source.text.slice(0,600) }));
      const size = message.content.length + evidence.reduce((sum,item) => sum+item.text.length, 0);
      if (size > budget && messages.length) break;
      budget -= size;
      messages.unshift({ role: message.role, content: message.content, ...(message.role === 'user' && message.paperTitle && evidence.length
        ? { paperContext: { paperTitle: message.paperTitle, pageCount: message.paperPageCount || 1, excerpts: evidence } } : {}) });
    }
    if (!provider) assistant.content = '尚未连接 AI 服务。阅读、笔记和标注仍可使用；请在右上角配置供应商后提问。';
    else if (streaming) {
      const prompt = chatPrompt(messages);
      for await (const text of createProvider(provider).stream(prompt.instructions, prompt.input, controller.signal)) {
        assistant.content += text; emit({ type: 'delta', text });
      }
    } else {
      const prompt = chatPrompt(messages);
      assistant.content = await createProvider(provider).generate(prompt.instructions, prompt.input, controller.signal);
    }
    const known = new Set(sources.map(source => source.id));
    assistant.content = assistant.content.replace(/\[(S[a-f0-9]{10})\]/g, (match,id: string) => known.has(id) ? match : '〔引用未核实〕');
    await persist();
    if (streaming) { emit({ type: 'done', assistant, conversationId }); res.end(); }
    else res.json({ answer: assistant.content, provider: assistant.provider, mode: assistant.mode, sources: assistant.sources, conversationId });
  } catch (error) {
    if (assistant) {
      assistant.status = controller.signal.aborted ? 'interrupted' : 'failed';
      await persist().catch(() => undefined);
    }
    if (streaming) {
      emit({ type: 'error', assistant, error: controller.signal.aborted ? '生成已停止，已保留收到的内容。' : error instanceof Error ? error.message : '生成失败。' });
      res.end();
    } else if (!res.destroyed) next(error);
  } finally { if (acquired) inFlight.delete(conversationId); }
});

assistantRoutes.post('/api/assistant/translate', async (req, res, next) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const { paperId, page, passage, targetLanguage = '简体中文', cacheOnly } = req.body;
    if (typeof paperId !== 'string' || !Number.isInteger(page) || typeof passage !== 'string' || !passage.trim() || passage.length > 12000
      || !['简体中文','繁體中文','English','日本語'].includes(targetLanguage)) {
      res.status(400).json({ error: '请选择原文，并提供有效的目标语言。' }); return;
    }
    const store = await readStore();
    const paper = store.papers.find(item => item.id === paperId);
    if (!paper) { res.status(404).json({ error: '找不到这篇文献。' }); return; }
    const anchor = await verifiedSourceAnchor(paper, page, passage, req.body.anchor);
    const blocks = documentBlocks(paper);
    const index = blocks.findIndex(block => block.page === page && normalizeText(block.text).includes(normalizeText(passage)));
    const current = blocks[index];
    const text = normalizeText(current?.text || paper.pages.find(item => item.page === page)?.text || '');
    const normalizedPassage = normalizeText(passage);
    const start = text.indexOf(normalizedPassage);
    // A failed block match must not use blocks[0] as the selected passage's neighbor.
    const previousText = `${index > 0 ? blocks[index-1].text.slice(-1200) : ''}\n${start >= 0 ? text.slice(Math.max(0,start-1200),start) : ''}`.trim();
    const followingText = `${start >= 0 ? text.slice(start+normalizedPassage.length,start+normalizedPassage.length+1200) : ''}\n${index >= 0 ? blocks[index+1]?.text.slice(0,1200) || '' : ''}`.trim();
    const glossary = store.terms.filter(term => term.paperId === paperId && `${passage} ${previousText} ${followingText}`.toLowerCase().includes(term.term.toLowerCase())).slice(0,30).map(({ term, meaning }) => ({ term, meaning }));
    const provider = store.providers.find(item => item.id === store.activeProviderId && item.enabled);
    const context: TranslationContext = { paperTitle: paper.title, page, section: current?.section, previousText, followingText, glossary };
    const key = createHash('sha256').update(JSON.stringify([paper.id,paper.fileHash,paper.extractionRevision,normalizedPassage,targetLanguage,context,provider?.id,provider?.model,provider?.baseUrl,provider?.protocol,'translation-v3'])).digest('hex');
    let cached = await getDocument<Record<string, unknown>>(`translation:${key}`);
    if (!cached) {
      // Preserve the reader's corrections from v2 only when the original source still matches.
      const legacyKey = createHash('sha256').update(JSON.stringify([paper.fileHash,paper.extractionRevision,passage,targetLanguage,glossary,provider?.id,provider?.model,provider?.baseUrl,'translation-v2'])).digest('hex');
      const legacy = await getDocument<Record<string, unknown>>(`translation:${legacyKey}`);
      const legacyAnchor = legacy?.anchor as SourceAnchor | undefined;
      if (legacy?.edited && typeof legacy.answer === 'string' && legacyAnchor?.paperId === paperId && legacyAnchor.pageIndex === page-1
        && legacyAnchor.extractionRevision === paper.extractionRevision && normalizeText(legacyAnchor.quote?.exact || '') === normalizedPassage) {
        cached = { ...legacy, cacheKey: key, legacyEdited: true, savedAt: typeof legacy.savedAt === 'number' ? legacy.savedAt : 0 };
        if (!req.body.force && !controller.signal.aborted && (await readStore()).papers.some(item=>item.id===paperId)) await putDocument(`translation:${key}`, 'translation', paperId, cached);
      }
    }
    if (cached && !req.body.force) { res.json({ ...cached, cached: true }); return; }
    if (cacheOnly) { res.json({ answer: '', mode: 'provider', cached: false }); return; }
    if (!provider) { res.json({ answer: '尚未连接 AI 服务，请先配置供应商。', provider: '演示模式', mode: 'demo' }); return; }
    const prompt = translationPrompt(passage, targetLanguage, context);
    const answer = await createProvider(provider).generate(prompt.instructions, prompt.input, controller.signal);
    if (controller.signal.aborted) return;
    const result = { answer, originalAnswer: answer, cacheKey: key, anchor, savedAt: Date.now(), provider: provider.name, mode: 'provider', context: { neighboringText: Boolean(previousText || followingText), glossaryCount: glossary.length, section: current?.section } };
    if ((await readStore()).papers.some(item => item.id === paperId)) await putDocument(`translation:${key}`, 'translation', paperId, result);
    res.json(result);
  } catch (error) { if (!res.destroyed) next(error); }
});
assistantRoutes.put('/api/assistant/translations/:key', async (req,res) => {
  const record = await getDocument<Record<string, unknown>>(`translation:${req.params.key}`);
  if (!record) { res.status(404).json({ error: '找不到这条译文。' }); return; }
  if (typeof req.body.answer !== 'string' || req.body.answer.length > 24000) { res.status(400).json({ error: '译文格式或长度无效。' }); return; }
  const anchor = record.anchor as { paperId: string };
  if (!(await readStore()).papers.some(paper=>paper.id===anchor.paperId)) { res.status(404).json({ error: '文献已被删除。' }); return; }
  if (typeof req.body.savedAt !== 'number' || !Number.isFinite(req.body.savedAt)) { res.status(400).json({ error: '译文保存时间无效。' }); return; }
  const updated = { ...record, answer: req.body.answer, edited: true, savedAt: req.body.savedAt };
  if (!await putLatestDocument(`translation:${req.params.key}`, 'translation', anchor.paperId, updated)) { res.status(409).json({ error: '已有更新的译文，请重新打开本段同步。本地修改仍保留。' }); return; }
  res.json({ ok: true });
});
