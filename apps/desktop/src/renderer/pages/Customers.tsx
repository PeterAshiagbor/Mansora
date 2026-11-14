import { ShareWhatsApp } from '../components/ShareWhatsApp';
import { debtMessage, statementMessage } from '../customer-sharing';
import { tableReportHtml } from '../reporting';
import { useState } from 'react';
import { TaskLinks } from '../components/TaskLinks';
import { CustomerFields } from '../components/CustomerPicker';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table, Textarea, QueryView } from '@mansora/ui';
import { call, dateTime, ExportButtons, METHOD, money, MoneyInput, plain, useAction, useQuery, useApp, printHtml, today, uuid } from '../lib';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const customersQuery = useQuery<any[]>('customer.list', { search });
  const { data, reload } = customersQuery;
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<string | null>(null);
  const { run, busy } = useAction();
  return (
    <div>
      <PageHeader title="Customers" subtitle="Walk-in sales do not need a customer record. Collect contact details only when they are needed." actions={<Button variant="primary" onClick={() => setEdit({ name: '', phone: '', email: '', notes: '' })}>Add customer</Button>} />
      <TaskLinks group="customers" current="customers" />
      <Input placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 w-80" aria-label="Search customers" />
      {data?.length === 500 && <p className="mb-3 text-xs text-slate-600">Showing the first 500 matches. Refine the name or phone search to find another customer.</p>}
      <QueryView query={customersQuery} label="customers"><Card pad={false}>
        <Table rows={data} rowKey={(r) => r.id} onRowClick={(r) => setView(r.id)} empty={search.trim() ? 'No customers match. Try another name or phone number.' : 'No customers yet. Add a customer when you need contact details or credit tracking. Walk-in sales do not require one.'}
          columns={[{ header: 'Name', sortValue: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> }, { header: 'Phone', cell: (c) => c.phone ?? '' }, { header: 'Owes', sortValue: (c) => c.outstanding, align: 'right', cell: (c) => (c.outstanding ? <Badge tone="warn">{money(c.outstanding)}</Badge> : '—') },
            { header: '', align: 'right', cell: (c) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setEdit(c); }}>Edit</Button> }]} />
      </Card></QueryView>
      {edit && (
        <Modal title={edit.id ? 'Edit customer' : 'Add customer'} open onClose={() => setEdit(null)}
          footer={<><Button dismiss onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={busy || !edit.name.trim()} onClick={() => run(async () => { await call('customer.save', { id: edit.id, name: edit.name, phone: edit.phone, email: edit.email ?? '', notes: edit.notes }); setEdit(null); reload(); }, 'Customer saved')}>Save</Button></>}>
          <CustomerFields value={{ name: edit.name ?? '', phone: edit.phone ?? '', email: edit.email ?? '', notes: edit.notes ?? '' }} onChange={(v) => setEdit({ ...edit, ...v })} />
        </Modal>
      )}
      {view && <CustomerView id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function CustomerView({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useApp();
  const { run, busy } = useAction();
  const customerDetail = useQuery<any>('customer.get', { id });
  const { data } = customerDetail;
  if (!data) return <Modal title="Customer details" open trackChanges={false} onClose={onClose}><QueryView query={customerDetail} label="customer details">{null}</QueryView></Modal>;
  const owed = data.credit.reduce((a: number, c: any) => a + c.outstanding_balance, 0);
  return (
    <Modal title={data.customer.name} open onClose={onClose} wide footer={<><ShareWhatsApp phone={data.customer.phone} message={statementMessage(state.business.name, data, today())} label="Share statement on WhatsApp" /><Button disabled={busy} onClick={() => run(async () => printHtml(tableReportHtml({ title: `Current customer statement — ${data.customer.name} — ${today()}`, businessName: state.business.name, columns: ['Receipt', 'Credit given', 'Still owed', 'Due date'], rows: [...data.credit.map((c: any) => [c.receipt_no, plain(c.original_balance), plain(c.outstanding_balance), c.due_date ?? 'Not set']), ['TOTAL CURRENTLY OWED', '', plain(owed), 'Current position; not historical']] })))}>Print customer statement</Button></>}>
      <p className="mb-3 text-sm text-slate-600">{[data.customer.phone, data.customer.email].filter(Boolean).join(' · ') || 'No contact details'} · Currently owes <strong>{money(owed)}</strong></p>
      <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Credit</h4>
      <Table rows={data.credit} empty="No credit sales" columns={[{ header: 'Receipt', cell: (r: any) => r.receipt_no }, { header: 'Date', cell: (r: any) => dateTime(r.created_at) }, { header: 'Credit given', align: 'right', cell: (r: any) => money(r.original_balance) }, { header: 'Still owed', align: 'right', cell: (r: any) => money(r.outstanding_balance) }, { header: 'Due', cell: (r: any) => r.due_date ?? '' }]} />
      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">Repayments</h4>
      <Table rows={data.repayments} empty="No repayments yet" columns={[{ header: 'Date', cell: (r: any) => dateTime(r.created_at) }, { header: 'Method', cell: (r: any) => METHOD[r.method] }, { header: 'Received by', cell: (r: any) => r.received_by_name }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.amount) }]} />
      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">Purchases</h4>
      <Table rows={data.sales} empty="No purchases yet" columns={[{ header: 'Receipt', cell: (r: any) => r.receipt_no }, { header: 'Date', cell: (r: any) => dateTime(r.created_at) }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} />
    </Modal>
  );
}

export function CreditPage() {
  const { state } = useApp();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const creditQuery = useQuery<any>('credit.list', { status });
  const { data, reload } = creditQuery;
  const [repay, setRepay] = useState<any | null>(null);
  return (
    <div>
      <PageHeader title="Credit & repayments" subtitle="Money customers still owe from credit sales."
        actions={<ExportButtons title="Customer credit" columns={['Customer', 'Phone', 'Receipt', 'Credit given', 'Still owed', 'Due date', 'Status']} rows={() => (data?.accounts ?? []).map((a: any) => [a.customer_name, a.customer_phone ?? '', a.receipt_no, plain(a.original_balance), plain(a.outstanding_balance), a.due_date ?? '', a.overdue ? 'Overdue' : a.status])} />} />
      <TaskLinks group="customers" current="credit" />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Total outstanding" value={money(data?.totalOutstanding)} tone={data?.totalOutstanding ? 'warn' : 'default'} />
        <Stat label="Overdue" value={money(data?.totalOverdue)} tone={data?.totalOverdue ? 'bad' : 'default'} />
        <Stat label="Open credit records" value={data?.accounts.filter((a: any) => a.status === 'open').length ?? '…'} />
      </div>
      <div className="mb-3 flex gap-2 no-print"><Button size="sm" variant={status === 'open' ? 'primary' : 'secondary'} onClick={() => setStatus('open')}>Still owing</Button><Button size="sm" variant={status === 'all' ? 'primary' : 'secondary'} onClick={() => setStatus('all')}>All, including settled</Button></div>
      <QueryView query={creditQuery} label="customer credit"><Card pad={false}>
        <Table rows={data?.accounts} rowKey={(r: any) => r.id} empty="Nobody owes anything"
          columns={[
            { header: 'Customer', cell: (a: any) => <><span className="font-medium">{a.customer_name}</span>{a.customer_phone && <span className="text-slate-500"> · {a.customer_phone}</span>}</> },
            { header: 'Receipt', cell: (a: any) => a.receipt_no },
            { header: 'Credit given', align: 'right', cell: (a: any) => money(a.original_balance) },
            { header: 'Still owed', align: 'right', cell: (a: any) => <strong>{money(a.outstanding_balance)}</strong> },
            { header: 'Due', cell: (a: any) => (a.overdue ? <Badge tone="bad">Overdue {a.due_date}</Badge> : a.status === 'settled' ? <Badge tone="good">Settled</Badge> : a.due_date ?? '') },
            { header: '', align: 'right', cell: (a: any) => a.status === 'open' && <div className="flex flex-wrap justify-end gap-2"><ShareWhatsApp phone={a.customer_phone} message={debtMessage(state.business.name, a)} label="Review debt reminder" /><Button size="sm" variant="primary" onClick={() => setRepay(a)}>Receive payment</Button></div> },
          ]} />
      </Card></QueryView>
      <Card title="Recent repayments" pad={false} className="mt-4">
        <Table rows={data?.recentRepayments} empty="No repayments yet" columns={[{ header: 'Date', cell: (r: any) => dateTime(r.created_at) }, { header: 'Customer', cell: (r: any) => r.customer_name }, { header: 'Method', cell: (r: any) => METHOD[r.method] }, { header: 'Received by', cell: (r: any) => r.received_by_name }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.amount) }]} />
      </Card>
      {repay && <RepayModal account={repay} onClose={() => setRepay(null)} onDone={() => { setRepay(null); reload(); }} />}
    </div>
  );
}

