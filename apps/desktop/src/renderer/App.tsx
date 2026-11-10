import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can as canDo, type Permission } from '@mansora/domain';
import { Alert, Button, cx, Field, Input, MansoraBrand, WorkspaceShell, CLIENT_GUIDES } from '@mansora/ui';
import { AppCtx, call, canRestore, restoreBackup, ToastProvider, useAction, useApp, useQuery, type AppState } from './lib';
import { Checkout } from './pages/Checkout';
import { Dashboard } from './pages/Dashboard';
import { HelpPage } from './pages/Help';
import { SalesPage } from './pages/Sales';
import { CategoriesPage, ProductsPage } from './pages/Products';
import { PurchasesPage, StockPage } from './pages/Stock';
import { CreditPage, CustomersPage } from './pages/Customers';
import { ExpensesPage, ShiftsPage } from './pages/Shifts';
import { ReportsPage } from './pages/Reports';
import { BillingPage } from './pages/Billing';
import { AuditPage, BackupPage, DataPage, SettingsPage, StaffPage, SupportPage, SyncPage } from './pages/Admin';

interface NavItem {
  id: string;
  label: string;
  perm?: Permission;
  render: (param?: string) => ReactNode;
}
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Workspace', items: [{ id: 'dashboard', label: 'Dashboard', render: () => <Dashboard /> }] },
  {
    group: 'Sell',
    items: [
      { id: 'checkout', label: 'New sale', perm: 'sale.create', render: () => <Checkout /> },
      { id: 'sales', label: 'Sales history', perm: 'sale.create', render: (p) => <SalesPage openId={p} /> },
      { id: 'shifts', label: 'Cashier shifts', perm: 'shift.own', render: () => <ShiftsPage /> },
    ],
  },
  {
    group: 'Customers',
    items: [
      { id: 'customers', label: 'Customers', perm: 'customer.manage', render: () => <CustomersPage /> },
      { id: 'credit', label: 'Credit & repayments', perm: 'credit.repayment', render: () => <CreditPage /> },
    ],
  },
  {
    group: 'Stock',
    items: [
      { id: 'products', label: 'Products', perm: 'product.view', render: () => <ProductsPage /> },
      { id: 'categories', label: 'Categories', perm: 'product.manage', render: () => <CategoriesPage /> },
      { id: 'stock', label: 'Stock', perm: 'stock.view', render: () => <StockPage /> },
      { id: 'purchases', label: 'Purchases & suppliers', perm: 'purchase.manage', render: () => <PurchasesPage /> },
    ],
  },
  {
    group: 'Business',
    items: [
      { id: 'reports', label: 'Reports', perm: 'report.sales', render: () => <ReportsPage /> },
      { id: 'expenses', label: 'Expenses', perm: 'expense.manage', render: () => <ExpensesPage /> },
    ],
  },
  {
    group: 'Manage',
    items: [
      { id: 'staff', label: 'Staff', perm: 'staff.manage', render: () => <StaffPage /> },
      { id: 'settings', label: 'Settings', render: () => <SettingsPage /> },
      { id: 'data', label: 'Import & export', perm: 'data.import', render: () => <DataPage /> },
      { id: 'billing', label: 'Billing & payments', perm: 'billing.view', render: () => <BillingPage /> },
      { id: 'sync', label: 'Sync status', render: () => <SyncPage /> },
      { id: 'backup', label: 'Backup & recovery', perm: 'backup.manage', render: () => <BackupPage /> },
      { id: 'support', label: 'Mansora access', perm: 'support.grant', render: () => <SupportPage /> },
      { id: 'audit', label: 'Audit history', perm: 'audit.view', render: () => <AuditPage /> },
      { id: 'help', label: 'Help & getting started', render: () => <HelpPage /> },
    ],
  },
];

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<{ id: string; param?: string }>({ id: 'dashboard' });
  const refresh = useCallback(async () => {
    try {
      setState(await call<AppState>('app.state'));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const onOut = () => void refresh();
    window.addEventListener('mansora:signed-out', onOut);
    return () => window.removeEventListener('mansora:signed-out', onOut);
  }, [refresh]);

  const ctx = useMemo(
    () => state && { state, refresh, can: (p: Permission) => canDo(state.user ? { ...state.user, role: state.user.role as any, status: 'active' } : null, p), go: (id: string, param?: string) => setPage({ id, param }) },
    [state, refresh],
  );
  if (error) return <div className="p-8"><Alert tone="bad">The application could not start: {error}</Alert></div>;
  if (!ctx) return <div className="flex h-full items-center justify-center text-slate-500">Starting…</div>;
  return (
    <AppCtx.Provider value={ctx}>
      <ToastProvider>
        {!ctx.state.business.activated ? <Activation /> : !ctx.state.user ? <Login onDone={() => setPage({ id: ctx.state.user ? page.id : 'dashboard' })} /> : <Shell page={page} />}
      </ToastProvider>
    </AppCtx.Provider>
  );
}

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-brand-900 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6">
          <div className="mb-5"><MansoraBrand /></div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const { state, refresh } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('auth.login', { username, password });
      await refresh();
      onDone();
    } catch (err: any) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title={state.business.name || 'Sign in'} subtitle="Sign in with your staff username and password. This works without internet.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Username"><Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <OwnerRecovery />
    </AuthFrame>
  );
}

