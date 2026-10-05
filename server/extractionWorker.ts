import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractPdf, type NativeExtraction } from './pdfExtraction.js';

async function nativeExtract(filename: string): Promise<NativeExtraction> {
  return new Promise((resolve, reject) => {
    const binary = process.env.PAPERBRIDGE_PARSER_BINARY;
    const child = spawn(binary || process.env.PAPERBRIDGE_PYTHON || 'python', binary ? [filename]
      : [fileURLToPath(new URL('./native/pdf_engine.py', import.meta.url)), filename], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    const shutdown=(event:{type:string})=>{if(event.type==='shutdown')child.kill();};
    parentPort?.on('message',shutdown);
    child.on('close',()=>parentPort?.off('message',shutdown));
    let buffer = '', result: NativeExtraction | undefined, error = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      buffer += data;
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { type: string; result?: NativeExtraction; error?: string; page?: number; total?: number };
          if (event.type === 'result') result = event.result;
          if (event.type === 'error') error = event.error || '本地解析失败。';
          if (event.type === 'progress') parentPort?.postMessage(event);
        } catch { reject(new Error('本地解析引擎返回了无效数据。')); child.kill(); }
      }
    });
    child.stderr.on('data', (data: string) => { error = (error + data).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 && result ? resolve(result) : reject(new Error(error || '本地解析引擎不可用。')));
    const timeout = setTimeout(() => { child.kill(); reject(new Error('本地解析超时。')); }, 180_000);
    child.on('close', () => clearTimeout(timeout));
  });
}
async function run() {
  const { filename, engine } = workerData as { filename: string; engine: 'auto' | 'pdfjs' | 'pymupdf' };
  let native: NativeExtraction | undefined;
  if (engine !== 'pdfjs') {
    try { native = await nativeExtract(filename); }
    catch (error) {
      if (engine === 'pymupdf') throw error;
      parentPort?.postMessage({ type: 'warning', message: '增强引擎不可用，已使用内置 PDF.js 解析。' });
    }
  }
  const result = await extractPdf(new Uint8Array(await readFile(filename)), native,
    (page, total) => parentPort?.postMessage({ type: 'progress', page, total }));
  parentPort?.postMessage({ type: 'result', result });
}
run().catch(error => parentPort?.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'PDF 解析失败。' }));
