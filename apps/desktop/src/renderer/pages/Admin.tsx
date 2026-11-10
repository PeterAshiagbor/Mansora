import { useRef, useState } from 'react';
import { ROLE_DEFAULTS, type Role } from '@mansora/domain';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table } from '@mansora/ui';
import { call, DateRange, dateTime, daysAgo, ExportButtons, fileToBase64, marginLabel, money, saveFile, today, useAction, useApp, useQuery } from '../lib';

// ---------------------------------------------------------------- Staff
export function StaffPage() {
  const { state } = useApp();
  const { data, reload } = useQuery<any[]>('staff.list');
  const [edit, setEdit] = useState<any | null>(null);
  const { run, busy } = useAction();
  const save = () => run(async () => {
    await call('staff.save', { id: edit.id, name: edit.name, username: edit.username, role: edit.role, status: edit.status, permissions: edit.permissions, ...(edit.password ? { password: edit.password } : {}) });
    setEdit(null);
    reload();
  }, 'Staff member saved');
  const owner = edit?.role === 'owner';
  return (
    <div>
      <PageHeader title="Staff" subtitle="Each person signs in with their own username so every action is traceable."
        actions={<Button variant="primary" onClick={() => setEdit({ name: '', username: '', role: 'cashier', status: 'active', permissions: ROLE_DEFAULTS.cashier, password: '' })}>Add staff member</Button>} />
      <Card pad={false}>
        <Table rows={data} rowKey={(r) => r.id} onRowClick={(u) => setEdit({ ...u, password: '' })}
          columns={[{ header: 'Name', cell: (u) => <span className="font-medium">{u.name}</span> }, { header: 'Username', cell: (u) => u.username }, { header: 'Role', cell: (u) => <span className="capitalize">{u.role}</span> }, { header: 'Status', cell: (u) => (u.status === 'active' ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Disabled</Badge>) }]} />
      </Card>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'Add staff member'} open onClose={() => setEdit(null)} wide
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={busy || !edit.name.trim() || !edit.username.trim() || (!edit.id && !edit.password)} onClick={save}>Save</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Username"><Input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} autoComplete="off" /></Field>
            <Field label="Role">
              <Select value={edit.role} disabled={owner} onChange={(e) => setEdit({ ...edit, role: e.target.value, permissions: ROLE_DEFAULTS[e.target.value as Role] })}>
                {owner && <option value="owner">Owner</option>}<option value="manager">Manager</option><option value="cashier">Cashier</option>
              </Select>
            </Field>
            <Field label="Status"><Select value={edit.status} disabled={owner} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Active</option><option value="disabled">Disabled (cannot sign in)</option></Select></Field>
            <Field label={edit.id ? 'New password (leave empty to keep)' : 'Password'} hint="At least 8 characters" className="col-span-2"><Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" /></Field>
          </div>
          {!owner && (
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium text-slate-700">What this person is allowed to do</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(state.permissions).filter(([p]) => !['staff.manage', 'support.grant'].includes(p)).map(([p, label]) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={edit.permissions.includes(p)} onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x: string) => x !== p) })} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {owner && <p className="mt-3 text-sm text-slate-600">The owner can do everything. The owner account cannot be disabled or changed to another role here.</p>}
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Settings
export function SettingsPage() {
  const { state, refresh, can } = useApp();
  const [f, setF] = useState({ ...state.business, lockMinutes: String(state.business.lockMinutes), maxDiscountPercent: String(state.business.maxDiscountBps / 100) });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const { run, busy } = useAction();
  const manage = can('settings.manage');
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" />
      {manage && (
        <Card title="Business profile (printed on receipts)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Business name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Address" className="col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="Receipt footer message" className="col-span-2"><Input value={f.receiptFooter} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} placeholder="Thank you for your purchase" /></Field>
            <Field label="Lock screen after (minutes without activity)"><Input type="number" min={1} max={240} value={f.lockMinutes} onChange={(e) => setF({ ...f, lockMinutes: e.target.value })} /></Field>
            <Field label="Discount limit (% of the basket)" hint="0 means no limit. Above the limit only the owner can approve a discount."><Input type="number" min={0} max={100} value={f.maxDiscountPercent} disabled={state.user?.role !== 'owner'} onChange={(e) => setF({ ...f, maxDiscountPercent: e.target.value })} /></Field>
            <div className="flex items-end pb-2 text-sm text-slate-600">Currency: Ghana cedi (GHS)</div>
            <label className="col-span-2 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={f.allowNegativeStock} disabled={state.user?.role !== 'owner'} onChange={(e) => setF({ ...f, allowNegativeStock: e.target.checked })} />
              <span>Allow selling when the system shows no stock <span className="text-slate-500">(owner only; not recommended. Leave off so that stock records stay trustworthy.)</span></span>
            </label>
          </div>
          <Button variant="primary" className="mt-4" disabled={busy || !f.name.trim()} onClick={() => run(async () => { await call('business.update', { name: f.name, phone: f.phone, address: f.address, receiptFooter: f.receiptFooter, lockMinutes: Number(f.lockMinutes) || 10, allowNegativeStock: f.allowNegativeStock, maxDiscountPercent: Math.min(100, Math.max(0, Math.floor(Number(f.maxDiscountPercent) || 0))) }); await refresh(); }, 'Settings saved')}>Save settings</Button>
        </Card>
      )}
      <Card title="Change my password">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Current password"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Repeat new password" error={pw.confirm && pw.confirm !== pw.next ? 'Does not match' : null}><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <Button className="mt-4" disabled={busy || !pw.current || !pw.next || pw.next !== pw.confirm} onClick={() => run(async () => { await call('auth.changePassword', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', confirm: '' }); }, 'Password changed')}>Change password</Button>
      </Card>
      <p className="text-xs text-slate-500">Mansora Sales &amp; Stock version {state.appVersion}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Import & export
const FIELD_LABEL: Record<string, string> = { name: 'Product name *', sku: 'SKU', barcode: 'Barcode', category: 'Category', unit: 'Unit', cost_price: 'Unit cost price (GHS)', carton_cost: 'Carton cost (GHS)', units_per_carton: 'Selling units per carton', selling_price: 'Selling price *', opening_stock: 'Opening stock', reorder_level: 'Reorder level' };
export function DataPage() {
  const { can } = useApp();
  const history = useQuery<any[]>('import.history');
  const [file, setFile] = useState<{ fileName: string; contentBase64: string } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const load = (f: { fileName: string; contentBase64: string }, mapping?: Record<string, string>) => run(async () => { setFile(f); setConfirm(false); setPreview(await call('import.preview', { ...f, mapping })); });
  const rows: any[] = preview?.rows ?? [];
  const errors = rows.filter((r) => r.errors.length).length;
  const dups = rows.filter((r) => r.duplicate && !r.errors.length).length;
  const good = rows.length - errors - dups;
  const hasStock = rows.some((r) => !r.duplicate && !r.errors.length && r.data.openingStock > 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Import & export" />
      <Card title="Import products and opening stock" actions={<><Button size="sm" onClick={() => run(async () => saveFile(await call('import.template', { format: 'xlsx' })))}>Download Excel template</Button><Button size="sm" onClick={() => run(async () => saveFile(await call('import.template', { format: 'csv' })))}>CSV template</Button></>}>
        <p className="mb-3 text-sm text-slate-600">Fill in the template (or use your own Excel / CSV list), then choose the file. You will see a preview before anything is saved. For carton costing, fill Carton cost and Units per carton; leave Cost price blank. Selling price and opening stock are per selling unit. Unit cost rounds to the nearest pesewa.</p>
        <input ref={input} type="file" accept=".xlsx,.csv" className="block text-sm" aria-label="Choose import file"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) load({ fileName: f.name, contentBase64: await fileToBase64(f) }); }} />
        {preview && file && (
          <div className="mt-4 space-y-3">
            {preview.alreadyImportedAt && <Alert tone="warn">This exact file was already imported on {dateTime(preview.alreadyImportedAt)}. It will not be imported again.</Alert>}
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Match your columns</legend>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(FIELD_LABEL).map(([field, label]) => (
                  <Field key={field} label={label}>
                    <Select value={preview.mapping[field] ?? ''} onChange={(e) => load(file, { ...preview.mapping, [field]: e.target.value || undefined })}>
                      <option value="">(not in my file)</option>{preview.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
            </fieldset>
            {preview.needsMapping ? <Alert tone="warn">Choose which columns hold the product name and the selling price.</Alert> : (
              <>
                <div className="flex gap-2"><Badge tone="good">{good} new product(s)</Badge>{dups > 0 && <Badge tone="warn">{dups} already exist (will be skipped)</Badge>}{errors > 0 && <Badge tone="bad">{errors} row(s) with errors</Badge>}</div>
                <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
                  <Table rows={rows} rowKey={(r) => r.rowNo} columns={[
                    { header: 'Row', cell: (r) => r.rowNo }, { header: 'Product', cell: (r) => r.data.name }, { header: 'Barcode', cell: (r) => r.data.barcode ?? '' }, { header: 'Category', cell: (r) => r.data.category ?? '' },
                    { header: 'Cost', align: 'right', cell: (r) => money(r.data.costPrice) }, { header: 'Selling price', align: 'right', cell: (r) => money(r.data.sellingPrice) }, ...(can('product.cost') ? [{ header: 'Gross margin', align: 'right' as const, cell: (r: any) => marginLabel(r.data.sellingPrice, r.data.costPrice) }] : []), { header: 'Opening stock', align: 'right', cell: (r) => r.data.openingStock },
                    { header: 'Result', cell: (r) => (r.errors.length ? <Badge tone="bad">{r.errors.join('; ')}</Badge> : r.duplicate ? <Badge tone="warn">{r.duplicate}</Badge> : <Badge tone="good">Will be added</Badge>) },
                  ]} />
                </div>
                {hasStock && <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm the opening stock quantities are what is physically in the shop</label>}
                <Button variant="primary" disabled={busy || errors > 0 || good === 0 || !!preview.alreadyImportedAt || (hasStock && !confirm)}
                  onClick={() => run(async () => { const r = await call('import.commit', { ...file, mapping: preview.mapping, confirmOpeningStock: confirm }); setPreview(null); setFile(null); if (input.current) input.current.value = ''; history.reload(); return r; }, `Imported ${good} product(s)`)}>
                  Import {good} product(s)
                </Button>
                {errors > 0 && <p className="text-sm text-red-700">Fix the rows with errors in your file and choose it again. Nothing has been imported.</p>}
              </>
            )}
          </div>
        )}
      </Card>
      <Card title="Import history" pad={false}>
        <Table rows={history.data} rowKey={(r) => r.id} empty="No imports yet" columns={[{ header: 'When', cell: (r) => dateTime(r.created_at) }, { header: 'File', cell: (r) => r.file_name }, { header: 'Added', align: 'right', cell: (r) => r.created_count }, { header: 'Skipped', align: 'right', cell: (r) => r.skipped_count }, { header: 'Opening stock', cell: (r) => (r.opening_stock_applied ? 'Applied' : '—') }, { header: 'By', cell: (r) => r.imported_by_name }]} />
      </Card>
      {can('data.export') && (
        <Card title="Export all business data">
          <p className="mb-3 text-sm text-slate-600">Your data belongs to your business. Download a complete copy at any time: products, stock movements, sales, payments, refunds, customers, credit, expenses, shifts and audit history.</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => run(async () => saveFile(await call('export.business', { format: 'xlsx' })), 'Export created')}>Download as Excel</Button>
            <Button disabled={busy} onClick={() => run(async () => saveFile(await call('export.business', { format: 'json' })), 'Export created')}>Download as JSON (for other systems)</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Sync
function SyncRepair({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const { run, busy } = useAction();
  return (
    <Card title="Repair tools (use only when Mansora support asks you to)" className="mt-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <p className="mb-2 text-sm text-slate-600"><strong>Re-link this laptop.</strong> After restoring a backup onto a replacement laptop, enter a new activation code from Mansora so this laptop gets its own identity. Your records are kept.</p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MNS-XXXX-XXXX-XXXX" aria-label="New activation code" />
            <Button disabled={busy || !code.trim()} onClick={() => run(async () => { await call('device.relink', { code, deviceName: 'Shop laptop' }); setCode(''); await call('sync.run'); onDone(); }, 'Laptop re-linked')}>Re-link</Button>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-slate-600"><strong>Send all records again.</strong> Queues everything already synced to be sent once more. The server ignores what it already has, so nothing is duplicated.</p>
          <Button disabled={busy} onClick={() => run(async () => { const r = await call('sync.requeue', {}); await call('sync.run'); onDone(); return r; }, 'Records queued and sent again')}>Send all records again</Button>
        </div>
      </div>
    </Card>
  );
}

export function SyncPage() {
  const { state } = useApp();
  const status = useQuery<any>('sync.status');
  const queue = useQuery<any[]>('sync.queue');
  const { run, busy } = useAction();
  const s = status.data;
  const label: Record<string, string> = { online: 'Online', offline: 'Offline', syncing: 'Syncing…', unknown: 'Not checked yet' };
  return (
    <div>
      <PageHeader title="Synchronisation status" subtitle="Sales are always saved on this laptop first. They are copied to the Mansora cloud when the internet is available."
        actions={<Button variant="primary" disabled={busy} onClick={() => run(async () => { const r = await call('sync.run'); status.reload(); queue.reload(); if (!r.ok) throw new Error(r.error ?? 'Sync did not complete'); }, 'Everything is synced')}>{busy ? 'Syncing…' : 'Sync now'}</Button>} />
      {s && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Connection" value={label[s.state]} tone={s.state === 'online' ? 'good' : s.state === 'offline' ? 'warn' : 'default'} />
            <Stat label="Waiting to sync" value={s.pending} tone={s.pending ? 'warn' : 'good'} hint={s.oldestPendingAt ? `Oldest from ${dateTime(s.oldestPendingAt)}` : 'Nothing waiting'} />
            <Stat label="Last successful sync" value={<span className="text-lg">{dateTime(s.lastSyncAt)}</span>} />
            <Stat label="Sync errors" value={s.rejected} tone={s.rejected ? 'bad' : 'default'} />
          </div>
          {s.lastError && <Alert tone="warn" className="mb-3">Last attempt: {s.lastError}. The app keeps working; it will try again automatically.</Alert>}
          {s.rejected > 0 && <Alert tone="bad" className="mb-3">{s.rejected} change(s) were refused by the server and need Mansora support. Your local records are intact.</Alert>}
          {s.unprotected > 0 && <Alert tone="warn" className="mb-3"><strong>{s.unprotected} change(s) exist only on this laptop.</strong> If the laptop is lost or damaged before they sync or are backed up, they cannot be recovered. Connect to the internet or make a backup.</Alert>}
        </>
      )}
      <Card title="Recent sync queue" pad={false}>
        <Table rows={queue.data} rowKey={(r) => r.seq} empty="Nothing has been recorded yet" columns={[
          { header: '#', cell: (r) => r.seq }, { header: 'What', cell: (r) => r.type }, { header: 'Recorded', cell: (r) => dateTime(r.occurred_at) },
          { header: 'Status', cell: (r) => (r.status === 'synced' ? <Badge tone="good">Synced</Badge> : r.status === 'rejected' ? <Badge tone="bad">Error</Badge> : <Badge tone="warn">Waiting</Badge>) },
          { header: 'Synced at', cell: (r) => dateTime(r.synced_at) }, { header: 'Note', cell: (r) => r.last_error ?? '' },
        ]} />
      </Card>
      {state.user?.role === 'owner' && <SyncRepair onDone={() => { status.reload(); queue.reload(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Backup
export function BackupPage() {
  const list = useQuery<any[]>('backup.list');
  const status = useQuery<any>('sync.status');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [verify, setVerify] = useState<any | null>(null);
  const [verifyPass, setVerifyPass] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const { run, busy } = useAction();
  return (
    <div className="space-y-4">
      <PageHeader title="Backup & recovery" subtitle="An encrypted copy of everything on this laptop, protected by a passphrase only you know." />
      {status.data && status.data.unprotected > 0 && <Alert tone="warn">{status.data.unprotected} recent change(s) are not yet in the cloud or in any backup.</Alert>}
      <Card title="Make a backup now">
        <div className="grid max-w-2xl grid-cols-2 gap-3">
          <Field label="Backup passphrase" hint="At least 10 characters. Write it down and keep it away from the laptop."><Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat passphrase" error={pass2 && pass !== pass2 ? 'Does not match' : null}><Input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <Alert tone="warn" className="mt-3 max-w-2xl">Without this passphrase the backup cannot be opened by anyone, including Mansora. There is no way to recover a forgotten passphrase.</Alert>
        <Button variant="primary" className="mt-3" disabled={busy || pass.length < 10 || pass !== pass2}
          onClick={() => run(async () => { const r = await call('backup.create', { passphrase: pass }); setPass(''); setPass2(''); list.reload(); status.reload(); setResult(r); })}>
          {busy ? 'Creating backup…' : 'Create encrypted backup'}
        </Button>
        {result && <Alert tone="good" className="mt-3 max-w-2xl">Backup created and checked: {result.summary.sales} sale(s), {result.summary.products} product(s). Saved to <code className="break-all">{result.path}</code>. {result.uploaded ? 'A copy was also stored in the Mansora cloud.' : 'No internet, so it was not copied to the cloud. Copy the file to a USB drive or another safe place.'}</Alert>}
      </Card>
      <AutoBackup enabled={!!status.data?.autoBackup} onChange={() => { status.reload(); list.reload(); }} />
      <Card title="Backups on this laptop" pad={false}>
        <Table rows={list.data} rowKey={(r) => r.id} empty="No backups yet" columns={[
          { header: 'Created', cell: (r) => dateTime(r.created_at) }, { header: 'Size', align: 'right', cell: (r) => `${(r.size_bytes / 1024).toFixed(0)} KB` },
          { header: 'Cloud copy', cell: (r) => (r.uploaded_at ? <Badge tone="good">Stored {dateTime(r.uploaded_at)}</Badge> : <Badge tone="warn">Local only</Badge>) }, { header: 'File', cell: (r) => <span className="break-all text-xs">{r.file_path}</span> },
          { header: '', align: 'right', cell: (r) => <Button size="sm" onClick={() => { setVerify(r); setVerifyPass(''); }}>Test this backup</Button> },
        ]} />
      </Card>
      <Card title="Restoring onto a replacement laptop">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Install Mansora Sales &amp; Stock on the new laptop. Do not activate it.</li>
          <li>On the activation screen choose <em>Restore from a backup instead</em>, enter the passphrase and pick the backup file.</li>
          <li>The app checks the backup, restores it and restarts. Staff sign in with their usual usernames.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Anything recorded after the backup was made and never synced cannot be recovered. See the Backup and Recovery guide.</p>
      </Card>
      {verify && (
        <Modal title="Test backup" open onClose={() => setVerify(null)} footer={<><Button onClick={() => setVerify(null)}>Close</Button><Button variant="primary" disabled={busy || !verifyPass} onClick={() => run(async () => setVerify({ ...verify, summary: await call('backup.verify', { id: verify.id, passphrase: verifyPass }) }))}>Open and check</Button></>}>
          <Field label="Backup passphrase"><Input type="password" value={verifyPass} onChange={(e) => setVerifyPass(e.target.value)} autoFocus /></Field>
          {verify.summary && <Alert tone="good" className="mt-3">The backup opens and passes its integrity checks. It contains {verify.summary.sales} sale(s) worth {money(verify.summary.salesTotal)}, {verify.summary.products} product(s), {verify.summary.users} staff login(s).</Alert>}
        </Modal>
      )}
    </div>
  );
}

function AutoBackup({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const { state } = useApp();
  const [pass, setPass] = useState('');
  const { run, busy } = useAction();
  if (state.user?.role !== 'owner') return null;
  return (
    <Card title="Automatic daily backup">
      {enabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="good">On</Badge>
          <span className="text-sm text-slate-600">A backup is made once a day while the app is open, and copied to the Mansora cloud when online. Restore it with the passphrase you chose. Do not rename the backup files.</span>
          <Button size="sm" disabled={busy} onClick={() => run(async () => { await call('backup.schedule', { enabled: false }); onChange(); }, 'Automatic backup switched off')}>Switch off</Button>
        </div>
      ) : (
        <div className="flex max-w-2xl flex-wrap items-end gap-3">
          <Field label="Passphrase for automatic backups" hint="At least 10 characters. The passphrase itself is not stored; you need it to restore." className="flex-1"><Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
          <Button disabled={busy || pass.length < 10} onClick={() => run(async () => { await call('backup.schedule', { enabled: true, passphrase: pass }); setPass(''); onChange(); }, 'Automatic daily backup switched on')}>Switch on</Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Mansora support access
export function SupportPage() {
  const { data, reload } = useQuery<any>('support.list');
  const [purpose, setPurpose] = useState('');
  const [hours, setHours] = useState('24');
  const { run, busy } = useAction();
  const state = (g: any) => (g.revoked_at ? 'revoked' : data && g.expires_at < data.now ? 'expired' : 'active');
  return (
    <div className="space-y-4">
      <PageHeader title="Mansora access" subtitle="Mansora staff cannot see your sales or reports unless you allow it here. You can stop access at any time." />
      <Card title="Allow Mansora to view my reports">
        <div className="grid max-w-2xl grid-cols-[1fr_10rem] gap-3">
          <Field label="Why is access needed?"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Help checking November stock report" /></Field>
          <Field label="For how long"><Select value={hours} onChange={(e) => setHours(e.target.value)}><option value="1">1 hour</option><option value="4">4 hours</option><option value="24">24 hours</option><option value="72">3 days</option></Select></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Access covers sales summaries only: totals, payment methods, best-selling products and stock counts. It never includes customer details or staff passwords. It takes effect the next time this laptop syncs.</p>
        <Button variant="primary" className="mt-3" disabled={busy || !purpose.trim()} onClick={() => run(async () => { await call('support.grant', { scope: 'reports', purpose, hours: Number(hours) }); setPurpose(''); reload(); call('sync.run').catch(() => {}); }, 'Access granted')}>Grant access</Button>
      </Card>
      <Card title="Access I have granted" pad={false}>
        <Table rows={data?.grants} rowKey={(r: any) => r.id} empty="You have never granted access" columns={[
          { header: 'Granted', cell: (g: any) => dateTime(g.created_at) }, { header: 'Purpose', cell: (g: any) => g.purpose }, { header: 'Until', cell: (g: any) => dateTime(g.expires_at) },
          { header: 'Status', cell: (g: any) => ({ active: <Badge tone="warn">Active</Badge>, expired: <Badge>Expired</Badge>, revoked: <Badge>Stopped</Badge> })[state(g)] },
          { header: '', align: 'right', cell: (g: any) => state(g) === 'active' && <Button size="sm" variant="danger" onClick={() => run(async () => { await call('support.revoke', { id: g.id }); reload(); call('sync.run').catch(() => {}); }, 'Access stopped')}>Stop access</Button> },
        ]} />
      </Card>
      <Card title="Every time Mansora looked at my data" pad={false}>
        <Table rows={data?.accessLog} rowKey={(r: any) => r.id} empty="Nobody at Mansora has viewed your data" columns={[{ header: 'When', cell: (l: any) => dateTime(l.occurred_at) }, { header: 'Who', cell: (l: any) => l.admin_name }, { header: 'What', cell: (l: any) => l.action }]} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Audit
export function AuditPage() {
  const [range, setRange] = useState({ from: daysAgo(7), to: today() });
  const [action, setAction] = useState('');
  const { data } = useQuery<any[]>('audit.list', { ...range, action: action || undefined });
  const detail = (d: string) => { try { return Object.entries(JSON.parse(d)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch { return d; } };
  return (
    <div>
      <PageHeader title="Audit history" subtitle="A permanent record of who did what. Entries cannot be edited or deleted."
        actions={<ExportButtons title="Audit history" columns={['When', 'Who', 'Action', 'Record', 'Details']} rows={() => (data ?? []).map((a) => [dateTime(a.occurred_at), a.actor_name ?? 'System', a.action, a.entity_type ?? '', detail(a.detail)])} />} />
      <div className="mb-3 flex flex-wrap items-center gap-3"><DateRange {...range} onChange={setRange} /><Input placeholder="Filter by action, e.g. refund" value={action} onChange={(e) => setAction(e.target.value)} className="w-64 no-print" aria-label="Filter by action" /></div>
      <Card pad={false}>
        <Table rows={data} rowKey={(r) => r.id} empty="No activity in this period" columns={[
          { header: 'When', cell: (a) => <span className="whitespace-nowrap">{dateTime(a.occurred_at)}</span> }, { header: 'Who', cell: (a) => a.actor_name ?? 'System' },
          { header: 'Action', cell: (a) => (a.action === 'permission.denied' ? <Badge tone="bad">{a.action}</Badge> : <code className="text-xs">{a.action}</code>) },
          { header: 'Details', cell: (a) => <span className="break-all text-xs text-slate-600">{detail(a.detail).slice(0, 300)}</span> },
        ]} />
      </Card>
    </div>
  );
}
