import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatGHS, parseGHS } from '@mansora/domain';
import { ActionMenu, Alert, Badge, Button, Card, cx, Field, Input, Modal, PageHeader, QueryView, Select, Stat, Table, Tabs, Textarea, useUnsavedChanges } from '@mansora/ui';
import { api, BASE, getToken, useApi } from './api';
import { Communications } from './communications';

// ------------------------------------------------------------------ shared
const ghs = (n: number | null | undefined) => (n == null ? '—' : `GH₵${formatGHS(n, false)}`);
const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '—');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const pct = (bps: number | null | undefined) => (bps == null ? '—' : `${(bps / 100).toFixed(1)}%`);
const label = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');
const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  paid: 'good', active: 'good', successful: 'good', completed: 'good', sent: 'info', partially_paid: 'warn', overdue: 'bad', draft: 'neutral', disputed: 'warn', cancelled: 'neutral', written_off: 'neutral',
  awaiting_approval: 'info', trial: 'info', payment_due: 'warn', payment_failed: 'bad', paused: 'neutral', expired: 'neutral', failed: 'bad', pending: 'warn', awaiting_customer: 'info', initiated: 'info', queued: 'warn', skipped: 'neutral',
  refunded: 'neutral', partially_refunded: 'warn', pending_provider: 'warn', open: 'warn', resolved: 'good',
};
const Status = ({ s }: { s?: string | null }) => <Badge tone={TONE[s ?? ''] ?? 'neutral'}>{label(s)}</Badge>;

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const running = useRef(false);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true); setError(null); setDone(null);
    try { const r = await fn(); if (success) setDone(success); return r; } catch (e: any) { setError(e.message); return undefined; } finally { running.current = false; setBusy(false); }
  };
  return { run, busy, error, done };
}
const Msg = ({ a }: { a: { error: string | null; done: string | null } }) => <>{a.error && <Alert tone="bad" className="mb-3">{a.error}</Alert>}{a.done && <Alert tone="good" className="mb-3">{a.done}</Alert>}</>;

