import { useEffect, useState, type ReactNode } from 'react';
import { formatGHS, parseGHS } from '@mansora/domain';
import { Alert, Badge, Button, Card, cx, Field, Input, MansoraBrand, AuthLayout, Modal, PageHeader, Select, Stat, Table, Tabs, Textarea, WorkspaceShell, ADMIN_GUIDES, DraftProvider, useNavigationGuard, QueryView, Disclosure, ReportProblemButton, ReportProblemNavItem } from '@mansora/ui';
import { Leads } from './leads';
import { ContactSettings } from './contact';
import { api, getToken, setToken, useApi } from './api';
import { Collections, Invoices, PaymentSettings, Payments, RevenueReports, Subscriptions } from './billing';

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const ago = (iso?: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} day(s) ago`;
};
const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral' | 'info'> = { active: 'good', onboarding: 'info', suspended: 'warn', closed: 'neutral', trial: 'info', past_due: 'bad', cancelled: 'neutral' };
/** Dates arrive as YYYY-MM-DD; tolerate a full timestamp so a driver difference can never show raw ISO text. */
const day = (d?: string | null) => (d ? String(d).slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

export function App() { return <DraftProvider><AdminApplication /></DraftProvider>; }

function AdminApplication() {
  const navigate = useNavigationGuard();
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [page, setPage] = useState<{ id: string; param?: string }>({ id: 'overview' });
  useEffect(() => {
    const out = () => setSignedIn(false);
    window.addEventListener('mansora:signed-out', out);
    return () => window.removeEventListener('mansora:signed-out', out);
  }, []);
  if (!signedIn) return <Login onDone={() => setSignedIn(true)} />;
  const go = (id: string, param?: string, afterSave = false) => {
    if (page.id === id && page.param === param) return;
    if (afterSave) setPage({ id, param });
    else navigate(() => setPage({ id, param }));
  };
  const groups = [
    { group: 'Workspace', items: [{ id: 'overview', label: 'Overview', icon: 'home' }, { id: 'clients', label: 'Clients', icon: 'users' }, { id: 'leads', label: 'Leads', icon: 'users' }, { id: 'plans', label: 'Service plans', icon: 'wallet' }] },
    { group: 'Billing', items: [{ id: 'collections', label: 'Collections', icon: 'wallet' }, { id: 'subscriptions', label: 'Subscriptions', icon: 'sync' }, { id: 'invoices', label: 'Invoices', icon: 'file' }, { id: 'payments', label: 'Payments', icon: 'sale' }, { id: 'revenue', label: 'Revenue reports', icon: 'chart' }, { id: 'paysettings', label: 'Payment settings', icon: 'settings' }] },
    { group: 'Administration', items: [{ id: 'audit', label: 'Audit log', icon: 'file' }, { id: 'admins', label: 'Administrators', icon: 'users' }, { id: 'security', label: 'Account security', icon: 'shield' }, { id: 'contact', label: 'Support contact', icon: 'help' }, { id: 'problems', label: 'Problem reports', icon: 'help' }] },
  ];
  const current = groups.flatMap((g) => g.items).find((item) => item.id === (page.id === 'client' ? 'clients' : page.id))!;
  return <WorkspaceShell pageKey={JSON.stringify([page.id, page.param])} pageLabel={page.id === 'client' ? 'Client details' : undefined} footerActions={<ReportProblemNavItem />} primaryIds={['overview', 'clients', 'collections', 'invoices', 'payments']} groups={groups} current={current} onNavigate={go} workspace="Mansora" workspaceLabel="Platform administration" user="Administrator" userRole="Platform team" guide={ADMIN_GUIDES[page.id]} onSignOut={async () => { await api('POST', '/v1/admin/logout').catch(() => {}); setToken(null); setSignedIn(false); }}>
      <div key={page.id + (page.param ?? '')}>
        {page.id === 'overview' && <Overview go={go} />}
        {page.id === 'clients' && <Clients go={go} />}
        {page.id === 'leads' && <Leads />}
        {page.id === 'client' && page.param && <Client id={page.param} go={go} />}
        {page.id === 'plans' && <Plans />}
        {page.id === 'collections' && <Collections go={go} />}
        {page.id === 'subscriptions' && <Subscriptions go={go} />}
        {page.id === 'invoices' && <Invoices />}
        {page.id === 'payments' && <Payments />}
        {page.id === 'revenue' && <RevenueReports />}
        {page.id === 'paysettings' && <PaymentSettings />}
        {page.id === 'audit' && <Audit />}
        {page.id === 'admins' && <Administrators />}
        {page.id === 'security' && <AccountSecurity />}
        {page.id === 'contact' && <ContactSettings />}
        {page.id === 'problems' && <ProblemReports />}
      </div>
      <ReportProblemButton page={current?.label ?? page.id} onSubmit={(r) => api('POST', '/v1/admin/bug-reports', r)} />
    </WorkspaceShell>;
}

/** Problem reports from shops and administrators. They are also emailed to Mansora every evening at 7pm. */
function ProblemReports() {
  const query = useApi<any[]>('/v1/admin/bug-reports');
  const kind: Record<string, string> = { blocking: 'Stops work', normal: 'Problem', idea: 'Idea' };
  return (
    <div>
      <PageHeader title="Problem reports" subtitle="What shop staff and administrators reported with Report a problem. All new reports are emailed to Mansora at 7pm each day." />
      <QueryView query={query} label="problem reports"><Card pad={false}>
        <Table rows={query.data ?? []} rowKey={(r: any) => r.id} empty="No problem reports yet"
          columns={[{ header: 'When', cell: (r: any) => new Date(r.created_at).toLocaleString('en-GB') }, { header: 'Kind', cell: (r: any) => <Badge tone={r.severity === 'blocking' ? 'bad' : r.severity === 'idea' ? 'info' : 'warn'}>{kind[r.severity] ?? r.severity}</Badge> },
            { header: 'From', cell: (r: any) => `${r.reporter_name ?? 'Unknown'}${r.reporter_role ? ` (${r.reporter_role})` : ''} · ${r.source === 'admin' ? 'Dashboard' : (r.shop ?? 'Shop')}` },
            { header: 'Page', cell: (r: any) => r.page ?? '' }, { header: 'Pointed at', cell: (r: any) => r.area?.label ?? '' },
            { header: 'What happened', cell: (r: any) => <span className="whitespace-pre-wrap">{r.description}</span> }, { header: 'Emailed', cell: (r: any) => r.digest_day ?? 'Tonight' }]} />
      </Card></QueryView>
    </div>
  );
}

/** Opened from an emailed invitation: the invited person chooses their own administrator password. */
function AcceptInvitation({ token, onDone }: { token: string; onDone: (email: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { run, busy, error } = useAction();
  const mismatch = confirm.length > 0 && password !== confirm;
  return (
    <AuthLayout platform>
      <form className="m-auth-card w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow-2xl" aria-label="Accept administrator invitation" onSubmit={(e) => { e.preventDefault(); if (mismatch) return; run(async () => { const r = await api('POST', '/v1/admin/invitations/accept', { token, password }); onDone(r.email); }); }}>
        <div><div className="mb-5"><MansoraBrand /></div><h1 className="text-2xl font-semibold">Set up your administrator account</h1></div>
        <p className="text-sm text-slate-600">Choose a password of at least 12 characters. This link works once. After signing in, turn on two-factor authentication under Account security.</p>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="New password"><Input type="password" minLength={12} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus /></Field>
        <Field label="Repeat password" error={mismatch ? 'The two passwords do not match' : undefined}><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || password.length < 12 || password !== confirm}>Create my account</Button>
      </form>
    </AuthLayout>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  // The invitation token arrives in the URL fragment and is removed from history straight away.
  const [invite, setInvite] = useState<string | null>(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('admin-invite');
    if (token) history.replaceState(null, '', window.location.pathname + window.location.search);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  });
  const [welcome, setWelcome] = useState<string | null>(null);
  if (invite) return <AcceptInvitation token={invite} onDone={(address) => { setInvite(null); setWelcome(address); }} />;
  return <PasswordLogin onDone={onDone} initialEmail={welcome ?? ''} welcome={!!welcome} />;
}

function PasswordLogin({ onDone, initialEmail, welcome }: { onDone: () => void; initialEmail: string; welcome: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { run, busy, error } = useAction();
  const signIn = () => run(async () => {
    const result = challenge
      ? await api('POST', '/v1/admin/login/totp', { challenge, code })
      : await api('POST', '/v1/admin/login', { email, password });
    setPassword('');
    if (result.requiresTotp) { setChallenge(result.challenge); setCode(''); return; }
    setToken(result.token);
    onDone();
  });
  return (
    <AuthLayout platform>
      <form className="m-auth-card w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow-2xl" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
        <div><div className="mb-5"><MansoraBrand /></div><h1 className="text-2xl font-semibold">{challenge ? 'Two-factor verification' : 'Administrator sign in'}</h1></div>
        {welcome && !error && <Alert tone="good">Your administrator account is ready. Sign in with your new password.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
        {challenge ? <>
          <p className="text-sm text-slate-600">Enter a code from your authenticator app, or one of your unused recovery codes. This sign-in challenge expires after five minutes.</p>
          <Field label="Authenticator or recovery code"><Input key="second-factor" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" maxLength={64} /></Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !code.trim()}>Verify and sign in</Button>
          <Button disabled={busy} onClick={() => { setChallenge(null); setCode(''); }}>Back to password sign in</Button>
        </> : <>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email || !password}>Sign in</Button>
        </>}
      </form>
    </AuthLayout>
  );
}

function Administrators() {
  const list = useApi<{ admins: any[]; invitations: any[] }>('/v1/admin/admins');
  const [f, setF] = useState({ name: '', email: '' });
  const { run, busy, error } = useAction();
  const [sent, setSent] = useState<string | null>(null);
  return <div className="max-w-3xl space-y-4">
    <PageHeader title="Administrators" subtitle="People who can manage Mansora's clients, billing and support. Every administrator has full access." />
    {error && <Alert tone="bad">{error}</Alert>}
    {sent && <Alert tone="good">{sent}</Alert>}
    <Card title="Invite an administrator">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api('POST', '/v1/admin/admins/invitations', f); setSent(`Invitation emailed to ${f.email}. The link works once, until ${when(r.expiresAt)}.`); setF({ name: '', email: '' }); list.reload(); }); }}>
        <p className="text-sm text-slate-600">They receive a private link to choose their own password. You never see or send a password. Ask them to turn on two-factor authentication after signing in.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} autoComplete="off" /></Field>
        </div>
        <Button type="submit" variant="primary" disabled={busy || !f.name.trim() || !f.email.trim()}>Send invitation</Button>
      </form>
    </Card>
    <QueryView query={list} label="administrators">{list.data && <>
      <Card title="Administrators" pad={false}><Table rows={list.data.admins} rowKey={(r: any) => r.id} columns={[{ header: 'Name', cell: (r: any) => r.name }, { header: 'Email', cell: (r: any) => r.email }, { header: 'Two-factor', cell: (r: any) => <Badge tone={r.two_factor ? 'good' : 'warn'}>{r.two_factor ? 'On' : 'Off'}</Badge> }, { header: 'Status', cell: (r: any) => r.status }]} /></Card>
      <Card title="Pending invitations" pad={false}><Table rows={list.data.invitations} rowKey={(r: any) => r.id} empty="No pending invitations" columns={[{ header: 'Name', cell: (r: any) => r.name }, { header: 'Email', cell: (r: any) => r.email }, { header: 'Expires', cell: (r: any) => when(r.expires_at) }, { header: '', align: 'right', cell: (r: any) => <Button size="sm" disabled={busy} onClick={() => run(async () => { await api('POST', `/v1/admin/admins/invitations/${r.id}/cancel`, {}); setSent(null); list.reload(); })}>Cancel</Button> }]} /></Card>
    </>}</QueryView>
  </div>;
}

function AccountSecurity() {
  const securityQuery = useApi<{ enabled: boolean; recoveryCodesRemaining: number }>('/v1/admin/totp');
  const { data, reload } = securityQuery;
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrolment, setEnrolment] = useState<{ secret: string; uri: string; expiresAt: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const { run, busy, error } = useAction();
  if (!data) return <QueryView query={securityQuery} label="account security">{null}</QueryView>;
  return <div className="max-w-2xl space-y-4">
    <PageHeader title="Account security" subtitle="Protect your Mansora administrator account with an authenticator app." />
    {error && <Alert tone="bad">{error}</Alert>}
    {recoveryCodes ? <Card title="Save your recovery codes">
      <Alert tone="warn">These ten codes are shown once. Store them securely away from this browser. Each code works once in place of an authenticator code. Your other sessions have been signed out.</Alert>
      <ul className="my-4 grid grid-cols-2 gap-2 font-mono" data-testid="totp-recovery-codes">{recoveryCodes.map((value) => <li key={value}>{value}</li>)}</ul>
      <Button variant="primary" onClick={() => { setRecoveryCodes(null); reload(); }}>I have saved my recovery codes</Button>
    </Card> : enrolment ? <Card title="Connect your authenticator">
      <p className="text-sm">In your authenticator app, add an account named Mansora using this setup key. Choose time-based codes, SHA-1, six digits and a 30-second period. This setup expires {when(enrolment.expiresAt)}.</p>
      <p className="my-4 break-all rounded bg-slate-100 p-3 font-mono select-all" data-testid="totp-secret">{enrolment.secret}</p>
      <details className="mb-4 text-sm"><summary>Authenticator setup URI</summary><code className="break-all">{enrolment.uri}</code></details>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => {
        const result = await api('POST', '/v1/admin/totp/confirm', { code });
        setRecoveryCodes(result.recoveryCodes); setEnrolment(null); setCode(''); reload();
      }); }}>
        <Field label="Authenticator code"><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} /></Field>
        <div className="flex gap-2"><Button type="submit" variant="primary" disabled={busy || !/^\d{6}$/.test(code)}>Enable two-factor authentication</Button><Button disabled={busy} onClick={() => { setEnrolment(null); setCode(''); }}>Cancel setup</Button></div>
      </form>
    </Card> : <Card title="Two-factor authentication">
      <p className="mb-3"><Badge tone={data.enabled ? 'good' : 'warn'}>{data.enabled ? 'Enabled' : 'Not enabled'}</Badge></p>
      {data.enabled ? <>
        <p className="mb-3 text-sm">Password sign-in also requires your authenticator or a recovery code. You have {data.recoveryCodesRemaining} unused recovery codes.</p>
        <Button variant="danger" onClick={() => { setDisabling(true); setPassword(''); setCode(''); }}>Disable two-factor authentication</Button>
      </> : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => {
        const result = await api('POST', '/v1/admin/totp/enrol', { password });
        setPassword(''); setEnrolment(result); setCode('');
      }); }}>
        <p className="text-sm">Confirm your password to start setup. Keep your authenticator and recovery codes private.</p>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" variant="primary" disabled={busy || !password}>Set up authenticator</Button>
      </form>}
    </Card>}
    {disabling && <Modal open title="Disable two-factor authentication" onClose={() => { setDisabling(false); setPassword(''); setCode(''); }}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => {
        await api('POST', '/v1/admin/totp/disable', { password, code });
        setPassword(''); setCode(''); setToken(null); window.dispatchEvent(new Event('mansora:signed-out'));
      }); }}>
        <Alert tone="warn">This removes your second sign-in step and invalidates all sessions and recovery codes. You will need to sign in again.</Alert>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Current password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></Field>
        <Field label="Authenticator or recovery code"><Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={64} /></Field>
        <Button type="submit" variant="danger" disabled={busy || !password || !code.trim()}>Confirm disable</Button>
      </form>
    </Modal>}
  </div>;
}

function Overview({ go }: { go: (id: string, param?: string) => void }) {
  const overviewQuery = useApi<any>('/v1/admin/overview');
  const { data: d } = overviewQuery;
  if (!d) return <QueryView query={overviewQuery} label="platform overview">{null}</QueryView>;
  const n = (list: any[], status: string) => list.find((x) => x.status === status)?.count ?? 0;
  const total = d.clientsByStatus.reduce((a: number, c: any) => a + c.count, 0);
  return (
    <div>
      <PageHeader title="Overview" subtitle="Your client portfolio, onboarding progress and service health. Client financial data stays in its own workspace." actions={<Button variant="primary" onClick={() => go('clients')}>View client directory</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Stat label="Client businesses" value={total} hint={`${n(d.clientsByStatus, 'onboarding')} being onboarded · ${n(d.subscriptionsByStatus, 'active') + n(d.subscriptionsByStatus, 'trial')} active plans`} />
        <Stat label="Live" value={n(d.clientsByStatus, 'active')} tone="good" />
        <Stat label="Need attention" value={d.needsAttention.length} tone={d.needsAttention.length ? 'warn' : 'good'} />
      </div>
      <div className="m-task-links"><Button onClick={() => go('collections')}>Review collections</Button><Button onClick={() => go('invoices')}>Review invoices</Button><Button onClick={() => go('security')}>Account security</Button></div>
      <div>
        <Card title="Live clients needing support attention" pad={false}>
          <Table rows={d.needsAttention} rowKey={(r: any) => r.id} onRowClick={(r: any) => go('client', r.id)} empty="All live clients are syncing and backed up"
            columns={[{ header: 'Client', cell: (r: any) => r.name }, { header: 'Last sync', cell: (r: any) => ago(r.last_sync_at) }, { header: 'Unsynced', align: 'right', cell: (r: any) => r.pending_count ?? '—' }, { header: 'Last backup', cell: (r: any) => ago(r.last_backup_at) }]} />
        </Card>
      </div>
      <ShopActivity go={go} />
      <Disclosure title="Onboarding & plan details" description="Setup progress, upcoming renewals and clients per plan"><div className="grid gap-4 xl:grid-cols-2">
        <Card title="Onboarding in progress" pad={false}>
          <Table rows={d.onboarding} rowKey={(r: any) => r.id} onRowClick={(r: any) => go('client', r.id)} empty="No clients are being onboarded" columns={[{ header: 'Client', cell: (r: any) => r.name }, { header: 'Progress', cell: (r: any) => <Progress done={r.done} total={r.total} /> }]} />
        </Card>
        <Card title="Renewals due in the next 30 days" pad={false}>
          <Table rows={d.renewalsDue} rowKey={(r: any) => r.id} onRowClick={(r: any) => go('client', r.id)} empty="No renewals due" columns={[{ header: 'Client', cell: (r: any) => r.name }, { header: 'Plan', cell: (r: any) => r.plan_name }, { header: 'Renewal', cell: (r: any) => day(r.renewal_date) }, { header: 'Status', cell: (r: any) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> }]} />
        </Card>
        <Card title="Clients per plan" pad={false}><Table rows={d.plans} empty="No plans yet" columns={[{ header: 'Plan', cell: (r: any) => r.name }, { header: 'Clients', align: 'right', cell: (r: any) => r.clients }]} /></Card>
      </div></Disclosure>
    </div>
  );
}

const USAGE: Record<string, { text: string; tone: 'good' | 'info' | 'warn' | 'bad' }> = { active: { text: 'Active', tone: 'good' }, slowing: { text: 'No sales for 2+ days', tone: 'warn' }, quiet: { text: 'No sales for 7+ days', tone: 'bad' }, never_sold: { text: 'No sales yet', tone: 'info' }, no_device: { text: 'Not set up', tone: 'info' } };
/** C34: whether each shop is using the till. Counts only; no amounts leave the shop for this. */
function ShopActivity({ go }: { go: (id: string, param?: string) => void }) {
  const q = useApi<any[]>('/v1/admin/activity');
  return <div className="mt-5"><Card title="Shop activity" pad={false} actions={<span className="text-xs text-slate-500">Counts reported at each sync</span>}>
    <QueryView query={q} label="shop activity"><Table rows={q.data} rowKey={(r: any) => r.id} onRowClick={(r: any) => go('client', r.id)} empty="No client shops yet"
      columns={[{ header: 'Client', cell: (r: any) => r.name }, { header: 'Usage', cell: (r: any) => <Badge tone={USAGE[r.usage]?.tone ?? 'info'}>{USAGE[r.usage]?.text ?? r.usage}</Badge> }, { header: 'Sales today', align: 'right', cell: (r: any) => r.sales_today }, { header: 'Staff active today', align: 'right', cell: (r: any) => r.staff_active_today }, { header: 'Last sale', cell: (r: any) => ago(r.last_sale_at) }, { header: 'Last sync', cell: (r: any) => ago(r.last_sync_at) }]} /></QueryView>
  </Card></div>;
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Onboarding progress" aria-valuenow={done} aria-valuemax={total}><div className="h-full bg-brand-600" style={{ width: `${(done / total) * 100}%` }} /></div>
      <span className="text-xs tabular-nums text-slate-600">{done}/{total}</span>
    </div>
  );
}

const EMPTY_CLIENT = { name: '', ownerName: '', phone: '', email: '', address: '', businessType: 'retail', supportContact: '' };
const BUSINESS_TYPES = ['retail', 'mini mart', 'general merchandise', 'wholesale', 'other'];
function ClientFields({ f, setF }: { f: any; setF: (f: any) => void }) {
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Business name"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
      <Field label="Primary owner"><Input value={f.ownerName} onChange={set('ownerName')} /></Field>
      <Field label="Phone"><Input value={f.phone ?? ''} onChange={set('phone')} /></Field>
      <Field label="Email"><Input type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
      <Field label="Address" className="col-span-2"><Input value={f.address ?? ''} onChange={set('address')} /></Field>
      <Field label="Business type"><Select value={f.businessType} onChange={set('businessType')}>{BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Assigned support contact"><Input value={f.supportContact ?? ''} onChange={set('supportContact')} /></Field>
    </div>
  );
}

function Clients({ go }: { go: (id: string, param?: string, afterSave?: boolean) => void }) {
  const clientsQuery = useApi<any[]>('/v1/admin/clients');
  const { data, reload } = clientsQuery;
  const planOptions = useApi<any[]>('/v1/admin/plans');
  const plans = planOptions.data ?? [];
  const [adding, setAdding] = useState<any | null>(null);
  const { run, busy, error } = useAction();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const query = search.trim().toLocaleLowerCase();
  const filtered = data?.filter((client) => (status === 'all' || client.status === status) &&
    [client.name, client.owner_name, client.phone, client.email, client.support_contact].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)));
  return (
    <div>
      <PageHeader title="Clients" subtitle={data ? `${filtered?.length ?? 0} of ${data.length} business(es)` : undefined} actions={<Button variant="primary" onClick={() => setAdding({ ...EMPTY_CLIENT, planId: '' })}>Add client</Button>} />
      <div className="mb-3 flex flex-wrap gap-3">
        <Input aria-label="Search clients" placeholder="Business, owner, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select aria-label="Client status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs">
          <option value="all">All statuses</option>{['onboarding', 'active', 'suspended', 'closed'].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
      </div>
      <QueryView query={clientsQuery} label="clients"><Card pad={false}>
        <Table rows={filtered} rowKey={(r) => r.id} onRowClick={(r) => go('client', r.id)} empty={query || status !== 'all' ? 'No clients match these filters' : 'No clients yet'}
          columns={[
            { header: 'Business', cell: (c) => <><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{c.owner_name} · {c.business_type}</div></> },
            { header: 'Status', cell: (c) => <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge> },
            { header: 'Plan', cell: (c) => c.plan_name ?? '—' },
            { header: 'Setup', cell: (c) => <Progress done={c.steps_done} total={c.steps_total} /> },
            { header: 'Laptop', cell: (c) => (c.connectivity === 'no_device' ? <Badge>Not activated</Badge> : <Badge tone={c.connectivity === 'online' ? 'good' : 'warn'}>{c.connectivity === 'online' ? 'Online' : 'Offline'}</Badge>) },
            { header: 'Last sync', cell: (c) => ago(c.last_sync_at) },
            { header: 'Unsynced', align: 'right', cell: (c) => c.pending_count ?? '—' },
            { header: 'Version', cell: (c) => c.app_version ?? '—' },
          ]} />
      </Card></QueryView>
      {adding && (
        <Modal title="Add client" open onClose={() => setAdding(null)} wide
          footer={<><Button dismiss onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" disabled={busy || !adding.name.trim() || !adding.ownerName.trim() || (!!adding.planId && !planOptions.data)} onClick={() => run(async () => { const r = await api('POST', '/v1/admin/clients', { ...adding, planId: adding.planId || null }); setAdding(null); reload(); go('client', r.id, true); })}>Create client</Button></>}>
          {error && <Alert tone="bad" className="mb-3">{error}</Alert>}
          <ClientFields f={adding} setF={setAdding} />
          <QueryView query={planOptions} label="service plan options"><Field label="Service plan" className="mt-3"><Select value={adding.planId} onChange={(e) => setAdding({ ...adding, planId: e.target.value })}><option value="">Decide later</option>{plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field></QueryView>
        </Modal>
      )}
    </div>
  );
}

function Client({ id, go }: { id: string; go: (id: string, param?: string) => void }) {
  const clientQuery = useApi<any>(`/v1/admin/clients/${id}`);
  const { data, reload } = clientQuery;
  const planOptions = useApi<any[]>('/v1/admin/plans');
  const plans = planOptions.data ?? [];
  const [edit, setEdit] = useState<any | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [browserWorkspace, setBrowserWorkspace] = useState<{ status: string; url: string; expiresAt?: string } | null>(null);
  const [sub, setSub] = useState<any | null>(null);
  const [recovery, setRecovery] = useState<{ reason: string; code?: string; expiresAt?: string } | null>(null);
  const act = useAction();
  const [revoking, setRevoking] = useState(false);
  const [tab, setTab] = useState<'overview' | 'audit'>('overview');
  const [stepOverrides, setStepOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => setStepOverrides({}), [data]);
  if (!data) return <QueryView query={clientQuery} label="client details">{null}</QueryView>;
  const c = data.client;
  const device = data.devices.find((d: any) => d.status === 'active');
  return (
    <div>
      <button className="mb-2 text-sm text-brand-700 hover:underline" onClick={() => go('clients')}>← All clients</button>
      <PageHeader title={c.name} subtitle={<>{c.owner_name} · {[c.phone, c.email, c.address].filter(Boolean).join(' · ')} · Support: {c.support_contact ?? '—'}</>}
        actions={<><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge><Button onClick={() => setEdit({ name: c.name, ownerName: c.owner_name, phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', businessType: c.business_type, supportContact: c.support_contact ?? '', status: c.status })}>Edit</Button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Client overview' }, { id: 'audit', label: 'Client audit' }]} />
      {tab === 'audit' && <Audit tenantId={id} />}
      <div hidden={tab !== 'overview'}>
      {act.error && <Alert tone="bad" className="mb-3">{act.error}</Alert>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Onboarding checklist" pad={false} actions={<Progress done={c.steps_done} total={c.steps_total} />}>
          <p className="border-b border-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600">Tick a step only after checking it with the client. Confirm go-live marks an onboarding client as active; this checklist does not automatically verify hardware, training, contracts or privacy arrangements.</p>
          <ul>
            {data.onboarding.map((s: any, i: number) => (
              <li key={s.step} className="m-onboarding-step flex items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-0">
                <input type="checkbox" id={s.step} checked={stepOverrides[s.step] ?? !!s.completed_at} disabled={act.busy} className="h-4 w-4"
                  onChange={(e) => {
                    const completed = e.target.checked;
                    setStepOverrides((previous) => ({ ...previous, [s.step]: completed }));
                    act.run(async () => {
                      try { await api('PUT', `/v1/admin/clients/${id}/onboarding/${s.step}`, { completed, notes: s.notes }); reload(); }
                      catch (error) { setStepOverrides((previous) => { const next = { ...previous }; delete next[s.step]; return next; }); throw error; }
                    });
                  }} />
                <label htmlFor={s.step} className="flex-1 text-sm"><span className="mr-1 text-slate-600">{i + 1}.</span>{s.label}{s.notes && <span className="text-xs text-slate-500"> — {s.notes}</span>}</label>
                <span className="m-onboarding-completed text-xs text-slate-500">{s.completed_at ? `${when(s.completed_at)}${s.completed_by_name ? ` · ${s.completed_by_name}` : ''}` : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="Client health">
            {c.data_may_be_incomplete && <Alert tone="warn" className="mb-3">Cloud data for this client may be incomplete: {device ? 'the laptop has changes that have not synced yet, or has not synced recently.' : 'no laptop is activated.'}</Alert>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[['Laptop', device ? `${device.name} (${c.connectivity})` : 'Not activated'], ['App version', c.app_version ?? '—'], ['Last successful sync', `${when(c.last_sync_at)} (${ago(c.last_sync_at)})`], ['Unsynced changes reported', c.pending_count ?? '—'], ['Last backup', `${when(c.last_backup_at)} (${ago(c.last_backup_at)})`], ['Setup', `${c.steps_done} of ${c.steps_total} steps`]].map(([k, v]) => (
                <div key={k as string} className="contents"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.browserWorkspaceAvailable && <Button size="sm" disabled={act.busy} onClick={() => act.run(async () => setBrowserWorkspace(await api('POST', `/v1/admin/clients/${id}/browser-workspace`)))}>Browser workspace</Button>}
              <Button size="sm" disabled={act.busy || !!device} title={device ? 'Deactivate the current laptop first' : ''} onClick={() => act.run(async () => setCode(await api('POST', `/v1/admin/clients/${id}/activation-codes`)))}>Create activation code</Button>
              {device && <Button size="sm" disabled={act.busy} onClick={() => setRecovery({ reason: '' })}>Owner recovery code</Button>}
              {device && <Button size="sm" variant="danger" disabled={act.busy} onClick={() => setRevoking(true)}>Deactivate laptop</Button>}
            </div>
          </Card>
          <Card title="Service plan" actions={<Button size="sm" onClick={() => setSub({ planId: c.plan_id ?? plans[0]?.id ?? '', status: c.subscription_status ?? 'trial', renewalDate: day(c.renewal_date) ?? '' })}>Change</Button>}>
            {c.plan_name ? <p className="text-sm"><strong>{c.plan_name}</strong> · <Badge tone={STATUS_TONE[c.subscription_status]}>{c.subscription_status}</Badge> · renews {day(c.renewal_date) ?? 'not set'}</p> : <p className="text-sm text-slate-500">No plan assigned</p>}
            <p className="mt-2 text-xs text-slate-500">Payments are recorded administratively. Changing the status here never stops a shop from selling.</p>
          </Card>
        </div>
        <SupportAccess id={id} grants={data.grants} />
        <Card title="Cloud backups (encrypted by the client; Mansora cannot open them)" pad={false}>
          <Table rows={data.backups} rowKey={(r: any) => r.id} empty="No backups stored in the cloud yet" columns={[{ header: 'Stored', cell: (b: any) => when(b.created_at) }, { header: 'Size', align: 'right', cell: (b: any) => `${Math.round(b.size_bytes / 1024)} KB` }, { header: 'Status', cell: (b: any) => b.status }]} />
        </Card>
      </div>
      </div>
      {revoking && device && <Modal title="Deactivate laptop" open onClose={() => !act.busy && setRevoking(false)}
        footer={<><Button dismiss disabled={act.busy} onClick={() => setRevoking(false)}>Cancel</Button><Button variant="danger" disabled={act.busy} onClick={() => act.run(async () => { await api('POST', `/v1/admin/devices/${device.id}/revoke`); setRevoking(false); reload(); })}>Deactivate laptop</Button></>}>
        <p className="text-sm">Deactivate {device.name}? This laptop will keep working offline but cannot sync until it is re-activated. This action is recorded.</p>
        {act.error && <Alert tone="bad" className="mt-3">{act.error}</Alert>}
      </Modal>}
      {edit && (
        <Modal title="Edit client" open onClose={() => setEdit(null)} wide footer={<><Button dismiss onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={act.busy} onClick={() => act.run(async () => { await api('PUT', `/v1/admin/clients/${id}`, edit); setEdit(null); reload(); })}>Save</Button></>}>
          <ClientFields f={edit} setF={setEdit} />
          <Field label="Account status" className="mt-3" hint="Suspending is recorded and shown to the client; it does not block sales."><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{['onboarding', 'active', 'suspended', 'closed'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </Modal>
      )}
      {sub && (
        <Modal title="Service plan" open onClose={() => setSub(null)} footer={<><Button dismiss onClick={() => setSub(null)}>Cancel</Button><Button variant="primary" disabled={act.busy || !planOptions.data || !sub.planId} onClick={() => act.run(async () => { await api('PUT', `/v1/admin/clients/${id}/subscription`, { ...sub, renewalDate: sub.renewalDate || null }); setSub(null); reload(); })}>Save</Button></>}>
          <div className="space-y-3">
            <QueryView query={planOptions} label="service plan options"><Field label="Plan"><Select value={sub.planId} onChange={(e) => setSub({ ...sub, planId: e.target.value })}><option value="">Choose…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatGHS(p.price)} {p.billing_period}</option>)}</Select></Field></QueryView>
            <Field label="Status"><Select value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}>{['trial', 'active', 'past_due', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Renewal date"><Input type="date" value={sub.renewalDate} onChange={(e) => setSub({ ...sub, renewalDate: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {recovery && (
        <Modal title="Owner password recovery" open onClose={() => setRecovery(null)}
          footer={recovery.code ? <Button variant="primary" onClick={() => setRecovery(null)}>Done</Button> : <><Button dismiss onClick={() => setRecovery(null)}>Cancel</Button><Button variant="primary" disabled={act.busy || !recovery.reason.trim()} onClick={() => act.run(async () => setRecovery({ ...recovery, ...(await api('POST', `/v1/admin/clients/${id}/recovery-codes`, { reason: recovery.reason })) }))}>Create code</Button></>}>
          {recovery.code ? (
            <>
              <p className="text-sm text-slate-600">Read this code to the owner. It works once, only on their activated laptop, and expires {when(recovery.expiresAt)}. They choose the new password themselves.</p>
              <p className="my-4 select-all rounded-lg bg-slate-900 py-4 text-center font-mono text-2xl tracking-widest text-white">{recovery.code}</p>
            </>
          ) : (
            <>
              <Alert tone="warn" className="mb-3">Confirm you are speaking to the business owner before creating a code. This action is recorded in the audit log and on the client's laptop.</Alert>
              <Field label="How did you verify the owner, and why is recovery needed?"><Textarea value={recovery.reason} onChange={(e) => setRecovery({ ...recovery, reason: e.target.value })} autoFocus /></Field>
            </>
          )}
        </Modal>
      )}
      {browserWorkspace && (
        <Modal title="Browser workspace" open onClose={() => setBrowserWorkspace(null)} footer={<Button variant="primary" onClick={() => { setBrowserWorkspace(null); reload(); }}>Done</Button>}>
          <p>{browserWorkspace.status === 'ready' ? 'The workspace is ready. The owner can sign in at this address.' : 'Share this private setup link only with the recorded business owner. They choose their own password. This link expires in 30 minutes.'}</p>
          <Field label="Workspace link"><Input readOnly value={browserWorkspace.url} onFocus={(event) => event.currentTarget.select()} /></Field>
        </Modal>
      )}
      {code && (
        <Modal title="Activation code" open onClose={() => { setCode(null); reload(); }} footer={<Button variant="primary" onClick={() => { setCode(null); reload(); }}>Done</Button>}>
          <p className="text-sm text-slate-600">Enter this code on the client's laptop. It works once and expires {when(code.expiresAt)}. It will not be shown again.</p>
          <p className="my-4 select-all rounded-lg bg-slate-900 py-4 text-center font-mono text-2xl tracking-widest text-white" data-testid="activation-code">{code.code}</p>
        </Modal>
      )}
    </div>
  );
}

function SupportAccess({ id, grants }: { id: string; grants: any[] }) {
  const [range, setRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const [report, setReport] = useState<any | null>(null);
  const { run, busy, error } = useAction();
  const active = grants.find((g) => !g.revoked_at && Date.parse(g.expires_at) > Date.now());
  return (
    <Card title="Client reports (owner's permission required)">
      {active ? <Alert tone="good" className="mb-3">The owner has allowed report access until {when(active.expires_at)}. Purpose: “{active.purpose}”. Every view is logged and shown to the owner.</Alert>
        : <Alert className="mb-3">No access. Ask the business owner to grant it on their laptop under <em>Mansora access</em>. You cannot see this client's sales without it.</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        <Button disabled={busy} onClick={() => run(async () => { setReport(null); setReport(await api('GET', `/v1/admin/clients/${id}/reports/summary?from=${range.from}&to=${range.to}`)); })}>View sales summary</Button>
      </div>
      {error && <Alert tone="bad" className="mt-3">{error}</Alert>}
      {report && (
        <div className="mt-3 space-y-3">
          {report.unsyncedOnDevice > 0 && <Alert tone="warn">Incomplete: the laptop reports {report.unsyncedOnDevice} change(s) not yet synced. Synced up to {when(report.syncedUpTo)}.</Alert>}
          <div className="grid grid-cols-3 gap-2"><Stat label="Net sales" value={formatGHS(report.sales.net)} /><Stat label="Transactions" value={report.sales.count} /><Stat label="Refunds" value={formatGHS(report.sales.refunds)} /></div>
          <Table rows={report.payments} empty="No payments" columns={[{ header: 'Paid by', cell: (r: any) => r.method }, { header: 'Amount', align: 'right', cell: (r: any) => formatGHS(r.total) }]} />
          <Table rows={report.topProducts} empty="No sales" columns={[{ header: 'Top products', cell: (r: any) => r.name }, { header: 'Qty', align: 'right', cell: (r: any) => r.quantity }, { header: 'Sales', align: 'right', cell: (r: any) => formatGHS(r.revenue) }]} />
          <p className="text-xs text-slate-500">{report.stock.products} active product(s), {report.stock.low} at or below reorder level.</p>
        </div>
      )}
      <details className="mt-3"><summary className="cursor-pointer text-sm text-slate-600">Access granted by the owner ({grants.length})</summary>
        <Table rows={grants} rowKey={(g) => g.id} empty="Never granted" columns={[{ header: 'From', cell: (g) => when(g.starts_at) }, { header: 'Until', cell: (g) => when(g.expires_at) }, { header: 'Purpose', cell: (g) => g.purpose }, { header: 'State', cell: (g) => (g.revoked_at ? 'Stopped by owner' : Date.parse(g.expires_at) < Date.now() ? 'Expired' : 'Active') }]} />
      </details>
    </Card>
  );
}

function Plans() {
  const plansQuery = useApi<any[]>('/v1/admin/plans');
  const { data, reload } = plansQuery;
  const [edit, setEdit] = useState<any | null>(null);
  const { run, busy, error } = useAction();
  const save = () => run(async () => {
    const body = { name: edit.name, price: parseGHS(edit.price), billingPeriod: edit.billingPeriod, includedSupport: edit.includedSupport, active: edit.active };
    await (edit.id ? api('PUT', `/v1/admin/plans/${edit.id}`, body) : api('POST', '/v1/admin/plans', body));
    setEdit(null);
    reload();
  });
  return (
    <div>
      <PageHeader title="Service plans" subtitle="Plans are recorded and managed here. Payments are not collected automatically in this version." actions={<Button variant="primary" onClick={() => setEdit({ name: '', price: '', billingPeriod: 'monthly', includedSupport: '', active: true })}>Add plan</Button>} />
      <QueryView query={plansQuery} label="service plans"><Card pad={false}>
        <Table rows={data} rowKey={(r) => r.id} empty="No plans yet" onRowClick={(p) => setEdit({ id: p.id, name: p.name, price: formatGHS(p.price, false).replace(/,/g, ''), billingPeriod: p.billing_period, includedSupport: p.included_support, active: p.active })}
          columns={[{ header: 'Plan', cell: (p) => <span className="font-medium">{p.name}</span> }, { header: 'Billing', cell: (p) => `${formatGHS(p.price)} ${p.billing_period}` }, { header: 'Included support', cell: (p) => p.included_support }, { header: 'Clients', align: 'right', cell: (p) => p.active_clients }, { header: 'Status', cell: (p) => (p.active ? <Badge tone="good">Offered</Badge> : <Badge>Retired</Badge>) }]} />
      </Card></QueryView>
      {edit && (
        <Modal title={edit.id ? 'Edit plan' : 'Add plan'} open onClose={() => setEdit(null)} footer={<><Button dismiss onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={busy || !edit.name.trim()} onClick={save}>Save</Button></>}>
          {error && <Alert tone="bad" className="mb-3">{error}</Alert>}
          <div className="space-y-3">
            <Field label="Plan name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Billing amount (GHS)" hint="Enter 0 only for an intentional free plan."><Input required pattern="[0-9]+(\.[0-9]{1,2})?" title="Enter a non-negative amount with up to two decimal places." inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} placeholder="0.00" /></Field>
              <Field label="Billing period"><Select value={edit.billingPeriod} onChange={(e) => setEdit({ ...edit, billingPeriod: e.target.value })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></Select></Field>
            </div>
            <Field label="Included support services"><Textarea value={edit.includedSupport} onChange={(e) => setEdit({ ...edit, includedSupport: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Offered to new clients</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Audit({ tenantId }: { tenantId?: string } = {}) {
  const auditQuery = useApi<any[]>(`/v1/admin/audit${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`);
  const { data } = auditQuery;
  return (
    <div>
      {!tenantId && <PageHeader title="Audit log" subtitle="Everything Mansora administrators do, including every attempt to view client data." />}
      <QueryView query={auditQuery} label="audit history"><Card title={tenantId ? "Client audit history" : undefined} pad={false}>
        <Table rows={data} rowKey={(r) => r.id} empty="No activity yet"
          columns={[{ header: 'When', cell: (l) => <span className="whitespace-nowrap">{when(l.occurred_at)}</span> }, { header: 'Administrator', cell: (l) => l.admin_name ?? 'System' }, { header: 'Action', cell: (l) => (l.action === 'support.access_denied' ? <Badge tone="bad">{l.action}</Badge> : <code className="text-xs">{l.action}</code>) }, { header: 'Client', cell: (l) => l.tenant_name ?? '' }, { header: 'Details', cell: (l) => <span className="break-all text-xs text-slate-600">{l.detail === '{}' ? '' : l.detail}</span> }]} />
      </Card></QueryView>
    </div>
  );
}
