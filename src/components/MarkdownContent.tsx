import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { SourceEvidence } from '../features/reader/sourceAnchor';

const components: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children, className }) => <div className="markdown-table-wrap"><table className={className}>{children}</table></div>,
};

export function MarkdownContent({ children, className = '', sources=[], onOpenSource }: { children: string; className?: string; sources?:SourceEvidence[]; onOpenSource?:(source:SourceEvidence)=>void }) {
  const source = children.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g).map((part, index) => {
    if (index % 2 === 1) return part;
    return part
      .replace(/\[(S[a-f0-9]{10})\]/g,(match,id:string)=>{const source=sources.find(item=>item.id===id);return source?`[p. ${source.page}](#source-${id})`:match;})
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `$$\n${formula}\n$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${formula}$`);
  }).join('');
  return <div className={`markdown-content ${className}`}>
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{...components,a:({children,href,title})=>{
      const evidence=sources.find(item=>href===`#source-${item.id}`);
      return evidence?<button className="markdown-source-button" type="button" onClick={()=>onOpenSource?.(evidence)} title={`p.${evidence.page} · ${evidence.section}`}>{children}</button>:<a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>;
    }}}>{source}</ReactMarkdown>
  </div>;
}
