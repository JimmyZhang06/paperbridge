import type { ProviderConfig, SourceEvidence } from './types.js';
import { tutorPrompt, chatPrompt, translationPrompt } from './prompts.js';

export type TutorRequest = {
  paperTitle: string;
  page: number;
  passage: string;
  learnerAttempt: string;
  action: 'hint' | 'explain' | 'check';
  question?: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  paperContext?: { paperTitle: string; pageCount: number; excerpts: SourceEvidence[] };
};
export type TranslationContext = {
  paperTitle: string;
  page: number;
  previousText: string;
  followingText: string;
  section?: string;
  glossary: Array<{ term: string; meaning: string }>;
};

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  generate(instructions: string, input: string | ChatMessage[], signal?: AbortSignal): Promise<string>;
  stream(instructions: string, input: string | ChatMessage[], signal?: AbortSignal): AsyncIterable<string>;
  complete(input: TutorRequest): Promise<string>;
  chat(messages: ChatMessage[]): Promise<string>;
  translate(passage: string, targetLanguage: string, context?: TranslationContext): Promise<string>;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly displayName: string;

  constructor(private readonly config: ProviderConfig) {
    this.id = config.id;
    this.displayName = config.name;
  }

  async generate(instructions: string, input: string | ChatMessage[], signal?: AbortSignal): Promise<string> {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.config.baseUrl).hostname);
    if (!local && !this.config.apiKey.trim()) throw new Error('请先在 AI 设置中填写这个供应商的 API Key。');
    if (this.config.apiKey.trim() && !/^[\x21-\x7E]+$/.test(this.config.apiKey.trim())) {
      throw new Error('API Key 含有非 ASCII 字符，无法放入 HTTP 请求头。请在 AI 供应商设置中重新填写服务商提供的原始 Key。');
    }
    if (!this.config.baseUrl.trim() || !this.config.model.trim()) throw new Error('请补全供应商的 API 地址和模型名称。');
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    let inferredProtocol: 'chat-completions' | 'responses' = 'chat-completions';
    try { if (new URL(baseUrl).hostname.toLowerCase() === 'grooroute.com') inferredProtocol = 'responses'; } catch { /* Settings validate provider URLs. */ }
    const protocol = this.config.protocol || inferredProtocol;
    const endpoint = protocol === 'responses'
      ? `${baseUrl}${/\/v\d+$/i.test(baseUrl) ? '' : '/v1'}/responses`
      : `${baseUrl}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...(this.config.apiKey.trim() ? { Authorization: `Bearer ${this.config.apiKey.trim()}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(protocol === 'responses'
        ? { model: this.config.model, instructions, input: Array.isArray(input) ? input.map(message => ({ role: message.role, content: message.content })) : input }
        : { model: this.config.model, temperature: 0.25, messages: [{ role: 'system', content: instructions }, ...(Array.isArray(input) ? input : [{ role: 'user' as const, content: input }])] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    });
    const raw = await response.text();
    let body: {
      error?: { message?: string } | string;
      message?: string;
      output_text?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }>; refusal?: string } }>;
    };
    try { body = JSON.parse(raw) as typeof body; }
    catch {
      const contentType = response.headers.get('content-type') || 'unknown content type';
      throw new Error(`供应商返回了非 JSON 内容 (HTTP ${response.status}, ${contentType})。请检查 API 地址与接口协议；Responses API 地址应指向 /v1/responses。`);
    }
    const errorMessage = typeof body.error === 'string' ? body.error : body.error?.message;
    if (!response.ok) throw new Error(errorMessage || body.message || `供应商请求失败 (HTTP ${response.status})`);
    const responseText = body.output_text
      || body.output?.flatMap(item => item.type === 'message' ? item.content || [] : []).filter(part => part.type === 'output_text' || part.type === 'text').map(part => part.text || '').join('\n')
      || '';
    const choiceContent = body.choices?.[0]?.message?.content;
    const chatText = typeof choiceContent === 'string' ? choiceContent : choiceContent?.map(part => part.text || '').join('\n');
    const answer = (responseText || chatText || body.choices?.[0]?.message?.refusal || '').trim();
    if (!answer) {
      const detail = errorMessage || body.message;
      throw new Error(detail || `供应商返回成功，但响应中没有文本内容 (HTTP ${response.status})。请确认模型支持所选协议，并检查接口文档。`);
    }
    return answer;
  }

  async *stream(instructions: string, input: string | ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const url = new URL(this.config.baseUrl);
    const key = this.config.apiKey.trim();
    if (!key && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('请填写供应商 API Key。');
    if (key && !/^[\x21-\x7E]+$/.test(key)) throw new Error('API Key 含有无效字符，请重新粘贴。');
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const protocol = this.config.protocol || (url.hostname === 'grooroute.com' ? 'responses' : 'chat-completions');
    const endpoint = protocol === 'responses' ? `${base}${/\/v\d+$/i.test(base) ? '' : '/v1'}/responses` : `${base}/chat/completions`;
    const messages = Array.isArray(input) ? input.map(({ role, content }) => ({ role, content })) : [{ role: 'user', content: input }];
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(protocol === 'responses' ? { model: this.config.model, instructions, input: messages, stream: true }
        : { model: this.config.model, temperature: 0.25, stream: true, messages: [{ role: 'system', content: instructions }, ...messages] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body.error?.message || `供应商请求失败 (HTTP ${response.status})`);
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }>; choices?: Array<{ message?: { content?: string } }> };
      const text = body.output_text || body.output?.flatMap(item => item.content || []).map(item => item.text || '').join('') || body.choices?.[0]?.message?.content;
      if (!text) throw new Error('供应商没有返回可读内容，请检查接口协议与模型。');
      yield text; return;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('供应商响应没有可读取的数据流。');
    const decoder = new TextDecoder();
    let buffer = '', received = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        if (done && buffer) { lines.push(buffer); buffer = ''; }
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          const event = JSON.parse(data) as { type?: string; delta?: string; error?: { message?: string }; choices?: Array<{ delta?: { content?: string; refusal?: string } }> };
          if (event.error || event.type === 'error' || event.type === 'response.failed') throw new Error(event.error?.message || '供应商中断了生成。');
          const text = event.type === 'response.output_text.delta' ? event.delta : event.choices?.[0]?.delta?.content || event.choices?.[0]?.delta?.refusal;
          if (text) { received = true; yield text; }
        }
        if (done) break;
      }
      if (!received) throw new Error('供应商数据流没有返回正文，请检查模型配置。');
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async complete(input: TutorRequest) { const prompt = tutorPrompt(input); return this.generate(prompt.instructions, prompt.input); }
  async chat(messages: ChatMessage[]) { const prompt = chatPrompt(messages); return this.generate(prompt.instructions, prompt.input); }
  async translate(passage: string, language: string, context?: TranslationContext) {
    const prompt = translationPrompt(passage, language, context); return this.generate(prompt.instructions, prompt.input);
  }
}

