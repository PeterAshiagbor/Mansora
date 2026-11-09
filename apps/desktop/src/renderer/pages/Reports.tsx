import { useState } from 'react';
import { Alert, Card, PageHeader, Stat, Table, Tabs } from '@mansora/ui';
import { DateRange, ExportButtons, METHOD, money, monthStart, percent, plain, today, useApp, useQuery } from '../lib';

type Tab = 'sales' | 'payments' | 'profit' | 'stock';
export function ReportsPage() {
  const { can } = useApp();
  const tabs = [{ id: 'sales' as Tab, label: 'Sales' }, { id: 'payments' as Tab, label: 'Payments' }, ...(can('report.profit') ? [{ id: 'profit' as Tab, label: 'Gross profit' }] : []), ...(can('report.stock') ? [{ id: 'stock' as Tab, label: 'Stock' }] : [])];
  const [tab, setTab] = useState<Tab>('sales');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  return (
    <div>
      <PageHeader title="Reports" subtitle={`${range.from} to ${range.to} · from the records on this laptop (works offline)`} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <div className="mb-4"><DateRange {...range} onChange={setRange} /></div>
      {(tab === 'sales' || tab === 'payments') && <SalesReport range={range} payments={tab === 'payments'} />}
      {tab === 'profit' && <ProfitReport range={range} />}
      {tab === 'stock' && <StockReport range={range} />}
    </div>
  );
}

function SalesReport({ range, payments }: { range: { from: string; to: string }; payments: boolean }) {
  const { data: d, error } = useQuery<any>('report.sales', range);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const p = d.payments;
  if (payments)
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Payments received for sales" pad={false} actions={<ExportButtons title="Payments" columns={['Method', 'Payments', 'Amount']} rows={() => p.sales.map((r: any) => [METHOD[r.method], r.count, plain(r.total)])} />}>
          <Table rows={p.sales} empty="No payments" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.method] }, { header: 'Payments', align: 'right', cell: (r: any) => r.count }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.total) }]} />
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">{p.splitPaymentSales} sale(s) were paid with more than one method. "Credit" is the amount sold on credit, not money received.</p>
        </Card>
        <div className="space-y-4">
          <Card title="Credit repayments received" pad={false}><Table rows={p.repayments} empty="No repayments" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.method] }, { header: 'Count', align: 'right', cell: (r: any) => r.count }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.total) }]} /></Card>
          <Card title="Refunds paid out" pad={false}>
            <Table rows={p.refundPayouts} empty="No refunds paid out" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.method] }, { header: 'Count', align: 'right', cell: (r: any) => r.count }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.total) }]} />
            {p.refundCreditReductions > 0 && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">A further {money(p.refundCreditReductions)} of refunds cancelled customer credit instead of being paid out.</p>}
          </Card>
        </div>
      </div>
    );
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Net sales" value={money(d.totals.net)} hint="Sales less refunds" tone="good" />
        <Stat label="Sales before refunds" value={money(d.totals.gross)} />
        <Stat label="Transactions" value={d.totals.count} />
        <Stat label="Discounts given" value={money(d.totals.discounts)} />
        <Stat label="Refunds" value={money(d.totals.refunds)} tone={d.totals.refunds ? 'warn' : 'default'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Daily sales" pad={false} actions={<ExportButtons title="Daily sales" columns={['Day', 'Transactions', 'Sales', 'Discounts', 'Refunds', 'Net']} rows={() => d.daily.map((r: any) => [r.day, r.count, plain(r.gross), plain(r.discounts), plain(r.refunds), plain(r.net)])} />}>
          <Table rows={d.daily} empty="No sales in this period" columns={[{ header: 'Day', cell: (r: any) => r.day }, { header: 'Sales', align: 'right', cell: (r: any) => r.count }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.gross) }, { header: 'Refunds', align: 'right', cell: (r: any) => (r.refunds ? money(r.refunds) : '') }, { header: 'Net', align: 'right', cell: (r: any) => <strong>{money(r.net)}</strong> }]} />
        </Card>
        <Card title="Best-selling products" pad={false}>
          <Table rows={d.bestSellers} empty="No sales in this period" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'Qty sold', align: 'right', cell: (r: any) => r.quantity }, { header: 'Sales', align: 'right', cell: (r: any) => money(r.revenue) }]} />
        </Card>
        <Card title="Sales by product" pad={false} actions={<ExportButtons title="Sales by product" columns={['Product', 'Qty sold', 'Sales']} rows={() => d.byProduct.map((r: any) => [r.name, r.quantity, plain(r.revenue)])} />}>
          <Table rows={d.byProduct} empty="No sales in this period" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'Qty sold', align: 'right', cell: (r: any) => r.quantity }, { header: 'Sales', align: 'right', cell: (r: any) => money(r.revenue) }]} />
        </Card>
        <div className="space-y-4">
          <Card title="Sales by cashier" pad={false}><Table rows={d.byCashier} empty="No sales" columns={[{ header: 'Cashier', cell: (r: any) => r.cashier }, { header: 'Sales', align: 'right', cell: (r: any) => r.count }, { header: 'Discounts', align: 'right', cell: (r: any) => money(r.discounts) }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.gross) }]} /></Card>
          <Card title="Monthly sales" pad={false}><Table rows={d.monthly} empty="No sales" columns={[{ header: 'Month', cell: (r: any) => r.month }, { header: 'Sales', align: 'right', cell: (r: any) => r.count }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.gross) }]} /></Card>
        </div>
      </div>
    </>
  );
}

