import { useState } from 'react';
import { Alert, Badge, Button, Card, Icon, PageHeader, Stat, Table, Tabs, QueryView } from '@mansora/ui';
import { SalesActivity } from '../components/SalesActivity';
import { StandingNotice, useStanding } from '../components/StandingNotice';
import { collectionSummary, reportPresets } from '../reporting';
import { dateTime, DateRange, ExportButtons, METHOD, money, monthStart, percent, plain, today, useApp, useQuery } from '../lib';

type Tab = 'choose' | 'summary' | 'sales' | 'payments' | 'wallet' | 'profit' | 'stock' | 'expenses' | 'balances';
export function ReportsPage() {
  const { can } = useApp();
  const tabs = [{ id: 'summary' as Tab, label: 'Summary' }, { id: 'sales' as Tab, label: 'Sales' }, { id: 'payments' as Tab, label: 'Payments' }, { id: 'wallet' as Tab, label: 'Mobile money check' }, ...(can('report.profit') ? [{ id: 'profit' as Tab, label: 'Gross profit' }] : []), ...(can('report.stock') ? [{ id: 'stock' as Tab, label: 'Stock' }] : []), ...(can('expense.manage') ? [{ id: 'expenses' as Tab, label: 'Expenses' }] : []), ...(can('credit.repayment') ? [{ id: 'balances' as Tab, label: 'Customer balances' }] : [])];
  const [tab, setTab] = useState<Tab>('choose');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const standing = useStanding();
  if (standing?.stage === 'restricted') return <div><PageHeader title="Reports" subtitle="Paused until the overdue Mansora invoice is paid" /><StandingNotice /></div>;
  return (
    <div>
      <PageHeader title="Reports" subtitle={`${range.from} to ${range.to} · from your business records`} />
      <StandingNotice />
      {tab === 'choose' ? <section aria-label="Choose a report"><p className="mb-6 text-sm text-slate-600">Start with what you need to understand. Choose dates and export from the report you open.</p><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[
        { id: 'summary', title: 'Business summary', description: 'Sales, money collected and customer credit in one view.', icon: 'home', allowed: true },
        { id: 'sales', title: 'Sales performance', description: 'What sold, when, and through which cashiers?', icon: 'chart', allowed: true },
        { id: 'payments', title: 'Money received', description: 'Separate payments, repayments and refunds from customer credit.', icon: 'wallet', allowed: true },
        { id: 'wallet', title: 'Mobile money & card check', description: 'Does every mobile money and card payment match your wallet or terminal statement?', icon: 'wallet', allowed: true },
        { id: 'profit', title: 'Gross profit', description: 'What did you earn after the recorded cost of goods sold?', icon: 'chart', allowed: can('report.profit') },
        { id: 'stock', title: 'Stock position', description: 'What is available, running low or out of stock?', icon: 'box', allowed: can('report.stock') },
        { id: 'expenses', title: 'Expenses', description: 'Where did business money go during the selected period?', icon: 'wallet', allowed: can('expense.manage') },
        { id: 'balances', title: 'Customer balances', description: 'Who owes you money and which repayments were recorded?', icon: 'users', allowed: can('credit.repayment') },
      ].filter(item => item.allowed).map(item => <button type="button" key={item.id} className="m-action-tile" onClick={() => setTab(item.id as Tab)}><span><Icon name={item.icon} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</div></section> : <><Button className="mb-5" onClick={() => setTab('choose')}>← All reports</Button><Tabs value={tab} onChange={setTab} tabs={tabs} /></>}
      {tab !== 'choose' && <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{reportPresets(today()).map((preset) => <Button size="sm" key={preset.label} aria-pressed={range.from === preset.from && range.to === preset.to} variant={range.from === preset.from && range.to === preset.to ? 'primary' : 'secondary'} onClick={() => setRange({ from: preset.from, to: preset.to })}>{preset.label}</Button>)}</div><DateRange {...range} onChange={setRange} shortcuts={false} /></div>}
      {tab === 'summary' && <SummaryReport range={range} />}
      {tab === 'expenses' && <ExpenseReport range={range} />}
      {tab === 'balances' && <BalanceReport />}
      {(tab === 'sales' || tab === 'payments') && <SalesReport range={range} payments={tab === 'payments'} />}
      {tab === 'wallet' && <WalletReport range={range} />}
      {tab === 'profit' && <ProfitReport range={range} />}
      {tab === 'stock' && <StockReport range={range} />}
    </div>
  );
}

function SummaryReport({ range }: { range: { from: string; to: string } }) {
  const { can } = useApp();
  const query = useQuery<any>('report.sales', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
  const collections = collectionSummary(d.payments);
  const average = d.totals.count ? Math.round(d.totals.gross / d.totals.count) : null;
  const rows = [['Net sales', d.totals.net], ['Sales after discounts, before refunds', d.totals.gross], ['Refunds', d.totals.refunds], ['Discounts given', d.totals.discounts], ['Collections on new sales (excludes credit)', collections.saleCollections], ['Credit repayments', collections.repayments], ['Refunds paid out', collections.refundsPaid], ['Collections after refunds', collections.netCollections], ['New credit granted', collections.newCredit]];
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">Sales performance and customer money collected · {range.from} to {range.to}</p><ExportButtons title={`Business summary ${range.from} to ${range.to}`} columns={['Measure', 'GHS']} rows={() => rows.map(([label, amount]) => [label, plain(amount as number)])} /></div>
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4"><Stat label="Net sales" value={money(d.totals.net)} hint="After discounts and refunds" /><Stat label="Collections after refunds" value={money(collections.netCollections)} hint="All received methods, including repayments" /><Stat label="Average completed sale" value={average == null ? '—' : money(average)} hint={`${d.totals.count} sales · before subsequent refunds`} /><Stat label="New credit granted" value={money(collections.newCredit)} hint="Customer debt created; not money received" tone={collections.newCredit ? 'warn' : 'default'} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><Card title="Daily net sales"><SalesActivity rows={d.daily} /></Card><Card title="Sales and collections reconciliation" pad={false}><Table rows={rows} columns={[{ header: 'Measure', cell: (r) => r[0] }, { header: 'Amount', align: 'right', cell: (r) => money(r[1] as number) }]} /><p className="border-t border-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600">Collections = payments on new sales excluding credit, plus credit repayments, less refunds paid out. This is not a bank reconciliation or a cash-flow statement.</p></Card></div>
    {can('report.profit') && <ProfitSnapshot range={range} />}
  </div>;
}
function ProfitSnapshot({ range }: { range: { from: string; to: string } }) {
  const query = useQuery<any>('report.profit', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
  return <Card title="Profitability at a glance"><div className="grid grid-cols-2 gap-4 xl:grid-cols-4"><div><p className="text-xs text-slate-600">Cost of goods sold</p><p className="mt-2 text-xl font-semibold tabular-nums">{money(d.cogs)}</p></div><div><p className="text-xs text-slate-600">Gross profit</p><p className="mt-2 text-xl font-semibold tabular-nums">{money(d.grossProfit)}</p></div><div><p className="text-xs text-slate-600">Gross margin</p><p className="mt-2 text-xl font-semibold tabular-nums">{percent(d.marginBps)}</p></div><div><p className="text-xs text-slate-600">Recorded expenses</p><p className="mt-2 text-xl font-semibold tabular-nums">{money(d.expenses)}</p></div></div><p className="mt-5 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">Gross profit is net sales less recorded cost of goods sold. Expenses are separate. These figures do not represent a complete accounting profit-and-loss statement.</p></Card>;
}
function ExpenseReport({ range }: { range: { from: string; to: string } }) {
  const query = useQuery<any>('expense.list', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
  return <div className="space-y-5"><div className="grid grid-cols-2 gap-4"><Stat label="Recorded expenses" value={money(d.total)} hint="Running costs; excludes cost of goods sold" /><Stat label="Expense records" value={d.rows.length} hint="In the selected period" /></div><div className="grid gap-5 xl:grid-cols-2"><Card title="Expenses by category" pad={false}><Table rows={d.byCategory} empty="No expenses in this period" columns={[{ header: 'Category', cell: (r: any) => r.key }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.total) }]} /></Card><Card title="Expenses by payment method" pad={false}><Table rows={d.byMethod} empty="No expenses in this period" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.key] }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.total) }]} /></Card></div><Card title="Expense detail" pad={false} actions={<ExportButtons title={`Expense report ${range.from} to ${range.to}`} columns={['Date', 'Category', 'Description', 'Method', 'GHS']} rows={() => d.rows.map((r: any) => [r.expense_date, r.category, r.description, METHOD[r.payment_method], plain(r.amount)])} />}><Table rows={d.rows} empty="No expenses in this period" columns={[{ header: 'Date', cell: (r: any) => r.expense_date }, { header: 'Category', cell: (r: any) => r.category }, { header: 'Description', cell: (r: any) => r.description }, { header: 'Amount', align: 'right', cell: (r: any) => money(r.amount) }]} /></Card></div>;
}
function BalanceReport() {
  const query = useQuery<any>('credit.list', { status: 'open' });
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
  return <div className="space-y-5"><Alert>Current customer balances as of now. The date filter above does not reconstruct past balances. Due dates determine which records are overdue.</Alert><div className="grid grid-cols-2 gap-4"><Stat label="Customer credit outstanding" value={money(d.totalOutstanding)} /><Stat label="Overdue credit" value={money(d.totalOverdue)} tone={d.totalOverdue ? 'warn' : 'default'} /></div><Card title="Open customer balances" pad={false} actions={<ExportButtons title={`Current customer balances ${today()}`} columns={['Customer', 'Receipt', 'Due date', 'Outstanding GHS']} rows={() => d.accounts.map((r: any) => [r.customer_name, r.receipt_no, r.due_date ?? '', plain(r.outstanding_balance)])} />}><Table rows={d.accounts} empty="No outstanding customer balances" columns={[{ header: 'Customer', cell: (r: any) => r.customer_name }, { header: 'Receipt', cell: (r: any) => r.receipt_no }, { header: 'Due date', cell: (r: any) => r.due_date ?? 'Not set' }, { header: 'Status', cell: (r: any) => r.overdue ? 'Overdue' : 'Open' }, { header: 'Outstanding', align: 'right', cell: (r: any) => money(r.outstanding_balance) }]} /></Card></div>;
}

