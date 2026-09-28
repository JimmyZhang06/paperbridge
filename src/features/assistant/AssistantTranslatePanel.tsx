import { useEffect, useState } from 'react';
import { BookOpenCheck, Check, Copy, Languages, LoaderCircle, Save, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { AppButton } from '../../components/AppButton';
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu';
import { MarkdownContent } from '../../components/MarkdownContent';

const languageOptions: SelectMenuOption[] = [
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
];

export function AssistantTranslatePanel({ paperId, page, passage, onSave }: {
  paperId: string | null;
  page: number;
  passage: string;
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

  useEffect(() => {
    setAnswer(''); setProvider(''); setMode(null); setContextUsed(null); setError(''); setCopied(false);
  }, [paperId, page, source, targetLanguage]);

  async function translate() {
    if (!paperId || !source || busy) return;
    setBusy(true); setError(''); setAnswer(''); setCopied(false);
    try {
      const result = await api<{ answer: string; provider: string; mode: 'provider' | 'demo'; context?: { neighboringText: boolean; glossaryCount: number } }>('/api/assistant/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperId, page, passage: source, targetLanguage }),
      });
      setAnswer(result.answer); setProvider(result.provider); setMode(result.mode); setContextUsed(result.context || null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '翻译失败，请重试。');
    } finally { setBusy(false); }
  }

  return <section className="assistant-translate-panel" aria-label="AI 论文翻译">
    <header className="ai-tool-intro"><span className="ai-tool-icon"><Languages size={17} /></span><div><strong>AI 论文翻译</strong><p>结合论文前后文理解术语和指代，只翻译你选中的段落。</p></div></header>
    <div className="translation-language-row"><span>翻译为</span><SelectMenu value={targetLanguage} options={languageOptions} onChange={setTargetLanguage} label="翻译目标语言" /></div>
    {!source ? <div className="translation-empty"><Languages size={24} /><strong>先从左侧选择一段原文</strong><p>点击论文段落后，这里会显示出处并开始翻译。</p></div> : <>
      <article className="translation-source"><div className="translation-card-heading"><span>原文</span><span>第 {page} 页</span></div><p>{source}</p></article>
      <div className="translation-context-hint"><BookOpenCheck size={16} /><span><strong>语境辅助已开启</strong><small>AI 会参考本文相邻原文与已保存术语卡，避免孤立直译。</small></span></div>
      <AppButton variant="secondary" className="translation-run" onClick={() => void translate()} disabled={busy}><Languages size={16} />{busy ? '正在翻译…' : '翻译本段'}</AppButton>
      {error && <p className="translation-error" role="alert">{error}</p>}
      {busy && <div className="translation-waiting"><LoaderCircle className="spin" size={16} />正在结合上下文与本文术语翻译…</div>}
      {answer && <article className={`translation-result ${mode === 'demo' ? 'is-demo' : ''}`}>
        <div className="translation-card-heading"><span><Sparkles size={14} />译文 · {targetLanguage}</span><span>{provider}</span></div>
        <MarkdownContent>{answer}</MarkdownContent>
        {mode === 'provider' && contextUsed && <div className="translation-context-receipt"><BookOpenCheck size={14} />已参考{contextUsed.neighboringText ? '论文相邻原文' : '论文标题'}{contextUsed.glossaryCount ? `和 ${contextUsed.glossaryCount} 条本文术语卡` : ''}</div>}
        {mode === 'demo' && <p className="translation-demo-hint">这是演示提示，并非真实译文。配置并启用 AI 服务后可使用翻译。</p>}
        <footer className="translation-actions">
          <button type="button" onClick={() => { if (!navigator.clipboard?.writeText) { setError('当前浏览器不支持剪贴板，请手动选择译文复制。'); return; } void navigator.clipboard.writeText(answer).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => setError('复制失败，请检查浏览器剪贴板权限。')); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制译文'}</button>
          {mode === 'provider' && <button type="button" onClick={() => void onSave(answer, targetLanguage)}><Save size={14} />收藏到本文笔记</button>}
        </footer>
      </article>}
      <p className="translation-note">译文用于辅助理解。请对照英文原文核对术语、否定、比较关系和因果表述。</p>
    </>}
  </section>;
}
