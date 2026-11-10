import { useCallback, useEffect, useState } from 'react';

export const BASE: string = (window as any).MANSORA_API_URL ?? 'http://localhost:4000';
const KEY = 'mansora-admin-token';

// The token lives in sessionStorage: it is gone when the browser tab closes, and the server expires it after 12 hours.
export const getToken = () => sessionStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      ...(method === 'GET' ? { signal: AbortSignal.timeout(15_000) } : {}),
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Cannot reach the Mansora server. Check the connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event('mansora:signed-out'));
    }
    throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? 'Request failed');
  }
  return data as T;
}

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([path, tick, deps]);
  const [result, setResult] = useState<{ key: string; data?: T; error?: ApiError }>({ key: '' });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setResult({ key });
    api<T>('GET', path).then((data) => live && setResult({ key, data }), (error) => live && setResult({ key, error }));
    return () => void (live = false);
  }, [path, tick, ...deps]);
  const current = result.key === key ? result : undefined;
  return { data: current?.data, error: current?.error ?? null, loading: !!path && !current?.error && current?.data === undefined, reload: useCallback(() => setTick((t) => t + 1), []) };
}
