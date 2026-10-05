import type { PDFDocumentProxy, DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import type { TextLayer } from 'pdfjs-dist/types/src/display/text_layer';

type PdfJs = { GlobalWorkerOptions:{workerSrc:string}; TextLayer:typeof TextLayer; getDocument:(options:DocumentInitParameters)=>{promise:Promise<PDFDocumentProxy>;destroy:()=>Promise<void>} };
let runtime:Promise<PdfJs> | null = null;
export function loadPdfJs() {
  runtime ||= (import(/* @vite-ignore */ `${import.meta.env.BASE_URL}pdf.min.mjs`) as Promise<PdfJs>).then(module=>{
    module.GlobalWorkerOptions.workerSrc=`${import.meta.env.BASE_URL}pdf.worker.min.mjs`;return module;
  }).catch(error=>{runtime=null;throw error;});
  return runtime;
}
type Entry = {promise:Promise<PDFDocumentProxy>;refs:number;lastUsed:number};
const documents = new Map<string,Entry>();
export function acquirePdf(file:string) {
  let entry=documents.get(file);
  if(!entry){
    const promise=Promise.all([loadPdfJs(),fetch(file).then(async response=>{
      if(!response.ok)throw new Error(`PDF 读取失败 (HTTP ${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('接口返回的内容不是有效 PDF。');return bytes;
    })]).then(([pdfjs,data])=>pdfjs.getDocument({data,cMapUrl:`${import.meta.env.BASE_URL}pdf-assets/cmaps/`,cMapPacked:true,standardFontDataUrl:`${import.meta.env.BASE_URL}pdf-assets/standard_fonts/`,wasmUrl:`${import.meta.env.BASE_URL}pdf-assets/wasm/`}).promise)
      .catch(error=>{documents.delete(file);throw error;});
    entry={promise,refs:0,lastUsed:Date.now()};documents.set(file,entry);
  }
  entry.refs++;entry.lastUsed=Date.now();
  const acquired=entry;
  return {promise:entry.promise,release:()=>{
    acquired.refs=Math.max(0,acquired.refs-1);acquired.lastUsed=Date.now();
    const idle=[...documents.entries()].filter(([,value])=>value.refs===0).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
    while(idle.length>2){const [key,value]=idle.shift()!;documents.delete(key);void value.promise.then(document=>document.loadingTask.destroy()).catch(()=>undefined);}
  }};
}