function OwnerRecovery() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', next: '', confirm: '' });
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="mt-4 text-sm font-medium text-brand-700 hover:underline" onClick={() => setOpen(true)}>Owner forgot their password?</button>;
  return (
    <form className="mt-4 space-y-3 border-t border-slate-200 pt-4" onSubmit={async (e) => {
      e.preventDefault();
      if (f.next !== f.confirm) return setMsg({ tone: 'bad', text: 'The two passwords do not match' });
      setBusy(true);
      try {
        const r = await call('auth.recoverOwner', { code: f.code, newPassword: f.next });
        setMsg({ tone: 'good', text: `Password changed. Sign in above as "${r.username}".` });
        setF({ code: '', next: '', confirm: '' });
      } catch (err: any) {
        setMsg({ tone: 'bad', text: err.message });
      } finally {
        setBusy(false);
      }
    }}>
      <p className="text-sm text-slate-600">Call Mansora for a recovery code. It works once, for one hour, only on this laptop, and needs internet. You choose the new password here; Mansora never sees it.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label="Recovery code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="REC-XXXX-XXXX-XXXX" autoComplete="off" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New owner password"><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Repeat new password"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></Field>
      </div>
      <Button type="submit" disabled={busy || !f.code || !f.next}>{busy ? 'Checking…' : 'Set new owner password'}</Button>
    </form>
  );
}

function Activation() {
  const { refresh } = useApp();
  const [f, setF] = useState({ apiUrl: 'https://', code: '', deviceName: 'Shop laptop', name: '', username: '', password: '', confirm: '' });
  const [fromCloud, setFromCloud] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('The two passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await call('activation.activate', { apiUrl: f.apiUrl, code: f.code, deviceName: f.deviceName, owner: { name: f.name, username: f.username, password: f.password }, restoreFromCloud: fromCloud });
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Activate this laptop" subtitle="Connect this laptop to your business workspace on the Mansora platform. You need internet and your activation code for this one-time setup.">
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Mansora server address"><Input value={f.apiUrl} onChange={set('apiUrl')} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Activation code"><Input value={f.code} onChange={set('code')} placeholder="MNS-XXXX-XXXX-XXXX" required autoFocus /></Field>
          <Field label="Name for this laptop"><Input value={f.deviceName} onChange={set('deviceName')} required /></Field>
        </div>
        <hr className="border-slate-200" />
        <p className="text-sm font-medium text-slate-700">Create the business owner's login</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner's full name"><Input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Username"><Input value={f.username} onChange={set('username')} required autoComplete="off" /></Field>
          <Field label="Password" hint="At least 8 characters"><Input type="password" value={f.password} onChange={set('password')} required autoComplete="new-password" /></Field>
          <Field label="Repeat password"><Input type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={fromCloud} onChange={(e) => setFromCloud(e.target.checked)} />
          <span>This laptop replaces a lost one and I have no backup file: load my business records from the Mansora cloud. <span className="text-slate-500">Staff other than the owner will need new passwords.</span></span>
        </label>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>{busy ? 'Activating…' : 'Activate'}</Button>
      </form>
      {canRestore() && <Restore onDone={refresh} />}
    </AuthFrame>
  );
}

