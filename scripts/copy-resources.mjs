import { mkdir,copyFile } from 'node:fs/promises';
await mkdir('dist-server/native',{recursive:true});
await copyFile('server/native/pdf_engine.py','dist-server/native/pdf_engine.py');
