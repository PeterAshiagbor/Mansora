import { useState } from 'react';
import { Alert, Badge, Button, Card, Icon, PageHeader, QueryView, Disclosure } from '@mansora/ui';
import { dateTime, useApp, useQuery } from '../lib';

export function GettingStartedPage() {
  const { state } = useApp();
  if (state.user?.role !== 'owner') return <Alert>Ask the business owner to review setup. Your daily tasks and guides are available from the navigation.</Alert>;
  return <OwnerSetup />;
}
function OwnerSetup() {
  const [active, setActive] = useState(1);
  const { state, go } = useApp();
  const stock = useQuery<any>('stock.overview', { filter: 'all' });
  const staff = useQuery<any[]>('staff.list');
  const backups = useQuery<any[]>('backup.list');
  const sync = useQuery<any>('sync.status');
  const latestBackup = backups.data?.find((record) => record.status === 'ok');
  const steps = [
    { title: 'Check your business and receipts', description: 'Confirm the name, contact details and receipt footer customers should see.', page: 'settings', action: 'Review business profile', state: state.business.name ? 'Name recorded' : 'Review needed', icon: 'settings', detail: state.business.name, query: null },
    { title: 'Add products and opening stock', description: 'Use individual selling units. Import a catalogue or enter products, then confirm physical quantities.', page: 'products', action: 'Review products', state: stock.data?.summary.products > 0 ? 'Products recorded' : 'Add your catalogue', icon: 'box', detail: stock.data ? `${stock.data.summary.products} active product(s); ${stock.data.summary.out} with no recorded stock. Quantities still need a physical check.` : '', query: stock },
    { title: 'Give each staff member their own login', description: 'Check permissions for discounts, refunds, credit and cost prices. An owner-run business can continue with the owner account.', page: 'staff', action: 'Review staff access', state: (staff.data?.filter((person) => person.status === 'active').length ?? 0) > 1 ? 'Staff accounts added' : 'Owner account only', icon: 'users', detail: staff.data ? `${staff.data.filter((person) => person.status === 'active').length} active account(s). Passwords are private and never shared with Mansora.` : '', query: staff },
    { title: 'Create and verify an encrypted backup', description: 'Keep an independent encrypted copy. Keep its passphrase separately and use Test backup to check the file.', page: 'backup', action: 'Open backup & recovery', state: latestBackup ? 'Backup created' : 'Backup needed', icon: 'shield', detail: latestBackup ? `Latest successful file: ${dateTime(latestBackup.created_at)}. Creation alone does not prove a restore has been rehearsed.` : 'Cloud sync and an encrypted backup protect against different risks.', query: backups },
    { title: 'Check sync before handover', description: 'Connect to the internet and review waiting changes, errors and the last successful sync.', page: 'sync', action: 'Review sync status', state: sync.data?.lastSyncAt && sync.data?.pending === 0 && sync.data?.rejected === 0 ? 'No changes waiting' : 'Review sync', icon: 'sync', detail: sync.data ? `Last successful sync: ${dateTime(sync.data.lastSyncAt)}. ${sync.data.pending} waiting; ${sync.data.rejected} rejected.` : '', query: sync },
  ];
  return <div className="space-y-5"><PageHeader title="Getting started" subtitle={`Set up ${state.business.name} for day-to-day work. Track the essentials for a confident start.`} />
    <Alert>Work through this with the business owner and your Mansora representative. Hardware, training, business policies and service arrangements need a separate handover review.</Alert>
    <div className="m-setup-layout"><div className="m-setup-checklist" role="group" aria-label="Business setup steps">{steps.map((step, index) => <button type="button" key={step.page} aria-current={active === index ? 'step' : undefined} onClick={() => setActive(index)}><span>{index + 1}. {step.title}</span><small>{active === index ? 'Current step' : step.query?.loading ? 'Checking…' : step.state}</small></button>)}</div><Card title={steps[active].title}><p className="text-sm leading-relaxed text-slate-600">{steps[active].description}</p>{steps[active].query ? <QueryView query={steps[active].query!} label={steps[active].title.toLowerCase()}><div className="mt-4"><Badge>{steps[active].state}</Badge><p className="mt-3 text-sm leading-relaxed text-slate-600">{steps[active].detail}</p></div></QueryView> : <div className="mt-4"><Badge>{steps[active].state}</Badge><p className="mt-3 text-sm text-slate-600">{steps[active].detail}</p></div>}<div className="mt-6 flex flex-wrap gap-3"><Button variant="primary" onClick={() => go(steps[active].page)}><Icon name={steps[active].icon} />{steps[active].action}</Button>{active === 1 && <Button onClick={() => go('data')}>Import Excel / CSV</Button>}{active < steps.length - 1 && <Button onClick={() => setActive(active + 1)}>Next setup step</Button>}</div></Card></div>
    <Disclosure title="Review with Mansora before serving customers" description="Hardware, training, permissions and recovery checks"><Card title="Handover review"><ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-slate-700"><li>Check the barcode scanner, actual receipt printer and cash drawer on the laptop you will use.</li><li>Rehearse a sale, refund, repayment and shift close in a separate training business. Made-up sales must not be entered into live client records.</li><li>Agree who may discount, approve refunds, grant credit, count stock and sign off cash differences.</li><li>Confirm the support contact, training, hosting/privacy arrangements and commercial terms with Mansora.</li><li>Rehearse restoring a backup on a replacement laptop with the owner present. Record what has been verified in the handover checklist.</li></ul><div className="mt-5 flex flex-wrap gap-2"><Button variant="primary" onClick={() => go('checkout')}>Open the selling workspace</Button><Button onClick={() => go('help')}>Read task guides</Button></div></Card></Disclosure>
  </div>;
}
export function FirstUsePrompt() {
  const { go } = useApp();
  const products = useQuery<any[]>('product.list', { limit: 1 });
  if (!products.data || products.data.length > 0) return null;
  return <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Welcome. Let’s set up your business.</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">Start with your business details, catalogue and physical opening stock. Then check staff access, backups and sync before your first live sale.</p></div><Button variant="primary" onClick={() => go('getting-started')}>Start business setup</Button></div></div>;
}
