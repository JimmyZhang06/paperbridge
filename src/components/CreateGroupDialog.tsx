import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FolderPlus, X } from 'lucide-react';
import './create-group-dialog.css';

type CreateGroupDialogProps = {
  open: boolean;
  existingNames: string[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
};

export function CreateGroupDialog({ open, existingNames, onClose, onCreate }: CreateGroupDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError('');
    setSaving(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('请先输入分组名称。'); inputRef.current?.focus(); return; }
    if (trimmed.length > 40) { setError('分组名称不能超过 40 个字符。'); return; }
    if (existingNames.some(existing => existing.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setError('已经有同名分组，请换一个名称。');
      inputRef.current?.focus();
      return;
    }

    setSaving(true);
    savingRef.current = true;
    setError('');
    try {
      await onCreate(trimmed);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请重试。');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <div className="create-group-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="create-group-dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title" aria-describedby="create-group-description">
      <header className="create-group-heading">
        <span className="create-group-icon"><FolderPlus size={20} /></span>
        <button className="create-group-close" type="button" aria-label="关闭" onClick={onClose} disabled={saving}><X size={18} /></button>
        <span className="eyebrow">PAPER COLLECTION</span>
        <h2 id="create-group-title">新建分组</h2>
        <p id="create-group-description">按主题整理文献。分组不会改变论文及其笔记的关联。</p>
      </header>
      <form onSubmit={event => void submit(event)}>
        <label className="create-group-label" htmlFor="create-group-name">分组名称</label>
        <input
          ref={inputRef}
          id="create-group-name"
          autoComplete="off"
          maxLength={40}
          value={name}
          onChange={event => { setName(event.target.value); if (error) setError(''); }}
          placeholder="例如：情绪调节、研究方法"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'create-group-error' : 'create-group-hint'}
        />
        <div className="create-group-field-foot">
          {error ? <span id="create-group-error" role="alert">{error}</span> : <span id="create-group-hint">最多 40 个字符</span>}
          <span>{name.length}/40</span>
        </div>
        <footer className="create-group-actions">
          <button className="create-group-cancel" type="button" onClick={onClose} disabled={saving}>取消</button>
          <button className="create-group-submit" type="submit" disabled={saving || !name.trim()}>{saving ? '正在创建…' : '创建分组'}</button>
        </footer>
      </form>
    </section>
  </div>;
}
