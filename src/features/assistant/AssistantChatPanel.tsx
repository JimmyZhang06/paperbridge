import { useRef, useState, type FormEvent } from 'react';
import { ArrowUp, LoaderCircle, MessageCircle, RotateCcw, Sparkles, UserRound } from 'lucide-react';
import { api } from '../../api';
import { MarkdownContent } from '../../components/MarkdownContent';
import type { ChatMessage } from './types';

type ChatTurn = ChatMessage & { id: string; provider?: string; mode?: 'provider' | 'demo' };

export function AssistantChatPanel({ messages, onChange }: { messages: ChatTurn[]; onChange: (messages: ChatTurn[]) => void }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    const next = [...messages, { id: crypto.randomUUID(), role: 'user' as const, content }];
    onChange(next);
    setDraft(''); setBusy(true); setError('');
    try {
      const result = await api<{ answer: string; provider: string; mode: 'provider' | 'demo' }>('/api/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-40).map(({ role, content: text }) => ({ role, content: text })) }),
      });
      onChange([...next, { id: crypto.randomUUID(), role: 'assistant', content: result.answer, provider: result.provider, mode: result.mode }]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } catch (requestError) {
      onChange(messages);
      setDraft(content);
      setError(requestError instanceof Error ? requestError.message : '发送失败，请重试。');
    } finally { setBusy(false); }
  }

  return <section className="assistant-chat-panel" aria-label="通用 AI 助手">
    <header className="ai-tool-intro"><span className="ai-tool-icon"><Sparkles size={17} /></span><div><strong>通用 AI 助手</strong><p>可以讨论概念、研究方法或写作问题。对话不会自动附加当前论文内容。</p></div></header>
    <div className="chat-history" aria-live="polite">
      {!messages.length && <div className="chat-empty"><MessageCircle size={23} /><strong>你想聊些什么？</strong><p>试试：如何区分调节效应与中介效应？</p></div>}
      {messages.map(message => <article key={message.id} className={`chat-message ${message.role === 'user' ? 'from-user' : 'from-assistant'}`}>
        <span className="chat-avatar">{message.role === 'user' ? <UserRound size={15} /> : <Sparkles size={15} />}</span>
        <div className="chat-message-body">
          <div className="chat-message-label">{message.role === 'user' ? '你' : 'AI 助手'}{message.mode === 'demo' && <span className="chat-demo-tag">演示模式</span>}</div>
          <MarkdownContent>{message.content}</MarkdownContent>
          {message.provider && message.role === 'assistant' && <small className="chat-provider">{message.provider}</small>}
        </div>
      </article>)}
      {busy && <div className="chat-waiting"><LoaderCircle className="spin" size={16} />正在思考…</div>}
      <div ref={endRef} />
    </div>
    {error && <p className="chat-error" role="alert">{error}</p>}
    <form className="chat-composer" onSubmit={send}>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} maxLength={8000} placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）" rows={3} aria-label="输入对话内容" />
      <footer><span>最多 8,000 字 · 连接 AI 后可连续追问</span><button type="submit" disabled={!draft.trim() || busy} aria-label="发送消息"><ArrowUp size={17} />发送</button></footer>
    </form>
    {messages.length > 0 && <button type="button" className="chat-clear" onClick={() => { onChange([]); setError(''); }}><RotateCcw size={13} />清空本次对话</button>}
  </section>;
}
