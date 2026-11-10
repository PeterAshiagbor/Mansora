import type { ReactNode } from 'react';
import { Alert, Button } from './index';

export function QueryView({ query, label, children }: { query: { data: unknown; error?: unknown; reload: () => void }; label: string; children: ReactNode }) {
  if (query.error) {
    const message = typeof query.error === 'string' ? query.error : query.error instanceof Error ? query.error.message : 'The request did not complete.';
    return <Alert tone="bad" className="my-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Could not load {label}.</strong><p className="mt-1 text-sm">{message}</p><p className="mt-1 text-xs">No results are shown until this information can be loaded.</p></div><Button onClick={query.reload}>Retry</Button></div></Alert>;
  }
  if (query.data === undefined) return <div role="status" className="my-4 rounded-lg border border-slate-200 bg-white px-5 py-8 text-sm text-slate-600">Loading {label}…</div>;
  return <>{children}</>;
}
