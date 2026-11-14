import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, QueryView } from '@mansora/ui';
import { call, dateTime, fileToBase64, money, useAction, useQuery, useToast } from '../lib';

/**
 * Bank & Mobile Money statements: import a statement, check what Mansora suggests for each line, then accept lines
 * one by one or all together. Money in is matched to sales and debt repayments; money out becomes expenses.
 */
const FIELD_LABEL: Record<string, string> = {
  date: 'Date', description: 'Description', reference: 'Reference / transaction ID', amount_in: 'Money in (credit)', amount_out: 'Money out (debit)',
  amount: 'Amount (one column, minus for money out)', direction: 'Type (credit / debit)',
};
const CATEGORIES = ['Rent', 'Electricity', 'Water', 'Transport', 'Salaries', 'Airtime & data', 'Repairs', 'Supplies', 'Mansora subscription', 'Bank charges', 'Other'];

export function StatementsPage() {
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery<any[]>('statement.list');
  return (
    <div>
      <PageHeader title="Bank & MoMo statements" subtitle="Import a statement, check each line, then accept. Money in is matched to your sales; money out becomes expenses." />
      {open ? <StatementLines id={open} onBack={() => { setOpen(null); list.reload(); }} /> : (
        <>
          <ImportStatement onDone={(id) => { list.reload(); setOpen(id); }} />
          <QueryView query={list} label="statements"><Card title="Imported statements" pad={false}>
            <Table rows={list.data ?? []} rowKey={(r: any) => r.id} onRowClick={(r: any) => setOpen(r.id)} empty="No statements imported yet"
              columns={[{ header: 'Imported', cell: (r: any) => dateTime(r.created_at) }, { header: 'Account', cell: (r: any) => r.account_name || (r.source === 'bank' ? 'Bank' : 'Mobile Money') },
                { header: 'File', cell: (r: any) => r.file_name }, { header: 'Money in', align: 'right', cell: (r: any) => money(r.total_in ?? 0) }, { header: 'Money out', align: 'right', cell: (r: any) => money(r.total_out ?? 0) },
                { header: 'To check', align: 'right', cell: (r: any) => (r.pending ? <Badge tone="warn">{r.pending}</Badge> : <Badge tone="good">Done</Badge>) }]} />
          </Card></QueryView>
        </>
      )}
    </div>
  );
}

