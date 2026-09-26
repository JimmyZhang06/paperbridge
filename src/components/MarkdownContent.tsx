import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children, className }) => <div className="markdown-table-wrap"><table className={className}>{children}</table></div>,
};

export function MarkdownContent({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`markdown-content ${className}`}>
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
  </div>;
}
