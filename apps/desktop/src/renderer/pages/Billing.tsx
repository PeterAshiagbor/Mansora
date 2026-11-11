import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table, Textarea } from '@mansora/ui';
import { StandingNotice } from '../components/StandingNotice';
import { call, dateTime, money, openExternal, printHtml, savePdf, useAction, useApp, useQuery } from '../lib';

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral' | 'info'> = { active: 'good', paid: 'good', sent: 'info', trial: 'info', partially_paid: 'warn', overdue: 'bad', payment_failed: 'bad', payment_due: 'warn', paused: 'neutral', cancelled: 'neutral', awaiting_approval: 'info', pending: 'warn', failed: 'bad', disputed: 'warn' };
const label = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');
const Status = ({ s }: { s?: string | null }) => <Badge tone={TONE[s ?? ''] ?? 'neutral'}>{label(s)}</Badge>;
const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '—');

export function BillingPage() {
  const { can } = useApp();
  const manage = can('billing.manage');
  const q = useQuery<any>('billing.summary');
  const { run, busy } = useAction();
  const [setup, setSetup] = useState(false);
  const [cancelAuth, setCancelAuth] = useState(false);
  const [cancelSub, setCancelSub] = useState(false);
  const [waiting, setWaiting] = useState(false);
  // Refresh on return from the provider only while no editable dialog is open.
  useEffect(() => {
    const onFocus = () => { if (waiting && !setup && !cancelAuth && !cancelSub) { q.reload(); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [waiting, setup, cancelAuth, cancelSub, q.reload]);
  if (q.error) return <><PageHeader title="Billing & payments" /><Alert tone="warn">{q.error}</Alert><Button className="mt-3" onClick={q.reload}>Try again</Button></>;
  const d = q.data;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const sub = d.subscription;
  const open = async (fn: () => Promise<{ url: string }>) => {
    const r = await run(fn);
    if (!r) return false;
    const opened = await run(async () => { await openExternal(r.url); return true; });
    if (opened) setWaiting(true);
    return !!opened;
  };
  const document = (kind: 'invoice' | 'receipt', id: string, how: 'print' | 'pdf') =>
    run(async () => {
      const r = await call<{ html: string; number: string }>('billing.document', { kind, id });
      if (how === 'print') await printHtml(r.html); else await savePdf(r.html, `${r.number}.pdf`);
    });
  return (
    <div>
      <PageHeader title="Billing & payments" subtitle="Your Mansora subscription, what is due, and your receipts." actions={<Button size="sm" onClick={q.reload}>Refresh</Button>} />
      <StandingNotice onBillingPage />
      {d.offline && <Alert tone="warn" className="mb-4">You are offline. This is what Mansora last told this computer, on {dateTime(d.fetchedAt)}. Payments and changes need an internet connection.</Alert>}
      {waiting && !d.offline && <Alert tone="info" className="mb-4">Finished paying in your browser? Come back to this window and it will update. Banks and Mobile Money can take a minute to confirm. <Button size="sm" className="ml-2" onClick={() => { q.reload(); setWaiting(false); }}>Check now</Button></Alert>}
      {!sub ? (
        <Card><p className="text-slate-700">You do not have a Mansora subscription yet. Contact {d.support.name}{d.support.email ? ` on ${d.support.email}` : ''}{d.support.phone ? ` or ${d.support.phone}` : ''} to get set up.</p></Card>
      ) : (
        <>
          {sub.status === 'overdue' || sub.status === 'payment_failed' ? <Alert tone="bad" className="mb-4">A payment is overdue. Please pay now to keep your service in good standing. Your system will keep working while this is sorted out.</Alert> : null}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Your plan" value={<span className="text-lg">{sub.plan ?? '—'}</span>} hint={<Status s={sub.status} />} />
            <Stat label="Fee" value={sub.amount == null ? '—' : money(sub.amount)} hint={`per ${sub.frequency?.replace('ly', '') ?? 'period'}`} />
            <Stat label="Next payment" value={d.nextPayment ? money(d.nextPayment.amount) : money(0)} hint={d.nextPayment ? `Due ${day(d.nextPayment.date)}` : sub.nextBillingDate ? `Next invoice ${day(sub.nextBillingDate)}` : 'Nothing due'} tone={d.outstanding ? 'warn' : 'good'} />
            <Stat label="Automatic payments" value={<span className="text-lg">{d.mandate?.status === 'active' ? 'On' : 'Off'}</span>} hint={d.mandate?.status === 'active' ? `${label(d.mandate.method)} ${d.mandate.masked ?? ''}` : 'You pay each invoice yourself'} />
          </div>
          {d.mandate?.sandbox && <Alert tone="warn" className="mt-3">This is a test authorisation. No real money moves.</Alert>}
          <div className="mt-4 flex flex-wrap gap-2">
            {d.nextPayment && <Button variant="primary" disabled={!manage || busy || !d.options.payNow.available || d.offline} onClick={() => open(() => call('billing.pay', { invoiceId: d.nextPayment.invoiceId }))}>Pay {money(d.nextPayment.amount)} now</Button>}
            {d.mandate?.status === 'active'
              ? <Button disabled={!manage || busy || d.offline} onClick={() => setCancelAuth(true)}>Cancel automatic payments</Button>
              : <Button disabled={!manage || busy || d.offline || (!d.options.card.available && !d.options.momo.available)} onClick={() => setSetup(true)}>Set up automatic payments</Button>}
            {!sub.cancelRequested && !['cancelled', 'expired'].includes(sub.status) && <Button disabled={!manage || busy || d.offline} onClick={() => setCancelSub(true)}>Ask to cancel my subscription</Button>}
          </div>
          {!manage && <p className="mt-2 text-sm text-slate-600">Only the owner can make payments or change how you pay.</p>}
          {d.nextPayment && !d.options.payNow.available && <p className="mt-2 text-sm text-slate-600">Online payment is not available yet. {d.options.payNow.reason} Please contact Mansora to pay.</p>}
          {!d.mandate && !d.options.card.available && !d.options.momo.available && <p className="mt-2 text-sm text-slate-600">Automatic payments are not available yet.</p>}
          {sub.cancelRequested && <Alert tone="info" className="mt-3">You asked to cancel. Mansora will confirm with you before anything changes.</Alert>}
        </>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Invoices" pad={false}>
          <Table rows={d.invoices} empty="No invoices yet" rowKey={(r: any) => r.id} columns={[
            { header: 'Number', cell: (r: any) => r.number }, { header: 'Due', cell: (r: any) => day(r.dueDate) }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }, { header: 'Owes', align: 'right', cell: (r: any) => money(r.outstanding) }, { header: 'Status', cell: (r: any) => <Status s={r.status} /> },
            { header: '', align: 'right', cell: (r: any) => <div className="flex justify-end gap-1">
              {r.canPay && manage && <Button size="sm" variant="primary" disabled={busy || d.offline || !d.options.payNow.available} onClick={() => open(() => call('billing.pay', { invoiceId: r.id }))}>Pay</Button>}
              <Button size="sm" disabled={busy || d.offline} onClick={() => document('invoice', r.id, 'pdf')}>Save PDF</Button>
              <Button size="sm" disabled={busy || d.offline} onClick={() => document('invoice', r.id, 'print')}>Print</Button></div> },
          ]} />
        </Card>
        <Card title="Receipts" pad={false}>
          <Table rows={d.payments} empty="No payments yet" rowKey={(r: any) => r.id} columns={[
            { header: 'Receipt', cell: (r: any) => <>{r.receiptNumber}{r.sandbox && <> <Badge tone="warn">test</Badge></>}</> }, { header: 'Paid', cell: (r: any) => dateTime(r.receivedAt) }, { header: 'Method', cell: (r: any) => label(r.method) }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.amount) },
            { header: '', align: 'right', cell: (r: any) => <div className="flex justify-end gap-1"><Button size="sm" disabled={busy || d.offline} onClick={() => document('receipt', r.id, 'pdf')}>Save PDF</Button><Button size="sm" disabled={busy || d.offline} onClick={() => document('receipt', r.id, 'print')}>Print</Button></div> },
          ]} />
        </Card>
      </div>
      <p className="mt-4 text-sm text-slate-600">Questions about a charge? Contact {d.support.name}{d.support.email ? ` at ${d.support.email}` : ''}{d.support.phone ? ` or ${d.support.phone}` : ''}. We never ask for your card number, PIN or password on this screen: you enter those only on the payment provider's own page.</p>
      {setup && <SetupModal options={d.options} onClose={() => setSetup(false)} busy={busy} onGo={async (input) => { if (await open(() => call('billing.mandate.start', input))) setSetup(false); }} />}
      {cancelAuth && (
        <Modal title="Cancel automatic payments?" open onClose={() => setCancelAuth(false)} footer={<><Button dismiss onClick={() => setCancelAuth(false)}>Keep them</Button><Button variant="danger" disabled={busy} onClick={async () => { await run(async () => { await call('billing.mandate.cancel'); setCancelAuth(false); q.reload(); }, 'Automatic payments cancelled'); }}>Cancel automatic payments</Button></>}>
          <p className="text-sm text-slate-700">Mansora will stop taking payment automatically. You will pay each invoice yourself from this screen. Your subscription continues.</p>
        </Modal>
      )}
      {cancelSub && <CancelRequest busy={busy} onClose={() => setCancelSub(false)} onSend={async (reason) => { await run(async () => { await call('billing.cancellation.request', { reason }); setCancelSub(false); q.reload(); }, 'Request sent to Mansora'); }} />}
    </div>
  );
}

function SetupModal({ options, busy, onClose, onGo }: { options: any; busy: boolean; onClose: () => void; onGo: (input: { method: 'card' | 'momo'; phone?: string }) => void }) {
  const [method, setMethod] = useState<'card' | 'momo'>(options.card.available ? 'card' : 'momo');
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(false);
  const opt = options[method];
  return (
    <Modal title="Set up automatic payments" open onClose={onClose} footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !agree || !opt.available || (method === 'momo' && !phone.trim())} onClick={() => onGo({ method, ...(method === 'momo' ? { phone: phone.trim() } : {}) })}>Continue to secure page</Button></>}>
      <div className="space-y-3">
        <Field label="Pay with"><Select value={method} onChange={(e) => setMethod(e.target.value as 'card' | 'momo')}><option value="card" disabled={!options.card.available}>Card</option><option value="momo" disabled={!options.momo.available}>Mobile Money</option></Select></Field>
        {!opt.available && <Alert tone="warn">{opt.reason}</Alert>}
        {method === 'momo' && <Field label="Mobile Money number"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree that Mansora may collect my subscription fee automatically each period, only for the amount on each invoice you have been sent. I can cancel this at any time on this screen.</span></label>
        <p className="text-xs text-slate-600">You will approve this on the payment provider's own secure page, in your browser. Nothing is charged by setting this up unless an invoice is due.</p>
      </div>
    </Modal>
  );
}

function CancelRequest({ busy, onClose, onSend }: { busy: boolean; onClose: () => void; onSend: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Ask to cancel" open onClose={onClose} footer={<><Button dismiss onClick={onClose}>Never mind</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => onSend(reason.trim())}>Send request</Button></>}>
      <p className="mb-3 text-sm text-slate-700">This sends a request to Mansora. Nothing is cancelled until Mansora confirms with you, and any unpaid invoices still need to be settled.</p>
      <Field label="Why would you like to cancel?"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
