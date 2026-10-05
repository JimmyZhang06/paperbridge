import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';

import type { TextLayer } from 'pdfjs-dist/types/src/display/text_layer';
import { acquirePdf,loadPdfJs } from './features/reader/pdfDocumentPool';
import type { SourceAnchor } from './features/reader/sourceAnchor';
import { cleanQuote } from './features/reader/sourceAnchor';
type PdfSource = { file:string; document:PDFDocumentProxy };
type ViewerStatus = 'loading'|'rendering'|'ready'|'error';
const emptyHighlights:SourceAnchor[]=[];
export default function PdfPageViewer({ file,pageNumber,crop,zoom=1,rotation=0,onSelectText,onNavigate,highlights=emptyHighlights,focus,onOutline,onReady }: { file:string;pageNumber:number;crop?:[number,number,number,number];zoom?:number;rotation?:number;onSelectText?:(text:string,rects:Array<[number,number,number,number]>)=>void;onNavigate?:(page:number)=>void;highlights?:SourceAnchor[];focus?:SourceAnchor;onOutline?:(items:Array<{title:string;page:number}>)=>void;onReady?:()=>void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef=useRef<HTMLDivElement>(null);
  const surfaceRef=useRef<HTMLDivElement>(null);
  const [surfaceSize,setSurfaceSize]=useState({width:580,height:800});
  const [links,setLinks]=useState<Array<{rect:[number,number,number,number];url?:string;page?:number}>>([]);
  const [marks,setMarks]=useState<Array<{rect:[number,number,number,number];focused:boolean}>>([]);
  const [markMapping,setMarkMapping]=useState<{page:number;convert:(rect:[number,number,number,number])=>[number,number,number,number]} | null>(null);
  const readyCallback=useRef(onReady);readyCallback.current=onReady;
  const selectionTransform=useRef<((x:number,y:number)=>number[]) | null>(null);
  const outlineCallback=useRef(onOutline);outlineCallback.current=onOutline;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(580);
  const [source, setSource] = useState<PdfSource | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const targetWidth = Math.max(260, width - 28);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect.width || 580);
      setWidth(previous => Math.abs(previous - next) > 2 ? next : previous);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const acquired=acquirePdf(file);
    setSource(null);setError('');setStatus('loading');
    void acquired.promise.then(async document=>{
      if(cancelled)return;setSource({file,document});
      if(outlineCallback.current){
        try {
        const outline=await document.getOutline();
        const items:Array<{title:string;page:number}>=[];
        const visit=async(nodes:NonNullable<typeof outline>)=>{for(const node of nodes){
          const dest=typeof node.dest==='string'?await document.getDestination(node.dest):node.dest;
          if(Array.isArray(dest)){const first=dest[0];const index=typeof first==='number'?first:await document.getPageIndex(first);items.push({title:node.title,page:index+1});}
          if(node.items?.length)await visit(node.items);
        }};
        if(outline)await visit(outline);if(!cancelled)outlineCallback.current?.(items);
        } catch {if(!cancelled)outlineCallback.current?.([]);}
      }
    }).catch(cause=>{if(!cancelled){setError(cause instanceof Error?cause.message:'PDF 读取失败');setStatus('error');}});
    return()=>{cancelled=true;acquired.release();};
  }, [file, retry]);

  useEffect(() => {
    if (!source || source.file !== file || !canvasRef.current) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    let textTask:TextLayer | undefined;
    setStatus('rendering');
    setError('');
    const draw = async () => {
      try {
        const page = await source.document.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale:1,rotation:crop?0:rotation });
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
        const visibleScale = crop
          ? Math.min(2, targetWidth / (baseViewport.width * crop[2]))
          : targetWidth / baseViewport.width * zoom;
        const renderScale = Math.min(visibleScale * pixelRatio, 3500 / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale:renderScale,rotation:crop?0:rotation });
        const displayViewport=page.getViewport({scale:visibleScale,rotation:crop?0:rotation});
        const renderCanvas = crop ? document.createElement('canvas') : canvasRef.current!;
        renderCanvas.width = Math.ceil(viewport.width);
        renderCanvas.height = Math.ceil(viewport.height);
        const context = renderCanvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('浏览器无法创建 PDF 画布。');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
        task = page.render({ canvas: renderCanvas, canvasContext: context, viewport });
        await task.promise;
        if (cancelled) return;
        const output = canvasRef.current!;
        if (crop) {
          const [x, y, w, h] = crop;
          output.width = Math.max(1, Math.round(renderCanvas.width * w));
          output.height = Math.max(1, Math.round(renderCanvas.height * h));
          const outputContext = output.getContext('2d', { alpha: false });
          if (!outputContext) throw new Error('浏览器无法生成图表预览。');
          outputContext.drawImage(renderCanvas,
            Math.round(renderCanvas.width * x), Math.round(renderCanvas.height * y), output.width, output.height,
            0, 0, output.width, output.height);
          output.style.width = `${Math.min(targetWidth, output.width / pixelRatio)}px`;
          renderCanvas.width = 0;
          renderCanvas.height = 0;
        } else {
          const size={width:displayViewport.width,height:displayViewport.height};setSurfaceSize(size);
          output.style.width=`${size.width}px`;output.style.height=`${size.height}px`;
          if(textRef.current){
            textRef.current.replaceChildren();
            textRef.current.style.setProperty('--scale-factor',String(visibleScale));
            textRef.current.style.setProperty('--total-scale-factor',String(visibleScale));
            const pdfjs=await loadPdfJs();
            if(cancelled)return;
            textTask=new pdfjs.TextLayer({textContentSource:await page.getTextContent(),container:textRef.current,viewport:displayViewport});
            await textTask.render();
          }
          if(cancelled)return;
          const viewportRect=(rect:number[])=>[...displayViewport.convertToViewportPoint(rect[0],rect[1]),...displayViewport.convertToViewportPoint(rect[2],rect[3])];
          const [x0,y0,x1,y1]=page.view;
          const pageWidth=x1-x0,pageHeight=y1-y0;
          selectionTransform.current=(x,y)=>{const point=displayViewport.convertToPdfPoint(x,y);return [(point[0]-x0)/pageWidth,(y1-point[1])/pageHeight];};
          const convert=(rect:[number,number,number,number]):[number,number,number,number]=>{
            const [x,y,w,h]=rect;const coords=viewportRect([x0+x*pageWidth,y1-y*pageHeight,x0+(x+w)*pageWidth,y1-(y+h)*pageHeight]);
            return [Math.min(coords[0],coords[2]),Math.min(coords[1],coords[3]),Math.abs(coords[2]-coords[0]),Math.abs(coords[3]-coords[1])];
          };
          setMarkMapping({page:pageNumber,convert});
          const annotations=await page.getAnnotations();
          const renderedLinks:Array<{rect:[number,number,number,number];url?:string;page?:number}>=[];
          for(const annotation of annotations){
            if(annotation.subtype!=='Link' || !annotation.rect)continue;
            const rect=viewportRect(annotation.rect);
            const box:[number,number,number,number]=[Math.min(rect[0],rect[2]),Math.min(rect[1],rect[3]),Math.abs(rect[2]-rect[0]),Math.abs(rect[3]-rect[1])];
            if(annotation.url && /^https?:/i.test(annotation.url))renderedLinks.push({rect:box,url:annotation.url});
            else if(annotation.dest){const dest=typeof annotation.dest==='string'?await source.document.getDestination(annotation.dest):annotation.dest;if(Array.isArray(dest)){const index=typeof dest[0]==='number'?dest[0]:await source.document.getPageIndex(dest[0]);renderedLinks.push({rect:box,page:index+1});}}
          }
          if(!cancelled)setLinks(renderedLinks);
        }
        setStatus('ready');

      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : '无法渲染 PDF 页面。'); setStatus('error'); }
      }
    };
    void draw();
    return () => { cancelled = true; task?.cancel(); textTask?.cancel(); };
  }, [source, file, pageNumber, crop?.[0], crop?.[1], crop?.[2], crop?.[3],targetWidth,zoom,rotation]);

  useEffect(()=>{
    if(!markMapping || markMapping.page !== pageNumber){setMarks([]);return;}
    const convert=markMapping.convert;
    setMarks([...highlights.filter(anchor=>anchor.pageIndex===pageNumber-1).flatMap(anchor=>(anchor.rects||[]).map(rect=>({rect:convert(rect),focused:false}))),...(focus?.pageIndex===pageNumber-1?(focus.rects||[]).map(rect=>({rect:convert(rect),focused:true})):[])]);
  },[markMapping,pageNumber,highlights,focus]);
  useEffect(()=>{
    if(status!=='ready')return;
    const frame=requestAnimationFrame(()=>readyCallback.current?.());
    return()=>cancelAnimationFrame(frame);
  },[status]);

  function selectOriginal(){
    const selection=window.getSelection();const surface=surfaceRef.current;
    if(!selection || !surface || !selection.rangeCount || !selectionTransform.current)return;
    const range=selection.getRangeAt(0);
    if(!surface.contains(range.commonAncestorContainer))return;
    const text=cleanQuote(selection.toString());if(text.length<2 || text.length>12000)return;
    const origin=surface.getBoundingClientRect();
    const rects:Array<[number,number,number,number]>=[];
    for(const rect of range.getClientRects()){
      if(rect.width<1 || rect.height<1)continue;
      const points=[[rect.left-origin.left,rect.top-origin.top],[rect.right-origin.left,rect.top-origin.top],[rect.left-origin.left,rect.bottom-origin.top],[rect.right-origin.left,rect.bottom-origin.top]].map(([x,y])=>selectionTransform.current!(x,y));
      const x=Math.max(0,Math.min(...points.map(point=>point[0]))),y=Math.max(0,Math.min(...points.map(point=>point[1])));
      const right=Math.min(1,Math.max(...points.map(point=>point[0]))),bottom=Math.min(1,Math.max(...points.map(point=>point[1])));
      if(right>x && bottom>y)rects.push([x,y,right-x,bottom-y]);
    }
    onSelectText?.(text,rects);
  }
  return <div className={crop?'pdf-figure-crop':'paper-pdf-container'} ref={containerRef} aria-busy={status==='loading'||status==='rendering'}>
    <div className={crop?'':'pdf-page-surface'} ref={surfaceRef} onMouseUp={crop?undefined:selectOriginal} style={crop?undefined:{width:surfaceSize.width,height:surfaceSize.height,visibility:status==='ready'?'visible':'hidden'}}>
      <canvas ref={canvasRef} className={crop?'pdf-figure-image':'pdf-page-canvas'} aria-label={`PDF 第 ${pageNumber} 页`} style={{visibility:status==='ready'?'visible':'hidden'}}/>
      {!crop&&<><div className="textLayer" ref={textRef}/><div className="pdf-highlight-layer">{marks.map((mark,index)=><mark key={index} className={mark.focused?'source-focus':''} style={{left:mark.rect[0],top:mark.rect[1],width:mark.rect[2],height:mark.rect[3]}}/>)}</div><div className="pdf-links-layer">{links.map((link,index)=><a key={index} href={link.url||'#'} target={link.url?'_blank':undefined} rel="noreferrer" aria-label={link.url||`跳转到第 ${link.page} 页`} onClick={event=>{if(link.page){event.preventDefault();onNavigate?.(link.page);}}} style={{left:link.rect[0],top:link.rect[1],width:link.rect[2],height:link.rect[3]}}/>)}</div></>}
    </div>
    {status==='error'?<div className="pdf-loading pdf-load-error"><strong>PDF 读取失败</strong><span>{error}</span><button type="button" onClick={()=>setRetry(value=>value+1)}>重新加载</button></div>:status!=='ready'?<div className="pdf-loading"><LoaderCircle className="spin" size={18}/>{status==='loading'?'正在读取原始 PDF…':'正在渲染 PDF 页面…'}</div>:null}
  </div>;
}
