import { copyFile,mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const python=process.env.PAPERBRIDGE_PYTHON || 'python';
const excluded=['numpy','pandas','matplotlib','scipy','PIL','cv2','torch','tensorflow','IPython','pytest','boto3','botocore','openpyxl','sympy','sphinx','tkinter'];
const result=spawnSync(python,['-m','PyInstaller','--noconfirm','--onedir','--name','suyue-pdf-engine','--distpath','build/parser','--workpath','build/parser-work','--specpath','build',...excluded.flatMap(name=>['--exclude-module',name]),'server/native/pdf_engine.py'],{stdio:'inherit',windowsHide:true});
if(result.status!==0)throw new Error('本地解析器打包失败，请确认 Python 环境已安装 pymupdf 和 pyinstaller。');

await mkdir('build/parser/suyue-pdf-engine/licenses',{recursive:true});
const licensePaths=spawnSync(python,['-c',"import importlib.metadata as m,json; print(json.dumps({n:[str(m.distribution(n).locate_file(f)) for f in m.distribution(n).files if str(f).split('/')[-1].lower() in ('copying','copying.txt','license','license.txt')] for n in ('pymupdf','pyinstaller')}))"],{encoding:'utf8',windowsHide:true});
if(licensePaths.status!==0)throw new Error('无法读取解析器许可证。');
for(const [name,paths] of Object.entries(JSON.parse(licensePaths.stdout))){for(const [index,filename] of paths.entries())await copyFile(filename,`build/parser/suyue-pdf-engine/licenses/${name}-${index}.txt`);}
await copyFile('THIRD_PARTY_NOTICES.md','build/parser/suyue-pdf-engine/THIRD_PARTY_NOTICES.md');
