import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PAPERBRIDGE_API_PORT || process.env.PORT || 8787);
const pdfWorkerPath = fileURLToPath(import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs'));
const pdfCorePath = fileURLToPath(import.meta.resolve('pdfjs-dist/build/pdf.min.mjs'));
const pdfRoot = path.resolve(path.dirname(pdfCorePath),'..');
const pdfAssets = new Map<string,string>();
for (const folder of ['cmaps','standard_fonts','wasm']) {
  for (const filename of readdirSync(path.join(pdfRoot,folder))) {
    if (!/\.(bcmap|otf|ttf|pfb|wasm)$/i.test(filename)) continue;
    pdfAssets.set(`/pdf-assets/${folder}/${filename}`,path.join(pdfRoot,folder,filename));
  }
}
const pdfWorkerPlugin: Plugin = {
  name: 'paperbridge-pdf-worker',
  configureServer(server) {
    server.middlewares.use((request,response,next)=>{
      const filename=pdfAssets.get((request.url || '').split('?')[0]);
      if (!filename) {next();return;}
      response.setHeader('Content-Type',filename.endsWith('.wasm')?'application/wasm':'application/octet-stream');
      createReadStream(filename).pipe(response);
    });
    server.middlewares.use('/pdf.min.mjs', (_request, response) => {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      createReadStream(pdfCorePath).pipe(response);
    });
    server.middlewares.use('/pdf.worker.min.mjs', (_request, response) => {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      createReadStream(pdfWorkerPath).pipe(response);
    });
  },
  generateBundle() {
    for(const [url,filename] of pdfAssets)this.emitFile({type:'asset',fileName:url.slice(1),source:readFileSync(filename)});
    this.emitFile({ type: 'asset', fileName: 'pdf.min.mjs', source: readFileSync(pdfCorePath) });
    this.emitFile({ type: 'asset', fileName: 'pdf.worker.min.mjs', source: readFileSync(pdfWorkerPath) });
  },
};

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/paperbridge/' : '/',
  plugins: [react(), pdfWorkerPlugin],
  server: {
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
});

