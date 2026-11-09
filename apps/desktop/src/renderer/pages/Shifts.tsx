import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table, Textarea } from '@mansora/ui';
import { ApprovalModal, call, DateRange, dateTime, daysAgo, ExportButtons, METHOD, money, MoneyInput, monthStart, plain, today, useAction, useApp, useQuery, uuid, type Approver } from '../lib';

export function ShiftsPage() {
  const { can } = useApp();
  const current = useQuery<any>('shift.current');
  const [range, setRange] = useState({ from: daysAgo(7), to: today() });
  const list = useQuery<any[]>('shift.list', range);
  const [closing, setClosing] = useState(false);
  const [cashMove, setCashMove] = useState(false);
  const [float, setFloat] = useState<number | null>(0);
  const [review, setReview] = useState<any | null>(null);
  const { run, busy } = useAction();
  const reload = () => { current.reload(); list.reload(); };
  const t = current.data?.totals;
  return (
    <div>
      <PageHeader title="Cashier shifts" subtitle="Open a shift before selling, close it when you hand over the till." />
      {current.data === null && (
        <Card title="You have no open shift" className="mb-4 max-w-xl">
          <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (float != null) run(async () => { await call('shift.open', { openingFloat: float }); reload(); }, 'Shift opened'); }}>
            <Field label="Opening cash float (GHS)" className="flex-1"><MoneyInput value={float} onChange={setFloat} /></Field>
            <Button type="submit" variant="primary" disabled={busy || float == null}>Open shift</Button>
          </form>
        </Card>
      )}
      {current.data && t && (
        <Card title={`Your open shift · since ${dateTime(current.data.shift.opened_at)}`} className="mb-4" actions={<><Button size="sm" onClick={() => setCashMove(true)}>Cash in / out</Button><Button size="sm" variant="primary" onClick={() => setClosing(true)}>Close shift</Button></>}>
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
            <Stat label="Opening float" value={money(t.openingFloat)} />
            <Stat label="Cash sales" value={money(t.cashSales)} hint={`${t.salesCount} sale(s)`} />
            <Stat label="Cash repayments" value={money(t.cashRepayments)} />
            <Stat label="Cash refunds" value={`−${plain(t.cashRefunds)}`} />
            <Stat label="Other cash out / in" value={`−${plain(t.cashOut + t.cashExpenses)} / +${plain(t.cashIn)}`} />
            <Stat label="Cash expected in till" value={money(t.expectedCash)} tone="good" hint={`Non-cash sales ${money(t.nonCashSales)}`} />
          </div>
        </Card>
      )}
      <div className="mb-3"><DateRange {...range} onChange={setRange} /></div>
      <Card pad={false}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="No shifts in this period"
          columns={[
            { header: 'Cashier', cell: (s) => s.cashier_name },
            { header: 'Opened', cell: (s) => dateTime(s.opened_at) },
            { header: 'Closed', cell: (s) => dateTime(s.closed_at) },
            { header: 'Sales', align: 'right', cell: (s) => money(s.totals.salesTotal) },
            { header: 'Expected cash', align: 'right', cell: (s) => money(s.expected_cash ?? s.totals.expectedCash) },
            { header: 'Counted', align: 'right', cell: (s) => money(s.counted_cash) },
            { header: 'Difference', align: 'right', cell: (s) => (s.variance == null ? '' : s.variance === 0 ? <Badge tone="good">Balanced</Badge> : <Badge tone={s.variance < 0 ? 'bad' : 'warn'}>{s.variance < 0 ? 'Short ' : 'Over '}{plain(Math.abs(s.variance))}</Badge>) },
            { header: 'Status', cell: (s) => (s.status === 'open' ? <Badge tone="info">Open</Badge> : s.status === 'reviewed' ? <Badge tone="good">Signed off by {s.reviewed_by_name}</Badge> : can('shift.review') ? <Button size="sm" onClick={() => setReview(s)}>Sign off</Button> : <Badge>Awaiting sign-off</Badge>) },
          ]} />
      </Card>
      {closing && t && <CloseModal expected={t.expectedCash} onClose={() => setClosing(false)} onDone={() => { setClosing(false); reload(); }} />}
      {cashMove && <CashMoveModal onClose={() => setCashMove(false)} onDone={() => { setCashMove(false); reload(); }} />}
      {review && <ReviewModal shift={review} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); }} />}
    </div>
  );
}

function CloseModal({ expected, onClose, onDone }: { expected: number; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const { run, busy } = useAction();
  const diff = counted == null ? null : counted - expected;
  return (
    <Modal title="Close shift" open onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || counted == null || (diff !== 0 && !notes.trim())} onClick={() => run(async () => { await call('shift.close', { countedCash: counted, notes: notes || null }); onDone(); }, 'Shift closed')}>Close shift</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Count all the cash in the till, including the float, and enter the total.</p>
        <Field label="Cash counted (GHS)"><MoneyInput value={counted} onChange={setCounted} autoFocus className="!text-lg" /></Field>
        <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"><span>Expected in till</span><strong className="tabular-nums">{money(expected)}</strong></div>
        {diff != null && <Alert tone={diff === 0 ? 'good' : 'warn'}>{diff === 0 ? 'The till balances.' : diff < 0 ? `The till is short by ${money(-diff)}.` : `The till is over by ${money(diff)}.`}</Alert>}
        <Field label={diff ? 'Explain the difference (required)' : 'Notes (optional)'}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CashMoveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { can } = useApp();
  const [direction, setDirection] = useState('out');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState(false);
  const { run, busy } = useAction();
  const submit = (approver?: Approver) => {
    if (!can('shift.review') && !approver) return setApproval(true);
    run(async () => { await call('shift.cashMovement', { direction, amount, reason, approver }); onDone(); }, 'Cash movement recorded');
  };
  return (
    <>
      <Modal title="Cash in / out of the till" open={!approval} onClose={onClose}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !amount || !reason.trim()} onClick={() => submit()}>Record</Button></>}>
        <div className="space-y-3">
          <Field label="Type"><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="out">Cash taken out (e.g. banked, given to owner)</option><option value="in">Cash put in (e.g. extra change)</option></Select></Field>
          <Field label="Amount (GHS)"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
      <ApprovalModal open={approval} reason="Moving cash in or out of the till needs approval." onCancel={() => setApproval(false)} onApprove={(a) => { setApproval(false); submit(a); }} />
    </>
  );
}

