import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  chevron: 'm6 9 6 6 6-6',
};
export function Icon({ name, className }: { name: string; className?: string }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx('shrink-0', className)}><path d={paths[name] ?? paths.file} /></svg>;
}
export interface WorkspaceItem { id: string; label: string; icon?: string }
export interface Guide { title: string; intro: string; steps: string[]; notes?: string[] }
export function GuideBody({ guide }: { guide: Guide }) {
  return <div className="space-y-5"><p className="text-sm leading-relaxed text-slate-600">{guide.intro}</p><ol className="space-y-4">{guide.steps.map((step, i) => <li key={step} className="flex gap-3 text-sm leading-relaxed"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">{i + 1}</span><span>{step}</span></li>)}</ol>{guide.notes?.length && <div className="rounded-lg border border-brand-200 bg-brand-50 p-4"><h3 className="mb-2 text-sm font-semibold text-brand-900">Good to know</h3><ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-700">{guide.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}</div>;
}
export function Disclosure({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="m-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><span><strong>{title}</strong>{description && <small>{description}</small>}</span><Icon name="chevron" /></summary>{open && <div className="m-disclosure-body">{children}</div>}</details>;
}

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <details ref={ref} className="m-action-menu no-print" open={open}><summary aria-label={label} onClick={(event) => { event.preventDefault(); setOpen(!open); }}>{label}<Icon name="chevron" /></summary>{open && <div role="group" aria-label={`${label} options`} onClick={() => setOpen(false)}>{children}</div>}</details>;
}

export function WorkspaceShell({ groups, primaryIds, current, pageKey = current.id, pageLabel, onNavigate, workspace, workspaceLabel, user, userRole, guide, onSignOut, signOutLabel = 'Sign out', footerActions, children }: {
  groups: { group: string; items: WorkspaceItem[] }[]; current: WorkspaceItem; onNavigate: (id: string) => void;
  primaryIds: string[];
  /** Include detail IDs: the selected sidebar item alone does not identify a subpage. */
  pageKey?: string; pageLabel?: string;
  workspace: string; workspaceLabel: string; user: string; userRole?: string; guide?: Guide;
  onSignOut: () => void; signOutLabel?: string; children: ReactNode;
  /** Extra items above Sign out, on every page (e.g. Report a problem). */
  footerActions?: ReactNode;
}) {
  const navigation = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const previousPage = useRef(pageKey);
  useLayoutEffect(() => {
    if (previousPage.current === pageKey) return;
    previousPage.current = pageKey;
    content.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Keep purpose-specific autofocus (for example the barcode input at the till).
    if (!main.current?.contains(document.activeElement)) main.current?.focus({ preventScroll: true });
  }, [pageKey]);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [menuOpen, setMenuOpen] = useState(false);
  // Reporting a problem from the phone menu closes the menu, so the person can point at the page itself.
  useEffect(() => { const close = () => setMenuOpen(false); window.addEventListener('mansora:report-problem', close); return () => window.removeEventListener('mansora:report-problem', close); }, []);
  useEffect(() => { const media = window.matchMedia('(max-width: 760px)'); const update = () => { setCompact(media.matches); if (!media.matches) setMenuOpen(false); }; media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const navigatePage = (id: string) => { setMenuOpen(false); onNavigate(id); };
  const [finding, setFinding] = useState(false), [query, setQuery] = useState(''), [help, setHelp] = useState(false);
  const pages = useMemo(() => groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.group }))), [groups]);
  const primary = primaryIds.flatMap((id) => pages.filter((item) => item.id === id));
  const secondary = groups.map((group) => ({ ...group, items: group.items.filter((item) => !primaryIds.includes(item.id)) })).filter((group) => group.items.length);
  const selectedGroup = secondary.find((group) => group.items.some((item) => item.id === current.id))?.group ?? null;
  // Sections stay open until the person closes them: opening one never closes another, so nothing jumps under the pointer.
  const [toolsOpen, setToolsOpen] = useState(!!selectedGroup), [openGroups, setOpenGroups] = useState<string[]>(selectedGroup ? [selectedGroup] : []);
  // A daily-work page folds More tools away (it sits below, so nothing under the pointer moves); a tools page opens its section.
  useLayoutEffect(() => { setToolsOpen(!!selectedGroup); if (selectedGroup) setOpenGroups((g) => (g.includes(selectedGroup) ? g : [...g, selectedGroup])); }, [current.id, selectedGroup]);
  // Keep the current page visible in the menu when the page changes, without moving anything when a section is
  // opened or closed, and without scrolling the page itself (scrollIntoView would move every scrollable ancestor).
  useEffect(() => {
    const nav = navigation.current, item = nav?.querySelector<HTMLElement>('[aria-current=page]');
    if (!nav || !item) return;
    const n = nav.getBoundingClientRect(), r = item.getBoundingClientRect();
    if (r.top < n.top) nav.scrollTop -= n.top - r.top; else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom;
  }, [current.id]);
  const pageButton = (item: WorkspaceItem) => <button key={item.id} type="button" aria-current={current.id === item.id ? 'page' : undefined} onClick={() => navigatePage(item.id)} className={cx('m-nav-item', current.id === item.id && 'm-nav-active')}><Icon name={item.icon ?? 'file'} /><span>{item.label}</span></button>;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('[role=dialog]')) { e.preventDefault(); setQuery(''); setFinding(true); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const results = pages.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase()));
  const sidebar = (<nav aria-label="Main" className="m-sidebar no-print">
      <div className="m-sidebar-brand"><MansoraBrand compact /></div>
      <div className="m-company"><span>{workspaceLabel}</span><strong title={workspace}>{workspace}</strong></div>
      <div className="m-nav-groups" ref={navigation}>
        <div className="m-nav-group"><p>Daily work</p>{primary.map(pageButton)}</div>
        {secondary.length > 0 && <details className="m-nav-tools" open={toolsOpen}><summary aria-label="More tools" onClick={(event) => { event.preventDefault(); setToolsOpen(!toolsOpen); }}><Icon name="settings" /><span>More tools</span><Icon name="chevron" /></summary><p className="m-nav-hint">Choose a section or find a page.</p>{secondary.map((group) => <details key={group.group} data-nav-group={group.group} className="m-nav-section" open={openGroups.includes(group.group)}><summary aria-label={`${group.group} tools`} onClick={(event) => { event.preventDefault(); setOpenGroups((g) => (g.includes(group.group) ? g.filter((x) => x !== group.group) : [...g, group.group])); }}><span>{group.group}</span><Icon name="chevron" /></summary><div>{group.items.map(pageButton)}</div></details>)}</details>}
      </div>
      <div className="m-sidebar-footer">{footerActions}<button className="m-nav-item" type="button" onClick={onSignOut}><Icon name="logout" /><span>{signOutLabel}</span></button><div className="m-provider-note">Provided by Mansora<span>Sales &amp; Stock platform</span></div></div>
    </nav>);
  return <div className="m-workspace">
    <a className="m-skip no-print" href="#workspace-main">Skip to page content</a>
    {!compact && sidebar}
    {compact && menuOpen && <Modal title="Workspace navigation" trackChanges={false} open onClose={() => setMenuOpen(false)}><div className="m-mobile-drawer">{sidebar}</div></Modal>}
    <div className="m-workspace-body">
      <header className="m-topbar no-print"><button type="button" className="m-mobile-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="settings" />Menu</button><div className="m-breadcrumb"><span>{workspaceLabel}</span><span aria-hidden="true">/</span><strong>{pageLabel ?? current.label}</strong></div><button type="button" className="m-page-search" onClick={() => { setQuery(''); setFinding(true); }}><Icon name="search" /><span>Find a page</span><kbd>Ctrl K</kbd></button><div className="m-user"><span className="m-avatar" aria-hidden="true">{user.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span><div><strong>{user}</strong><span>{userRole}</span></div></div></header>
      <div className="m-content-scroll" ref={content}><div className="m-page-tools no-print">{guide && <button type="button" onClick={() => setHelp(true)}><Icon name="help" />How to use this page</button>}</div><main ref={main} id="workspace-main" aria-label={pageLabel ?? current.label} tabIndex={-1} className="m-main" key={pageKey}>{children}</main></div>
      {compact && <nav aria-label="Quick tasks" className="m-mobile-shortcuts no-print">{primary.slice(0, 4).map(item => <button type="button" key={item.id} aria-current={item.id === current.id ? 'page' : undefined} onClick={() => navigatePage(item.id)}><Icon name={item.icon ?? 'file'} /><span>{item.label}</span></button>)}</nav>}
    </div>
    {finding && <Modal title="Find a page" trackChanges={false} open onClose={() => setFinding(false)}><Input aria-label="Find a page" placeholder="Search sales, products, reports…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); navigatePage(results[0].id); setFinding(false); } if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.m-search-result')?.focus(); } }} autoFocus /><div className="mt-3 max-h-80 overflow-y-auto">{results.map((item) => <button type="button" className="m-search-result" key={item.id} onClick={() => { navigatePage(item.id); setFinding(false); }}><Icon name={item.icon ?? 'file'} /><span>{item.label}<small>{item.group}</small></span><span aria-hidden="true">↗</span></button>)}{!results.length && <p className="py-6 text-center text-sm text-slate-600">No matching pages. Try a different name.</p>}</div></Modal>}
    {help && guide && <Modal title={`How to use: ${guide.title}`} open onClose={() => setHelp(false)} wide footer={<Button variant="primary" onClick={() => setHelp(false)}>Got it</Button>}><GuideBody guide={guide} /></Modal>}
  </div>;
}

