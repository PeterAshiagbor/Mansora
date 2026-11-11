import { Alert, Badge, Button, Card, Icon, PageHeader, Stat, Table, QueryView, Disclosure } from '@mansora/ui';
import { FirstUsePrompt } from './GettingStarted';
import { SalesActivity } from '../components/SalesActivity';
import { dateTime, METHOD, money, monthStart, today, useApp, useQuery } from '../lib';

export function Dashboard() {
  const { state, go, can } = useApp();
  const dashboard = useQuery<any>('report.dashboard');
  const { data: d } = dashboard;
  const sync = useQuery<any>('sync.status').data;
  if (!d) return <QueryView query={dashboard} label="dashboard">{null}</QueryView>;
  const own = d.scope === 'own';
  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Good day, ${state.user?.name.split(' ')[0]}. ${own ? 'Here is your sales activity today.' : 'Here is how your business is doing today.'}`} actions={<><Button onClick={dashboard.reload}><Icon name="sync" />Refresh overview</Button>{can('sale.create') && <Button variant="primary" onClick={() => go('checkout')}><Icon name="plus" />Create a sale</Button>}</>} />
      {state.user?.role === 'owner' && <FirstUsePrompt />}
      {sync?.tenantStatus === 'suspended' && <Alert tone="warn" className="mb-4">Your Mansora service plan needs attention. Please contact Mansora. You can keep selling as normal.</Alert>}
      {sync && sync.unprotected > 0 && sync.state === 'offline' && (
        <Alert tone="warn" className="mb-4">{sync.unprotected} recent change(s) exist only on this laptop. They will be protected when the internet returns, or when you make a backup.</Alert>
      )}
      <div className="m-overview-caption"><strong>At a glance</strong><span>Today and month to date</span></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat icon={<Icon name="wallet" />} label={own ? 'My sales today' : 'Sales today'} value={money(d.today.net)} hint={`${d.today.count} transaction(s)${d.today.refunds ? ` · ${money(d.today.refunds)} refunded` : ''}`} />
        <Stat icon={<Icon name="chart" />} label={own ? 'My sales this month' : 'Sales this month'} value={money(d.month.net)} hint={`${d.month.count} transaction(s)`} />
        {d.outstandingCredit != null && <Stat icon={<Icon name="users" />} label="Customer credit outstanding" value={money(d.outstandingCredit)} tone={d.outstandingCredit > 0 ? 'warn' : 'default'} />}
        {d.lowStock && <Stat icon={<Icon name="box" />} label="Low or out of stock" value={d.lowStock.length >= 10 ? '10+' : d.lowStock.length} tone={d.lowStock.length ? 'warn' : 'good'} hint="products at or below reorder level" />}
      </div>
      <div className="mt-5"><Card title="Recent transactions" pad={false} actions={<Button size="sm" variant="ghost" onClick={() => go('sales')}>View sales history</Button>}>
        <Table caption="Latest transactions, up to five" rows={d.recent.slice(0, 5)} empty={<div><strong className="text-sm font-medium text-slate-700">No sales yet</strong><p className="m-empty-hint">Completed sales will appear here, with a receipt and a clear audit trail. Use Create a sale when you are ready.</p></div>} onRowClick={(r: any) => go('sales', r.id)} columns={[{ header: 'Receipt', cell: (r: any) => r.receipt_no }, { header: 'Time', cell: (r: any) => dateTime(r.created_at) }, { header: 'Cashier', cell: (r: any) => r.cashier_name }, { header: 'Total', align: 'right', cell: (r: any) => money(r.total) }]} />
      </Card></div>
      <Disclosure title="Daily breakdown" description="Sales activity, payment methods and products running low">
      {can('report.sales') && <DashboardActivity />}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {d.payments && (
          <Card title="Payment mix today" pad={false}>
            <Table rows={d.payments} empty="No sales yet today" columns={[{ header: 'Method', cell: (r: any) => METHOD[r.method] ?? r.method }, { header: 'Payments', cell: (r: any) => r.count, align: 'right' }, { header: 'Amount', cell: (r: any) => money(r.total), align: 'right' }]} />
            <p className="border-t border-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-500">Credit records a customer balance, not money received.</p>
          </Card>
        )}
        {d.lowStock && (
          <Card title="Running low" pad={false} actions={can('stock.view') && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => go('stock')}>View stock</button>}>
            <Table rows={d.lowStock} empty="Stock levels look healthy" columns={[{ header: 'Product', cell: (r: any) => r.name }, { header: 'In stock', align: 'right', cell: (r: any) => (r.quantity <= 0 ? <Badge tone="bad">Out</Badge> : r.quantity) }, { header: 'Reorder at', align: 'right', cell: (r: any) => r.reorder_level }]} />
          </Card>
        )}
      </div>
      </Disclosure>
    </div>
  );
}

function DashboardActivity() {
  const { go } = useApp();
  const activityQuery = useQuery<any>('report.sales', { from: monthStart(), to: today() });
  const { data } = activityQuery;
  if (!data) return <QueryView query={activityQuery} label="sales activity">{null}</QueryView>;
  return <div className="mt-5"><Card title="Sales activity this month" actions={<button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => go('reports')}>Open full reports →</button>}><SalesActivity rows={data.daily} /></Card></div>;
}
