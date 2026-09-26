import { ArrowUpRight, BarChart3, BookOpen, FileText, Lightbulb } from 'lucide-react';
import type { FigureReference } from './figureReferences';
import './reader.css';

export function FigureStudyPanel({ references, selectedId, currentPage, onOpenReference, onAskTutor }: {
  references: FigureReference[];
  selectedId: string | null;
  currentPage: number;
  onOpenReference: (reference: FigureReference) => void;
  onAskTutor: (reference: FigureReference) => void;
}) {
  const selected = references.find(reference => reference.id === selectedId)
    || references.find(reference => reference.page === currentPage)
    || references[0];

  return <div className="figure-study-content">
    <section className="figure-study-intro">
      <span className="figure-study-icon"><BarChart3 size={17} /></span>
      <div><strong>从图表读证据</strong><p>先看原图中的标题、坐标和比较对象，再回到正文核对作者如何解释。</p></div>
    </section>
    <div className="figure-study-list-heading"><strong>本篇图表</strong><span>{references.length} 项</span></div>
    {references.length ? <div className="figure-study-list">{references.map(reference => <button key={reference.id} className={`figure-study-item ${selected?.id === reference.id ? 'selected' : ''}`} onClick={() => onOpenReference(reference)}>
      <span className="figure-reference-icon"><FileText size={15} /></span><span className="figure-reference-copy"><strong>{reference.label}</strong><span>{reference.caption || '在 PDF 原页查看图题和图表内容'}</span></span><span className="figure-reference-page">p. {reference.page}</span>
    </button>)}</div> : <div className="figure-study-empty"><BookOpen size={17} /><strong>暂未识别到图表标题</strong><p>此索引读取 PDF 文本层的图题。可以用底部页码浏览原文 PDF。</p></div>}
    {selected && <section className="figure-reading-guide">
      <div className="figure-reading-guide-title"><Lightbulb size={15} /><strong>读 {selected.label} 时，依次确认</strong></div>
      <ol><li>图题说明的对象或变量是什么？</li><li>坐标轴、列标题和单位分别表示什么？</li><li>组别/条件之间观察到什么差异？</li><li>这是数据直接显示的结果，还是作者的解释？</li></ol>
      <button className="figure-open-source" onClick={() => onOpenReference(selected)}><FileText size={13} />在左侧查看 PDF 原图 <ArrowUpRight size={13} /></button>
      <button className="figure-ask-tutor" onClick={() => onAskTutor(selected)}><BarChart3 size={13} />带着读图问题请助手引导</button>
    </section>}
    <p className="figure-study-footnote">图像来自原始 PDF；助手不会把相关关系自动解释为因果关系。</p>
  </div>;
}