export function WorkflowSteps({ steps, current }: { steps: string[]; current: number }) {
  return <ol className="m-workflow-steps" aria-label="Progress">{steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? '✓' : index + 1} · </span>{step}</li>)}</ol>;
}

export function AuthLayout({ children, platform = false }: { children: ReactNode; platform?: boolean }) {
  return <div className="m-auth-layout"><aside className="m-auth-story" aria-label="About Mansora"><h2>{platform ? 'Your clients.\nClearly managed.' : 'Your business.\nUnder control.'}</h2><p>{platform ? 'Onboard clients, review service health and manage subscription collections from one place.' : 'A clearer way to sell, manage stock and understand your numbers.'}</p><p>{platform ? 'Client financial data stays protected by scoped consent and recorded access.' : 'From the carton you buy to the individual items you sell, keep a clear trail of your daily work.'}</p><small>Mansora Consulting &amp; Business Solutions</small></aside><div className="m-auth-panel">{children}</div></div>;
}

/**
 * The page a person is on, kept for this browser tab, so a refresh returns to the same page instead of the
 * dashboard. Stored per tab (sessionStorage), not in the address bar, which sign-in and invitation links use.
 */
export function usePersistentPage<T extends { id: string; param?: string }>(key: string, fallback: T): [T, (next: T) => void] {
  const [page, setPage] = useState<T>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (saved && typeof saved.id === 'string') return saved as T; } catch { /* storage unavailable */ }
    return fallback;
  });
  const set = useCallback((next: T) => { setPage(next); try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ } }, [key]);
  return [page, set];
}