function RepayModal({ account, onClose, onDone }: { account: any; onClose: () => void; onDone: () => void }) {
  const [id] = useState(uuid);
  const [amount, setAmount] = useState<number | null>(account.outstanding_balance);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const { run, busy } = useAction();
  const tooMuch = (amount ?? 0) > account.outstanding_balance;
  return (
    <Modal title={`Repayment from ${account.customer_name}`} open onClose={onClose}
      footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !amount || tooMuch} onClick={() => run(async () => { await call('credit.repay', { id, creditAccountId: account.id, amount, method, reference: reference || null }); onDone(); }, 'Repayment recorded')}>Record repayment</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Owes <strong>{money(account.outstanding_balance)}</strong> on receipt {account.receipt_no}.</p>
        <Field label="Amount received (GHS)" error={tooMuch ? 'This is more than the amount owed' : null}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <div className="m-payment-summary" aria-live="polite"><p className="text-sm text-slate-600">Balance after this repayment</p><p className="mt-2 text-2xl font-semibold">{amount != null && amount > 0 && !tooMuch ? money(account.outstanding_balance - amount) : 'Enter a valid repayment'}</p><p className="mt-2 text-xs text-slate-600">The balance changes only after the repayment is recorded.</p></div>
        <Field label="Paid by" hint={method === 'cash' ? 'Cash goes into your till and is counted in your shift.' : 'Recorded only. Confirm the money has arrived.'}><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="card">Card</option></Select></Field>
        {method !== 'cash' && <Field label="Reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}
