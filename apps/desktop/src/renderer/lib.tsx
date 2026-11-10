import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DomainError, formatGHS, grossMarginBps, parseGHS, type Permission } from '@mansora/domain';
import { Button, cx, Field, Input, Modal } from '@mansora/ui';

export interface FileOut {
  fileName: string;
  mime: string;
  contentBase64: string;
}
interface Bridge {
  invoke(command: string, input?: unknown): Promise<{ ok: true; data: any } | { ok: false; error: { code: string; message: string; details?: unknown } }>;
  print?(html: string): Promise<{ ok: boolean; message?: string }>;
  savePdf?(html: string, fileName: string): Promise<{ ok: boolean; message?: string }>;
  saveFile?(file: FileOut): Promise<{ ok: boolean; message?: string }>;
  openExternal?(url: string): Promise<{ ok: boolean; message?: string }>;
  restore?(passphrase: string): Promise<{ ok: boolean; message?: string; summary?: { businessName: string; sales: number; products: number } }>;
}
declare global {
  interface Window {
    mansora?: Bridge;
  }
}

/** In the packaged app `window.mansora` is the Electron preload bridge. In browser development it is an HTTP shim to the dev host. */
const bridge: Bridge = window.mansora ?? {
  invoke: async (command, input) => (await fetch('/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command, input }) })).json(),
};

export async function openExternal(url: string): Promise<void> {
  if (bridge.openExternal) {
    const r = await bridge.openExternal(url);
    if (!r.ok) throw new DomainError('CANNOT_OPEN', r.message ?? 'Could not open the link');
  } else window.open(url, '_blank', 'noopener');
}
export const canRestore = () => !!bridge.restore;
export const restoreBackup = (passphrase: string) => bridge.restore!(passphrase);

const READ_ONLY = /\.(list|get|status|queue|current|overview|movements|lookup|receipt|dashboard|sales|profit|stock|state|preview|history|template|table|summary|document)$/;

export async function call<T = any>(command: string, input: unknown = {}): Promise<T> {
  const res = await bridge.invoke(command, input);
  if (res.ok) {
    if (!READ_ONLY.test(command)) window.dispatchEvent(new Event('mansora:changed'));
    return res.data as T;
  }
  if (res.error.code === 'SESSION_LOCKED' || res.error.code === 'NOT_SIGNED_IN') window.dispatchEvent(new CustomEvent('mansora:signed-out', { detail: res.error.code }));
  throw new DomainError(res.error.code, res.error.message, res.error.details);
}

function printInFrame(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
export async function printHtml(html: string): Promise<void> {
  if (bridge.print) {
    const r = await bridge.print(html);
    if (!r.ok) throw new DomainError('PRINT_FAILED', r.message ?? 'Printing failed');
  } else printInFrame(html);
}
export async function savePdf(html: string, fileName: string): Promise<void> {
  if (bridge.savePdf) {
    const r = await bridge.savePdf(html, fileName);
    if (!r.ok && r.message) throw new DomainError('PDF_FAILED', r.message);
  } else printInFrame(html);
}
export async function saveFile(file: FileOut): Promise<void> {
  if (bridge.saveFile) {
    const r = await bridge.saveFile(file);
    if (!r.ok && r.message) throw new DomainError('SAVE_FAILED', r.message);
    return;
  }
  const bytes = Uint8Array.from(atob(file.contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: file.fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function useQuery<T = any>(command: string, input: unknown = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    call<T>(command, input).then((d) => live && (setData(d), setError(null)), (e) => live && setError(e.message));
    return () => void (live = false);
  }, [command, key, tick, ...deps]);
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}

// ---------- session ----------
export interface AppState {
  business: { activated: boolean; name: string; phone: string; address: string; receiptFooter: string; lockMinutes: number; allowNegativeStock: boolean; maxDiscountBps: number };
  user: { id: string; name: string; username: string; role: string; permissions: string[] } | null;
  appVersion: string;
  permissions: Record<string, string>;
  roleDefaults: Record<string, string[]>;
}
export const AppCtx = createContext<{ state: AppState; refresh: () => Promise<void>; can: (p: Permission) => boolean; go: (page: string, param?: string) => void }>(null as any);
export const useApp = () => useContext(AppCtx);

// ---------- toasts ----------
const ToastCtx = createContext<(message: string, tone?: 'good' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; tone: 'good' | 'bad' }[]>([]);
  const push = useCallback((message: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'bad' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2 no-print">
        {items.map((i) => (
          <div key={i.id} role={i.tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-md px-4 py-3 text-sm font-medium text-white shadow-lg', i.tone === 'bad' ? 'bg-red-700' : 'bg-slate-900')}>{i.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an action, showing its error (or a success message) as a toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const out = await fn();
      if (success) toast(success);
      return out;
    } catch (e: any) {
      toast(e.message ?? 'Something went wrong', 'bad');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, busy };
}

// ---------- formatting ----------
export const money = (p: number | null | undefined) => (p == null ? '—' : formatGHS(p));
export const plain = (p: number | null | undefined) => (p == null ? '' : formatGHS(p, false));
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
export const monthStart = () => `${today().slice(0, 7)}-01`;
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
export const percent = (bps: number | null | undefined) => (bps == null ? '—' : `${(bps / 100).toFixed(1)}%`);
export const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', momo: 'Mobile money', credit: 'Credit' };
export const uuid = () => crypto.randomUUID();

/** Cedi amount input. Holds text while typing; reports integer pesewas (or null when not a valid amount). */
export function MoneyInput({ value, onChange, ...rest }: { value: number | null; onChange: (pesewas: number | null) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value == null ? '' : plain(value).replace(/,/g, ''));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? '' : plain(value).replace(/,/g, ''));
    }
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      placeholder="0.00"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        let parsed: number | null = null;
        try {
          parsed = e.target.value.trim() === '' ? null : parseGHS(e.target.value);
          if (parsed !== null && parsed < 0) parsed = null;
        } catch {
          parsed = null;
        }
        last.current = parsed;
        onChange(parsed);
      }}
      {...rest}
    />
  );
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <Input type="date" aria-label="From date" value={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} className="w-40" />
      <span className="text-sm text-slate-500">to</span>
      <Input type="date" aria-label="To date" value={to} min={from} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} className="w-40" />
      <Button size="sm" onClick={() => onChange({ from: today(), to: today() })}>Today</Button>
      <Button size="sm" onClick={() => onChange({ from: monthStart(), to: today() })}>This month</Button>
    </div>
  );
}

export interface Approver {
  username: string;
  password: string;
}
/** Asks a manager or owner to enter their own credentials to approve a restricted action. */
export function ApprovalModal({ open, reason, onCancel, onApprove }: { open: boolean; reason: string; onCancel: () => void; onApprove: (a: Approver) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (open) (setUsername(''), setPassword(''));
  }, [open]);
  return (
    <Modal title="Manager approval needed" open={open} onClose={onCancel}
      footer={<><Button onClick={onCancel}>Cancel</Button><Button variant="primary" disabled={!username || !password} onClick={() => onApprove({ username, password })}>Approve</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (username && password) onApprove({ username, password }); }} className="space-y-3">
        <p className="text-sm text-slate-700">{reason} A manager or the owner must sign to approve.</p>
        <Field label="Manager username"><Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
        <Field label="Manager password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ExportButtons({ title, columns, rows }: { title: string; columns: string[]; rows: () => (string | number | null)[][] }) {
  const { run, busy } = useAction();
  const go = (format: 'csv' | 'xlsx') => run(async () => saveFile(await call('export.table', { title, format, columns, rows: rows() })));
  return (
    <>
      <Button size="sm" disabled={busy} onClick={() => go('xlsx')}>Excel</Button>
      <Button size="sm" disabled={busy} onClick={() => go('csv')}>CSV</Button>
      <Button size="sm" onClick={() => window.print()}>Print / PDF</Button>
    </>
  );
}

/** Catalogue gross margin; callers must enforce product.cost before displaying it. */
export function marginLabel(price: number, cost: number): string {
  const bps = grossMarginBps(price, cost);
  return bps == null ? '—' : `${(bps / 100).toFixed(2)}%`;
}
