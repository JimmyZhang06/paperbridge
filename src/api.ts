const localDesktopOrDev = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = localDesktopOrDev ? '' : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T,>(url: string, options?: RequestInit): Promise<T> {
  const retryable = !options?.method || options.method.toUpperCase() === 'GET';
  for (let attempt=0;;attempt++) {
    try {
      const response = await fetch(apiUrl(url), options);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if(retryable && attempt<3 && [502,503,504].includes(response.status)) {
          await retryDelay(attempt,options?.signal);continue;
        }
        throw new ApiError(data?.error || `请求失败 (${response.status})`, response.status);
      }
      if (data === null) throw new ApiError('接口未返回有效 JSON，请检查后端地址与代理配置。', response.status);
      return data as T;
    } catch(error) {
      if(!retryable || attempt>=3 || options?.signal?.aborted || !(error instanceof TypeError))throw error;
      await retryDelay(attempt,options?.signal);
    }
  }
}

function retryDelay(attempt:number,signal?:AbortSignal | null) {
  return new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason || new DOMException('Aborted','AbortError'));return;}
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason || new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},400*2**attempt);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
