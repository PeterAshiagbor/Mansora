/**
 * Mansora Consulting design system: shared by platform administration and client workspaces.
 */
import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useMemo, type ButtonHTMLAttributes, type ComponentProps, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { DialogDismiss, useNavigationGuard, useUnsavedChanges } from './drafts';
import { useState } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

const focus = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' | 'lg'; dismiss?: boolean };
export function Button({ variant = 'secondary', size = 'md', className, type = 'button', onClick, dismiss, ...rest }: ButtonProps) {
  const guardedDismiss = useContext(DialogDismiss);
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 border-transparent',
    secondary: 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300',
    danger: 'bg-red-700 text-white hover:bg-red-800 border-transparent',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border-transparent',
  };
  const sizes = { sm: 'px-2.5 py-1 text-sm', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-3 text-base' };
  return <button type={type} onClick={(event) => {
    if (variant === 'primary' || type === 'submit') {
      const scope = event.currentTarget.closest('[role="dialog"]') ?? event.currentTarget.closest('form') ?? event.currentTarget.closest('section');
      const invalid = scope?.querySelector<HTMLInputElement>('input:invalid, select:invalid, textarea:invalid');
      if (invalid) { event.preventDefault(); invalid.focus(); invalid.reportValidity(); return; }
    }
    if (dismiss && guardedDismiss) { guardedDismiss(() => onClick?.(event)); return; }
    onClick?.(event);
  }} className={cx('m-button inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50', focus, variants[variant], sizes[size], className)} {...rest} />;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  const id = useId();
  const description = hint || error ? `${id}-description` : undefined;
  const child = isValidElement<Record<string, unknown>>(children) ? cloneElement(children, {
    ...(!children.props['aria-label'] && !children.props['aria-labelledby'] ? { 'aria-labelledby': `${id}-label` } : {}),
    'aria-describedby': [children.props['aria-describedby'], description].filter(Boolean).join(' ') || undefined,
    ...(error ? { 'aria-invalid': true } : {}),
  }) : children;
  return (
    <label className={cx('block', className)}>
      <span id={`${id}-label`} className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {child}
      {hint && !error && <span id={description} className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span id={description} className="mt-1 block text-xs font-medium text-red-700">{error}</span>}
    </label>
  );
}

const control = cx('m-control block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 disabled:bg-slate-100', 'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30');
export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(control, className)} {...rest} />;
}
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(control, className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, className)} rows={3} {...rest} />;
}

