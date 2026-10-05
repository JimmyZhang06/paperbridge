import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import './paper-review-dialog.css';

export type ReviewBlock = { id: string; kind: string; text: string; hidden?: boolean };
type Props = {
  open: boolean;
  title: string;
  author: string;
  page: number;
  blocks: ReviewBlock[];
  onClose: () => void;
  onSave: (corrections: { title: string; author: string; page: number; blocks: Array<{ id: string; text: string; hidden: boolean }> }) => Promise<void>;
  onViewOriginal: () => void;
};

export function PaperReviewDialog({ open, title, author, page, blocks, onClose, onSave, onViewOriginal }: Props) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftAuthor, setDraftAuthor] = useState(author);
  const [draftBlocks, setDraftBlocks] = useState<ReviewBlock[]>(blocks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftTitle(title);
    setDraftAuthor(author);
    setDraftBlocks(blocks.map(block => ({ ...block })));
    setError('');
  }, [open, title, author, page, blocks]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({ title: draftTitle.trim(), author: draftAuthor.trim(), page, blocks: draftBlocks.map(block => ({ id: block.id, text: block.text, hidden: Boolean(block.hidden) })) });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return <div className="paper-review-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="paper-review-dialog" role="dialog" aria-modal="true" aria-labelledby="paper-review-title">
      <header className="paper-review-header">
        <div><span className="eyebrow">PDF TEXT REVIEW</span><h2 id="paper-review-title">解析校对 · 第 {page} 页</h2><p>对照 PDF 原页修正文字。修改只影响精读视图和 AI 检索，原始 PDF 始终保留。</p></div>
        <button type="button" className="paper-review-close" onClick={onClose} aria-label="关闭校对" disabled={saving}><X size={19} /></button>
      </header>
      <form onSubmit={event => void submit(event)}>
        <div className="paper-review-fields">
          <label>论文标题<input value={draftTitle} maxLength={220} required onChange={event => setDraftTitle(event.target.value)} /></label>
          <label>作者<input value={draftAuthor} maxLength={500} onChange={event => setDraftAuthor(event.target.value)} /></label>
        </div>
        <div className="paper-review-list-header"><strong>本页文本块</strong><span>共 {draftBlocks.length} 条 · 误识别内容可隐藏</span></div>
        <div className="paper-review-list">
          {draftBlocks.map((block, index) => <div className={`paper-review-block ${block.hidden ? 'is-hidden' : ''}`} key={block.id}>
            <div className="paper-review-block-meta"><span>{String(index + 1).padStart(2, '0')} · {block.kind}</span><button type="button" onClick={() => setDraftBlocks(current => current.map(item => item.id === block.id ? { ...item, hidden: !item.hidden } : item))}>{block.hidden ? <><Eye size={16} />显示</> : <><EyeOff size={16} />隐藏</>}</button></div>
            <textarea aria-label={`第 ${index + 1} 条文本`} rows={Math.min(5, Math.max(2, Math.ceil(block.text.length / 85)))} maxLength={5000} value={block.text} onChange={event => setDraftBlocks(current => current.map(item => item.id === block.id ? { ...item, text: event.target.value } : item))} />
          </div>)}
        </div>
        {error && <p className="paper-review-error" role="alert">{error}</p>}
        <footer className="paper-review-actions"><button type="button" onClick={onViewOriginal}>查看 PDF 原页</button><div><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="paper-review-save" disabled={saving || !draftTitle.trim()}>{saving ? '正在保存…' : '保存校对'}</button></div></footer>
      </form>
    </section>
  </div>;
}
