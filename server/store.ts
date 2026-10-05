import { mkdir, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Store, Paper } from './types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.PAPERBRIDGE_DATA_DIR || path.join(root, 'data');
export const uploadDir = path.join(dataDir, 'uploads');
const legacyPath = path.join(dataDir, 'store.json');
const collections = ['papers', 'groups', 'providers', 'notes', 'terms', 'turns', 'conversations'] as const;
type RecordValue = Record<string, unknown> & { id: string };
const initial: Store = { papers: [], groups: [], providers: [], activeProviderId: null, notes: [], terms: [], turns: [], conversations: [] };
const snapshots = new WeakMap<Store, Store>();
function encodeRecord(collection:string,record:unknown) {
  if (collection !== 'providers' || !process.env.PAPERBRIDGE_STORAGE_KEY) return JSON.stringify(record);
  const provider = record as { apiKey:string };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm',Buffer.from(process.env.PAPERBRIDGE_STORAGE_KEY,'hex'),iv);
  const encrypted = Buffer.concat([cipher.update(provider.apiKey,'utf8'),cipher.final()]);
  return JSON.stringify({...provider,apiKey:'',encryptedKey:[iv,cipher.getAuthTag(),encrypted].map(part=>part.toString('base64')).join('.')});
}
function decodeRecord(collection:string,text:string) {
  const record=JSON.parse(text);
  if (collection !== 'providers' || !record.encryptedKey) return record;
  if (!process.env.PAPERBRIDGE_STORAGE_KEY) throw new Error('此文献库的供应商凭据由桌面端加密，请从原 Windows 用户的桌面端打开。');
  const [iv,tag,data]=record.encryptedKey.split('.').map((part:string)=>Buffer.from(part,'base64'));
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.PAPERBRIDGE_STORAGE_KEY,'hex'),iv);
  decipher.setAuthTag(tag);record.apiKey=Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');delete record.encryptedKey;
  return record;
}
let database: DatabaseSync;
let opening: Promise<void> | undefined;

export class WriteConflict extends Error {
  status = 409;
  constructor() { super('这条记录已被其他操作更新，请刷新后再保存。你的本地草稿仍会保留。'); }
}
function transaction<T>(work: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try { const result = work(); database.exec('COMMIT'); return result; }
  catch (error) { database.exec('ROLLBACK'); throw error; }
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyed = (value: unknown): value is RecordValue[] => Array.isArray(value) && value.every(item => item && typeof item.id === 'string');

/** Apply only fields changed by this request. Concurrent additions survive; deleted records stay deleted. */
function merge(base: unknown, changed: unknown, current: unknown): unknown {
  if (equal(base, changed)) return current;
  if (equal(base, current) || equal(changed, current)) return changed;
  if (keyed(base) && keyed(changed) && keyed(current)) {
    const baseMap = new Map(base.map(item => [item.id, item]));
    const nextMap = new Map(changed.map(item => [item.id, item]));
    const currentMap = new Map(current.map(item => [item.id, item]));
    return [...new Set([...changed.map(item => item.id), ...current.map(item => item.id)])].flatMap(id => {
      const before = baseMap.get(id), after = nextMap.get(id), now = currentMap.get(id);
      if (before && (!after || !now)) return [];
      if (!before) return [now && after ? merge({}, after, now) : after || now];
      return [merge(before, after, now)];
    });
  }
  if (base && changed && current && !Array.isArray(base) && !Array.isArray(changed) && !Array.isArray(current)
    && typeof base === 'object' && typeof changed === 'object' && typeof current === 'object') {
    const result = { ...current } as Record<string, unknown>;
    const before = base as Record<string, unknown>, after = changed as Record<string, unknown>;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (equal(before[key], after[key])) continue;
      if (key === 'updatedAt') result[key] = [after[key], result[key]].filter(Boolean).sort().at(-1);
      else if (!(key in after)) delete result[key];
      else result[key] = merge(before[key], after[key], result[key]);
    }
    return result;
  }
  throw new WriteConflict();
}

