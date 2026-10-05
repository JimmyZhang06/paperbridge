const { app, BrowserWindow, utilityProcess, dialog, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');

let apiServer;
let mainWindow;

async function startDesktopServer() {
  const dataDir = process.env.PAPERBRIDGE_DESKTOP_DATA_DIR || path.join(app.getPath('userData'), 'data');
  await fs.mkdir(dataDir, { recursive: true });
  process.env.PAPERBRIDGE_DATA_DIR = dataDir;
  process.env.PAPERBRIDGE_EMBEDDED = '1';
  process.env.NODE_ENV = 'production';

  const secretPath=path.join(dataDir,'storage-key.bin');
  if(safeStorage.isEncryptionAvailable()){
    let secret;
    try{secret=safeStorage.decryptString(await fs.readFile(secretPath));}
    catch(error){if(error.code!=='ENOENT')throw new Error('Cannot unlock local credentials. Keep storage-key.bin and the user data directory intact.');secret=randomBytes(32).toString('hex');await fs.writeFile(secretPath,safeStorage.encryptString(secret));}
    process.env.PAPERBRIDGE_STORAGE_KEY=secret;
  }
  const parser=path.join(process.resourcesPath,'parser','suyue-pdf-engine.exe');
  try{await fs.access(parser);process.env.PAPERBRIDGE_PARSER_BINARY=parser;}catch{}
  const child=utilityProcess.fork(path.join(app.getAppPath(),'desktop','backend.cjs'),[],{env:{...process.env},serviceName:'Suyue local API'});
  apiServer={process:child};
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Local service startup timed out.')),45000);
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local service exited (${code}).`));});
    child.on('message',message=>{
      if(message.type==='ready'){clearTimeout(timer);apiServer.port=message.port;console.log(`[溯页] Local API ready: http://127.0.0.1:${message.port}`);resolve();}
      if(message.type==='error'){clearTimeout(timer);reject(new Error(message.message));}
    });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => { if(process.env.PAPERBRIDGE_DESKTOP_CHECK !== '1')mainWindow.show(); });
  const localOrigin = `http://127.0.0.1:${apiServer.port}`;
  const openExternal = url => {
    try {
      const target = new URL(url);
      if (['https:', 'http:'].includes(target.protocol) && target.origin !== localOrigin) {
        void shell.openExternal(target.href).catch(error => console.error('[溯页] Cannot open link:', error.message));
      }
    } catch {}
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try { if(new URL(url).origin === localOrigin)return; } catch {}
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(`http://127.0.0.1:${apiServer.port}/`);
  console.log('[溯页] Desktop window loaded.');
  if(process.env.PAPERBRIDGE_DESKTOP_CHECK === '1')app.quit();
}

if(!app.requestSingleInstanceLock()){app.quit();}
else app.whenReady().then(async () => {
  app.setName('溯页');
  app.setAppUserModelId('app.suyue.reader');
  await startDesktopServer();
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}).catch(error => {
  dialog.showErrorBox('溯页启动失败',error.message);
  console.error('[溯页桌面版] 启动失败', error);
  app.quit();
});

app.on('before-quit', () => {
  if(apiServer?.process){apiServer.process.postMessage('shutdown');setTimeout(()=>apiServer.process.kill(),1500).unref();}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}});