/** Cedi amount typed as text, reported as whole pesewas (or null while it is not a valid amount). */
function MoneyField({ label: l, value, onChange, hint }: { label: string; value: string; onChange: (text: string) => void; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  let bad = false;
  try { if (value.trim()) bad = parseGHS(value) < 0; } catch { bad = true; }
  useEffect(() => { input.current?.setCustomValidity(bad ? 'Enter a non-negative amount with at most two decimal places.' : ''); }, [bad]);
  return <Field label={l} hint={hint} error={bad ? 'Enter an amount like 150 or 150.50' : null}><Input ref={input} aria-invalid={bad || undefined} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
const detailText = (d: unknown) => { if (d == null) return ''; const t = typeof d === 'string' ? d : JSON.stringify(d); return t === '{}' ? '' : t; };
const toPesewas = (text: string): number | null => { try { return text.trim() ? parseGHS(text) : null; } catch { return null; } };

async function openDocument(path: string) {
  const tab = window.open('about:blank', '_blank');
  if (!tab) throw new Error('Allow pop-ups for Mansora, then open the printable document again.');
  tab.opener = null;
  try {
    const r = await api<{ html: string }>('GET', path);
    const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
    tab.location.replace(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { tab.close(); throw error; }
}
async function downloadCsv(kind: string, from: string, to: string) {
  const res = await fetch(`${BASE}/v1/admin/billing/reports/export?kind=${kind}&from=${from}&to=${to}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('The export could not be created');
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: `mansora-${kind}-${to}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Payment link" onFocus={(e) => e.currentTarget.select()} />
      <Button onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {})}>{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  );
}
function Bars({ rows }: { rows: { month: string; invoiced: number; collected: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiced, r.collected]));
  return (
    <div>
      <div className="flex items-end gap-2" role="img" aria-label="Invoiced and collected by month, last 12 months. The table below lists the same figures.">
        {rows.map((r) => (
          <div key={r.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <div className="w-1/2 rounded-t bg-slate-300" style={{ height: `${(r.invoiced / max) * 100}%` }} title={`Invoiced ${ghs(r.invoiced)}`} />
              <div className="w-1/2 rounded-t bg-brand-600" style={{ height: `${(r.collected / max) * 100}%` }} title={`Collected ${ghs(r.collected)}`} />
            </div>
            <div className="text-[10px] text-slate-500">{r.month.slice(5)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-slate-600"><span><span className="mr-1 inline-block h-2 w-3 rounded bg-slate-300" />Invoiced</span><span><span className="mr-1 inline-block h-2 w-3 rounded bg-brand-600" />Cash collected (after refunds)</span></div>
    </div>
  );
}

// ------------------------------------------------------------------ revenue reports
export function RevenueReports() {
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const report = useApi<any>(`/v1/admin/billing/reports/summary?from=${range.from}&to=${range.to}`);
  const d = report.data;
  const act = useAction();
  const exp = (kind: string, text: string) => <Button size="sm" disabled={act.busy || !d} onClick={() => act.run(() => downloadCsv(kind, range.from, range.to))}>{text}</Button>;
  return (
    <div>
      <PageHeader title="Revenue reports" subtitle="Cash received is kept separate from what has been invoiced. Test (sandbox) payments are never counted."
        actions={<ActionMenu label="Export reports">{exp('collections', 'Export collections')}{exp('invoices', 'Export invoices')}{exp('payments', 'Export payments')}{exp('revenue_by_month', 'Export by month')}{exp('ageing', 'Export ageing')}</ActionMenu>} />
      <Msg a={act} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className="w-40" />
        <span className="text-sm text-slate-500">to</span>
        <Input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className="w-40" />
        <Button size="sm" onClick={() => setRange({ from: monthStart(), to: today() })}>This month</Button>
      </div>
      <QueryView query={report} label="revenue reports">{d && <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={ghs(d.mrr)} hint="Running subscriptions, after discounts" />
        <Stat label="Annual recurring revenue" value={ghs(d.arr)} hint="Monthly recurring revenue × 12" />
        <Stat label="Collected this month" value={ghs(d.thisMonth.collected.net)} tone="good" hint={`${ghs(d.thisMonth.collected.gross)} received, ${ghs(d.thisMonth.collected.refunds)} refunded`} />
        <Stat label="Expected this month" value={ghs(d.thisMonth.expected)} hint={`${ghs(d.thisMonth.alreadyCollected)} collected, ${ghs(d.thisMonth.stillToCollect)} still to come`} />
        <Stat label="Overdue receivables" value={ghs(d.receivables.overdue)} tone={d.receivables.overdue ? 'bad' : 'default'} />
        <Stat label="Total outstanding invoices" value={ghs(d.receivables.outstanding)} hint={`${d.receivables.invoices} invoice(s)`} />
        <Stat label="Successful payment rate" value={pct(d.attempts.successRateBps)} hint={`${d.attempts.successful} succeeded in this period`} />
        <Stat label="Failed payment rate" value={pct(d.attempts.failureRateBps)} tone={d.attempts.failed ? 'warn' : 'default'} hint={`${d.attempts.failed} failed`} />
        <Stat label="Active subscriptions" value={d.subscriptions.active} />
        <Stat label="Cancelled subscriptions" value={d.subscriptions.cancelled} />
        <Stat label="Upcoming renewals (30 days)" value={d.subscriptions.upcomingRenewals} />
        <Stat label="Items needing review" value={d.openExceptions} tone={d.openExceptions ? 'warn' : 'good'} hint="Open in Collections" />
      </div>
      {d.sandboxPaymentsExcluded > 0 && <Alert tone="info" className="mt-3">{d.sandboxPaymentsExcluded} sandbox test payment(s) exist and are excluded from every figure on this page.</Alert>}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Invoiced and collected, last 12 months" className="xl:col-span-2"><Bars rows={d.months} />
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-600">Show as a table</summary>
            <Table rows={d.months} rowKey={(r: any) => r.month} columns={[{ header: 'Month', cell: (r: any) => r.month }, { header: 'Invoiced', align: 'right', cell: (r: any) => ghs(r.invoiced) }, { header: 'Cash collected', align: 'right', cell: (r: any) => ghs(r.collected) }]} /></details>
        </Card>
        <Card title="Cash and settlement in this period" pad={false}>
          <Table rows={[['Received', d.period.cash.gross], ['Refunded', -d.period.cash.refunds], ['Net collected', d.period.cash.net], ['Provider fees', -d.period.cash.fees], ['Net settled revenue', d.period.cash.netSettled], ['Paid out by providers', d.period.settledByProvider], ['Invoiced (not cash)', d.period.invoiced]]} columns={[{ header: 'Measure', cell: (r: any) => r[0] }, { header: 'Amount', align: 'right', cell: (r: any) => ghs(r[1]) }]} />
        </Card>
        <Card title="Receivables ageing" pad={false}>
          <Table rows={[['Not yet due', d.receivables.ageing.notYetDue], ['1 to 7 days overdue', d.receivables.ageing.d1_7], ['8 to 14 days', d.receivables.ageing.d8_14], ['15 to 30 days', d.receivables.ageing.d15_30], ['Over 30 days', d.receivables.ageing.d31plus]]} columns={[{ header: 'Age', cell: (r: any) => r[0] }, { header: 'Owed', align: 'right', cell: (r: any) => ghs(r[1]) }]} />
        </Card>
        <Card title="Cash collected by client" pad={false}>
          <Table rows={d.byClient} empty="No payments in this period" rowKey={(r: any) => r.id} columns={[{ header: 'Client', cell: (r: any) => r.name }, { header: 'Received', align: 'right', cell: (r: any) => ghs(r.gross) }, { header: 'Refunded', align: 'right', cell: (r: any) => (r.refunded ? ghs(r.refunded) : '') }]} />
        </Card>
        <Card title="By service" pad={false}>
          <Table rows={Object.keys({ ...d.collectedByService, ...Object.fromEntries(d.invoicedByService.map((s: any) => [s.service_code, 1])) })} empty="Nothing yet" rowKey={(r: string) => r}
            columns={[{ header: 'Service', cell: (r: string) => label(r) }, { header: 'Invoiced', align: 'right', cell: (r: string) => ghs(d.invoicedByService.find((s: any) => s.service_code === r)?.total ?? 0) }, { header: 'Cash collected', align: 'right', cell: (r: string) => ghs(d.collectedByService[r] ?? 0) }]} />
          {d.collectedUnallocated ? <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">Not applied to any invoice: {ghs(d.collectedUnallocated)}. Cash collected by service plus this amount equals net cash collected. Refunds count in the period they were made.</p> : null}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">Subscription income alone is not profit: no costs are counted here, so no profit figure is shown.</p>
      </>}</QueryView>
    </div>
  );
}

// ------------------------------------------------------------------ collections
const FILTERS: [string, string][] = [['all', 'All clients'], ['active', 'Active'], ['pending_mandate', 'Pending mandate'], ['upcoming', 'Upcoming payment'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['failed', 'Failed collection'], ['cancelled', 'Cancelled'], ['disputed', 'Disputed']];

export function Collections({ go }: { go: (id: string, param?: string) => void }) {
  const [tab, setTab] = useState<'clients' | 'exceptions' | 'messages' | 'attempts'>('clients');
  const [filter, setFilter] = useState('all');
  const rows = useApi<any[]>(`/v1/admin/billing/collections?filter=${filter}`);
  const exceptions = useApi<any[]>('/v1/admin/billing/exceptions');
  const messages = useApi<any[]>('/v1/admin/billing/notifications');
  const attempts = useApi<any[]>('/v1/admin/billing/attempts');
  const [manage, setManage] = useState<any | null>(null);
  const [resolve, setResolve] = useState<any | null>(null);
  const act = useAction();
  const reload = () => { rows.reload(); exceptions.reload(); messages.reload(); attempts.reload(); };
  return (
    <div>
      <PageHeader title="Who owes us" subtitle="Who owes what, whose automatic payments are set up, and what needs attention." actions={<Button size="sm" onClick={() => go('revenue')}>Revenue reports</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'clients', label: 'Clients' }, { id: 'exceptions', label: `Needs review${exceptions.data?.length ? ` (${exceptions.data.length})` : ''}` }, { id: 'messages', label: 'Messages' }, { id: 'attempts', label: 'Payment attempts' }]} />
      {tab === 'clients' && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">{FILTERS.map(([id, text]) => <Button key={id} size="sm" variant={filter === id ? 'primary' : 'secondary'} onClick={() => setFilter(id)} aria-pressed={filter === id}>{text}</Button>)}</div>
          <Card pad={false}>
            <QueryView query={rows} label="billing records"><Table rows={rows.data} rowKey={(r) => r.tenant_id} empty="No clients match this filter"
              columns={[
                { header: 'Client', cell: (r) => <button className="font-medium text-brand-700 hover:underline" onClick={() => go('client', r.tenant_id)}>{r.client}</button> },
                { header: 'Plan', cell: (r) => r.plan ?? '—' },
                { header: 'Fee', align: 'right', cell: (r) => (r.period_fee == null ? '—' : <>{ghs(r.period_fee)}<span className="text-xs text-slate-500"> /{r.billing_frequency?.replace('ly', '')}</span></>) },
                { header: 'Paying by', cell: (r) => (r.payment_method ? <>{label(r.payment_method)}{r.mandate_masked && <div className="text-xs text-slate-500">{r.mandate_masked}</div>}</> : '—') },
                { header: 'Last payment', cell: (r) => day(r.last_payment) },
                { header: 'Next payment', cell: (r) => day(r.next_payment) },
                { header: 'Owes', align: 'right', cell: (r) => (r.outstanding ? <strong>{ghs(r.outstanding)}</strong> : ghs(0)) },
                { header: 'Days late', align: 'right', cell: (r) => (r.days_overdue ? <Badge tone="bad">{r.days_overdue}</Badge> : '') },
                { header: 'Service', cell: (r) => <StandingBadge s={r.standing} /> },
                { header: 'Mandate', cell: (r) => (r.mandate_status ? <Status s={r.mandate_status} /> : <Badge>none</Badge>) },
                { header: 'Subscription', cell: (r) => <Status s={r.subscription_status} /> },
                { header: '', align: 'right', cell: (r) => <Button size="sm" onClick={() => setManage(r)}>Manage</Button> },
              ]} /></QueryView>
          </Card>
        </>
      )}
      {tab === 'exceptions' && (
        <Card pad={false}>
          <QueryView query={exceptions} label="billing records"><Table rows={exceptions.data} rowKey={(r) => r.id} empty="Nothing needs review. Differences between Mansora's records and the providers' appear here."
            columns={[{ header: 'When', cell: (r) => when(r.created_at) }, { header: 'Kind', cell: (r) => <Badge tone="warn">{label(r.kind)}</Badge> }, { header: 'Client', cell: (r) => r.client ?? '—' }, { header: 'Invoice', cell: (r) => r.invoice ?? '' }, { header: 'What happened', cell: (r) => <span className="text-sm">{r.detail}</span> }, { header: '', align: 'right', cell: (r) => <Button size="sm" onClick={() => setResolve(r)}>Resolve</Button> }]} /></QueryView>
        </Card>
      )}
      {tab === 'messages' && <Communications />}
      {tab === 'attempts' && (
        <Card pad={false}><QueryView query={attempts} label="billing records"><Table rows={attempts.data} rowKey={(r) => r.id} empty="No payment attempts yet" columns={[{ header: 'When', cell: (r) => when(r.created_at) }, { header: 'Client', cell: (r) => r.client }, { header: 'Invoice', cell: (r) => r.invoice }, { header: 'Kind', cell: (r) => label(r.kind) }, { header: 'Provider', cell: (r) => <>{r.provider}{r.sandbox && <> <Badge tone="warn">sandbox</Badge></>}</> }, { header: 'Amount', align: 'right', cell: (r) => ghs(r.amount) }, { header: 'Status', cell: (r) => <Status s={r.status} /> }, { header: 'Note', cell: (r) => <span className="text-xs text-slate-600">{r.failure_reason ?? ''}</span> }]} /></QueryView></Card>
      )}
      {manage && <ManageClient row={manage} go={go} onClose={() => setManage(null)} onChanged={reload} />}
      {resolve && (
        <ResolveModal title="Resolve this item" onClose={() => setResolve(null)} onSave={async (text) => { await api('POST', `/v1/admin/billing/exceptions/${resolve.id}/resolve`, { resolution: text }); setResolve(null); reload(); }}>
          <p className="mb-3 text-sm text-slate-700">{resolve.detail}</p>
        </ResolveModal>
      )}
      {act.error && <Alert tone="bad">{act.error}</Alert>}
    </div>
  );
}

function ResolveModal({ title, children, onClose, onSave, button = 'Save' }: { title: string; children?: ReactNode; onClose: () => void; onSave: (text: string) => Promise<void>; button?: string }) {
  const [text, setText] = useState('');
  const act = useAction();
  return (
    <Modal title={title} open onClose={onClose} footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="primary" disabled={act.busy || !text.trim()} onClick={() => act.run(() => onSave(text))}>{button}</Button></>}>
      <Msg a={act} />{children}
      <Field label="Reason or note (kept in the audit log)"><Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function ManageClient({ row, go, onClose, onChanged }: { row: any; go: (id: string, p?: string) => void; onClose: () => void; onChanged: () => void }) {
  const act = useAction();
  const [view, setView] = useState<'actions' | 'invoice' | 'payment' | 'plan' | 'history' | 'link' | 'arrangement'>('actions');
  const [link, setLink] = useState('');
  const history = useApi<any[]>(view === 'history' ? `/v1/admin/billing/audit?tenantId=${row.tenant_id}` : null);
  const call = (method: 'POST', path: string, body?: unknown, msg?: string) => act.run(async () => { await api(method, `/v1/admin/billing${path}`, body ?? {}); onChanged(); }, msg);
  const inv = row.oldest_invoice_id;
  return (
    <Modal trackChanges={false} title={row.client} open onClose={onClose} wide footer={<Button dismiss onClick={onClose}>Close</Button>}>
      <Msg a={act} />
      {view === 'actions' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button onClick={() => go('client', row.tenant_id)}>View client</Button>
          <Button disabled={!inv} onClick={() => setView('invoice')}>View invoice</Button>
          <Button disabled={!inv || act.busy} onClick={() => call('POST', `/invoices/${inv}/remind`, {}, 'Reminder queued for this client')}>Send reminder</Button>
          <Button disabled={!inv || act.busy} onClick={() => act.run(async () => { setLink((await api('POST', `/v1/admin/billing/invoices/${inv}/link`, {})).url); setView('link'); })}>Generate payment link</Button>
          <Button disabled={!inv} onClick={() => setView('payment')}>Record payment</Button>
          <Button disabled={!inv || act.busy} onClick={() => call('POST', `/invoices/${inv}/retry`, {}, 'Collection requested. Check the result under Payment attempts.')}>Retry collection</Button>
          <Button disabled={!row.subscription_id} onClick={() => setView('plan')}>Change plan</Button>
          {row.subscription_status === 'paused'
            ? <Button disabled={act.busy} onClick={() => call('POST', `/subscriptions/${row.subscription_id}/resume`, {}, 'Subscription resumed')}>Resume subscription</Button>
            : <Button disabled={!row.subscription_id || act.busy} onClick={() => call('POST', `/subscriptions/${row.subscription_id}/pause`, { reason: 'Paused by administrator' }, 'Subscription paused')}>Pause subscription</Button>}
          <Button onClick={() => setView('arrangement')}>Payment arrangement</Button>
          <Button onClick={() => setView('history')}>View audit history</Button>
        </div>
      )}
      {view === 'actions' && row.standing && row.standing.stage !== 'good' && <p className="mt-3 text-sm text-slate-600"><StandingBadge s={row.standing} /> {standingText(row.standing)}</p>}
      {view === 'arrangement' && <Arrangement tenantId={row.tenant_id} onDone={() => { onChanged(); setView('actions'); }} />}
      {view === 'link' && <><p className="mb-2 text-sm text-slate-600">Anyone with this link can pay this invoice. Share it only with the client.</p><CopyLink url={link} /></>}
      {view === 'invoice' && inv && <InvoiceDetail id={inv} onChanged={onChanged} embedded />}
      {view === 'payment' && inv && <Modal title="Record payment" open onClose={() => setView('actions')} footer={<Button dismiss onClick={() => setView('actions')}>Cancel</Button>}><RecordPayment invoiceId={inv} onDone={() => { onChanged(); setView('actions'); }} /></Modal>}
      {view === 'plan' && <Modal title="Change plan" open onClose={() => setView('actions')} footer={<Button dismiss onClick={() => setView('actions')}>Cancel</Button>}><ChangePlan subscriptionId={row.subscription_id} onDone={() => { onChanged(); setView('actions'); }} /></Modal>}
      {view === 'history' && <QueryView query={history} label="billing records"><Table rows={history.data} rowKey={(r: any) => r.id} empty="No history yet" columns={[{ header: 'When', cell: (r: any) => when(r.occurred_at) }, { header: 'By', cell: (r: any) => r.actor_type }, { header: 'Action', cell: (r: any) => <code className="text-xs">{r.action}</code> }, { header: 'Details', cell: (r: any) => <span className="break-all text-xs text-slate-600">{detailText(r.detail)}</span> }]} /></QueryView>}
      {view !== 'actions' && <Button size="sm" className="mt-3" onClick={() => setView('actions')}>← Back to actions</Button>}
    </Modal>
  );
}

const STAGE: Record<string, { text: string; tone: 'good' | 'info' | 'warn' | 'bad' }> = { good: { text: 'Normal', tone: 'good' }, notice: { text: 'Reminded', tone: 'info' }, warning: { text: 'Warned', tone: 'warn' }, restricted: { text: 'Reports paused', tone: 'bad' } };
function StandingBadge({ s }: { s?: any }) {
  if (!s) return <>—</>;
  return <Badge tone={STAGE[s.stage]?.tone ?? 'info'}>{STAGE[s.stage]?.text ?? s.stage}{s.holdUntil ? ' · arrangement' : ''}</Badge>;
}
function standingText(s: any): string {
  if (s.stage === 'restricted') return `Invoice ${s.invoiceNumber} is ${s.daysOverdue} days overdue. The client's reports and report exports are paused; selling, stock, backups and paying continue.`;
  const arrangement = s.holdUntil ? ` A payment arrangement runs until ${s.holdUntil}.` : '';
  return `Invoice ${s.invoiceNumber} is ${s.daysOverdue} days overdue. Reports pause on ${s.restrictFrom} if it is still unpaid.${arrangement}`;
}

/** Non-payment policy (D-28): agree or end a time-limited payment arrangement. Every change is audited. */
function Arrangement({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const info = useApi<any>(`/v1/admin/billing/clients/${tenantId}/standing`);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  const d = info.data;
  return (
    <QueryView query={info} label="service standing">{d && (
      <div className="space-y-3">
        <Msg a={act} />
        <p className="text-sm text-slate-700"><StandingBadge s={d.standing} /> {d.standing.stage === 'good' ? 'Nothing is overdue. No arrangement is needed.' : standingText(d.standing)}</p>
        <p className="text-xs text-slate-600">Policy: reminder after {d.policy.noticeAfterDays} day(s), warning after {d.policy.warnAfterDays}, reports pause after {d.policy.restrictAfterDays}. Selling never stops. Disputed invoices never escalate. An arrangement keeps reports open until its last day and can last up to 60 days.</p>
        {d.hold && <Alert>Current arrangement until {d.hold.until}: {d.hold.reason}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrangement ends on"><Input type="date" value={until} min={today()} onChange={(e) => setUntil(e.target.value)} /></Field>
          <Field label="What was agreed (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pays half on the 15th, rest on the 30th" /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={act.busy || !until || !reason.trim()} onClick={() => act.run(async () => { await api('POST', `/v1/admin/billing/clients/${tenantId}/standing/hold`, { until, reason }); onDone(); }, 'Arrangement saved')}>Save arrangement</Button>
          {d.hold && <Button disabled={act.busy || !reason.trim()} onClick={() => act.run(async () => { await api('POST', `/v1/admin/billing/clients/${tenantId}/standing/clear-hold`, { reason }); onDone(); }, 'Arrangement ended')}>End arrangement now</Button>}
        </div>
      </div>
    )}</QueryView>
  );
}

function RecordPayment({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', method: 'momo', reference: '', receivedOn: today(), notes: '' });
  const act = useAction();
  const amount = toPesewas(f.amount);
  return (
    <div className="space-y-3">
      <Msg a={act} />
      {act.error && <Alert tone="warn">If the connection failed after sending, check this invoice’s payment history before recording the money again.</Alert>}
      <p className="text-sm text-slate-600">Use this for money that arrived outside the payment provider: a bank transfer, cash, or a Mobile Money payment sent directly.</p>
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Amount received (GH₵)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="momo">Mobile Money</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
        <Field label="Reference (transaction ID)"><Input maxLength={80} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Date received"><Input type="date" max={today()} value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><Input maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <Button variant="primary" disabled={act.busy || !amount} onClick={() => act.run(async () => { await api('POST', `/v1/admin/billing/invoices/${invoiceId}/payment`, { amount, method: f.method, reference: f.reference || null, receivedOn: f.receivedOn, notes: f.notes || null }); onDone(); })}>Record payment</Button>
    </div>
  );
}

function ChangePlan({ subscriptionId, onDone }: { subscriptionId: string; onDone: () => void }) {
  const plansQuery = useApi<any[]>('/v1/admin/plans');
  const plans = plansQuery.data ?? [];
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('');
  const act = useAction();
  const plan = plans.find((p) => p.id === planId);
  const yearlyOffered = plan?.annual_price != null && plan?.billing_period !== 'yearly';
  return (
    <div className="space-y-3">
      <Msg a={act} />
      <QueryView query={plansQuery} label="service plans">{null}</QueryView>
      <Alert tone="info">The new price applies from the next invoice. Invoices already issued are never changed.</Alert>
      <Field label="New plan"><Select value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Choose…</option>{plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {ghs(p.price)} {p.billing_period}{p.annual_price != null && p.billing_period !== 'yearly' ? ` or ${ghs(p.annual_price)} yearly` : ''}</option>)}</Select></Field>
      {yearlyOffered && <Field label="Billed"><Select value={frequency || plan.billing_period} onChange={(e) => setFrequency(e.target.value)}><option value={plan.billing_period}>{label(plan.billing_period)} · {ghs(plan.price)}</option><option value="yearly">Yearly · {ghs(plan.annual_price)}</option></Select></Field>}
      <MoneyField label="Agreed amount per period (leave empty for the plan price)" value={amount} onChange={setAmount} />
      <Button variant="primary" disabled={act.busy || !planId || !plansQuery.data} onClick={() => act.run(async () => { await api('POST', `/v1/admin/billing/subscriptions/${subscriptionId}/change-plan`, { planId, agreedAmount: toPesewas(amount), frequency: yearlyOffered ? (frequency || plan.billing_period) : null }); onDone(); })}>Change plan</Button>
    </div>
  );
}

// ------------------------------------------------------------------ invoices
export function InvoiceDetail({ id, onChanged, embedded }: { id: string; onChanged?: () => void; embedded?: boolean }) {
  const query = useApi<any>(`/v1/admin/billing/invoices/${id}`);
  const { data: i, reload } = query;
  const act = useAction();
  const [form, setForm] = useState<null | 'cancel' | 'write-off' | 'credit-note' | 'dispute' | 'dispute/resolve' | 'payment'>(null);
  const [amount, setAmount] = useState('');
  if (!i) return <QueryView query={query} label="invoice">{null}</QueryView>;
  const changed = () => { reload(); onChanged?.(); };
  const post = (path: string, body: unknown = {}, msg?: string) => act.run(async () => { await api('POST', `/v1/admin/billing/invoices/${id}/${path}`, body); changed(); }, msg);
  const payable = ['sent', 'partially_paid', 'disputed'].includes(i.status);
  return (
    <div className="space-y-4">
      {!embedded && <h2 className="text-lg font-semibold">{i.number ?? 'Draft invoice'} <Status s={i.display_status} /></h2>}
      <Msg a={act} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Client" value={<span className="text-base">{i.tenant_name}</span>} />
        <Stat label="Total" value={ghs(i.total)} />
        <Stat label="Paid" value={ghs(i.amount_paid - i.amount_refunded)} tone="good" />
        <Stat label="Owes" value={ghs(i.outstanding)} tone={i.outstanding ? (i.days_overdue ? 'bad' : 'warn') : 'good'} hint={i.days_overdue ? `${i.days_overdue} days overdue` : `Due ${day(i.due_date)}`} />
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        {i.status === 'draft' && <Button variant="primary" disabled={act.busy} onClick={() => post('issue', {}, 'Invoice issued')}>Issue invoice</Button>}
        <Button disabled={!i.number} onClick={() => act.run(() => openDocument(`/v1/admin/billing/invoices/${id}/document`))}>Open printable invoice</Button>
        {payable && <Button disabled={act.busy} onClick={() => act.run(async () => { const r = await api('POST', `/v1/admin/billing/invoices/${id}/link`, {}); setForm(null); await navigator.clipboard?.writeText(r.url).catch(() => {}); }, 'Payment link copied')}>Copy payment link</Button>}
        {payable && <Button disabled={act.busy} onClick={() => post('remind', {}, 'Reminder queued')}>Send reminder</Button>}
        {payable && <Button disabled={act.busy} onClick={() => act.run(async () => { await api('POST', `/v1/admin/billing/invoices/${id}/retry`, {}); changed(); }, 'Collection requested')}>Retry collection</Button>}
        {payable && <Button onClick={() => setForm('payment')}>Record payment</Button>}
        {payable && <Button onClick={() => setForm('credit-note')}>Credit note</Button>}
        {payable && <Button onClick={() => setForm('write-off')}>Write off</Button>}
        {payable && i.status !== 'disputed' && <Button onClick={() => setForm('dispute')}>Mark disputed</Button>}
        {i.status === 'disputed' && <Button onClick={() => setForm('dispute/resolve')}>Resolve dispute</Button>}
        {['draft', 'sent'].includes(i.status) && !i.amount_paid && <Button variant="danger" onClick={() => setForm('cancel')}>Cancel invoice</Button>}
      </div>
      {form === 'payment' && <Modal title="Record a payment received outside the provider" open onClose={() => setForm(null)} footer={<Button dismiss onClick={() => setForm(null)}>Cancel</Button>}><RecordPayment invoiceId={id} onDone={() => { setForm(null); changed(); }} /></Modal>}
      {form === 'credit-note' && (
        <ResolveModal title="Credit note" button="Issue credit note" onClose={() => setForm(null)} onSave={async (reason) => { const a = toPesewas(amount); if (!a || a < 0) throw new Error('Enter a positive credit amount'); await api('POST', `/v1/admin/billing/invoices/${id}/credit-note`, { amount: a, reason }); setForm(null); setAmount(''); changed(); }}><MoneyField label="Credit amount (GH₵)" value={amount} onChange={setAmount} /></ResolveModal>
      )}
      {(form === 'cancel' || form === 'write-off' || form === 'dispute' || form === 'dispute/resolve') && (
        <ResolveModal title={form === 'cancel' ? 'Cancel this invoice' : form === 'write-off' ? 'Write off the balance' : form === 'dispute' ? 'Mark as disputed' : 'Resolve the dispute'} button="Confirm" onClose={() => setForm(null)}
          onSave={async (text) => { await api('POST', `/v1/admin/billing/invoices/${id}/${form}`, form === 'dispute/resolve' ? { resolution: text } : { reason: text }); setForm(null); changed(); }} />
      )}
      <Card title="Lines" pad={false}><Table rows={i.lines} rowKey={(r: any) => r.id} columns={[{ header: 'Description', cell: (r: any) => r.description }, { header: 'Qty', align: 'right', cell: (r: any) => r.quantity }, { header: 'Unit', align: 'right', cell: (r: any) => ghs(r.unit_price) }, { header: 'Total', align: 'right', cell: (r: any) => ghs(r.line_total) }]} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payments" pad={false}><Table rows={i.payments} empty="No payments yet" rowKey={(r: any) => r.id} columns={[{ header: 'Receipt', cell: (r: any) => <>{r.receipt_number}{r.sandbox && <> <Badge tone="warn">sandbox</Badge></>}</> }, { header: 'Received', cell: (r: any) => when(r.received_at) }, { header: 'Method', cell: (r: any) => label(r.method) }, { header: 'Amount', align: 'right', cell: (r: any) => ghs(r.allocated) }]} /></Card>
        <Card title="Payment attempts" pad={false}><Table rows={i.attempts} empty="None yet" rowKey={(r: any) => r.id} columns={[{ header: 'When', cell: (r: any) => when(r.created_at) }, { header: 'Kind', cell: (r: any) => label(r.kind) }, { header: 'Status', cell: (r: any) => <Status s={r.status} /> }, { header: 'Note', cell: (r: any) => <span className="text-xs text-slate-600">{r.failure_reason ?? ''}</span> }]} /></Card>
        <Card title="Reminders" pad={false}><Table rows={i.reminders} empty="None yet" rowKey={(r: any, k) => `${r.step}${k}`} columns={[{ header: 'Step', cell: (r: any) => label(r.step) }, { header: 'Due', cell: (r: any) => day(r.due_on) }, { header: 'Status', cell: (r: any) => <Status s={r.status} /> }]} /></Card>
        <Card title="History" pad={false}><Table rows={i.history} empty="No history" rowKey={(_r: any, k) => k} columns={[{ header: 'When', cell: (r: any) => when(r.occurred_at) }, { header: 'By', cell: (r: any) => r.actor_type }, { header: 'Action', cell: (r: any) => <code className="text-xs">{r.action}</code> }]} /></Card>
      </div>
    </div>
  );
}

export function Invoices() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useApi<any[]>(`/v1/admin/billing/invoices?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { q: search } : {}) })}`);
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Every invoice Mansora has raised. Subscription invoices are created automatically before each renewal." actions={<Button variant="primary" onClick={() => setCreating(true)}>New invoice</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input aria-label="Search invoices" placeholder="Search by number or client" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">All statuses</option>{['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'disputed', 'cancelled', 'written_off'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
      </div>
      <Card pad={false}>
        <QueryView query={list} label="billing records"><Table rows={list.data} rowKey={(r) => r.id} empty="No invoices yet" onRowClick={(r) => setOpen(r.id)}
          columns={[{ header: 'Number', cell: (r) => r.number ?? 'Draft' }, { header: 'Client', cell: (r) => r.client }, { header: 'Issued', cell: (r) => day(r.issue_date) }, { header: 'Due', cell: (r) => day(r.due_date) }, { header: 'Total', align: 'right', cell: (r) => ghs(r.total) }, { header: 'Owes', align: 'right', cell: (r) => ghs(r.outstanding) }, { header: 'Status', cell: (r) => <Status s={r.display_status} /> }, { header: '', align: 'right', cell: () => <span className="text-xs text-brand-700">Open</span> }]} /></QueryView>
      </Card>
      {open && <Modal trackChanges={false} title="Invoice" open wide onClose={() => setOpen(null)} footer={<Button dismiss onClick={() => setOpen(null)}>Close</Button>}><InvoiceDetail id={open} onChanged={list.reload} /></Modal>}
      {creating && <NewInvoice onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); list.reload(); setOpen(id); }} />}
    </div>
  );
}

function NewInvoice({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const clientsQuery = useApi<any[]>('/v1/admin/clients');
  const clients = clientsQuery.data ?? [];
  const [tenantId, setTenantId] = useState('');
  const [lines, setLines] = useState([{ description: '', quantity: '1', unit: '' }]);
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const act = useAction();
  const parsed = lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPrice: toPesewas(l.unit) }));
  const valid = clientsQuery.data && tenantId && lines.every((l) => /^\d+$/.test(l.quantity)) && parsed.every((l) => l.description && Number.isInteger(l.quantity) && l.quantity > 0 && l.unitPrice != null && l.unitPrice > 0);
  const total = parsed.reduce((n, l) => n + (l.unitPrice ?? 0) * (Number.isInteger(l.quantity) ? l.quantity : 0), 0);
  return (
    <Modal title="New one-off invoice" open wide onClose={onClose} footer={<><Button dismiss onClick={onClose}>Cancel</Button>
      <Button disabled={act.busy || !valid} onClick={() => act.run(async () => { const r = await api('POST', '/v1/admin/billing/invoices', { tenantId, lines: parsed.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, serviceCode: 'custom' })), dueDate: dueDate || null, notes: notes || null, issue: false }); onCreated(r.id); })}>Save as draft</Button>
      <Button variant="primary" disabled={act.busy || !valid} onClick={() => act.run(async () => { const r = await api('POST', '/v1/admin/billing/invoices', { tenantId, lines: parsed.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, serviceCode: 'custom' })), dueDate: dueDate || null, notes: notes || null, issue: true }); onCreated(r.id); })}>Issue now</Button></>}>
      <Msg a={act} /><QueryView query={clientsQuery} label="clients">{null}</QueryView>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client"><Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Due date (optional)" hint="Defaults to the standard payment terms"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((l, k) => (
          <div key={k} className="grid grid-cols-[1fr_70px_110px_auto] items-end gap-2">
            <Field label={k === 0 ? 'Description' : `Line ${k + 1}`}><Input value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, description: e.target.value } : x)))} /></Field>
            <Field label="Qty"><Input inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, quantity: e.target.value } : x)))} /></Field>
            <MoneyField label="Unit price (GH₵)" value={l.unit} onChange={(v) => setLines(lines.map((x, j) => (j === k ? { ...x, unit: v } : x)))} />
            <Button size="sm" aria-label={`Remove line ${k + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== k))}>✕</Button>
          </div>
        ))}
        <Button size="sm" onClick={() => setLines([...lines, { description: '', quantity: '1', unit: '' }])}>Add a line</Button>
      </div>
      <Field label="Notes (shown on the invoice)" className="mt-3"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <p className="mt-2 text-right text-sm font-semibold">Total {ghs(total)}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------ subscriptions
export function Subscriptions({ go }: { go: (id: string, param?: string) => void }) {
  const [status, setStatus] = useState('');
  const list = useApi<any[]>(`/v1/admin/billing/subscriptions${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Subscriptions" subtitle="What each client has agreed to pay, and where it stands." actions={<Button variant="primary" onClick={() => setCreating(true)}>New subscription</Button>} />
      <div className="mb-3"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-52"><option value="">All statuses</option>{['draft', 'awaiting_approval', 'trial', 'active', 'payment_due', 'payment_failed', 'overdue', 'paused', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div>
      <Card pad={false}>
        <QueryView query={list} label="billing records"><Table rows={list.data} rowKey={(r) => r.id} empty="No subscriptions yet" onRowClick={(r) => setOpen(r.id)}
          columns={[{ header: 'Client', cell: (r) => r.client }, { header: 'Plan', cell: (r) => r.plan ?? '—' }, { header: 'Agreed fee', align: 'right', cell: (r) => (r.agreed_amount == null ? '—' : <>{ghs(r.agreed_amount)}<span className="text-xs text-slate-500"> /{r.billing_frequency?.replace('ly', '')}</span></>) }, { header: 'Next billing', cell: (r) => day(r.renewal_date) }, { header: 'Paying by', cell: (r) => (r.payment_method ? label(r.payment_method) : '—') }, { header: 'Mandate', cell: (r) => (r.mandate_status ? <Status s={r.mandate_status} /> : '—') }, { header: 'Owes', align: 'right', cell: (r) => ghs(r.outstanding) }, { header: 'Status', cell: (r) => <Status s={r.status} /> }]} /></QueryView>
      </Card>
      {open && <SubscriptionDetail id={open} go={go} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {creating && <NewSubscription onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); list.reload(); setOpen(id); }} />}
    </div>
  );
}