export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.kind) {
    case 'openai-compatible': return new OpenAICompatibleProvider(config);
    default: throw new Error(`暂不支持的 provider 类型：${String(config.kind)}`);
  }
}

export function demoTutor(input: TutorRequest): string {
  if (input.action === 'hint') {
    return `先找出这段的主语和主要动词，再看转折词或因果词。\n\n在原文里圈出一个最能支撑你判断的短语，然后试着用自己的话重述。\n\n回到原文：第 ${input.page} 页，你选中的这一段。`;
  }
  if (input.action === 'check' && input.learnerAttempt.trim()) {
    return `我已把你的理解和原文放在一起核对。\n\n这段有 ${input.passage.trim().split(/\s+/).length} 个英文词。当前演示模式不会调用外部 AI，因此不能可靠判断你的具体解释是否准确。请在「设置 → AI 供应商」中添加一个兼容 OpenAI Chat Completions 的服务，再重新核对。\n\n你可以先检查：你的复述是否保留了原文的主语、关系词（例如 although / because / whereas）和作者的限定条件？\n\n回到原文：第 ${input.page} 页。`;
  }
  return `演示模式已就绪，但尚未连接 AI 供应商。\n\n你仍然可以先按这个顺序读这段：\n1. 找出主句和核心动词；\n2. 标记生词及指代对象；\n3. 判断这段是在陈述背景、提出缺口，还是说明研究设计；\n4. 用自己的话写一句总结。\n\n添加 AI 供应商后，我会根据这段原文提供逐句拆解，并附上页码供你核对。\n\n回到原文：第 ${input.page} 页。`;
}