function ImportStatement({ onDone }: { onDone: (id: string) => void }) {
  const [source, setSource] = useState<'momo' | 'bank'>('momo');
  const [account, setAccount] = useState('');
  const [file, setFile] = useState<{ fileName: string; contentBase64: string } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const { run, busy } = useAction();
  // Changing the source re-reads the chosen file at once (the same file cannot be chosen again to trigger a change).
  const load = (f: { fileName: string; contentBase64: string }, mapping?: Record<string, string | undefined>, from: 'momo' | 'bank' = source) =>
    run(async () => { setPreview(await call('statement.preview', { ...f, source: from, ...(mapping ? { mapping } : {}) })); });
  const good = preview?.rows?.filter((r: any) => !r.errors.length) ?? [];
  const bad = preview?.rows?.filter((r: any) => r.errors.length) ?? [];
  const dups = good.filter((r: any) => r.duplicate).length;
  return (
    <Card title="Import a statement" className="mb-4">
      <p className="mb-3 text-sm text-slate-600">Download your statement from your bank or Mobile Money app as Excel or CSV, then choose it here. Nothing is saved until you press Import, and nothing is recorded until you accept lines.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Statement from"><Select value={source} onChange={(e) => { const next = e.target.value as 'momo' | 'bank'; setSource(next); if (file) load(file, undefined, next); }}><option value="momo">Mobile Money</option><option value="bank">Bank</option></Select></Field>
        <Field label="Account name (optional)"><Input value={account} maxLength={80} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. MTN shop line" /></Field>
        <Field label="Statement file"><input type="file" accept=".xlsx,.csv" aria-label="Choose statement file" className="block text-sm" disabled={busy}
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const next = { fileName: f.name, contentBase64: await fileToBase64(f) }; setFile(next); load(next); }} /></Field>
      </div>
      {preview && file && (
        <div className="mt-4 space-y-3">
          {preview.alreadyImportedAt && <Alert tone="warn">This file was already imported on {dateTime(preview.alreadyImportedAt)}.</Alert>}
          <details className="m-form-details" open={preview.needsMapping || undefined}><summary>Match your columns</summary>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(FIELD_LABEL).map(([field, label]) => (
                <Field key={field} label={label}><Select value={preview.mapping[field] ?? ''} disabled={busy} onChange={(e) => load(file, { ...preview.mapping, [field]: e.target.value || undefined })}>
                  <option value="">(not in my file)</option>{preview.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                </Select></Field>
              ))}
            </div>
          </details>
          {preview.needsMapping ? <Alert tone="warn">Choose the date column and either the amount column or the money in and money out columns.</Alert> : (
            <>
              <div className="flex flex-wrap gap-2"><Badge tone="good">{good.length - dups} line(s) to check</Badge>{dups > 0 && <Badge tone="warn">{dups} already imported before</Badge>}{bad.length > 0 && <Badge tone="bad">{bad.length} line(s) could not be read and will be left out</Badge>}</div>
              {bad.length > 0 && <p className="text-sm text-slate-600">{bad.slice(0, 5).map((r: any) => `Row ${r.lineNo}: ${r.errors.join('; ')}`).join(' · ')}</p>}
              <Button variant="primary" disabled={busy || !good.length || !!preview.alreadyImportedAt}
                onClick={() => run(async () => { const r = await call('statement.import', { ...file, source, mapping: preview.mapping, accountName: account.trim() || undefined }); setPreview(null); setFile(null); onDone(r.id); }, 'Statement imported')}>
                Import {good.length} line(s)
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function suggestionText(l: any): string {
  const s = l.suggestion;
  if (l.status === 'duplicate') return 'Already in an earlier statement';
  if (!s) return '';
  if (s.kind === 'confirm') return `Matches ${s.label}${s.strength === 'amount' ? ' (same amount and date)' : ''}`;
  if (s.kind === 'linked') return `Already recorded: ${s.label}`;
  if (s.kind === 'expense') return 'Record as an expense';
  if (s.kind === 'supplier') return `Payment to supplier ${s.supplier}: receive the stock under Purchases, or choose a category to record it as an expense`;
  return 'No matching sale or repayment found';
}

function StatementLines({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useQuery<any>('statement.lines', { importId: id });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const toast = useToast();
  const lines: any[] = query.data?.lines ?? [];
  const pending = lines.filter((l) => l.status === 'pending');
  // Lines that can be accepted as they are: a match, a link, or an expense with a category.
  const ready = pending.filter((l) => ['confirm', 'linked', 'expense'].includes(l.suggestion?.kind) || (l.amount_out > 0 && categories[l.id]));
  const toggle = (lineId: string) => setSelected((s) => { const n = new Set(s); n.has(lineId) ? n.delete(lineId) : n.add(lineId); return n; });
  const accept = (ids: string[]) => run(async () => {
    const chosen = Object.fromEntries(Object.entries(categories).filter(([k]) => ids.includes(k)));
    const r = await call('statement.accept', { lineIds: ids, categories: chosen });
    setSelected(new Set()); query.reload();
    toast(`${r.accepted} line(s) accepted${r.expenses ? `, ${r.expenses} expense(s) recorded` : ''}${r.skipped.length ? `. ${r.skipped.length} need a category or a decision.` : ''}`);
  });
  const ignore = (ids: string[]) => run(async () => { await call('statement.ignore', { lineIds: ids }); setSelected(new Set()); query.reload(); }, 'Lines ignored');
  const tone = (l: any) => (l.status === 'accepted' ? 'good' : l.status === 'ignored' || l.status === 'duplicate' ? 'neutral' : 'warn') as any;
  return (
    <QueryView query={query} label="statement lines">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={onBack}>Back to statements</Button>
        <Button variant="primary" disabled={busy || !ready.length} onClick={() => accept(ready.map((l) => l.id))}>Accept all suggested ({ready.length})</Button>
        <Button disabled={busy || !selected.size} onClick={() => accept([...selected])}>Accept selected ({selected.size})</Button>
        <Button disabled={busy || !selected.size} onClick={() => ignore([...selected])}>Ignore selected</Button>
      </div>
      <Card pad={false}>
        <Table rows={lines} rowKey={(l: any) => l.id} caption="Each statement line with what Mansora suggests"
          columns={[
            { header: '', cell: (l: any) => (l.status === 'pending' ? <input type="checkbox" aria-label={`Select line ${l.line_no}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} /> : null) },
            { header: 'Date', cell: (l: any) => l.txn_date },
            { header: 'Description', cell: (l: any) => <><div>{l.description ?? ''}</div>{l.reference && <div className="text-xs text-slate-500">{l.reference}</div>}</> },
            { header: 'In', align: 'right', cell: (l: any) => (l.amount_in ? money(l.amount_in) : '') },
            { header: 'Out', align: 'right', cell: (l: any) => (l.amount_out ? money(l.amount_out) : '') },
            { header: 'Suggestion', cell: (l: any) => <span className="text-sm">{suggestionText(l)}</span> },
            { header: 'Category', cell: (l: any) => (l.status === 'pending' && l.amount_out > 0 && l.suggestion?.kind !== 'linked'
              ? <Select aria-label={`Category for line ${l.line_no}`} value={categories[l.id] ?? l.category ?? ''} onChange={(e) => setCategories((c) => ({ ...c, [l.id]: e.target.value }))}>
                  <option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              : l.category ?? '') },
            { header: 'Status', cell: (l: any) => <Badge tone={tone(l)}>{l.status === 'pending' ? 'To check' : l.status === 'accepted' ? 'Accepted' : l.status === 'ignored' ? 'Ignored' : 'Duplicate'}</Badge> },
            { header: '', align: 'right', cell: (l: any) => (l.status === 'pending' ? <Button size="sm" disabled={busy} onClick={() => accept([l.id])}>Accept</Button> : null) },
          ]} />
      </Card>
    </QueryView>
  );
}