function ProfitReport({ range }: { range: { from: string; to: string } }) {
  const { data: d, error } = useQuery<any>('report.profit', range);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Net sales" value={money(d.revenue)} />
        <Stat label="Cost of goods sold" value={money(d.cogs)} />
        <Stat label="Gross profit" value={money(d.grossProfit)} tone={d.grossProfit >= 0 ? 'good' : 'bad'} />
        <Stat label="Gross margin" value={percent(d.marginBps)} />
      </div>
      <Alert className="mb-4">Expenses recorded in this period: <strong>{money(d.expenses)}</strong>. They are shown separately and are not subtracted here. Gross profit is not net profit; a full accounting statement is outside this version.</Alert>
      <Card title="Gross profit by product" pad={false} actions={<ExportButtons title="Gross profit by product" columns={['Product', 'Qty', 'Sales', 'Cost', 'Gross profit', 'Margin %']} rows={() => d.byProduct.map((r: any) => [r.name, r.quantity, plain(r.revenue), plain(r.cogs), plain(r.grossProfit), r.marginBps == null ? '' : (r.marginBps / 100).toFixed(1)])} />}>
        <Table rows={d.byProduct} empty="No sales in this period" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'Qty', align: 'right', cell: (r: any) => r.quantity }, { header: 'Sales', align: 'right', cell: (r: any) => money(r.revenue) }, { header: 'Cost', align: 'right', cell: (r: any) => money(r.cogs) }, { header: 'Gross profit', align: 'right', cell: (r: any) => <strong>{money(r.grossProfit)}</strong> }, { header: 'Margin', align: 'right', cell: (r: any) => percent(r.marginBps) }]} />
      </Card>
    </>
  );
}

const TYPE: Record<string, string> = { OPENING_STOCK: 'Opening stock', PURCHASE_RECEIVED: 'Purchases received', SALE: 'Sales', SALE_REFUND: 'Returned by customers', DAMAGE: 'Damaged', STOCK_COUNT_ADJUSTMENT: 'Stock count', MANUAL_CORRECTION: 'Manual correction' };
function StockReport({ range }: { range: { from: string; to: string } }) {
  const { data: d, error } = useQuery<any>('report.stock', range);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const cost = d.valuation != null;
  const moveCols = [{ header: 'When', cell: (r: any) => r.occurred_at.slice(0, 10) }, { header: 'Product', cell: (r: any) => r.product }, { header: 'Change', align: 'right' as const, cell: (r: any) => r.quantity_delta }, { header: 'By', cell: (r: any) => r.actor }, { header: 'Reason', cell: (r: any) => r.reason ?? '' }];
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Products in stock list" value={d.onHand.length} />
        <Stat label="Low or out of stock" value={d.lowStock.length} tone={d.lowStock.length ? 'warn' : 'good'} />
        {cost && <Stat label="Stock value (at average cost)" value={money(d.valuation)} />}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Stock on hand" pad={false} className="xl:col-span-2" actions={<ExportButtons title="Stock on hand" columns={['Product', 'SKU', 'Category', 'In stock', 'Reorder level', ...(cost ? ['Average cost', 'Value'] : [])]} rows={() => d.onHand.map((r: any) => [r.name, r.sku ?? '', r.category ?? '', r.quantity, r.reorder_level, ...(cost ? [plain(r.average_cost), plain(r.value)] : [])])} />}>
          <Table rows={d.onHand} empty="No products" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'Category', cell: (r: any) => r.category ?? '' }, { header: 'In stock', align: 'right', cell: (r: any) => r.quantity }, { header: 'Reorder at', align: 'right', cell: (r: any) => r.reorder_level }, ...(cost ? [{ header: 'Avg cost', align: 'right' as const, cell: (r: any) => money(r.average_cost) }, { header: 'Value', align: 'right' as const, cell: (r: any) => money(r.value) }] : [])]} />
        </Card>
        <Card title="Stock movements in this period" pad={false}><Table rows={d.movementSummary} empty="No movements" columns={[{ header: 'Type', cell: (r: any) => TYPE[r.type] ?? r.type }, { header: 'Entries', align: 'right', cell: (r: any) => r.count }, { header: 'Units', align: 'right', cell: (r: any) => r.quantity }]} /></Card>
        <Card title="Low-stock products" pad={false}><Table rows={d.lowStock} empty="None" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'In stock', align: 'right', cell: (r: any) => r.quantity }, { header: 'Reorder at', align: 'right', cell: (r: any) => r.reorder_level }]} /></Card>
        <Card title="Damaged items" pad={false}><Table rows={d.damages} empty="None in this period" columns={moveCols} /></Card>
        <Card title="Stock adjustments" pad={false}><Table rows={d.adjustments} empty="None in this period" columns={moveCols} /></Card>
      </div>
    </>
  );
}
