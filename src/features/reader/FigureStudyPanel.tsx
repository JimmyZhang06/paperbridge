import { Suspense, lazy, useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, BookOpen, Lightbulb, LoaderCircle } from 'lucide-react';
import type { FigureReference } from './figureReferences';
import './reader.css';
import { FigureCropEditor } from './FigureCropEditor';
import { SelectMenu } from '../../components/SelectMenu';

const defaultCrop:[number,number,number,number]=[.05,.05,.9,.9];
const PdfPageViewer = lazy(() => import('../../PdfPageViewer'));

export function FigureStudyPanel({ references, selectedId, currentPage, file, onOpenReference, onAskTutor,onOpenDiscussion,onSaveCrop }: {
  references: FigureReference[];
  selectedId: string | null;
  currentPage: number;
  file: string;
  onOpenReference: (reference: FigureReference) => void;
  onAskTutor: (reference: FigureReference) => void;
  onOpenDiscussion:(source:{id:string;page:number;text:string})=>void;
  onSaveCrop:(reference:FigureReference,crop:[number,number,number,number])=>Promise<void>;
}) {
  const [editing,setEditing]=useState(false);
  const [preview,setPreview]=useState<{id:string;crop:[number,number,number,number]} | null>(null);
  const selected = references.find(reference => reference.id === selectedId)
    || references.find(reference => reference.page === currentPage)
    || references[0];
  useEffect(()=>{setEditing(false);setPreview(null);},[file,selected?.id]);

  return <div className="figure-study-content">
    <div className="figure-study-list-heading"><strong>本篇图表</strong><span>{references.length} 项</span></div>
    {selected ? <SelectMenu className="figure-picker" label="选择图表" value={selected.id} options={references.map(reference=>({value:reference.id,label:`${reference.label} · 第 ${reference.page} 页`}))} onChange={id=>{const reference=references.find(item=>item.id===id);if(reference){setEditing(false);setPreview(null);onOpenReference(reference);}}}/> : <div className="figure-study-empty"><BookOpen size={17} /><strong>暂未识别到图表标题</strong><p>此索引读取 PDF 文本层的图题。可以用底部页码浏览原文 PDF。</p></div>}
    {selected && <section className="figure-original-preview"><header><strong>{selected.label} · 原图</strong><button onClick={() => onOpenReference(selected)}>在左侧阅读 <ArrowUpRight size={13} /></button></header><div className="figure-original-preview-page"><Suspense fallback={<div className="pdf-loading"><LoaderCircle className="spin" size={16} />正在载入图表…</div>}><PdfPageViewer file={file} pageNumber={selected.page} crop={preview?.id===selected.id?preview.crop:selected.crop} /></Suspense></div>
      {selected.blockId && <><button type="button" className="figure-open-source" onClick={()=>{setEditing(value=>!value);setPreview(null);}}>调整图表范围</button>{editing&&<FigureCropEditor key={selected.id} initial={selected.crop || defaultCrop} onChange={crop=>setPreview({id:selected.id,crop})} onSave={async crop=>{await onSaveCrop(selected,crop);setEditing(false);setPreview(null);}}/>}</>}
      {selected.caption && <p className="figure-selected-caption">{selected.caption}</p>}
      {selected.mentions.length>0 && <details><summary>正文中讨论此图表 · {selected.mentions.length} 处</summary>{selected.mentions.map(source=><button type="button" className="roadmap-evidence-link" key={source.id} onClick={()=>onOpenDiscussion(source)}>p.{source.page} · {source.text.slice(0,160)}</button>)}</details>}
    </section>}
    {selected && <><details className="figure-reading-guide"><summary><Lightbulb size={15}/>读图时核对什么？</summary><ol><li>图题说明的对象或变量是什么？</li><li>坐标轴、列标题和单位分别表示什么？</li><li>组别/条件之间观察到什么差异？</li><li>这是数据直接显示的结果，还是作者的解释？</li></ol></details><button className="figure-ask-tutor" onClick={() => onAskTutor(selected)}><BarChart3 size={15} />请助手引导读图</button></>}
    <p className="figure-study-footnote">图像来自原始 PDF；助手不会把相关关系自动解释为因果关系。</p>
  </div>;
}