function Restore({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="mt-4 text-sm font-medium text-brand-700 hover:underline" onClick={() => setOpen(true)}>Replacing a lost laptop? Restore from a backup instead</button>;
  return (
    <form className="mt-4 space-y-3 border-t border-slate-200 pt-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await restoreBackup(pass);
      setBusy(false);
      if (r.ok) await onDone();
      else setMsg(r.message ?? 'Restore cancelled');
    }}>
      {msg && <Alert tone="bad">{msg}</Alert>}
      <Field label="Backup passphrase" hint="You will then be asked to choose the backup file (.mbk)."><Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus /></Field>
      <Button type="submit" disabled={busy || !pass}>{busy ? 'Restoring…' : 'Choose backup file and restore'}</Button>
    </form>
  );
}

const NAV_ICONS: Record<string, string> = { dashboard: 'home', checkout: 'sale', sales: 'file', shifts: 'wallet', customers: 'users', credit: 'wallet', products: 'box', categories: 'box', stock: 'box', purchases: 'sale', reports: 'chart', expenses: 'wallet', staff: 'users', settings: 'settings', data: 'file', sync: 'sync', backup: 'shield', support: 'shield', audit: 'file', help: 'help' };
function Shell({ page }: { page: { id: string; param?: string } }) {
  const { state, can, go, refresh } = useApp();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)).map((item) => ({ ...item, icon: NAV_ICONS[item.id] })) })).filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => i.id === page.id) ?? all[0];
  const { run } = useAction();
  return <div className="flex h-full flex-col"><div className="min-h-0 flex-1"><WorkspaceShell groups={groups} current={current} onNavigate={go} workspace={state.business.name} workspaceLabel="Client workspace" user={state.user?.name ?? 'Staff'} userRole={state.user?.role} guide={CLIENT_GUIDES[current.id]} signOutLabel="Lock / sign out" onSignOut={() => run(async () => { await call('auth.logout'); await refresh(); })}><div key={current.id + (page.param ?? '')}>{current.render(page.param)}</div></WorkspaceShell></div><StatusBar /></div>;
}

function StatusBar() {
  const { state, go } = useApp();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((x) => x + 1);
    const t = setInterval(bump, 5000);
    window.addEventListener('mansora:changed', bump);
    return () => (clearInterval(t), window.removeEventListener('mansora:changed', bump));
  }, []);
  const sync = useQuery<any>('sync.status', {}, [tick]).data;
  const shift = useQuery<any>('shift.current', {}, [tick]).data;
  const now = new Date();
  const tone = !sync ? 'bg-slate-400' : sync.state === 'online' && sync.pending === 0 ? 'bg-emerald-500' : sync.state === 'offline' ? 'bg-amber-500' : 'bg-sky-500';
  const label = !sync ? '…' : sync.state === 'syncing' ? 'Syncing' : sync.state === 'offline' ? 'Offline' : sync.state === 'online' ? 'Online' : 'Not synced yet';
  return (
    <footer className="no-print flex items-center gap-5 border-t border-slate-300 bg-white px-4 py-1.5 text-xs text-slate-700">
      <button type="button" onClick={() => go('sync')} className="flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" title="Open sync status">
        <span aria-hidden className={cx('h-2.5 w-2.5 rounded-full', tone)} />
        <span className="font-medium">{label}</span>
        {sync && sync.pending > 0 && <span>· {sync.pending} waiting to sync</span>}
        {sync && sync.rejected > 0 && <span className="font-semibold text-red-700">· {sync.rejected} sync error(s)</span>}
      </button>
      <span>Cashier: <strong>{state.user?.name}</strong></span>
      <span>{shift ? <>Shift open since {new Date(shift.shift.opened_at).toISOString().slice(11, 16)}</> : <span className="text-amber-700">No shift open</span>}</span>
      <span className="ml-auto">{state.business.name}</span>
      <span className="tabular-nums">{now.toLocaleDateString('en-GB')} {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
    </footer>
  );
}