export function indexPaper(paper: Paper) {
  database.prepare('DELETE FROM paper_fts WHERE paper_id = ?').run(paper.id);
  const insert = database.prepare('INSERT INTO paper_fts(paper_id, page, block_id, section, text) VALUES(?,?,?,?,?)');
  let section = '';
  for (const page of paper.pages) {
    const blocks = page.blocks || (page.paragraphs || [page.text]).map((text, index) => ({ id: `${page.page}-${index}`, text, kind: 'paragraph', hidden: false }));
    for (const block of blocks) {
      if (block.hidden) continue;
      if (block.kind === 'heading') section = block.text;
      if (['title', 'authors', 'affiliation', 'metadata', 'reference'].includes(block.kind)) continue;
      insert.run(paper.id, page.page, block.id, section, block.text);
    }
  }
}
async function openDatabase() {
  await mkdir(uploadDir, { recursive: true });
  database = new DatabaseSync(path.join(dataDir, 'library.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  for (const collection of collections) database.exec(`CREATE TABLE IF NOT EXISTS ${collection}(id TEXT PRIMARY KEY, data TEXT NOT NULL, sort_order INTEGER NOT NULL)`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(key TEXT PRIMARY KEY, kind TEXT NOT NULL, paper_id TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS documents_kind_paper ON documents(kind,paper_id);
    CREATE TABLE IF NOT EXISTS extraction_versions(paper_id TEXT, revision TEXT, data TEXT NOT NULL, PRIMARY KEY(paper_id,revision));
    CREATE VIRTUAL TABLE IF NOT EXISTS paper_fts USING fts5(paper_id UNINDEXED, page UNINDEXED, block_id UNINDEXED, section, text, tokenize='unicode61');
  `);
  if (!database.prepare("SELECT key FROM settings WHERE key='schema-version'").get()) {
    let legacy = structuredClone(initial);
    try {
      legacy = { ...legacy, ...JSON.parse(await readFile(legacyPath, 'utf8')) } as Store;
      for (const key of collections) if (!Array.isArray(legacy[key])) throw new Error(`旧数据中的 ${key} 格式无效。`);
      await copyFile(legacyPath, `${legacyPath}.before-sqlite-${Date.now()}.bak`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('旧数据读取失败，已停止迁移以保护文献库。', { cause: error });
    }
    for (const paper of legacy.papers) {
      paper.fileHash ||= await readFile(path.join(uploadDir, paper.fileKey)).then(bytes => createHash('sha256').update(bytes).digest('hex')).catch(() => `legacy-${paper.id}`);
      paper.extractionRevision ||= `legacy-${paper.extraction?.engine || 'text'}`;
    }
    transaction(() => {
      for (const key of collections) {
        const insert = database.prepare(`INSERT INTO ${key}(id,data,sort_order) VALUES(?,?,?)`);
        legacy[key].forEach((item, order) => insert.run(item.id, encodeRecord(key,item), order));
        const count = database.prepare(`SELECT COUNT(*) AS count FROM ${key}`).get() as { count: number };
        if (count.count !== legacy[key].length) throw new Error(`迁移数量核对失败：${key}`);
      }
      for (const paper of legacy.papers) { archiveExtraction(paper); indexPaper(paper); }
      database.prepare('INSERT INTO settings(key,data) VALUES(?,?)').run('activeProviderId', JSON.stringify(legacy.activeProviderId));
      database.prepare('INSERT INTO settings(key,data) VALUES(?,?)').run('schema-version', '1');
    });
  }
  if(process.env.PAPERBRIDGE_STORAGE_KEY)transaction(()=>{
    for(const row of database.prepare('SELECT id,data FROM providers').all() as Array<{id:string;data:string}>){
      if(!JSON.parse(row.data).encryptedKey)database.prepare('UPDATE providers SET data=? WHERE id=?').run(encodeRecord('providers',JSON.parse(row.data)),row.id);
    }
  });
}
export async function ensureStore() { opening ||= openDatabase(); await opening; }
export async function readStore(): Promise<Store> {
  await ensureStore();
  const store = structuredClone(initial);
  for (const key of collections) {
    const rows = database.prepare(`SELECT data FROM ${key} ORDER BY sort_order`).all() as Array<{ data: string }>;
    (store[key] as unknown[]) = rows.map(row => decodeRecord(key,row.data));
  }
  store.activeProviderId = JSON.parse((database.prepare("SELECT data FROM settings WHERE key='activeProviderId'").get() as { data: string } | undefined)?.data || 'null');
  snapshots.set(store, structuredClone(store));
  return store;
}
export async function writeStore(store: Store) {
  await ensureStore();
  const base = snapshots.get(store);
  if (!base) throw new Error('保存必须基于已读取的文献库快照。');
  transaction(() => {
    for (const key of collections) {
      const before = new Map<string, unknown>(base[key].map(item => [item.id, item]));
      const after = new Map<string, unknown>(store[key].map(item => [item.id, item]));
      const get = database.prepare(`SELECT data FROM ${key} WHERE id=?`);
      const upsert = database.prepare(`INSERT INTO ${key}(id,data,sort_order) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
      for (const [id] of before) if (!after.has(id)) {
        database.prepare(`DELETE FROM ${key} WHERE id=?`).run(id);
        if (key === 'papers') {
          database.prepare('DELETE FROM paper_fts WHERE paper_id=?').run(id);
          database.prepare('DELETE FROM documents WHERE paper_id=?').run(id);
          database.prepare('DELETE FROM extraction_versions WHERE paper_id=?').run(id);
        }
      }
      for (const [order, item] of store[key].entries()) {
        const previous = before.get(item.id);
        if (equal(previous, item)) continue;
        const row = get.get(item.id) as { data: string } | undefined;
        if (previous && !row) continue;
        const next = row ? merge(previous || {}, item, decodeRecord(key,row.data)) : item;
        if (['notes','terms','turns'].includes(key) && !database.prepare('SELECT id FROM papers WHERE id=?').get((item as { paperId: string }).paperId)) continue;
        upsert.run(item.id, encodeRecord(key,next), previous ? order : -Date.now() + order);
        if (key === 'papers' && (!previous || !equal((previous as Paper).pages,(next as Paper).pages))) { archiveExtraction(next as Paper); indexPaper(next as Paper); }
      }
    }
    for (const key of ['notes','terms','turns']) database.exec(`DELETE FROM ${key} WHERE json_extract(data,'$.paperId') NOT IN (SELECT id FROM papers)`);
    if (store.activeProviderId !== base.activeProviderId) database.prepare("UPDATE settings SET data=? WHERE key='activeProviderId'").run(JSON.stringify(store.activeProviderId));
  });
  snapshots.set(store, structuredClone(store));
}
export function archiveExtraction(paper: Paper) {
  database.prepare('INSERT OR IGNORE INTO extraction_versions(paper_id,revision,data) VALUES(?,?,?)')
    .run(paper.id, paper.extractionRevision || 'legacy', JSON.stringify({ pages: paper.pages, extraction: paper.extraction, title: paper.title, author: paper.author }));
}
export async function getDocument<T>(key: string): Promise<T | null> {
  await ensureStore();
  const row = database.prepare('SELECT data FROM documents WHERE key=?').get(key) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as T : null;
}
export async function putDocument(key: string, kind: string, paperId: string | null, value: unknown) {
  await ensureStore();
  database.prepare('INSERT INTO documents(key,kind,paper_id,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
    .run(key, kind, paperId, JSON.stringify(value), new Date().toISOString());
}
export async function listDocuments<T>(kind: string): Promise<T[]> {
  await ensureStore();
  return (database.prepare('SELECT data FROM documents WHERE kind=? ORDER BY updated_at DESC').all(kind) as Array<{ data: string }>).map(row => JSON.parse(row.data));
}
export async function searchBlocks(paperId: string, terms: string[]) {
  await ensureStore();
  if (!terms.length) return [];
  const query = terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  return database.prepare('SELECT block_id AS id, page, section, text, bm25(paper_fts) AS rank FROM paper_fts WHERE paper_fts MATCH ? AND paper_id=? ORDER BY rank LIMIT 80')
    .all(query, paperId) as Array<{ id: string; page: number; section: string; text: string; rank: number }>;
}

export function publicProvider<T extends { apiKey: string }>(provider: T) {
  const { apiKey, ...rest } = provider;
  return { ...rest, hasApiKey: Boolean(apiKey), apiKey: '' };
}

/** Compare and save within one SQLite transaction; an older browser cannot overwrite a newer draft. */
export async function putLatestDocument(key:string,kind:string,paperId:string|null,value:{savedAt:number}) {
  await ensureStore();
  return transaction(()=>{
    const row=database.prepare('SELECT data FROM documents WHERE key=?').get(key) as {data:string}|undefined;
    if(row && Number(JSON.parse(row.data).savedAt || 0)>value.savedAt)return false;
    database.prepare('INSERT INTO documents(key,kind,paper_id,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(key,kind,paperId,JSON.stringify(value),new Date().toISOString());
    return true;
  });
}
