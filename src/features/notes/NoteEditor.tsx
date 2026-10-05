import { useState } from 'react';
import { AppButton } from '../../components/AppButton';
import { usePersistentDraft } from '../reader/usePersistentDraft';
import type { StudyNoteRecord } from './StudyNotesPanel';
export function NoteEditor({note,onSave,onClose}:{note:StudyNoteRecord;onSave:(fields:Partial<StudyNoteRecord>)=>Promise<void>;onClose:()=>void}){
  const initial = { baseUpdatedAt: note.updatedAt, firstAttempt: note.firstAttempt, revisedUnderstanding: note.revisedUnderstanding, uncertainty: note.uncertainty || '', aiAnswer: note.aiAnswer || '', tags: (note.tags || []).join(', ') };
  const [stored, setDraft, status] = usePersistentDraft(`note-edit:${note.id}`, initial, note.paperId);
  const draft = stored.baseUpdatedAt === note.updatedAt ? stored : initial;
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const change = (field: keyof typeof initial, value: string) => setDraft({ ...draft, [field]: value });
  return <form className="note-edit-form" onSubmit={event=>{
    event.preventDefault(); if(busy)return;
    const tags = [...new Set(draft.tags.split(/[,，]/).map(item=>item.trim()).filter(Boolean))];
    if(tags.length>20 || tags.some(tag=>tag.length>40)){setError('标签最多 20 项，每项不超过 40 字。');return;}
    setBusy(true);setError('');
    void onSave({firstAttempt:draft.firstAttempt,revisedUnderstanding:draft.revisedUnderstanding,uncertainty:draft.uncertainty,aiAnswer:draft.aiAnswer,tags}).then(onClose).catch(error=>setError(error instanceof Error?error.message:'保存失败，请重试。')).finally(()=>setBusy(false));
  }}>
    <fieldset disabled={busy}>
    {note.kind==='ai'?<label>收藏内容 · Markdown<textarea value={draft.aiAnswer} onChange={event=>change('aiAnswer',event.target.value)} maxLength={60000}/></label>:note.kind!=='highlight'&&<><label>最初理解<textarea value={draft.firstAttempt} onChange={event=>change('firstAttempt',event.target.value)} maxLength={5000}/></label><label>修订理解<textarea value={draft.revisedUnderstanding} onChange={event=>change('revisedUnderstanding',event.target.value)} maxLength={5000}/></label><label>仍不确定<textarea value={draft.uncertainty} onChange={event=>change('uncertainty',event.target.value)} maxLength={5000}/></label></>}
    <label>标签 · 逗号分隔<input value={draft.tags} onChange={event=>change('tags',event.target.value)} maxLength={800}/></label>
    </fieldset>
    {error&&<p role="alert">{error}</p>}
    <p className="edit-save-status" role="status">{status || '修改后自动保留草稿'} · 关闭编辑后可继续修改；点击保存后更新笔记。</p>
    <div><AppButton type="submit" disabled={busy}>{busy?'保存中…':'保存修改'}</AppButton><AppButton type="button" variant="text" disabled={busy} onClick={onClose}>关闭编辑</AppButton></div>
  </form>;
}
