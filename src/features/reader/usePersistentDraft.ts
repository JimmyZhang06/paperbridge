import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';

type Envelope<T> = { value: T; savedAt: number; paperId?: string };
const prefix = 'paperbridge:draft:';
function load<T>(key: string, fallback: T): Envelope<T> {
  try { const stored = JSON.parse(localStorage.getItem(prefix+key) || 'null'); if (stored && Object.hasOwn(stored, 'value') && Number.isFinite(stored.savedAt)) return stored; } catch { /* Keep the UI usable when browser storage is restricted. */ }
  return { value: fallback, savedAt: 0 };
}
// Keep separate queues alive when a paragraph, conversation or editor unmounts.
const pending = new Map<string, Envelope<unknown>>();
const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(message: string) => void>>();
function report(key: string, message: string) { listeners.get(key)?.forEach(listener => listener(message)); }
function schedule(key: string, delay = 500) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); void flush(key); }, delay));
}
async function flush(key: string) {
  if (running.has(key)) return;
  const queued = pending.get(key);
  if (!queued) return;
  running.add(key);
  let retry = false;
  try {
    await api(`/api/drafts/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queued), signal: AbortSignal.timeout(15000) });
    if (pending.get(key) === queued) { pending.delete(key); report(key, '草稿已保存'); }
  } catch (error) {
    if (error instanceof ApiError && [400, 404, 409].includes(error.status)) {
      if (pending.get(key) === queued) { pending.delete(key); report(key, `${error.message} 本地副本仍保留。`); }
    } else { retry = true; report(key, '草稿保留在此设备，稍后重试同步'); }
  } finally {
    running.delete(key);
    if (pending.has(key)) schedule(key, retry ? 10000 : 500);
  }
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { for (const key of pending.keys()) void flush(key); });

export function usePersistentDraft<T>(key: string, fallback: T, paperId?: string) {
  const [state, setState] = useState(() => ({ key, ...load(key, fallback) }));
  const [status, setStatus] = useState('');
  const fallbackRef = useRef(fallback); fallbackRef.current = fallback;
  const latest = useRef({ key, ...load(key, fallback) });
  if (latest.current.key !== key) latest.current = { key, ...load(key, fallback) };
  const value = state.key === key && state.savedAt ? state.value : load(key, fallback).value;
  useEffect(() => {
    const local = load(key, fallbackRef.current);
    latest.current = { key, ...local }; setState(latest.current);
    setStatus(local.savedAt ? '本地草稿已恢复' : '');
    const notify = (message: string) => setStatus(message);
    const subscribers = listeners.get(key) || new Set(); subscribers.add(notify); listeners.set(key, subscribers);
    const request = new AbortController();
    void api<Partial<Envelope<T>>>(`/api/drafts/${encodeURIComponent(key)}`, { signal: request.signal }).then(remote => {
      if (request.signal.aborted || latest.current.key !== key) return;
      const remoteAt = typeof remote.savedAt === 'number' && Number.isFinite(remote.savedAt) ? remote.savedAt : 0;
      if (Object.hasOwn(remote, 'value') && remoteAt > latest.current.savedAt) {
        latest.current = { key, value: remote.value as T, savedAt: remoteAt, paperId: remote.paperId }; setState(latest.current);
        if ((pending.get(key)?.savedAt || 0) < remoteAt) pending.delete(key);
        try { localStorage.setItem(prefix + key, JSON.stringify(remote)); } catch { /* Server copy remains intact. */ }
        setStatus('草稿已恢复');
      } else if (latest.current.savedAt > remoteAt) {
        pending.set(key, latest.current); schedule(key);
      }
    }).catch(() => {
      if (!request.signal.aborted && local.savedAt) { pending.set(key, latest.current); schedule(key); }
    });
    return () => { request.abort(); subscribers.delete(notify); if (!subscribers.size) listeners.delete(key); void flush(key); };
  }, [key]);
  const update = (next: T | ((previous: T) => T)) => {
    const previous = latest.current.savedAt ? latest.current.value : fallbackRef.current;
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
    const envelope = { value: resolved, savedAt: Math.max(Date.now(), latest.current.savedAt + 1), paperId };
    latest.current = { key, ...envelope }; setState(latest.current);
    try { localStorage.setItem(prefix + key, JSON.stringify(envelope)); setStatus('已保留本地草稿'); }
    catch { setStatus('浏览器无法保存草稿，正在同步到本机服务'); }
    pending.set(key, envelope); schedule(key);
  };
  return [value, update, status] as const;
}
