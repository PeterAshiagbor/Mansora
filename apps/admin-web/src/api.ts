import { useCallback, useEffect, useState } from 'react';

const BASE = (import.meta as any).env?.VITE_API_URL ?? (window as any).MANSORA_API_URL ?? 'http://localhost:4000';
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
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Cannot reach the Mansora server');
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
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>('GET', path).then((d) => live && (setData(d), setError(null)), (e) => live && (setError(e), setData(undefined)));
    return () => void (live = false);
  }, [path, tick, ...deps]);
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}
