import { useMemo, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
type Item = { id:string; page:number; text:string; kind?:string; headingLevel?:number };
export function ReaderNavigation({ paragraphs, onSelect, onClose }: { paragraphs: Item[]; onSelect:(item:Item)=>void; onClose:()=>void }) {
  const [query,setQuery] = useState('');
  const [limit,setLimit] = useState(30);
  const results = useMemo(() => query.trim() ? paragraphs.filter(item=>item.text.toLowerCase().includes(query.trim().toLowerCase()))
    : paragraphs.filter(item=>item.kind === 'heading' || item.kind === 'abstract'),[paragraphs,query]);
  return <section className="reader-navigation" aria-label="目录与全文搜索"><header><strong><BookOpen size={16}/>目录与搜索</strong><button type="button" aria-label="关闭目录" onClick={onClose}><X size={16}/></button></header>
    <label><Search size={16}/><input value={query} onChange={event=>{setQuery(event.target.value);setLimit(30);}} placeholder="搜索全文原文" aria-label="搜索全文原文"/></label>
    <div className="reader-navigation-results">{results.slice(0,limit).map(item=><button type="button" key={item.id} style={{paddingLeft:query?12:12+((item.headingLevel||1)-1)*14}} onClick={()=>onSelect(item)}><span>{!query.trim() && item.kind === 'abstract' ? 'Abstract' : item.text.slice(0,query?180:100)}</span><small>p.{item.page}</small></button>)}
      {!results.length&&<p>{query?'没有找到匹配原文':'这篇论文没有识别到章节标题，可搜索原文定位。'}</p>}
      {results.length>limit&&<button type="button" onClick={()=>setLimit(value=>value+30)}>继续显示 · 共 {results.length} 项</button>}
    </div></section>;
}
