import { ArrowRight, BookOpen, Check, ChevronDown, FileText, Search, Sparkles, Highlighter, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StudyStageId } from '../study/StudyRoadmap';
import { MarkdownContent } from '../../components/MarkdownContent';
import './notes.css';

export type StudyNoteRecord = { id: string; paperId: string; paperTitle?: string; page: number; passage: string; firstAttempt: string; revisedUnderstanding: string; uncertainty?: string; stageId?: StudyStageId; kind?: 'learning' | 'ai' | 'highlight'; aiAnswer?: string; highlightColor?: 'yellow' | 'blue' | 'green'; createdAt: string; updatedAt: string };
export type GlossaryRecord = { id: string; paperId: string; term: string; meaning: string; passage: string; page: number; createdAt: string };
type PaperRecord = { id: string; title: string };
const stageLabels = [
  ['background', '研究背景'], ['gap', '已有不足'], ['question', '研究问题'], ['method', '研究方法'], ['findings', '主要发现'], ['contribution', '贡献与局限'],
];

export function StudyNotesPanel({ papers, notes, terms, onOpenPaper, onOpenNote, onDeleteNote, onOpenTerm, onDeleteTerm }: {
  papers: PaperRecord[];
  notes: StudyNoteRecord[];
  terms: GlossaryRecord[];
  onOpenPaper: (id: string) => void;
  onOpenNote: (note: StudyNoteRecord) => void;
  onDeleteNote: (note: StudyNoteRecord) => void;
  onOpenTerm: (term: GlossaryRecord) => void;
  onDeleteTerm: (term: GlossaryRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'learning' | 'ai' | 'highlight'>('all');
  const filteredNotes = useMemo(() => notes.filter(note => {
    const kind = note.kind || 'learning';
    const matchesType = filter === 'all' || kind === filter;
    const haystack = [note.paperTitle, note.passage, note.firstAttempt, note.revisedUnderstanding, note.aiAnswer, note.uncertainty].join(' ').toLocaleLowerCase();
    return matchesType && haystack.includes(query.trim().toLocaleLowerCase());
  }), [notes, filter, query]);
  const groups = papers.map(paper => ({ paper, notes: filteredNotes.filter(note => note.paperId === paper.id), terms: filter === 'all' ? terms.filter(term => term.paperId === paper.id && (!query.trim() || `${term.term} ${term.meaning} ${term.passage}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) : [] }))
    .filter(group => group.notes.length || group.terms.length);
  if (!notes.length && !terms.length) return <div className="tutor-empty"><div className="tutor-empty-icon"><FileText size={18} /></div><h3>还没有学习记录</h3><p>学习理解、AI 回答和原文标注都会按文献归档。阅读时可收藏 AI 回答，或给重要段落做标记。</p>{papers[0] && <button className="subtle-button" onClick={() => onOpenPaper(papers[0].id)}><BookOpen size={14} />返回论文</button>}</div>;

  return <div className="notes-content"><div className="notes-tools"><label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文献、原文或笔记内容" /></label><div className="notes-filters">{([['all','全部'],['learning','学习记录'],['ai','AI 收藏'],['highlight','原文标注']] as const).map(([id,label]) => <button className={filter === id ? 'active' : ''} key={id} onClick={() => setFilter(id)}>{label}{id === 'all' ? ` ${notes.length}` : ` ${notes.filter(note => (note.kind || 'learning') === id).length}`}</button>)}</div></div>
    {!groups.length ? <div className="notes-no-results">没有匹配的记录，试试其他关键词或类别。</div> : groups.map(({ paper, notes: paperNotes, terms: paperTerms }) => <details className="note-paper-group" key={paper.id}>
      <summary className="note-paper-summary"><span><small>{paperNotes.length} 条笔记 · {paperTerms.length} 张术语卡</small><strong>{paper.title}</strong></span><ChevronDown size={15} /></summary><button className="note-paper-open" onClick={() => onOpenPaper(paper.id)}>打开文献 <ArrowRight size={12} /></button>
      {paperNotes.some(note => note.stageId) && <details className="learning-recall-card"><summary>论文复述卡 · 汇总已保存的阶段理解</summary><div className="learning-recall-body">{stageLabels.map(([id, label]) => {
        const note = paperNotes.find(item => item.stageId === id && item.revisedUnderstanding.trim());
        return <section key={id}><strong>{label}</strong>{note ? <><p>{note.revisedUnderstanding}</p><button onClick={() => onOpenNote(note)}>核对原文 · p. {note.page} <ArrowRight size={11} /></button></> : <span>尚未记录</span>}</section>;
      })}{paperNotes.some(note => note.uncertainty?.trim()) && <section className="recall-uncertainties"><strong>仍不确定</strong>{paperNotes.filter(note => note.uncertainty?.trim()).map(note => <p key={note.id}>{note.uncertainty} <button onClick={() => onOpenNote(note)}>p. {note.page} <ArrowRight size={11} /></button></p>)}</section>}</div></details>}
      {paperTerms.length > 0 && <div className="glossary-section"><h4>术语卡</h4>{paperTerms.map(term => <article className="glossary-card" key={term.id}><header><strong>{term.term}</strong><span>p. {term.page}</span><button className="icon-button small danger" title="删除术语卡" onClick={() => onDeleteTerm(term)}><Trash2 size={13} /></button></header><MarkdownContent className="glossary-markdown">{term.meaning}</MarkdownContent><button className="note-open" onClick={() => onOpenTerm(term)}>查看原文出处 <ArrowRight size={12} /></button></article>)}</div>}
      {paperNotes.map(note => <article className={`note-card ${note.kind === 'ai' ? 'saved-ai-card' : note.kind === 'highlight' ? 'saved-highlight-card' : ''}`} key={note.id}><header><span className="note-page">{note.kind === 'ai' ? <><Sparkles size={11} /> AI 收藏</> : note.kind === 'highlight' ? <><Highlighter size={11} /> 原文标注</> : <>第 {note.page} 页 · 学习记录</>}</span><button className="icon-button small danger" title="删除笔记" onClick={() => onDeleteNote(note)}><Trash2 size={14} /></button></header><p className="note-passage">“{note.passage.replace(/\s+/g, ' ').slice(0, 110)}{note.passage.length > 110 ? '…' : ''}”</p>{note.kind === 'ai' ? <div className="note-version revised-version"><span><Sparkles size={12} />AI 回答</span><MarkdownContent>{note.aiAnswer || note.revisedUnderstanding}</MarkdownContent></div> : note.kind === 'highlight' ? <p className="highlight-note-label">已标注为重点段落</p> : <><div className="note-version"><span>最初理解</span><p>{note.firstAttempt || '（未填写）'}</p></div><div className="note-version revised-version"><span><Check size={12} />修订理解</span><p>{note.revisedUnderstanding || '（未填写）'}</p></div></>}<button className="note-open" onClick={() => onOpenNote(note)}>回到原文 · p. {note.page} <ArrowRight size={12} /></button></article>)}
    </details>)}
  </div>;
}
