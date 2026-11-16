import { useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Input, Modal, PageHeader, QueryView, Select, Stat, Table } from '@mansora/ui';
import type { TaxConfig } from '@mansora/domain';
import { call, money, MoneyInput, saveFile, today, useAction, useApp, useQuery, uuid } from '../lib';

export function TaxNotice() {
  const { can, go } = useApp();
  if (!can('report.sales')) return null;
  return <TaxNoticeBody onOpen={() => go('tax')} />;
}
function TaxNoticeBody({ onOpen }: { onOpen: () => void }) {
  const q = useQuery<any>('tax.status');
  useEffect(() => {
    const refresh = () => q.reload();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('mansora:changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('mansora:changed', refresh); window.removeEventListener('focus', refresh); };
  }, [q.reload]);
  const d = q.data;
  if (!d || (!d.amendmentReviewRequired && (d.registered || (!d.requiresReview && !d.near)))) return null;
  return <Alert tone="warn" className="mb-4">{d.message} <Button size="sm" onClick={onOpen}>Review VAT</Button></Alert>;
}
export function TaxPage() {
  const { state, go } = useApp();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState(false), [record, setRecord] = useState(false), [filing, setFiling] = useState(false);
  const status = useQuery<any>('tax.status', {}, [revision]);
  const report = useQuery<any>('tax.report', { month }, [revision]);
  const { run, busy } = useAction();
  const saved = () => { setRevision(v => v + 1); setSettings(false); setRecord(false); setFiling(false); };
  const owner = state.user?.role === 'owner';
  const d = status.data, r = report.data;
  return <div className="space-y-5">
    <PageHeader title="Ghana VAT" subtitle="Turnover monitoring, VAT and levy working papers, credits and filing records" actions={<><Button onClick={() => go('vat-guide')}>VAT guide</Button>{owner && <><Button onClick={() => setSettings(true)} disabled={!d}>Tax settings</Button><Button onClick={() => setRecord(true)}>Record tax evidence</Button></>}</>} />
    <QueryView query={status} label="VAT status">{d && <><Alert tone={d.requiresReview && !d.registered ? 'warn' : 'info'}>{d.message} {d.unclassified > 0 && `${d.unclassified} active product(s) need classification in Products.`}</Alert>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{d.windows.map((w: any) => <Stat key={w.months} label={`${w.months}-month taxable turnover`} value={money(w.total)} hint={`Band ${money(w.threshold)}${w.months < 12 ? ' · forecast/registration review' : ''}`} tone={w.exceeded || w.near ? 'warn' : 'default'} />)}</div>
    {d.pendingTrigger && <Alert tone="warn">Automatic VAT charging effective {d.pendingTrigger.effectiveDate}. Registration application due {d.pendingTrigger.applicationDueDate}. Complete GRA registration and classify products before this date.</Alert>}
    <p className="text-sm text-slate-600">The annual test is GHS 750,000 under the default rules. Shorter bands and expected turnover prompt review. Registered businesses continue charging until an effective cancellation is recorded. Add turnover from other branches and channels without duplicating Mansora sales.</p>
    {d.amendmentReviewRequired && <Alert tone="warn">Service-provider rules changed during 2026. The owner must obtain the enacted commencement date or written GRA confirmation, then save that date and source in Tax settings. Managers should escalate this to the owner. Existing VAT obligations continue.</Alert>}</>}</QueryView>
    <div className="flex flex-wrap items-end gap-3"><Field label="VAT month"><Input type="month" value={month} min="2026-01" max={today().slice(0, 7)} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></Field><Button disabled={busy || !r} onClick={() => void run(async () => saveFile(await call('tax.export', { month })))}>Download VAT workbook</Button>{owner && <Button disabled={!r || month >= today().slice(0, 7)} onClick={() => setFiling(true)}>Record GRA filing</Button>}</div>
    <QueryView query={report} label="VAT report">{r && <>
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Tax payable for month" value={money(r.payable)} /><Stat label="GRA payments for this return" value={money(r.payments)} hint="Matched by the return month each payment settles" /><Stat label="Unpaid tax for month" value={money(r.outstanding)} /></div>
      {r.arrears && (r.arrears.outstanding > 0 || r.arrears.unmatchedPayments.length > 0) && <Card title="Filed returns and payments" pad={false}><Table rows={r.arrears.rows} empty="No filed returns" columns={[{ header: 'Return month', cell: (v: any) => v.month }, { header: 'Payable', align: 'right', cell: (v: any) => money(v.payable) }, { header: 'Paid', align: 'right', cell: (v: any) => money(v.paid) }, { header: 'Still owed', align: 'right', cell: (v: any) => <strong>{money(v.outstanding)}</strong> }]} /><p className="px-4 py-2 text-sm">Total owed on filed returns: <strong>{money(r.arrears.outstanding)}</strong>{r.arrears.unmatchedPayments.length > 0 && ` · ${r.arrears.unmatchedPayments.length} payment(s) are for months with no filed return yet`}</p></Card>}
      <Card title="VAT and levy reconciliation" pad={false}><Table rows={r.buckets} columns={[
        { header: 'Tax', cell: (b: any) => b.tax.toUpperCase() },
        ...[['Output', 'output'], ['Refunds', 'reversals'], ['Input credits', 'inputs'], ['Withholding', 'withholding'], ['Adjustments', 'adjustments'], ['Prior credits', 'broughtForward'], ['Payable', 'payable'], ['Carry forward', 'carriedForward']].map(([header, key]) => ({ header, align: 'right' as const, cell: (b: any) => money(b[key]) })),
      ]} /></Card>
      <Card title="Net supplies by VAT classification" pad={false}><Table rows={r.classification} columns={[{ header: 'Classification', cell: (v: any) => v.classification }, { header: 'Value excluding tax', cell: (v: any) => money(v.base), align: 'right' }]} /></Card>
      <Card title="Review before filing"><p className="mb-3">Deadline before public-holiday checks: {r.deadlineBeforeHolidayCheck}. File and pay through GRA’s authorised channel.</p><ul className="list-disc space-y-2 pl-5 text-sm">{r.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></Card>
      <Card title="Tax evidence and filing history" pad={false}><Table rows={r.records} empty="No input credits, certificates, adjustments, payments or filing records in this month" columns={[{ header: 'Date', cell: (v: any) => v.tax_date }, { header: 'Type', cell: (v: any) => v.kind }, { header: 'Reference', cell: (v: any) => v.reference }, { header: 'Reason', cell: (v: any) => v.data.reason ?? 'Filed return' }]} /></Card>
    </>}</QueryView>
    {settings && d && <TaxSettings config={d.config} onClose={() => setSettings(false)} onSaved={saved} />}
    {record && <TaxRecord month={month} onClose={() => setRecord(false)} onSaved={saved} />}
    {filing && <Filing month={month} onClose={() => setFiling(false)} onSaved={saved} />}
  </div>;
}
function TaxSettings({ config, onClose, onSaved }: { config: TaxConfig; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...config, effectiveDate: today(), reason: '' });
  const { run, busy } = useAction();
  const save = () => void run(async () => { await call('tax.configure', f); onSaved(); }, 'Tax settings saved');
  return <Modal title="Ghana tax settings" open onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !f.reason.trim()} onClick={save}>Save dated settings</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Settings effective date"><Input type="date" value={f.effectiveDate} min="2026-01-01" onChange={e => setF({ ...f, effectiveDate: e.target.value })} /></Field>
      <Field label="Business supplies"><Select value={f.supplyType} onChange={e => setF({ ...f, supplyType: e.target.value as TaxConfig['supplyType'] })}><option value="goods">Goods</option><option value="services">Services</option><option value="mixed">Goods and services</option></Select></Field>
      <label className="text-sm"><input type="checkbox" checked={f.automatic} onChange={e => setF({ ...f, automatic: e.target.checked })} /> Automatically schedule VAT when a verified registration threshold is met</label>
      <label className="text-sm"><input type="checkbox" checked={f.registered} onChange={e => setF({ ...f, registered: e.target.checked })} /> VAT registered / legally effective obligation confirmed</label>
      <Field label="Legal VAT effective date"><Input type="date" value={f.registrationDate ?? ''} onChange={e => setF({ ...f, registrationDate: e.target.value || null })} /></Field>
      <Field label="Business TIN"><Input value={f.tin} onChange={e => setF({ ...f, tin: e.target.value })} /></Field>
      <Field label="VAT registration number"><Input value={f.vatNumber} onChange={e => setF({ ...f, vatNumber: e.target.value })} /></Field>
      <Field label="Catalogue selling prices"><Select value={f.pricing} onChange={e => setF({ ...f, pricing: e.target.value as TaxConfig['pricing'] })}><option value="inclusive">Include VAT and levies (absorb tax)</option><option value="exclusive">Exclude VAT and levies (add tax)</option></Select></Field>
      <Field label="Annual registration threshold (GHS)"><MoneyInput value={f.threshold} onChange={v => setF({ ...f, threshold: v ?? 0 })} /></Field>
      <Field label="Expected taxable supplies over next 12 months (GHS)"><MoneyInput value={f.forecast} onChange={v => setF({ ...f, forecast: v ?? 0 })} /></Field>
      <Field label="Expected taxable supplies over next 9 months (GHS)"><MoneyInput value={f.forecastNineMonths} onChange={v => setF({ ...f, forecastNineMonths: v ?? 0 })} /></Field>
      <Field label="Early alert at (%)"><Input type="number" min={1} max={100} step="0.01" value={f.alertBps / 100} onChange={e => setF({ ...f, alertBps: Math.round(Number(e.target.value) * 100) })} /></Field>
      {([['VAT rate (%)', 'vatBps'], ['NHIL rate (%)', 'nhilBps'], ['GETFund rate (%)', 'getfundBps']] as const).map(([label, key]) => <Field label={label} key={key}><Input type="number" min={0} max={100} step="0.01" value={f[key] / 100} onChange={e => setF({ ...f, [key]: Math.round(Number(e.target.value) * 100) })} /></Field>)}
      {f.supplyType !== 'goods' && <><Field label="Service amendment commencement date"><Input type="date" value={f.serviceThresholdDate ?? ''} onChange={e => setF({ ...f, serviceThresholdDate: e.target.value || null })} /></Field><Field label="Service amendment authority / GRA reference"><Input value={f.serviceThresholdAuthority} maxLength={400} onChange={e => setF({ ...f, serviceThresholdAuthority: e.target.value })} /></Field></>}
      <label className="text-sm"><input type="checkbox" checked={f.serviceThresholdConfirmed} onChange={e => setF({ ...f, serviceThresholdConfirmed: e.target.checked })} /> Service-threshold applicability and commencement checked</label>
      <label className="text-sm"><input type="checkbox" checked={f.mandatoryRegistration} onChange={e => setF({ ...f, mandatoryRegistration: e.target.checked })} /> Special registration obligation / GRA direction applies</label>
      <Field label="Reason and supporting authority" className="sm:col-span-2"><Input value={f.reason} maxLength={400} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
    </div><p className="mt-4 text-sm">Changes apply to new transactions from the settings date. Previous receipts and refund tax remain tied to their original snapshots. Automatic threshold triggers schedule charging for the next tax period. The legal effective date controls charging; complete GRA registration without delay.</p>
  </Modal>;
}
function TaxRecord({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(uuid);
  const [f, setF] = useState({ kind: 'input', date: month === today().slice(0, 7) ? today() : month + '-01', invoiceDate: today(), supplierTin: '', reference: '', reason: '', base: 0 as number | null, vat: 0 as number | null, nhil: 0 as number | null, getfund: 0 as number | null, amount: 0 as number | null, eligibleBps: 10000, purchaseId: '', period: month === today().slice(0, 7) ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7) : month });
  const [confirmed, setConfirmed] = useState(false);
  const { run, busy } = useAction();
  const save = () => void run(async () => { await call('tax.record', { ...f, id, invoiceDate: f.kind === 'input' ? f.invoiceDate : undefined, purchaseId: f.purchaseId || undefined, period: f.kind === 'payment' ? f.period : undefined, evidenceConfirmed: confirmed }); onSaved(); }, 'Tax evidence recorded');
  return <Modal title="Record tax evidence" open wide onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || [f.base, f.vat, f.nhil, f.getfund, f.amount].some(v => v == null) || !confirmed || !f.reference.trim() || !f.reason.trim()} onClick={save}>Save evidence</Button></>}><div className="grid gap-4 sm:grid-cols-2">
    <Field label="Evidence type"><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="input">Eligible purchase input credits</option><option value="withholding">VAT withholding certificate received</option><option value="adjustment">Tax adjustment (signed amounts)</option><option value="opening_credit">Verified opening carry-forward credit</option><option value="turnover">Taxable turnover outside Mansora</option><option value="payment">GRA payment for selected tax month</option></Select></Field>
    <Field label="Tax date / month being settled"><Input type="date" value={f.date} max={today()} min="2026-01-01" onChange={e => setF({ ...f, date: e.target.value })} /></Field>
    <Field label="Invoice / certificate / payment reference"><Input value={f.reference} maxLength={120} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
    {f.kind === 'input' && <><Field label="Supplier TIN"><Input value={f.supplierTin} onChange={e => setF({ ...f, supplierTin: e.target.value })} /></Field><Field label="Supplier invoice date"><Input type="date" value={f.invoiceDate} onChange={e => setF({ ...f, invoiceDate: e.target.value })} /></Field><Field label="Linked purchase ID (optional)"><Input value={f.purchaseId} onChange={e => setF({ ...f, purchaseId: e.target.value })} /></Field><Field label="Eligible taxable-business use (%)"><Input type="number" min={0} max={100} value={f.eligibleBps / 100} onChange={e => setF({ ...f, eligibleBps: Math.round(Number(e.target.value) * 100) })} /></Field></>}
    {(['turnover', 'input'].includes(f.kind)) && <Field label="Value excluding taxes (GHS)"><MoneyInput value={f.base} onChange={v => setF({ ...f, base: v })} /></Field>}
    {f.kind === 'payment' && <Field label="VAT return month this payment settles"><Input type="month" value={f.period} min="2026-01" max={today().slice(0, 7)} onChange={e => setF({ ...f, period: e.target.value })} /></Field>}
    {f.kind === 'payment' ? <Field label="Amount paid to GRA (GHS)"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field> : f.kind !== 'turnover' && (['vat', ...(f.kind === 'withholding' ? [] : ['nhil', 'getfund'])] as const).map(key => <Field key={key} label={`${key.toUpperCase()} on evidence (GHS)`}><MoneyInput allowNegative={f.kind === 'adjustment'} value={f[key as 'vat']} onChange={v => setF({ ...f, [key]: v })} /></Field>)}
    <Field label="Reason / eligibility evidence" className="sm:col-span-2"><Input value={f.reason} maxLength={400} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
    <label className="text-sm sm:col-span-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I checked the invoice/certificate, eligibility, claim timing and that these amounts have not already been claimed.</label>
  </div><p className="mt-3 text-sm">Keep the original evidence. VAT withholding is a credit against VAT; it does not reduce invoice tax. Input credits are recorded separately from stock costs: use costs excluding recoverable tax when receiving stock. Corrections use a documented adjustment in an open period.</p></Modal>;
}
function Filing({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(uuid), [reference, setReference] = useState(''), [reason, setReason] = useState(''), [reviewed, setReviewed] = useState(false);
  const { run, busy } = useAction();
  return <Modal title={`Record GRA filing · ${month}`} open onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button disabled={busy || !reviewed || !reference.trim() || !reason.trim()} onClick={() => void run(async () => { await call('tax.file', { id, month, reference, reason, reviewed }); onSaved(); }, 'Filing recorded; period locked')}>Record filed return</Button></>}><div className="space-y-4"><Alert>This records a return already filed through GRA. It does not submit a return. The month’s tax entries will be locked; later corrections need an open-period adjustment.</Alert><Field label="GRA acknowledgement reference"><Input value={reference} onChange={e => setReference(e.target.value)} /></Field><Field label="Reconciliation / filing note"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field><label className="text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I reconciled the export, reviewed the warnings and filed these figures with GRA.</label></div></Modal>;
}