export function Modal({ title, open, onClose, children, footer, wide, trackChanges = true }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; trackChanges?: boolean }) {
  const [modified, setModified] = useState(false);
  const navigate = useNavigationGuard();
  useUnsavedChanges(open && trackChanges && modified, title);
  const dismiss = (action: () => void) => trackChanges && modified ? navigate(action) : action();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const previous = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const close = useRef(onClose);
  close.current = () => dismiss(onClose);
  // Capture the trigger before React mounts autoFocus inputs inside the dialog.
  if (open && !wasOpen.current) previous.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const focusable = () => [...(el?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]') ?? [])]
      .filter((item) => item.tabIndex >= 0 && !item.matches(':disabled, [hidden], input[type="hidden"]') && item.getClientRects().length > 0);
    const active = document.activeElement;
    if (!el?.contains(active)) (focusable().find((item) => item.matches('input, select, textarea')) ?? focusable()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ([...document.querySelectorAll('[role=dialog][aria-modal=true]')].at(-1) !== el) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close.current();
      }
      if (e.key === 'Tab' && el) {
        const items = focusable();
        if (!items.length) { e.preventDefault(); el.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (!el.contains(document.activeElement)) (e.preventDefault(), first.focus());
        else if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <DialogDismiss.Provider value={dismiss}><div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && dismiss(onClose)}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onChangeCapture={(event) => { if ((event.target as HTMLElement).closest('[role="dialog"]') === event.currentTarget) setModified(true); }} className={cx('m-dialog w-full rounded-lg bg-white shadow-xl outline-none', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="m-dialog-header flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id={id} className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={() => dismiss(onClose)} aria-label="Close" className={cx('rounded p-1 text-slate-500 hover:bg-slate-100', focus)}>✕</button>
        </div>
        <div className="m-dialog-body px-5 py-4" role="region" aria-label={`${title} content`} tabIndex={0}>{children}</div>
        {footer && <div className="m-dialog-footer flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-lg">{footer}</div>}
      </div>
    </div></DialogDismiss.Provider>
  );
}

const TableCaption = createContext<string | undefined>(undefined);

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('m-card min-w-0 rounded-lg border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <div className="m-card-header flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}
      <TableCaption.Provider value={typeof title === 'string' ? title : undefined}><div className={pad ? 'm-card-body p-4' : ''}>{children}</div></TableCaption.Provider>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const tones = { default: 'text-slate-900', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-700' };
  return (
    <div className="m-stat min-w-0 rounded-lg border border-slate-200 bg-white p-4">
      <div className="m-stat-label break-words text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('m-stat-value mt-1 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</div>
      {hint && <div className="m-stat-hint mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  sortValue?: (row: T) => string | number | null | undefined;
}
export function Table<T>({ columns, rows, onRowClick, empty = 'Nothing to show yet', rowKey, caption, pageSize = 50 }: { caption?: string; columns: Column<T>[]; rows: T[] | undefined; onRowClick?: (row: T) => void; empty?: ReactNode; rowKey?: (row: T, i: number) => string | number; pageSize?: number }) {
  const contextCaption = useContext(TableCaption);
  const tableCaption = caption ?? contextCaption ?? columns.map((c) => c.header).join(", ");
  const [page, setPage] = useState(0), [sort, setSort] = useState<{ header: string; descending: boolean } | null>(null);
  useEffect(() => setPage(0), [rows]);
  const accessor = sort ? columns.find((column) => column.header === sort.header)?.sortValue : undefined;
  const ordered = useMemo(() => {
    if (!rows || !accessor) return rows ?? [];
    return [...rows].sort((a, b) => {
      const x = accessor(a) ?? '', y = accessor(b) ?? '';
      const direction = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' });
      return sort?.descending ? -direction : direction;
    });
  }, [rows, accessor, sort?.descending]);
  const activePage = Math.min(page, Math.max(0, Math.ceil(ordered.length / pageSize) - 1));
  const visible = ordered.slice(activePage * pageSize, (activePage + 1) * pageSize);
  return (
    <div><div role="region" aria-label="Scrollable data table" tabIndex={0} className={cx("max-w-full overflow-x-auto", focus)}>
      <table className="m-table w-full text-sm">
        <caption className="sr-only">{tableCaption}</caption>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            {columns.map((c) => (
              <th key={c.header} scope="col" aria-sort={sort?.header === c.header ? sort.descending ? 'descending' : 'ascending' : undefined} className={cx('px-3 py-2', c.align === 'right' && 'text-right')}>{c.sortValue ? <button type="button" className="inline-flex items-center gap-1 rounded hover:text-brand-800" onClick={() => { setSort({ header: c.header, descending: sort?.header === c.header ? !sort.descending : false }); setPage(0); }}>{c.header}<span aria-hidden="true">{sort?.header === c.header ? sort.descending ? '↓' : '↑' : '↕'}</span></button> : c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(row); } } : undefined}
              className={cx('border-b border-slate-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-50 focus:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700')}
            >
              {columns.map((c) => (
                <td key={c.header} className={cx('px-3 py-2 align-top', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows && rows.length === 0 && <div className="px-3 py-8 text-center text-sm text-slate-500">{empty}</div>}
      {!rows && <div className="px-3 py-8 text-center text-sm text-slate-600">Loading…</div>}
    </div>{ordered.length > pageSize && <p className="hidden print:block">This printout shows the current table page. Use the report’s Print / PDF button for all loaded rows.</p>}{ordered.length > pageSize && <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600"><span role="status">Showing {activePage * pageSize + 1}–{Math.min((activePage + 1) * pageSize, ordered.length)} of {ordered.length} loaded rows</span><div className="flex gap-2"><Button size="sm" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous page</Button><Button size="sm" disabled={(activePage + 1) * pageSize >= ordered.length} onClick={() => setPage(activePage + 1)}>Next page</Button></div></div>}</div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const tones = { neutral: 'bg-slate-100 text-slate-700', good: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-900', bad: 'bg-red-100 text-red-800', info: 'bg-sky-100 text-sky-800' };
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone])}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="m-page-header mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" aria-label="View" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 print:hidden">
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const index = tabs.findIndex((tab) => tab.id === t.id);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            onChange(tabs[next].id);
            (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next])?.focus();
          }}
          className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', focus, value === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Alert({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode; className?: string }) {
  const tones = { info: 'border-sky-200 bg-sky-50 text-sky-900', warn: 'border-amber-300 bg-amber-50 text-amber-900', bad: 'border-red-300 bg-red-50 text-red-900', good: 'border-emerald-300 bg-emerald-50 text-emerald-900' };
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', tones[tone], className)}>{children}</div>;
}

export { MansoraBrand } from './brand';

export { WorkspaceShell, GuideBody, Icon, type Guide } from './workspace';
export { CLIENT_GUIDES, ADMIN_GUIDES } from './guides';
export { QueryView } from './query';
export { DraftProvider, useNavigationGuard, useUnsavedChanges } from './drafts';
