import { useEffect, useRef, useState } from 'react';
import { BookOpenCheck, Check, Copy, Languages, LoaderCircle, Save, Sparkles, Pencil } from 'lucide-react';
import { api } from '../../api';
import { AppButton } from '../../components/AppButton';
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu';
import { MarkdownContent } from '../../components/MarkdownContent';
import type { SourceAnchor } from '../reader/sourceAnchor';
import { usePersistentDraft } from '../reader/usePersistentDraft';

const languageOptions: SelectMenuOption[] = [
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
];

export function AssistantTranslatePanel({ paperId, page, passage, anchor, onSave }: {
  paperId: string | null;
  page: number;
  passage: string;
  anchor?:SourceAnchor;
  onSave: (answer: string, targetLanguage: string) => Promise<void>;
}) {
  const [targetLanguage, setTargetLanguage] = useState('简体中文');
  const [answer, setAnswer] = useState('');
  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<'provider' | 'demo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [contextUsed, setContextUsed] = useState<{ neighboringText: boolean; glossaryCount: number } | null>(null);
  const source = passage.trim();
  const [cacheKey,setCacheKey]=useState('');
  const [cached,setCached]=useState(false);
  const [legacyEdited,setLegacyEdited]=useState(false);
  const [editing,setEditing]=useState(false);
  const [resultAt,setResultAt]=useState(0);
  const [saving,setSaving]=useState(false);
  const [editDraft,setEditDraft,draftStatus]=usePersistentDraft(`translation-edit:${cacheKey || 'empty'}`, {baseAnswer:answer,baseSavedAt:resultAt,answer,editedAt:0}, paperId || undefined);
  const matchesDraft = Boolean(cacheKey) && editDraft.baseAnswer===answer && editDraft.baseSavedAt===resultAt;
  const renderedAnswer = matchesDraft ? editDraft.answer : answer;
  const controller=useRef<AbortController | null>(null);
  const selected=useRef('');selected.current=`${paperId}:${page}:${source}:${targetLanguage}:${anchor?.extractionRevision || ''}`;
  type Result={answer:string;provider:string;mode:'provider'|'demo';cacheKey?:string;cached?:boolean;savedAt?:number;legacyEdited?:boolean;context?:{neighboringText:boolean;glossaryCount:number}};
  function apply(result:Result){setAnswer(result.answer);setProvider(result.provider);setMode(result.mode);setContextUsed(result.context||null);setCacheKey(result.cacheKey||'');setCached(Boolean(result.cached));setResultAt(result.savedAt || 0);setLegacyEdited(Boolean(result.legacyEdited));}

  useEffect(()=>{
    controller.current?.abort();setBusy(false);setAnswer('');setProvider('');setMode(null);setContextUsed(null);setError('');setCopied(false);setCacheKey('');setEditing(false);setCached(false);setResultAt(0);
    if(!paperId||!source)return;
    const request=new AbortController();controller.current=request;const key=selected.current;
    void api<Result>('/api/assistant/translate',{method:'POST',headers:{'Content-Type':'application/json'},signal:request.signal,
      body:JSON.stringify({paperId,page,passage:source,targetLanguage,anchor,cacheOnly:true})}).then(result=>{if(key===selected.current && !request.signal.aborted && result.answer)apply(result);}).catch(()=>undefined);
    return()=>request.abort();
  },[paperId,page,source,targetLanguage,anchor?.extractionRevision]);

  useEffect(()=>{
    if(!matchesDraft || editDraft.answer===answer || mode!=='provider' || busy)return;
    const key=selected.current;
    const timer=window.setTimeout(()=>{
      void api(`/api/assistant/translations/${cacheKey}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({answer:editDraft.answer,savedAt:editDraft.editedAt})})
        .catch(error=>{if(selected.current===key)setError(error instanceof Error?error.message:'译文同步失败，本地草稿仍保留。');});
    },600);
    return()=>window.clearTimeout(timer);
  },[cacheKey,matchesDraft,editDraft.answer,editDraft.editedAt,answer,mode,busy]);

  async function translate(force=false) {
    if (!paperId || !source || busy || saving) return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const key=selected.current;
    setBusy(true); setError(''); setCopied(false);
    try {
      const result = await api<Result>('/api/assistant/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal:request.signal,
        body: JSON.stringify({ paperId, page, passage: source, targetLanguage, anchor, force }),
      });
      if(key===selected.current && !request.signal.aborted)apply(result);
    } catch (requestError) {
      if(!request.signal.aborted && key===selected.current)setError(requestError instanceof Error ? requestError.message : '翻译失败，请重试。');
    } finally { if(key===selected.current)setBusy(false); }
  }

  async function saveToNotes() {
    if(saving || busy || !renderedAnswer.trim())return;
    const key=selected.current;setSaving(true);setError('');
    try { await onSave(renderedAnswer,targetLanguage); }
    catch(error){if(selected.current===key)setError(error instanceof Error?error.message:'收藏失败，请重试。');}
    finally { setSaving(false); }
  }

  return <section className="assistant-translate-panel" aria-label="AI 论文翻译">
    <div className="translation-controls"><span>翻译为</span><SelectMenu value={targetLanguage} options={languageOptions} onChange={setTargetLanguage} label="翻译目标语言"/>{!answer && <AppButton variant="secondary" onClick={()=>void translate()} disabled={busy || !source}><Languages size={16}/>{busy?'正在翻译…':'翻译本段'}</AppButton>}</div>
    {!source ? <div className="translation-empty"><Languages size={24} /><strong>先从左侧选择一段原文</strong><p>点击论文段落后，这里会显示出处并开始翻译。</p></div> : <>
      <details className="translation-source"><summary>原文 · 第 {page} 页 · {source.length} 字</summary><p>{source}</p></details>
      {error && <p className="translation-error" role="alert">{error}</p>}
      {busy && <div className="translation-waiting"><LoaderCircle className="spin" size={16} />正在结合上下文与本文术语翻译…</div>}
      {answer && <article className={`translation-result ${mode === 'demo' ? 'is-demo' : ''}`}>
        <div className="translation-card-heading"><span><Sparkles size={14} />译文 · {targetLanguage}</span><span>{provider}</span></div>
        {!editing && <MarkdownContent>{renderedAnswer}</MarkdownContent>}
        {cached && <p className="translation-cache-label">{legacyEdited?'已保留旧版本中人工校对的译文，请对照原文核实语境':'已恢复本机保存的译文'}</p>}
        {editing && <><textarea className="translation-edit" aria-label="修改译文" maxLength={24000} disabled={busy || saving} value={renderedAnswer} onChange={event=>setEditDraft({baseAnswer:answer,baseSavedAt:resultAt,answer:event.target.value,editedAt:Math.max(Date.now(),resultAt+1,editDraft.editedAt+1)})}/><p className="edit-save-status" role="status">{draftStatus || '修改后自动保存草稿'}</p></>}
        {mode === 'provider' && contextUsed && <div className="translation-context-receipt"><BookOpenCheck size={14} />已参考{contextUsed.neighboringText ? '论文相邻原文' : '论文标题'}{contextUsed.glossaryCount ? `和 ${contextUsed.glossaryCount} 条本文术语卡` : ''}</div>}
        {mode === 'demo' && <p className="translation-demo-hint">这是演示提示，并非真实译文。配置并启用 AI 服务后可使用翻译。</p>}
        <footer className="translation-actions">
          {mode==='provider' && <button type="button" disabled={busy || saving} onClick={()=>void translate(true)}>重新翻译</button>}
          {mode==='provider' && cacheKey && <button type="button" onClick={()=>setEditing(value=>!value)}><Pencil size={14}/>{editing?'收起编辑':'修改译文'}</button>}
          <button type="button" onClick={() => { if (!navigator.clipboard?.writeText) { setError('当前浏览器不支持剪贴板，请手动选择译文复制。'); return; } void navigator.clipboard.writeText(renderedAnswer).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => setError('复制失败，请检查浏览器剪贴板权限。')); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制译文'}</button>
          {mode === 'provider' && <button type="button" disabled={saving || busy || !renderedAnswer.trim()} onClick={() => void saveToNotes()}><Save size={14} />{saving?'收藏中…':'收藏到本文笔记'}</button>}
        </footer>
      </article>}
      <p className="translation-note">译文用于辅助理解。请对照英文原文核对术语、否定、比较关系和因果表述。</p>
    </>}
  </section>;
}
