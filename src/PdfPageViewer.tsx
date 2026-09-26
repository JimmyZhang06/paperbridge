import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { LoaderCircle } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function PdfPageViewer({ file, pageNumber }: { file: string; pageNumber: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(580);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width || 580));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return <div className="paper-pdf-container" ref={containerRef}>
    <Document file={file} loading={<div className="pdf-loading"><LoaderCircle className="spin" size={19} />正在加载原始页面…</div>} error={<div className="pdf-loading">PDF 页面读取失败。请尝试重新导入文件。</div>}>
      <Page pageNumber={pageNumber} width={Math.max(260, width - 28)} renderTextLayer={false} renderAnnotationLayer={false} />
    </Document>
  </div>;
}