function SubscriptionDetail({ id, go, onClose, onChanged }: { id: string; go: (id: string, p?: string) => void; onClose: () => void; onChanged: () => void }) {
  const query = useApi<any>(`/v1/admin/billing/subscriptions/${id}`);
  const { data, reload } = query;
  const act = useAction();
  const [form, setForm] = useState<null | 'cancel' | 'pause' | 'plan' | 'date' | 'discount'>(null);
  const [text, setText] = useState('');
  const [atEnd, setAtEnd] = useState(true);
  const [pct2, setPct] = useState(''), [until2, setUntil] = useState('');
  const [invoice, setInvoice] = useState<string | null>(null);
  const s = data?.subscription;
  const changed = () => { reload(); onChanged(); };
  const mutate = async (path: string, body: unknown = {}) => { await api('POST', `/v1/admin/billing/subscriptions/${id}/${path}`, body); setForm(null); setText(''); changed(); };
  const post = (path: string, body: unknown = {}, msg?: string) => act.run(() => mutate(path, body), msg);
  return (
    <Modal trackChanges={false} title={s ? `${s.client} · ${s.plan ?? 'No plan'}` : 'Subscription'} open wide onClose={onClose} footer={<Button dismiss onClick={onClose}>Close</Button>}>
      {!s ? <QueryView query={query} label="subscription">{null}</QueryView> : (
        <div className="space-y-4">
          <Msg a={act} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Status" value={<Status s={s.status} />} />
            <Stat label="Agreed fee" value={ghs(s.agreed_amount)} hint={`${label(s.billing_frequency)}${s.discount_bps ? ` · ${pct(s.discount_bps)} discount${s.discount_until ? ` until ${s.discount_until}` : ''}` : ''}${s.setup_fee_waived ? ' · setup fee waived' : ''}`} />
            <Stat label="Next billing" value={<span className="text-base">{day(s.renewal_date)}</span>} />
            <Stat label="Paying by" value={<span className="text-base">{label(s.payment_method)}</span>} />
          </div>
          {s.cancel_requested_at && <Alert tone="warn">The client asked to cancel on {day(s.cancel_requested_at)}: {s.cancel_requested_reason}</Alert>}
          <div className="flex flex-wrap gap-2">
            {s.status === 'draft' && <Button variant="primary" disabled={act.busy} onClick={() => post('submit', {}, 'Submitted for approval')}>Submit for approval</Button>}
            {['awaiting_approval', 'draft'].includes(s.status) && <Button disabled={act.busy} onClick={() => post('activate', {}, 'Subscription activated')}>Activate manually</Button>}
            {s.status === 'paused' ? <Button disabled={act.busy} onClick={() => post('resume', {}, 'Resumed')}>Resume</Button> : !['cancelled', 'expired'].includes(s.status) && <Button onClick={() => setForm('pause')}>Pause</Button>}
            {!['cancelled', 'expired'].includes(s.status) && <><Button onClick={() => setForm('plan')}>Change plan</Button><Button onClick={() => setForm('date')}>Change billing date</Button><Button onClick={() => setForm('discount')}>Set discount</Button><Button dismiss variant="danger" onClick={() => setForm('cancel')}>Cancel</Button></>}
            <Button onClick={() => go('client', s.tenant_id)}>View client</Button>
          </div>
          {form === 'pause' && <ResolveModal title="Pause subscription" button="Pause" onClose={() => setForm(null)} onSave={async (r) => { await mutate('pause', { reason: r }); }} />}
          {form === 'cancel' && <ResolveModal title="Cancel subscription" button="Cancel subscription" onClose={() => setForm(null)} onSave={async (r) => { await mutate('cancel', { reason: r, atPeriodEnd: atEnd }); }}><label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={atEnd} onChange={(e) => setAtEnd(e.target.checked)} />Keep the service until the end of the paid period</label></ResolveModal>}
          {form === 'plan' && <Modal title="Change plan" open onClose={() => setForm(null)}><ChangePlan subscriptionId={id} onDone={() => { setForm(null); changed(); }} /></Modal>}
          {form === 'date' && <Modal title="Change next billing date" open onClose={() => setForm(null)} footer={<><Button dismiss onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" disabled={!text || act.busy} onClick={() => post('renewal-date', { date: text }, 'Billing date changed')}>Save</Button></>}><Msg a={act} /><Field label="Next billing date"><Input required type="date" value={text} onChange={(e) => setText(e.target.value)} /></Field></Modal>}
          {form === 'discount' && <ResolveModal title="Set discount" onClose={() => setForm(null)} onSave={async (note) => { const v = Number(pct2); if (!pct2.trim() || !/^\d+(\.\d{1,2})?$/.test(pct2) || !(v >= 0 && v <= 100)) throw new Error('Enter a percentage between 0 and 100'); await mutate('discount', { discountBps: Math.round(v * 100), note, until: until2 || null }); }}><Field label="Discount (%)"><Input type="number" required min={0} max={100} step={0.01} value={pct2} onChange={(e) => setPct(e.target.value)} /></Field><Field label="Ends on (optional)" hint="For a pilot price: periods starting on or after this date are full price. Leave empty for no end."><Input type="date" value={until2} onChange={(e) => setUntil(e.target.value)} /></Field></ResolveModal>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Invoices" pad={false}><Table rows={data.invoices} empty="No invoices yet" rowKey={(r: any) => r.id} onRowClick={(r: any) => setInvoice(r.id)} columns={[{ header: 'Number', cell: (r: any) => r.number ?? 'Draft' }, { header: 'Due', cell: (r: any) => day(r.due_date) }, { header: 'Total', align: 'right', cell: (r: any) => ghs(r.total) }, { header: 'Status', cell: (r: any) => <Status s={r.status} /> }]} /></Card>
            <Card title="Payment authorisations" pad={false}><Table rows={data.mandates} empty="No authorisation on file" rowKey={(r: any) => r.id} columns={[{ header: 'Method', cell: (r: any) => <>{label(r.method)} {r.masked}</> }, { header: 'Provider', cell: (r: any) => r.provider }, { header: 'Approved', cell: (r: any) => day(r.approved_at) }, { header: 'Status', cell: (r: any) => <Status s={r.status} /> }]} /></Card>
          </div>
          <Card title="History" pad={false}><Table rows={data.history} empty="No history" rowKey={(_r: any, k) => k} columns={[{ header: 'When', cell: (r: any) => when(r.occurred_at) }, { header: 'By', cell: (r: any) => r.actor_type }, { header: 'Action', cell: (r: any) => <code className="text-xs">{r.action}</code> }, { header: 'Details', cell: (r: any) => <span className="break-all text-xs text-slate-600">{detailText(r.detail)}</span> }]} /></Card>
          {invoice && <Modal trackChanges={false} title="Invoice" open wide onClose={() => setInvoice(null)} footer={<Button dismiss onClick={() => setInvoice(null)}>Close</Button>}><InvoiceDetail id={invoice} onChanged={changed} /></Modal>}
        </div>
      )}
    </Modal>
  );
}

function NewSubscription({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const clientsQuery = useApi<any[]>('/v1/admin/clients');
  const clients = clientsQuery.data ?? [];
  const plansQuery = useApi<any[]>('/v1/admin/plans');
  const plans = (plansQuery.data ?? []).filter((p) => p.active);
  const [f, setF] = useState({ tenantId: '', planId: '', frequency: 'monthly', amount: '', startDate: '', paymentMethod: 'momo', activationPolicy: 'first_payment',
    waiveSetup: false, waiverNote: 'Pilot shop', pilot: false, pilotPct: '50', pilotUntil: '', pilotNote: 'Pilot price' });
  const act = useAction();
  const plan = plans.find((p) => p.id === f.planId);
  const yearlyOffered = plan?.annual_price != null && plan?.billing_period !== 'yearly';
  const frequency = plan && (f.frequency === plan.billing_period || (f.frequency === 'yearly' && yearlyOffered)) ? f.frequency : plan?.billing_period ?? 'monthly';
  const listPrice = plan ? (frequency === 'yearly' && plan.billing_period !== 'yearly' ? plan.annual_price : plan.price) : null;
  const pct = Number(f.pilotPct);
  const pilotValid = !f.pilot || (/^\d+(\.\d{1,2})?$/.test(f.pilotPct) && pct > 0 && pct <= 100 && !!f.pilotUntil);
  const create = () => act.run(async () => {
    if (!pilotValid) throw new Error('Enter the pilot discount (more than 0%, up to 100%) and the date the pilot price ends');
    const r = await api('POST', '/v1/admin/billing/subscriptions', {
      tenantId: f.tenantId, planId: f.planId, frequency, agreedAmount: toPesewas(f.amount), startDate: f.startDate || null, paymentMethod: f.paymentMethod, activationPolicy: f.activationPolicy,
      setupFeeWaived: f.waiveSetup, setupWaiverNote: f.waiveSetup ? f.waiverNote.trim() || null : null,
      ...(f.pilot ? { discountBps: Math.round(pct * 100), discountUntil: f.pilotUntil, discountNote: f.pilotNote.trim() || 'Pilot price' } : {}),
    });
    onCreated(r.id);
  });
  return (
    <Modal title="New subscription" open onClose={onClose} footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="primary" disabled={act.busy || !f.tenantId || !f.planId || !clientsQuery.data || !plansQuery.data} onClick={create}>Create draft</Button></>}>
      <Msg a={act} /><QueryView query={clientsQuery} label="clients">{null}</QueryView><QueryView query={plansQuery} label="service plans">{null}</QueryView>
      <div className="space-y-3">
        <Field label="Client"><Select value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Plan"><Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}><option value="">Choose…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {ghs(p.price)} {p.billing_period}{p.annual_price != null && p.billing_period !== 'yearly' ? ` or ${ghs(p.annual_price)} yearly` : ''}</option>)}</Select></Field>
        {plan && <Field label="Billed" hint={yearlyOffered ? `Yearly is ${ghs(plan.annual_price)}: ${plan.price ? Math.round((plan.price * 12 - plan.annual_price) / plan.price * 10) / 10 : 0} months free compared with paying monthly.` : undefined}>
          <Select value={frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            <option value={plan.billing_period}>{plan.billing_period === 'monthly' ? 'Monthly' : plan.billing_period === 'quarterly' ? 'Quarterly' : 'Yearly'} · {ghs(plan.price)}</option>
            {yearlyOffered && <option value="yearly">Yearly · {ghs(plan.annual_price)}</option>}
          </Select></Field>}
        <MoneyField label="Agreed amount (GH₵)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} hint={listPrice != null ? `Leave empty to use the list price of ${ghs(listPrice)}` : undefined} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Payment method"><Select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}><option value="momo">Mobile Money</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="manual">Manual / invoice</option></Select></Field>
        </div>
        {plan?.setup_fee > 0 && <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Setup fee ({ghs(plan.setup_fee)}, first invoice only)</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.waiveSetup} onChange={(e) => setF({ ...f, waiveSetup: e.target.checked })} /> Waive the setup fee</label>
          {f.waiveSetup && <Field label="Reason shown on the invoice" className="mt-2"><Input value={f.waiverNote} maxLength={200} onChange={(e) => setF({ ...f, waiverNote: e.target.value })} /></Field>}
        </fieldset>}
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Pilot price</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pilot} onChange={(e) => setF({ ...f, pilot: e.target.checked })} /> Discount for the first months, then the full price</label>
          {f.pilot && <div className="mt-2 grid grid-cols-3 gap-3">
            <Field label="Discount (%)"><Input type="number" min={0} max={100} step={0.01} value={f.pilotPct} onChange={(e) => setF({ ...f, pilotPct: e.target.value })} /></Field>
            <Field label="Full price from" hint="Periods starting on or after this date are full price"><Input type="date" value={f.pilotUntil} onChange={(e) => setF({ ...f, pilotUntil: e.target.value })} /></Field>
            <Field label="Shown on invoices"><Input value={f.pilotNote} maxLength={200} onChange={(e) => setF({ ...f, pilotNote: e.target.value })} /></Field>
          </div>}
        </fieldset>
        <Field label="Start the service when" hint="Never starts billing until you submit and approve it"><Select value={f.activationPolicy} onChange={(e) => setF({ ...f, activationPolicy: e.target.value })}><option value="first_payment">First payment is received</option><option value="mandate">Automatic payments are authorised</option></Select></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ payments
export function Payments() {
  const list = useApi<any[]>('/v1/admin/billing/payments');
  const settlements = useApi<any[]>('/v1/admin/billing/settlements');
  const [refund, setRefund] = useState<any | null>(null);
  const [tab, setTab] = useState<'payments' | 'settlements'>('payments');
  const act = useAction();
  return (
    <div>
      <PageHeader title="Payments received" subtitle="Money received from clients, with receipts, refunds and provider payouts." />
      <Msg a={act} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'payments', label: 'Payments' }, { id: 'settlements', label: 'Provider payouts' }]} />
      {tab === 'payments' ? (
        <Card pad={false}>
          <QueryView query={list} label="billing records"><Table rows={list.data} rowKey={(r) => r.id} empty="No payments yet"
            columns={[{ header: 'Receipt', cell: (r) => <>{r.receipt_number}{r.sandbox && <> <Badge tone="warn">sandbox</Badge></>}</> }, { header: 'Client', cell: (r) => r.client }, { header: 'Received', cell: (r) => when(r.received_at) }, { header: 'Invoices', cell: (r) => r.invoices }, { header: 'Method', cell: (r) => <>{label(r.method)}<div className="text-xs text-slate-500">{r.provider}</div></> }, { header: 'Amount', align: 'right', cell: (r) => ghs(r.amount) }, { header: 'Refunded', align: 'right', cell: (r) => (r.amount_refunded ? ghs(r.amount_refunded) : '') }, { header: 'Settlement', cell: (r) => (r.settlement_id ? <Badge tone="good">paid out</Badge> : <Badge>awaiting</Badge>) },
              { header: '', align: 'right', cell: (r) => <div className="flex justify-end gap-1"><Button size="sm" onClick={() => act.run(() => openDocument(`/v1/admin/billing/payments/${r.id}/receipt`))}>Receipt</Button>{r.amount > r.amount_refunded && <Button size="sm" onClick={() => setRefund(r)}>Refund</Button>}</div> }]} /></QueryView>
        </Card>
      ) : (
        <>
          <Alert tone="info" className="mb-3">Provider payouts are recorded when a provider's settlement report arrives. Mansora compares each payout against the payments it expects and flags any difference under Collections → Needs review.</Alert>
          <Card pad={false}><QueryView query={settlements} label="billing records"><Table rows={settlements.data} empty="No payouts recorded" rowKey={(r) => r.id} columns={[{ header: 'Paid out', cell: (r) => day(r.settled_on) }, { header: 'Provider', cell: (r) => r.provider }, { header: 'Reference', cell: (r) => r.reference }, { header: 'Payments', align: 'right', cell: (r) => r.payments }, { header: 'Gross', align: 'right', cell: (r) => ghs(r.gross) }, { header: 'Fees', align: 'right', cell: (r) => ghs(r.fees) }, { header: 'Net', align: 'right', cell: (r) => ghs(r.net) }]} /></QueryView></Card>
        </>
      )}
      {refund && <RefundModal payment={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); list.reload(); }} />}
    </div>
  );
}

