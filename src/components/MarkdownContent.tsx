import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const components: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children, className }) => <div className="markdown-table-wrap"><table className={className}>{children}</table></div>,
};

export function MarkdownContent({ children, className = '' }: { children: string; className?: string }) {
  const source = children.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g).map((part, index) => {
    if (index % 2 === 1) return part;
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `$$\n${formula}\n$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${formula}$`);
  }).join('');
  return <div className={`markdown-content ${className}`}>
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>{source}</ReactMarkdown>
  </div>;
}
