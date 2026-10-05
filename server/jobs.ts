import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getDocument, listDocuments, putDocument } from './store.js';
import type { extractPdf } from './pdfExtraction.js';

export type ParseJob = { id: string; paperId?: string; status: 'queued' | 'running' | 'complete' | 'failed'; page: number; total: number; warning?: string; error?: string; createdAt: string };
type Work = { job: ParseJob; filename: string; engine: 'auto' | 'pdfjs' | 'pymupdf'; complete: (result: Awaited<ReturnType<typeof extractPdf>>) => Promise<string> };
const queue: Work[] = [];
let running = false;
const save = (job: ParseJob) => putDocument(`job:${job.id}`, 'job', job.paperId || null, job);
export async function recoverJobs() {
  for (const job of await listDocuments<ParseJob>('job')) if (job.status === 'running' || job.status === 'queued') {
    job.status = 'failed'; job.error = '上次解析被应用关闭中断，请重新导入或重新解析。'; await save(job);
  }
}
export async function enqueueParse(filename: string, engine: Work['engine'], complete: Work['complete'], paperId?: string) {
  const job: ParseJob = { id: randomUUID(), paperId, status: 'queued', page: 0, total: 0, createdAt: new Date().toISOString() };
  await save(job); queue.push({ job, filename, engine, complete }); void pump(); return job;
}
async function pump() {
  if (running) return;
  const work = queue.shift(); if (!work) return;
  running = true; const { job } = work;
  try {
    job.status = 'running'; await save(job);
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const entry=new URL(`./extractionWorker.${extension}`,import.meta.url);
    const workerData={filename:work.filename,engine:work.engine};
    const worker=extension==='ts'
      ? new Worker(`(async()=>{const {register}=await import('tsx/esm/api');register();await import(${JSON.stringify(entry.href)});})().catch(error=>{require('node:worker_threads').parentPort.postMessage({type:'error',error:error.message});});`,{eval:true,workerData})
      : new Worker(fileURLToPath(entry),{workerData});
    await new Promise<void>((resolve,reject) => {
      let finished = false, completing = false;
      let writes = Promise.resolve();
      const finish = async (error?: string) => {
        if (finished) return; finished = true; clearTimeout(timeout);
        try {
          await writes.catch(() => undefined);
          if (error) { job.status = 'failed'; job.error = error; }
          await save(job);
          worker.postMessage({type:'shutdown'});
          await new Promise(done=>setTimeout(done,100));
          await worker.terminate(); resolve();
        } catch(error) { await worker.terminate();reject(error); }
      };
      const timeout=setTimeout(()=>void finish('解析超过 5 分钟，请检查文献后重试。'),300_000);
      worker.on('message', (event: { type: string; page?: number; total?: number; message?: string; error?: string; result?: Awaited<ReturnType<typeof extractPdf>> }) => {
        if (finished || completing) return;
        if (event.type === 'progress' || event.type === 'warning') {
          if (event.page) job.page = event.page;
          if (event.total) job.total = event.total;
          if (event.message) job.warning = event.message;
          const snapshot = { ...job }; writes = writes.catch(()=>undefined).then(() => save(snapshot));
        }
        if (event.type === 'error') void finish(event.error || '解析失败。');
        if (event.type === 'result' && event.result) {
          completing=true;
          void work.complete(event.result).then(id => { job.paperId = id; job.status = 'complete'; return finish(); }).catch(error => finish(error.message));
        }
      });
      worker.on('error', error => void finish(error instanceof Error ? error.message : '解析进程发生错误。'));
      worker.on('exit', code => { if (!finished && !completing) void finish(`解析进程提前退出 (${code})，请重试。`); });
    });
  } catch(error) {
    job.status='failed';job.error=error instanceof Error ? error.message : '无法启动解析进程。';await save(job).catch(()=>undefined);
  } finally { running = false; void pump(); }
}

export const getJob = (id: string) => getDocument<ParseJob>(`job:${id}`);