function ReviewModal({ shift, onClose, onDone }: { shift: any; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const { run, busy } = useAction();
  const t = shift.totals;
  return (
    <Modal title={`Sign off shift: ${shift.cashier_name}`} open onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => run(async () => { await call('shift.review', { id: shift.id, reviewNotes: notes || null }); onDone(); }, 'Shift signed off')}>Sign off</Button></>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {[['Opening float', t.openingFloat], ['Cash sales', t.cashSales], ['Cash repayments', t.cashRepayments], ['Cash in', t.cashIn], ['Cash refunds', -t.cashRefunds], ['Cash expenses', -t.cashExpenses], ['Cash out', -t.cashOut], ['Expected', shift.expected_cash], ['Counted', shift.counted_cash], ['Difference', shift.variance]].map(([k, v]) => (
          <div key={k as string} className="contents"><dt className="text-slate-600">{k}</dt><dd className="text-right tabular-nums">{money(v as number)}</dd></div>
        ))}
      </dl>
      {shift.notes && <p className="mt-3 text-sm"><span className="text-slate-500">Cashier's note:</span> {shift.notes}</p>}
      <Field label="Manager's note" className="mt-3"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

const CATEGORIES = ['Rent', 'Electricity', 'Water', 'Transport', 'Salaries', 'Airtime & data', 'Repairs', 'Supplies', 'Other'];
export function ExpensesPage() {
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const { data, reload } = useQuery<any>('expense.list', range);
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Running costs of the business. These are separate from the cost of the goods you sell."
        actions={<><ExportButtons title="Expenses" columns={['Date', 'Category', 'Description', 'Paid by', 'Receipt ref', 'Recorded by', 'Amount']} rows={() => (data?.rows ?? []).map((e: any) => [e.expense_date, e.category, e.description, METHOD[e.payment_method], e.receipt_reference ?? '', e.created_by_name, plain(e.amount)])} /><Button variant="primary" onClick={() => setAdding(true)}>Record expense</Button></>} />
      <div className="mb-3"><DateRange {...range} onChange={setRange} /></div>
      <div className="mb-4 grid gap-4 xl:grid-cols-4">
        <Stat label="Total expenses" value={money(data?.total)} />
        <Card title="By category" pad={false}><Table rows={data?.byCategory} empty="—" columns={[{ header: 'Category', cell: (r: any) => r.key }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} /></Card>
        <Card title="By payment method" pad={false}><Table rows={data?.byMethod} empty="—" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.key] }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} /></Card>
        <Card title="By month" pad={false}><Table rows={data?.byMonth} empty="—" columns={[{ header: 'Month', cell: (r: any) => r.key }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} /></Card>
      </div>
      <Card pad={false}>
        <Table rows={data?.rows} rowKey={(r: any) => r.id} empty="No expenses in this period"
          columns={[{ header: 'Date', cell: (e: any) => e.expense_date }, { header: 'Category', cell: (e: any) => e.category }, { header: 'Description', cell: (e: any) => e.description }, { header: 'Paid by', cell: (e: any) => <>{METHOD[e.payment_method]}{e.shift_id && <> <Badge>from till</Badge></>}</> }, { header: 'Recorded by', cell: (e: any) => e.created_by_name }, { header: 'Amount', align: 'right', cell: (e: any) => money(e.amount) }]} />
      </Card>
      {adding && <ExpenseModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function ExpenseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [id] = useState(uuid);
  const [f, setF] = useState({ category: CATEGORIES[0], description: '', amount: null as number | null, expenseDate: today(), paymentMethod: 'cash', receiptReference: '', paidFromTill: false });
  const { run, busy } = useAction();
  return (
    <Modal title="Record expense" open onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !f.amount || !f.description.trim()} onClick={() => run(async () => { await call('expense.create', { id, ...f, paidFromTill: f.paidFromTill && f.paymentMethod === 'cash' }); onDone(); }, 'Expense recorded')}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={f.expenseDate} max={today()} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></Field>
        <Field label="Description" className="col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} autoFocus /></Field>
        <Field label="Amount (GHS)"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Paid by"><Select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="card">Card</option></Select></Field>
        <Field label="Receipt reference (optional)" className="col-span-2"><Input value={f.receiptReference} onChange={(e) => setF({ ...f, receiptReference: e.target.value })} /></Field>
        {f.paymentMethod === 'cash' && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.paidFromTill} onChange={(e) => setF({ ...f, paidFromTill: e.target.checked })} /> Paid with cash from my till (reduces my expected cash)</label>}
      </div>
    </Modal>
  );
}
