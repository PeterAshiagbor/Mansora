import { Alert, Badge, Card, PageHeader, Stat, Table } from '@mansora/ui';
import { dateTime, METHOD, money, useApp, useQuery } from '../lib';

export function Dashboard() {
  const { state, go, can } = useApp();
  const { data: d } = useQuery<any>('report.dashboard');
  const sync = useQuery<any>('sync.status').data;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const own = d.scope === 'own';
  return (
    <div>
      <PageHeader title={`Good day, ${state.user?.name.split(' ')[0]}`} subtitle={own ? 'Your own sales today' : 'How the business is doing today'} />
      {sync?.tenantStatus === 'suspended' && <Alert tone="warn" className="mb-4">Your Mansora service plan needs attention. Please contact Mansora. You can keep selling as normal.</Alert>}
      {sync && sync.unprotected > 0 && sync.state === 'offline' && (
        <Alert tone="warn" className="mb-4">{sync.unprotected} recent change(s) exist only on this laptop. They will be protected when the internet returns, or when you make a backup.</Alert>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={own ? 'My sales today' : 'Sales today'} value={money(d.today.net)} hint={`${d.today.count} transaction(s)${d.today.refunds ? ` · ${money(d.today.refunds)} refunded` : ''}`} />
        <Stat label={own ? 'My sales this month' : 'Sales this month'} value={money(d.month.net)} hint={`${d.month.count} transaction(s)`} />
        {d.outstandingCredit != null && <Stat label="Customer credit outstanding" value={money(d.outstandingCredit)} tone={d.outstandingCredit > 0 ? 'warn' : 'default'} />}
        {d.lowStock && <Stat label="Low or out of stock" value={d.lowStock.length >= 10 ? '10+' : d.lowStock.length} tone={d.lowStock.length ? 'warn' : 'good'} hint="products at or below reorder level" />}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {d.payments && (
          <Card title="How customers paid today" pad={false}>
            <Table rows={d.payments} empty="No sales yet today" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.method] ?? r.method }, { header: 'Payments', cell: (r: any) => r.count, align: 'right' }, { header: 'Amount', cell: (r: any) => money(r.total), align: 'right' }]} />
          </Card>
        )}
        {d.lowStock && (
          <Card title="Running low" pad={false} actions={can('stock.view') && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => go('stock')}>View stock</button>}>
            <Table rows={d.lowStock} empty="Stock levels look healthy" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'In stock', align: 'right', cell: (r: any) => (r.quantity <= 0 ? <Badge tone="bad">Out</Badge> : r.quantity) }, { header: 'Reorder at', align: 'right', cell: (r: any) => r.reorder_level }]} />
          </Card>
        )}
        <Card title="Recent transactions" pad={false} className={d.payments ? '' : 'xl:col-span-2'}>
          <Table rows={d.recent} empty="No sales yet" onRowClick={(r: any) => go('sales', r.id)} columns={[{ header: 'Receipt', cell: (r: any) => r.receipt_no }, { header: 'Time', cell: (r: any) => dateTime(r.created_at) }, { header: 'Cashier', cell: (r: any) => r.cashier_name }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} />
        </Card>
      </div>
    </div>
  );
}