function SalesReport({ range, payments }: { range: { from: string; to: string }; payments: boolean }) {
  const query = useQuery<any>('report.sales', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
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

const KIND: Record<string, string> = { sale: 'Sale', repayment: 'Credit repayment', refund: 'Refund paid out' };
function WalletReport({ range }: { range: { from: string; to: string } }) {
  const query = useQuery<any>('report.wallet', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
  const momo = d.byMethod.find((m: any) => m.method === 'momo');
  const card = d.byMethod.find((m: any) => m.method === 'card');
  const missing = momo.missingReference + card.missingReference;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-slate-600">Compare these figures with your mobile money wallet statement and card terminal report for the same dates. Amounts here were typed in at the till; only the provider's statement proves the money arrived.</p>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Mobile money expected in wallet" value={money(momo.net)} hint={`${money(momo.received)} received · ${money(momo.refunded)} refunded`} />
        <Stat label="Card expected from terminal" value={money(card.net)} hint={`${money(card.received)} received · ${money(card.refunded)} refunded`} />
      </div>
      {d.duplicateReferences.length > 0 && <Alert tone="bad">The same transaction ID was recorded more than once: {d.duplicateReferences.map((r: any) => `${r.reference} (${r.count} times)`).join(', ')}. Check these against the statement before accepting them. A reused ID can mean a fake or recycled payment message.</Alert>}
      {missing > 0 && <Alert tone="warn">{count(missing, 'payment has', 'payments have')} no transaction ID. Ask staff to enter the ID from the payment message so each payment can be matched.</Alert>}
      <Card title="Payments to check" pad={false} actions={<ExportButtons title={`Mobile money and card check ${range.from} to ${range.to}`} columns={['Time', 'Type', 'Method', 'Receipt or refund', 'Customer', 'Staff', 'Transaction ID', 'GHS']} rows={() => d.entries.map((e: any) => [dateTime(e.at), KIND[e.kind], METHOD[e.method], e.number ?? '', e.customer ?? '', e.staff, e.reference ?? '', plain(e.amount)])} />}>
        <Table rows={d.entries} empty="No mobile money or card payments in this period" columns={[
          { header: 'Time', cell: (e: any) => dateTime(e.at) },
          { header: 'Type', cell: (e: any) => KIND[e.kind] },
          { header: 'Method', cell: (e: any) => METHOD[e.method] },
          { header: 'Receipt', cell: (e: any) => e.number ?? '' },
          { header: 'Customer', cell: (e: any) => e.customer ?? '' },
          { header: 'Staff', cell: (e: any) => e.staff },
          { header: 'Transaction ID', cell: (e: any) => e.reference ?? (e.amount > 0 ? <Badge tone="warn">Missing</Badge> : '') },
          { header: 'Amount', align: 'right', cell: (e: any) => <strong>{money(e.amount)}</strong> },
        ]} />
      </Card>
    </div>
  );
}

function ProfitReport({ range }: { range: { from: string; to: string } }) {
  const query = useQuery<any>('report.profit', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
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
  const query = useQuery<any>('report.stock', range);
  const { data: d } = query;
  if (!d) return <QueryView query={query} label="report data">{null}</QueryView>;
  const cost = d.valuation != null;
  const moveCols = [{ header: 'When', cell: (r: any) => r.occurred_at.slice(0, 10) }, { header: 'Product', cell: (r: any) => r.product }, { header: 'Change', align: 'right' as const, cell: (r: any) => r.quantity_delta }, { header: 'By', cell: (r: any) => r.actor }, { header: 'Reason', cell: (r: any) => r.reason ?? '' }];
  return (
    <>
      <p className="mb-4 text-xs leading-relaxed text-slate-600">Stock on hand and valuation are the current position. Damage, adjustments and movement summaries use the selected date range.</p>
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
