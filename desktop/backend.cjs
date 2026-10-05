const path = require('node:path');
const { pathToFileURL } = require('node:url');
let service;
(async () => {
  const module = await import(pathToFileURL(path.join(__dirname,'..','dist-server','index.js')).href);
  service = await module.startServer({host:'127.0.0.1',port:0,staticDir:path.join(__dirname,'..','dist')});
  process.parentPort.postMessage({type:'ready',port:service.port});
})().catch(error=>{process.parentPort.postMessage({type:'error',message:error.message});process.exitCode=1;});
process.parentPort.on('message',event=>{
  if(event.data==='shutdown' && service)service.server.close(()=>process.exit(0));
});