function RefundModal({ payment, onClose, onDone }: { payment: any; onClose: () => void; onDone: () => void }) {
  const left = payment.amount - payment.amount_refunded;
  const [amount, setAmount] = useState((left / 100).toFixed(2));
  const [viaProvider, setVia] = useState(!payment.sandbox && payment.provider !== 'manual');
  return (
    <ResolveModal title={`Refund ${payment.receipt_number}`} button="Refund" onClose={onClose} onSave={async (reason) => { const a = toPesewas(amount); if (!a || a > left) throw new Error(`Enter an amount up to ${ghs(left)}`); await api('POST', `/v1/admin/billing/payments/${payment.id}/refund`, { amount: a, reason, viaProvider }); onDone(); }}>
      <MoneyField label={`Refund amount (up to ${ghs(left)})`} value={amount} onChange={setAmount} />
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={viaProvider} onChange={(e) => setVia(e.target.checked)} />Send the refund back through the payment provider</label>
    </ResolveModal>
  );
}

// ------------------------------------------------------------------ settings
export function PaymentSettings() {
  const providers = useApi<any>('/v1/admin/billing/providers');
  const settings = useApi<any>('/v1/admin/billing/settings');
  const accounts = useApi<any[]>('/v1/admin/billing/merchant-accounts');
  const [s, setS] = useState<any | null>(null);
  const [lastSettings, setLastSettings] = useState<any>(null);
  useEffect(() => { if (settings.data) setLastSettings(settings.data); }, [settings.data]);
  const act = useAction();
  const cur = s ?? settings.data ?? lastSettings;
  useUnsavedChanges(s != null, 'Billing settings');
  const jobs = useAction();
  if (!providers.data || !cur) return <><PageHeader title="Payment settings" /><QueryView query={providers} label="payment providers">{null}</QueryView><QueryView query={settings} label="billing settings">{null}</QueryView></>;
  const payload = () => ({ ...cur, ...Object.fromEntries(['invoiceLeadDays', 'defaultDueDays', 'maxAttempts', 'retryDays'].map((k) => [k, Number(cur[k])])), reminders: { ...cur.reminders, offsets: Object.fromEntries(Object.entries(cur.reminders.offsets).map(([k, v]) => [k, Number(v)])) }, ...(cur.standing ? { standing: Object.fromEntries(Object.entries(cur.standing).map(([k, v]) => [k, Number(v)])) } : {}) });
  const set = (patch: any) => setS({ ...cur, ...patch });
  const STEPS: [string, string][] = [['upcoming', 'Upcoming payment (days before due, negative)'], ['due', 'Due today'], ['overdue_1', 'First overdue notice (days after due)'], ['overdue_2', 'Second overdue notice'], ['escalate', 'Escalate to Mansora admin'], ['review', 'Flag for service review']];
  return (
    <div className="space-y-4">
      <PageHeader title="Payment settings" subtitle="Payment providers, invoice rules, reminders and the details printed on invoices." />
      <Card title="Payment providers" pad={false}>
        <Table rows={providers.data.providers} rowKey={(r: any) => r.id} columns={[
          { header: 'Provider', cell: (r: any) => <>{r.label}{r.sandbox && <> <Badge tone="warn">test only</Badge></>}</> },
          { header: 'Status', cell: (r: any) => (r.configured ? <Badge tone="good">connected</Badge> : <Badge tone="bad">blocked</Badge>) },
          { header: 'Can do', cell: (r: any) => <span className="text-xs">{[r.capabilities.oneOff && 'one-off payments', r.capabilities.recurringCard && 'recurring card', r.capabilities.recurringMomo && 'recurring Mobile Money', r.capabilities.refunds && 'refunds'].filter(Boolean).join(', ') || 'nothing yet'}</span> },
          { header: 'Needs', cell: (r: any) => <span className="text-xs text-slate-700">{r.blocker ?? (r.verifiedAgainstProvider ? '' : 'Not yet verified against the live provider')}</span> },
        ]} />
      </Card>
      <Alert tone={providers.data.email.configured ? 'good' : 'warn'}>Email: {providers.data.email.configured ? 'connected' : providers.data.email.blocker}</Alert>
      {lastSettings && (settings.loading || settings.error) && <QueryView query={settings} label="updated billing settings">{null}</QueryView>}
      <Card title="Invoice and collection rules">
        <Msg a={act} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Invoice created (days before renewal)"><Input type="number" required min={0} max={60} step={1} value={cur.invoiceLeadDays} onChange={(e) => set({ invoiceLeadDays: e.target.value })} /></Field>
          <Field label="Payment terms (days)"><Input type="number" required min={0} max={120} step={1} value={cur.defaultDueDays} onChange={(e) => set({ defaultDueDays: e.target.value })} /></Field>
          <Field label="Automatic attempts"><Input type="number" required min={1} max={10} step={1} value={cur.maxAttempts} onChange={(e) => set({ maxAttempts: e.target.value })} /></Field>
          <Field label="Days between attempts"><Input type="number" required min={1} max={30} step={1} value={cur.retryDays} onChange={(e) => set({ retryDays: e.target.value })} /></Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.reminders.enabled} onChange={(e) => set({ reminders: { ...cur.reminders, enabled: e.target.checked } })} />Send payment reminders automatically</label>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">{STEPS.map(([k, text]) => <Field key={k} label={text}><Input type="number" required min={-30} max={180} step={1} value={cur.reminders.offsets[k]} onChange={(e) => set({ reminders: { ...cur.reminders, offsets: { ...cur.reminders.offsets, [k]: e.target.value } } })} /></Field>)}</div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">When an invoice stays unpaid</h3>
        {cur.standing && <div className="grid gap-3 sm:grid-cols-3">{([['noticeAfterDays', 'Remind the client (days late)'], ['warnAfterDays', 'Warn the client (days late)'], ['restrictAfterDays', 'Pause reports (days late, at least 21)']] as const).map(([k, text]) => <Field key={k} label={text}><Input type="number" required min={k === 'restrictAfterDays' ? 21 : 0} max={365} step={1} value={cur.standing[k]} onChange={(e) => set({ standing: { ...cur.standing, [k]: e.target.value } })} /></Field>)}</div>}
        <Alert tone="info" className="mt-3">Selling never stops. After the last threshold only the client's management reports and report exports pause until the invoice is paid; stock, customers, backups, the full data export and paying Mansora keep working. Disputed invoices never escalate, a warning always comes at least 7 days before reports pause, and you can agree a payment arrangement per client under Collections → Manage.</Alert>
        <h3 className="mb-2 mt-4 text-sm font-semibold">Printed on invoices</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {([['name', 'Business name'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Billing email'], ['tin', 'Tax identification number']] as const).map(([k, text]) => <Field key={k} label={text}><Input required={k === 'name'} type={k === 'email' ? 'email' : 'text'} maxLength={{ name: 120, address: 300, phone: 40, email: 160, tin: 40 }[k]} value={cur.issuer[k]} onChange={(e) => set({ issuer: { ...cur.issuer, [k]: e.target.value } })} /></Field>)}
          <Field label="Payment instructions"><Textarea maxLength={600} value={cur.issuer.paymentInstructions} onChange={(e) => set({ issuer: { ...cur.issuer, paymentInstructions: e.target.value } })} /></Field>
        </div>
        <div className="mt-3"><Button variant="primary" disabled={act.busy || !s} onClick={() => act.run(async () => { await api('PUT', '/v1/admin/billing/settings', payload()); settings.reload(); setS(null); }, 'Settings saved')}>Save settings</Button></div>
      </Card>
      <Card title="Mansora's settlement accounts" pad={false}>
        <QueryView query={accounts} label="billing records"><Table rows={accounts.data} empty="No accounts recorded. Add one once the provider has verified Mansora's business." rowKey={(r: any) => r.id} columns={[{ header: 'Provider', cell: (r: any) => r.provider }, { header: 'Name', cell: (r: any) => r.display_name }, { header: 'Status', cell: (r: any) => <Status s={r.status} /> }, { header: 'Settles to', cell: (r: any) => r.settlement_note }]} /></QueryView>
        <MerchantAccountForm onSaved={accounts.reload} />
      </Card>
      <Card title="Run now">
        <p className="mb-2 text-sm text-slate-600">These run automatically every 15 minutes. Use them after changing settings or to check the result immediately.</p>
        <Msg a={jobs} />
        <div className="flex flex-wrap gap-2">{([['cycle', 'Create due invoices and collect'], ['reminders', 'Send due reminders'], ['reconcile', 'Check pending payments with providers']] as const).map(([k, text]) => <Button key={k} disabled={jobs.busy} onClick={() => jobs.run(async () => { await api('POST', `/v1/admin/billing/run/${k}`, {}); }, `${text}: done`)}>{text}</Button>)}</div>
      </Card>
    </div>
  );
}

function MerchantAccountForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ provider: 'paystack', displayName: '', status: 'pending_verification', settlementNote: '' });
  const act = useAction();
  useUnsavedChanges(!!f.displayName || !!f.settlementNote || f.provider !== 'paystack' || f.status !== 'pending_verification', 'Settlement account');
  return (
    <div className="border-t border-slate-200 p-4">
      <Msg a={act} />
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Provider"><Select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="paystack">Paystack</option><option value="hubtel">Hubtel</option><option value="bank">Bank</option></Select></Field>
        <Field label="Account name"><Input required maxLength={120} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="pending_verification">Pending verification</option><option value="active">Active</option><option value="disabled">Disabled</option></Select></Field>
        <Field label="Settles to (no account numbers)"><Input maxLength={300} value={f.settlementNote} onChange={(e) => setF({ ...f, settlementNote: e.target.value })} /></Field>
        <div className="flex items-end"><Button disabled={act.busy || !f.displayName.trim()} onClick={() => act.run(async () => { await api('POST', '/v1/admin/billing/merchant-accounts', f); setF({ provider: 'paystack', displayName: '', status: 'pending_verification', settlementNote: '' }); onSaved(); }, 'Saved')}>Save account</Button></div>
      </div>
    </div>
  );
}
