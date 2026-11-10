import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal, cx } from './index';
import { MansoraBrand } from './brand';

const paths: Record<string, string> = {
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  sale: 'M3 4h2l2 12h12l2-8H6M9 21h.01M18 21h.01',
  chart: 'M4 3v17h17M8 15v-4m5 4V7m5 8V5',
  box: 'm3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h6',
  wallet: 'M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v12H5a3 3 0 0 1-3-3V6m19 7h-6v4h6m-3-2h.01',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  sync: 'M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 9 3 3 5-5',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 4H4v16h5m6-13 5 5-5 5m-7-5h12',
};
export function Icon({ name, className }: { name: string; className?: string }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx('shrink-0', className)}><path d={paths[name] ?? paths.file} /></svg>;
}
export interface WorkspaceItem { id: string; label: string; icon?: string }
export interface Guide { title: string; intro: string; steps: string[]; notes?: string[] }
export function GuideBody({ guide }: { guide: Guide }) {
  return <div className="space-y-5"><p className="text-sm leading-relaxed text-slate-600">{guide.intro}</p><ol className="space-y-4">{guide.steps.map((step, i) => <li key={step} className="flex gap-3 text-sm leading-relaxed"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">{i + 1}</span><span>{step}</span></li>)}</ol>{guide.notes?.length && <div className="rounded-lg border border-brand-200 bg-brand-50 p-4"><h3 className="mb-2 text-sm font-semibold text-brand-900">Good to know</h3><ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-700">{guide.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}</div>;
}
export function WorkspaceShell({ groups, current, onNavigate, workspace, workspaceLabel, user, userRole, guide, onSignOut, signOutLabel = 'Sign out', children }: {
  groups: { group: string; items: WorkspaceItem[] }[]; current: WorkspaceItem; onNavigate: (id: string) => void;
  workspace: string; workspaceLabel: string; user: string; userRole?: string; guide?: Guide;
  onSignOut: () => void; signOutLabel?: string; children: ReactNode;
}) {
  const navigation = useRef<HTMLDivElement>(null);
  useEffect(() => { navigation.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest' }); }, [current.id]);
  const [finding, setFinding] = useState(false), [query, setQuery] = useState(''), [help, setHelp] = useState(false);
  const pages = useMemo(() => groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.group }))), [groups]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('[role=dialog]')) { e.preventDefault(); setQuery(''); setFinding(true); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const results = pages.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="m-workspace">
    <a className="m-skip no-print" href="#workspace-main">Skip to page content</a>
    <nav aria-label="Main" className="m-sidebar no-print">
      <div className="m-sidebar-brand"><MansoraBrand compact /></div>
      <div className="m-company"><span>{workspaceLabel}</span><strong title={workspace}>{workspace}</strong></div>
      <div className="m-nav-groups" ref={navigation}>{groups.map((group) => <div key={group.group} className="m-nav-group"><p>{group.group}</p>{group.items.map((item) => <button key={item.id} type="button" aria-current={current.id === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)} className={cx('m-nav-item', current.id === item.id && 'm-nav-active')}><Icon name={item.icon ?? 'file'} /><span>{item.label}</span></button>)}</div>)}</div>
      <div className="m-sidebar-footer"><button className="m-nav-item" type="button" onClick={onSignOut}><Icon name="logout" /><span>{signOutLabel}</span></button><div className="m-provider-note">Provided by Mansora<span>Sales &amp; Stock platform</span></div></div>
    </nav>
    <div className="m-workspace-body">
      <header className="m-topbar no-print"><div className="m-breadcrumb"><span>{workspaceLabel}</span><span aria-hidden="true">/</span><strong>{current.label}</strong></div><button type="button" className="m-page-search" onClick={() => { setQuery(''); setFinding(true); }}><Icon name="search" /><span>Find a page</span><kbd>Ctrl K</kbd></button><div className="m-user"><span className="m-avatar" aria-hidden="true">{user.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span><div><strong>{user}</strong><span>{userRole}</span></div></div></header>
      <div className="m-content-scroll"><div className="m-page-tools no-print">{guide && <button type="button" onClick={() => setHelp(true)}><Icon name="help" />How to use this page</button>}</div><main id="workspace-main" tabIndex={-1} className="m-main" key={current.id}>{children}</main></div>
    </div>
    {finding && <Modal title="Find a page" trackChanges={false} open onClose={() => setFinding(false)}><Input aria-label="Find a page" placeholder="Search sales, products, reports…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); onNavigate(results[0].id); setFinding(false); } if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.m-search-result')?.focus(); } }} autoFocus /><div className="mt-3 max-h-80 overflow-y-auto">{results.map((item) => <button type="button" className="m-search-result" key={item.id} onClick={() => { onNavigate(item.id); setFinding(false); }}><Icon name={item.icon ?? 'file'} /><span>{item.label}<small>{item.group}</small></span><span aria-hidden="true">↗</span></button>)}{!results.length && <p className="py-6 text-center text-sm text-slate-600">No matching pages. Try a different name.</p>}</div></Modal>}
    {help && guide && <Modal title={`How to use: ${guide.title}`} open onClose={() => setHelp(false)} wide footer={<Button variant="primary" onClick={() => setHelp(false)}>Got it</Button>}><GuideBody guide={guide} /></Modal>}
  </div>;
}
