import { ShareWhatsApp } from '../components/ShareWhatsApp';
import { receiptMessage } from '../customer-sharing';
import { useEffect, useState } from 'react';
import { refundLineAmount } from '@mansora/domain';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Textarea, QueryView } from '@mansora/ui';
import { ApprovalModal, call, DateRange, dateTime, ExportButtons, METHOD, money, plain, printHtml, savePdf, today, useAction, useApp, useQuery, uuid, type Approver } from '../lib';

export function SalesPage({ openId }: { openId?: string }) {
  const [range, setRange] = useState({ from: today(), to: today() });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const salesQuery = useQuery<any[]>('sale.list', { ...range, search });
  const { data, reload } = salesQuery;
  return (
    <div>
      <PageHeader title="Sales history" subtitle="Completed sales cannot be changed. Use a refund to correct a sale."
        actions={<ExportButtons disabled={!data} title={`Sales ${range.from} to ${range.to} — loaded matches`} columns={['Receipt', 'Date', 'Cashier', 'Customer', 'Paid by', 'Total', 'Refunded']} rows={() => (data ?? []).map((r) => [r.receipt_no, dateTime(r.created_at), r.cashier_name, r.customer_name ?? '', r.methods, plain(r.total), plain(r.refunded)])} />} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DateRange {...range} onChange={setRange} />
        <Input placeholder="Receipt number or customer" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 no-print" aria-label="Search sales" />
      </div>
      {data?.length === 300 && <p className="mb-3 text-xs text-slate-600">Showing the latest 300 matching sales. Narrow the dates or search to find an older receipt. Use Reports for complete period totals.</p>}
      <QueryView query={salesQuery} label="sales history"><Card pad={false}>
        <Table rows={data} empty="No sales in this period" onRowClick={(r) => setOpen(r.id)} rowKey={(r) => r.id}
          columns={[
            { header: 'Receipt', cell: (r) => <span className="font-medium">{r.receipt_no}</span> },
            { header: 'Date', sortValue: (r) => r.created_at, cell: (r) => dateTime(r.created_at) },
            { header: 'Cashier', cell: (r) => r.cashier_name },
            { header: 'Customer', cell: (r) => r.customer_name ?? '—' },
            { header: 'Paid by', cell: (r) => String(r.methods ?? '').split(',').map((m: string) => METHOD[m] ?? m).join(' + ') },
            { header: 'Total', sortValue: (r) => r.total, align: 'right', cell: (r) => money(r.total) },
            { header: 'Refunded', align: 'right', cell: (r) => (r.refunded ? <Badge tone="warn">{money(r.refunded)}</Badge> : '') },
          ]} />
      </Card></QueryView>
      {open && <SaleDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function SaleDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useApp();
  const saleQuery = useQuery<any>('sale.get', { id });
  const { data, reload } = saleQuery;
  const [refunding, setRefunding] = useState(false);
  const { run, busy } = useAction();
  const receipt = async () => call<{ html: string; receiptNo: string }>('sale.receipt', { id, reprint: true });
  if (!data) return <Modal title="Sale details" open trackChanges={false} onClose={onClose}><QueryView query={saleQuery} label="sale details">{null}</QueryView></Modal>;
  const { sale, items, payments, refunds, credit } = data;
  const refundable = items.some((i: any) => i.refunded_quantity < i.quantity);
  return (
    <Modal trackChanges={false} title={`Receipt ${sale.receipt_no}`} open onClose={onClose} wide
      footer={<>
        {refundable && <Button variant="danger" onClick={() => setRefunding(true)}>Refund…</Button>}
        <ShareWhatsApp phone={sale.customer_phone} message={receiptMessage(state.business.name, data)} label="Share receipt on WhatsApp" />
        <Button disabled={busy} onClick={() => run(async () => { const r = await receipt(); await savePdf(r.html, `${r.receiptNo}.pdf`); })}>Save PDF</Button>
        <Button variant="primary" disabled={busy} onClick={() => run(async () => printHtml((await receipt()).html))}>Reprint receipt</Button>
      </>}>
      <dl className="mb-3 grid grid-cols-4 gap-3 text-sm">
        <div><dt className="text-xs text-slate-500">Date</dt><dd>{dateTime(sale.created_at)}</dd></div>
        <div><dt className="text-xs text-slate-500">Cashier</dt><dd>{sale.cashier_name}</dd></div>
        <div><dt className="text-xs text-slate-500">Customer</dt><dd>{sale.customer_name ?? 'Walk-in'}</dd></div>
        <div><dt className="text-xs text-slate-500">Total</dt><dd className="text-base font-semibold">{money(sale.total)}</dd></div>
      </dl>
      <Table rows={items} rowKey={(r: any) => r.id} columns={[
        { header: 'Product', cell: (r: any) => r.product_name },
        { header: 'Qty', align: 'right', cell: (r: any) => r.quantity },
        { header: 'Unit price', align: 'right', cell: (r: any) => money(r.unit_price) },
        { header: 'Discount', align: 'right', cell: (r: any) => (r.discount ? money(r.discount) : '') },
        { header: 'Line total', align: 'right', cell: (r: any) => money(r.line_total) },
        { header: 'Refunded', align: 'right', cell: (r: any) => (r.refunded_quantity ? `${r.refunded_quantity} (${money(r.refunded_amount)})` : '') },
      ]} />
      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Payments</h4>
          {payments.map((p: any) => <div key={p.id} className="flex justify-between"><span>{METHOD[p.method]}{p.reference && <span className="text-slate-500"> · {p.reference}</span>}</span><span className="tabular-nums">{money(p.amount)}</span></div>)}
          {sale.cash_tendered > 0 && <div className="flex justify-between text-slate-500"><span>Cash received / change</span><span className="tabular-nums">{money(sale.cash_tendered)} / {money(sale.change_given)}</span></div>}
          {credit && <div className="mt-1 flex justify-between font-medium"><span>Credit still owed</span><span className="tabular-nums">{money(credit.outstanding_balance)}</span></div>}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Refunds</h4>
          {refunds.length === 0 && <span className="text-slate-500">None</span>}
          {refunds.map((r: any) => (
            <div key={r.id} className="mb-1">
              <div className="flex justify-between"><span className="font-medium">{r.refund_no}</span><span className="tabular-nums">−{money(r.amount)}</span></div>
              <div className="text-xs text-slate-500">{dateTime(r.created_at)} · {r.reason} · approved by {r.authorised_by_name}{r.payout_amount > 0 && ` · paid out by ${METHOD[r.payout_method]}`}{r.credit_reduction > 0 && ` · ${money(r.credit_reduction)} taken off credit`}</div>
            </div>
          ))}
        </div>
      </div>
      {refunding && <RefundModal saleId={id} items={items} onClose={() => setRefunding(false)} onDone={() => { setRefunding(false); reload(); }} />}
    </Modal>
  );
}

function RefundModal({ saleId, items, onClose, onDone }: { saleId: string; items: any[]; onClose: () => void; onDone: () => void }) {
  const { can } = useApp();
  const [refundId] = useState(uuid);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('cash');
  const [approval, setApproval] = useState(false);
  const { run, busy } = useAction();
  const eligible = items.filter((i) => i.refunded_quantity < i.quantity);
  useEffect(() => setRestock(Object.fromEntries(eligible.map((i) => [i.id, true]))), []);
  const lines = eligible.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ saleItemId: i.id, quantity: qty[i.id], restock: restock[i.id] ?? true }));
  let amount = 0;
  for (const i of eligible) {
    const q = qty[i.id] ?? 0;
    if (q > 0) try { amount += refundLineAmount({ quantity: i.quantity, lineTotal: i.line_total, refundedQuantity: i.refunded_quantity, refundedAmount: i.refunded_amount }, q); } catch { /* shown by max */ }
  }
  const submit = (approver?: Approver) => {
    if (!can('refund.approve') && !approver) return setApproval(true);
    run(async () => { await call('refund.create', { id: refundId, saleId, reason, payoutMethod, lines, approver }); onDone(); }, 'Refund recorded');
  };
  return (
    <>
      <Modal title="Refund items" open={!approval} onClose={onClose} wide
        footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="danger" disabled={busy || !lines.length || !reason.trim()} onClick={() => submit()}>Refund {money(amount)}</Button></>}>
        <Table rows={eligible} rowKey={(r) => r.id} columns={[
          { header: 'Product', cell: (r) => r.product_name },
          { header: 'Can refund', align: 'right', cell: (r) => r.quantity - r.refunded_quantity },
          { header: 'Refund qty', align: 'right', cell: (r) => <Input type="number" min={0} max={r.quantity - r.refunded_quantity} value={qty[r.id] ?? 0} aria-label={`Refund quantity for ${r.product_name}`} className="ml-auto w-20 text-right"
              onChange={(e) => setQty({ ...qty, [r.id]: Math.max(0, Math.min(r.quantity - r.refunded_quantity, Math.floor(Number(e.target.value) || 0))) })} /> },
          { header: 'Back into stock?', cell: (r) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restock[r.id] ?? true} onChange={(e) => setRestock({ ...restock, [r.id]: e.target.checked })} /> Sellable</label> },
        ]} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Reason for refund"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Pay the customer back by" hint="Any credit still owed on this sale is cancelled first.">
            <Select value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value)}><option value="cash">Cash from the till</option><option value="momo">Mobile money</option><option value="card">Card</option></Select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Untick "Sellable" for damaged returns: the customer is refunded but the item does not go back into stock.</p>
      </Modal>
      <ApprovalModal open={approval} reason="Refunds need approval." onCancel={() => setApproval(false)} onApprove={(a) => { setApproval(false); submit(a); }} />
    </>
  );
}
