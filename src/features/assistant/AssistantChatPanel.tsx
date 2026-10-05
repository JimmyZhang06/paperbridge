import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, BookOpenCheck, Clock3, Copy, Save, Square, FileText, LoaderCircle, MessageCircle, Plus, Search, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { api, apiUrl } from '../../api';
import { MarkdownContent } from '../../components/MarkdownContent';
import type { ChatMessage } from './types';
import type { SourceEvidence } from '../reader/sourceAnchor';
import { useConfirmation } from '../../components/useConfirmation';
import { usePersistentDraft } from '../reader/usePersistentDraft';

type ChatTurn = ChatMessage & { id: string; createdAt: string; provider?: string; mode?: 'provider' | 'demo'; paperId?: string; paperTitle?: string; paperPageCount?: number; paperScope?: 'full-paper'; page?: number; sources?:SourceEvidence[]; status?:'complete'|'interrupted'|'failed' };
type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatTurn[] };
type ConversationSummary = Omit<Conversation, 'messages'> & { messageCount: number };

export function AssistantChatPanel({ paperId, paperTitle, paperPageCount, onOpenCitation,onOpenSource,onOpenPaper,onSaved, modeControl, actionsTarget }: {
  onOpenPaper:(paperId:string)=>Promise<void>;
  paperId: string | null;
  paperTitle?: string;
  paperPageCount?: number;
  onOpenCitation: (page: number) => void;
  onOpenSource:(source:SourceEvidence)=>void;
  onSaved:()=>void;
  modeControl?: ReactNode;
  actionsTarget?: HTMLElement | null;
}) {

  const {confirm,confirmation}=useConfirmation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [composerDraft,setComposerDraft,draftStatus]=usePersistentDraft(`chat:${conversationId || 'new'}`,{text:''});
  const draft=composerDraft.text;
  const setDraft=(text:string)=>setComposerDraft({text});
  const abort=useRef<AbortController | null>(null);
  const [savedMessages,setSavedMessages]=useState<string[]>([]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [searchResults,setSearchResults] = useState<ConversationSummary[] | null>(null);
  const [searching,setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paperContextEnabled, setPaperContextEnabled] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setPaperContextEnabled(false); }, [paperId]);

  async function refreshConversations() {
    const data = await api<ConversationSummary[]>('/api/assistant/conversations');
    setConversations(data);
    return data;
  }

  async function openConversation(id: string) {
    setLoading(true); setError('');
    try {
      const conversation = await api<Conversation>(`/api/assistant/conversations/${id}`);
      setConversationId(conversation.id); localStorage.setItem('paperbridge:last-conversation',conversation.id); setMessages(conversation.messages); setHistoryOpen(false);
      const lastContextMessage = [...conversation.messages].reverse().find(message => message.role === 'user' && message.paperId);
      setPaperContextEnabled(Boolean(paperId && lastContextMessage?.paperId === paperId));
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '无法打开对话记录。'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void api<ConversationSummary[]>('/api/assistant/conversations').then(async data => {
      if (!active) return;
      setConversations(data);
      const savedId=localStorage.getItem('paperbridge:last-conversation');
      const selected=savedId==='new'?undefined:data.find(item=>item.id===savedId)||data[0];
      if (selected) {
        const conversation = await api<Conversation>(`/api/assistant/conversations/${selected.id}`);
        if (active) {
          setConversationId(conversation.id); setMessages(conversation.messages);
          const lastContextMessage = [...conversation.messages].reverse().find(message => message.role === 'user' && message.paperId);
          setPaperContextEnabled(Boolean(paperId && lastContextMessage?.paperId === paperId));
        }
      }
    }).catch(requestError => { if (active) setError(requestError instanceof Error ? requestError.message : '加载历史对话失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filteredConversations = useMemo(()=>historyQuery.trim() ? searchResults || [] : conversations,[conversations,searchResults,historyQuery]);
  useEffect(()=>{
    if(!historyQuery.trim()){setSearchResults(null);setSearching(false);return;}
    let current=true;const request=new AbortController();setSearching(true);setSearchResults(null);
    const timer=setTimeout(()=>{void api<ConversationSummary[]>(`/api/assistant/conversations?q=${encodeURIComponent(historyQuery)}`,{signal:request.signal})
      .then(data=>{if(current)setSearchResults(data);})
      .catch(error=>{if(current)setError(`历史搜索失败：${error.message}`);})
      .finally(()=>{if(current)setSearching(false);});},250);
    return()=>{current=false;clearTimeout(timer);request.abort();};
  },[historyQuery,conversations]);

  function newConversation() {
    if(busy)return;localStorage.setItem('paperbridge:last-conversation','new');setConversationId(null); setMessages([]); setError(''); setHistoryOpen(false); setPaperContextEnabled(false);
  }

  function startWithPrompt(prompt: string, usePaper = false) {
    setDraft(prompt);
    if (usePaper && paperId) setPaperContextEnabled(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function deleteConversation(id: string) {
    if (!(await confirm('删除这条对话记录？删除后无法恢复。'))) return;
    try {
      await api(`/api/assistant/conversations/${id}`, { method: 'DELETE' });
      const remaining = await refreshConversations();
      if (conversationId === id) {
        if (remaining[0]) await openConversation(remaining[0].id);
        else newConversation();
      }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '删除失败，请重试。'); }
  }

  async function saveMessage(message:ChatTurn){
    if(!conversationId)return;
    try{await api(`/api/assistant/conversations/${conversationId}/messages/${message.id}/note`,{method:'POST'});setSavedMessages(items=>[...items,message.id]);onSaved();}
    catch(error){setError((error as Error).message);}
  }
  async function send(event:FormEvent){
    event.preventDefault();const content=draft.trim();if(!content||busy||loading)return;
    setBusy(true);setError('');let activeId=conversationId;let acknowledged=false;let partial:ChatTurn|undefined;
    const controller=new AbortController();abort.current=controller;
    try{
      if(!activeId){const created=await api<Conversation>('/api/assistant/conversations',{method:'POST',signal:controller.signal});activeId=created.id;setConversationId(activeId);}
      localStorage.setItem('paperbridge:last-conversation',activeId);
      const response=await fetch(apiUrl('/api/assistant/chat'),{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({conversationId:activeId,content,stream:true,...(paperContextEnabled && paperId?{paperId}: {})})});
      if(!response.ok){const result=await response.json();throw new Error(result.error||`请求失败 (${response.status})`);}
      const reader=response.body?.getReader();if(!reader)throw new Error('浏览器无法读取回答数据流。');
      const decoder=new TextDecoder();let buffer='';let lastRender=0;
      try{for(;;){
        const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()||'';if(done&&buffer){lines.push(buffer);buffer='';}
        for(const line of lines){if(!line.trim())continue;
          const data=JSON.parse(line) as {type:string;user?:ChatTurn;assistant?:ChatTurn;text?:string;error?:string};
          if(data.type==='start'&&data.user&&data.assistant){acknowledged=true;partial=data.assistant;setDraft('');setMessages(items=>[...items,data.user!,{...data.assistant!}]);}
          if(data.type==='delta'&&partial){partial.content+=data.text||'';if(Date.now()-lastRender>80){const snapshot={...partial};setMessages(items=>items.map(item=>item.id===snapshot.id?snapshot:item));lastRender=Date.now();}}
          if(data.type==='done'&&data.assistant){partial=data.assistant;setMessages(items=>items.map(item=>item.id===data.assistant!.id?data.assistant!:item));}
          if(data.type==='error'){if(data.assistant)partial=data.assistant;throw new Error(data.error||'生成失败。');}
        }
        if(done)break;
      }}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
      await refreshConversations();
      requestAnimationFrame(()=>endRef.current?.scrollIntoView({behavior:'smooth',block:'end'}));
    }catch(error){
      if(!acknowledged){setConversationId(conversationId);localStorage.setItem('paperbridge:last-conversation',conversationId || 'new');setDraft(content);}
      if(partial){const snapshot={...partial,status:controller.signal.aborted?'interrupted' as const:'failed' as const};setMessages(items=>items.map(item=>item.id===snapshot.id?snapshot:item));}
      setError(controller.signal.aborted?'生成已停止，已收到的内容会保留在历史记录中。':(error as Error).message);
    }finally{setBusy(false);abort.current=null;void refreshConversations().catch(()=>undefined);}
  }

  const chatActions = <div className="chat-toolbar-actions"><button type="button" className="chat-icon-button" aria-label="新建对话" title="新建对话" disabled={busy} onClick={newConversation}><Plus size={17} /></button><button type="button" className={`chat-icon-button ${historyOpen ? 'active' : ''}`} aria-label={`对话历史，${conversations.length} 条`} title="对话历史" disabled={busy} onClick={() => setHistoryOpen(value => !value)}><Clock3 size={16} /><span className="chat-history-count">{conversations.length}</span></button></div>;
  return <>
  <section className="assistant-chat-panel" aria-label="通用 AI 助手">
    <div className="chat-toolbar"><div className="chat-toolbar-leading">{modeControl}<div className="chat-current-title"><span>{conversationId ? conversations.find(item => item.id === conversationId)?.title || '历史对话' : '新对话'}</span><small>{messages.length ? `${messages.length} 条消息` : '准备开始'}</small></div></div></div>
    {historyOpen && <section className="chat-history-drawer" aria-label="对话历史记录"><div className="chat-history-search"><Search size={15} /><input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="搜索标题和对话内容" aria-label="搜索历史对话内容" /><button type="button" aria-label="关闭历史记录" onClick={() => setHistoryOpen(false)}><X size={15} /></button></div><div className="chat-history-list">{searching ? <p className="chat-history-empty">正在搜索对话内容…</p> : filteredConversations.length ? filteredConversations.map(item => <div key={item.id} className={`chat-history-row ${item.id === conversationId ? 'current' : ''}`}><button type="button" className="chat-history-open" onClick={() => void openConversation(item.id)}><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {Math.floor(item.messageCount / 2)} 轮对话</span></button><button type="button" className="chat-history-delete" aria-label={`删除${item.title}`} onClick={() => void deleteConversation(item.id)}><Trash2 size={14} /></button></div>) : <p className="chat-history-empty">没有匹配的对话记录</p>}</div></section>}
    <div className="chat-history" aria-live="polite">
      {loading ? <div className="chat-empty"><LoaderCircle className="spin" size={22} /><strong>正在打开对话…</strong></div> : !messages.length && <div className="chat-welcome">
        <span className="chat-empty-icon"><MessageCircle size={21} /></span>
        <div><span className="chat-welcome-eyebrow">PAPERBRIDGE · AI 对话</span><h3>你现在想弄懂什么？</h3><p>直接提出问题。需要结合论文时，打开输入框上方的“结合本文”。</p></div>
        <div className="chat-prompt-list" aria-label="问题示例">
          <button type="button" onClick={() => startWithPrompt('如何区分调节效应与中介效应？')}>调节效应和中介效应有什么区别？<ArrowUp size={14} /></button>
          {paperId && <button type="button" onClick={() => startWithPrompt('请梳理这篇论文的方法设计：研究对象、测量指标和分析方法分别是什么？', true)}>梳理这篇论文的方法设计<BookOpenCheck size={14} /></button>}
        </div>
      </div>}
      {messages.map(message => <article key={message.id} className={`chat-message ${message.role === 'user' ? 'from-user' : 'from-assistant'}`}>
        <span className="chat-avatar">{message.role === 'user' ? <UserRound size={15} /> : <Sparkles size={15} />}</span>
        <div className="chat-message-body">
          <div className="chat-message-label">{message.role === 'user' ? '你' : 'AI 助手'}{message.mode === 'demo' && <span className="chat-demo-tag">演示模式</span>}</div>
          {!message.content && message.role==='assistant' && message.status && <p className="chat-message-status">{message.status==='interrupted'?'生成已停止':'本次回答未生成，可以重新发送问题。'}</p>}
          <MarkdownContent sources={message.sources} onOpenSource={onOpenSource}>{message.content}</MarkdownContent>
          {message.role==='assistant' && message.content && <div className="chat-message-actions"><button type="button" onClick={()=>void navigator.clipboard.writeText(message.content).catch(()=>setError('复制失败，请手动复制。'))}><Copy size={14}/>复制</button>{message.paperId && <button type="button" disabled={savedMessages.includes(message.id)} onClick={()=>void saveMessage(message)}><Save size={14}/>{savedMessages.includes(message.id)?'已收藏':'存入本文笔记'}</button>}{message.status && message.status!=='complete' && <span className="chat-message-status">{message.status==='interrupted'?'已停止 · 部分回答':'生成中断 · 部分回答'}</span>}</div>}
          {message.sources?.length ? <details className="chat-evidence-details"><summary>{message.role==='user'?'检索到的原文片段':'核对原文依据'} · {message.sources.length} 处</summary><div className="chat-source-list">{message.sources.map(source=><button type="button" key={source.id} onClick={()=>onOpenSource(source)}>p.{source.page} · {source.section || '原文'}</button>)}</div></details>:null}
          {message.role === 'user' && message.paperId && message.paperTitle && (message.paperScope === 'full-paper' ? <button type="button" className="chat-paper-source" title={`打开关联文献：${message.paperTitle}`} onClick={()=>void onOpenPaper(message.paperId!).catch(error=>setError(error.message))}><FileText size={13} />结合全文 · {message.paperPageCount || '多'} 页 · {message.paperTitle}</button> : <button type="button" className="chat-paper-source" onClick={() => onOpenCitation(message.page || 1)}><FileText size={13} />基于《{message.paperTitle}》· 第 {message.page || 1} 页</button>)}
          <time className="chat-message-time">{new Date(message.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
          {message.provider && message.role === 'assistant' && <small className="chat-provider">{message.provider}</small>}
        </div>
      </article>)}
      {busy && <div className="chat-waiting"><LoaderCircle className="spin" size={16} />正在思考…</div>}
      <div ref={endRef} />
    </div>
    {error && <p className="chat-error" role="alert">{error}</p>}
    <form className="chat-composer" onSubmit={send}>
      <div className="chat-context-row"><button type="button" className={`chat-context-toggle ${paperContextEnabled ? 'enabled' : ''}`} disabled={!paperId} aria-pressed={paperContextEnabled} title={paperId ? '允许 AI 在当前论文全文中检索相关原文' : '打开一篇论文后可关联全文'} onClick={() => setPaperContextEnabled(value => !value)}><BookOpenCheck size={15} />{paperContextEnabled ? '已关联全文' : '结合全文'}</button>{paperContextEnabled && paperTitle ? <span className="chat-context-paper" title={paperTitle}>{paperTitle} · {paperPageCount || '多'} 页全文</span> : <span className="chat-context-caption">{paperId ? '在全文中检索相关内容，并标注出处页码' : '打开一篇论文后，即可结合全文提问'}</span>}</div>
      <textarea ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} maxLength={8000} placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）" rows={3} aria-label="输入对话内容" />
      <footer><span>{draftStatus || '最多 8,000 字'}</span>{busy && <button type="button" onClick={()=>abort.current?.abort()}><Square size={15}/>停止</button>}<button type="submit" disabled={!draft.trim() || busy || loading} aria-label="发送消息">{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={17} />}{busy ? '思考中' : '发送'}</button></footer>
    </form>
  </section>
  {confirmation}
  {actionsTarget && createPortal(chatActions, actionsTarget)}
  </>;
}
