import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from './types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = path.join(root, 'data');
export const uploadDir = path.join(dataDir, 'uploads');
const storePath = path.join(dataDir, 'store.json');

const initial: Store = {
  papers: [], groups: [], providers: [], activeProviderId: null, notes: [], terms: [], turns: [],
};

export async function ensureStore() {
  await mkdir(uploadDir, { recursive: true });
  try { await readFile(storePath, 'utf8'); }
  catch { await writeFile(storePath, JSON.stringify(initial, null, 2), 'utf8'); }
}

export async function readStore(): Promise<Store> {
  await ensureStore();
  try { return { ...initial, ...JSON.parse(await readFile(storePath, 'utf8')) } as Store; }
  catch { return structuredClone(initial); }
}

export async function writeStore(store: Store) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${storePath}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), 'utf8');
  await rename(temporary, storePath);
}

export function publicProvider<T extends { apiKey: string }>(provider: T) {
  const { apiKey, ...rest } = provider;
  return { ...rest, hasApiKey: Boolean(apiKey), apiKey: '' };
}
