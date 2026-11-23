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
  if (!d || (d.feature?.enabled !== false && !d.amendmentReviewRequired && (d.registered || (!d.requiresReview && !d.near)))) return null;
  return <Alert tone="warn" className="mb-4">{d.message} <Button size="sm" onClick={onOpen}>Review VAT</Button></Alert>;
}
export function TaxPage() {
  const { state, go } = useApp();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState(false), [record, setRecord] = useState(false), [filing, setFiling] = useState(false), [reopening, setReopening] = useState(false);
  const status = useQuery<any>('tax.status', {}, [revision]);
  const report = useQuery<any>('tax.report', { month }, [revision]);
  const { run, busy } = useAction();
  const saved = () => { setRevision(v => v + 1); setSettings(false); setRecord(false); setFiling(false); setReopening(false); };
  const owner = state.user?.role === 'owner';
  const d = status.data, r = report.data;
  return <div className="space-y-5">
    <PageHeader title="Ghana VAT" subtitle="Turnover monitoring, VAT and levy working papers, credits and filing records" actions={<><Button onClick={() => go('vat-guide')}>VAT guide</Button>{owner && <><Button onClick={() => setSettings(true)} disabled={!d}>Tax settings</Button><Button onClick={() => setRecord(true)}>Record tax evidence</Button></>}</>} />
    <QueryView query={status} label="VAT status">{d && <><Alert tone={d.requiresReview && !d.registered ? 'warn' : 'info'}>{d.message} {d.unclassified > 0 && `${d.unclassified} active product(s) need classification in Products.`}</Alert>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{d.windows.map((w: any) => <Stat key={w.months} label={`${w.months}-month taxable turnover`} value={money(w.total)} hint={`Band ${money(w.threshold)}${w.months < 12 ? ' · forecast/registration review' : ''}`} tone={w.exceeded || w.near ? 'warn' : 'default'} />)}</div>
    {d.pendingTrigger && <Alert tone="warn">Automatic VAT charging effective {d.pendingTrigger.effectiveDate}. Registration application due {d.pendingTrigger.applicationDueDate}. Complete GRA registration and classify products before this date.</Alert>}
    <p className="text-sm text-slate-600">The annual test is GHS 750,000 under the default rules. Shorter bands and expected turnover prompt review. Registered businesses continue charging until an effective cancellation is recorded. Add turnover from other branches and channels without duplicating Mansora sales.</p>
    {d.amendmentReviewRequired && <Alert tone="warn">Service-provider rules changed during 2026. The owner must obtain the enacted commencement date or written GRA confirmation, then save that date and source in Tax settings. Managers should escalate this to the owner. Existing VAT obligations continue.</Alert>}</>}</QueryView>
    <div className="flex flex-wrap items-end gap-3"><Field label="VAT month"><Input type="month" value={month} min="2026-01" max={today().slice(0, 7)} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></Field><Button disabled={busy || !r} onClick={() => void run(async () => saveFile(await call('tax.export', { month })))}>Download VAT workbook</Button>{owner && <Button disabled={!r || !!r.blockers?.length || month >= today().slice(0, 7)} onClick={() => setFiling(true)}>Record GRA filing</Button>}{owner && <Button disabled={!r?.records.some((v: any) => v.kind === 'filing')} onClick={() => setReopening(true)}>GRA-authorised amendment</Button>}</div>
    <QueryView query={report} label="VAT report">{r && <>
      {!!r.blockers?.length && <Alert tone="warn"><strong>Filing blocked until reconciled</strong><ul className="list-disc pl-5">{r.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul></Alert>}
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Tax payable for month" value={money(r.payable)} /><Stat label="GRA payments for this return" value={money(r.payments)} hint="Matched by the return month each payment settles" /><Stat label="Unpaid tax for month" value={money(r.outstanding)} /></div>
      {r.arrears && (r.arrears.outstanding > 0 || r.arrears.unmatchedPayments.length > 0) && <Card title="Filed returns and payments" pad={false}><Table rows={r.arrears.rows} empty="No filed returns" columns={[{ header: 'Return month', cell: (v: any) => v.month }, { header: 'Payable', align: 'right', cell: (v: any) => money(v.payable) }, { header: 'Paid', align: 'right', cell: (v: any) => money(v.paid) }, { header: 'Still owed', align: 'right', cell: (v: any) => <strong>{money(v.outstanding)}</strong> }]} /><p className="px-4 py-2 text-sm">Total owed on filed returns: <strong>{money(r.arrears.outstanding)}</strong>{r.arrears.unmatchedPayments.length > 0 && ` · ${r.arrears.unmatchedPayments.length} payment(s) are for months with no filed return yet`}</p></Card>}
      <Card title="VAT and levy reconciliation" pad={false}><Table rows={r.buckets} columns={[
        { header: 'Tax', cell: (b: any) => b.tax.toUpperCase() },
        ...[['Recorded output', 'output'], ['Historical exposure', 'historicalExposure'], ['Refunds', 'reversals'], ['Input credits', 'inputs'], ['Withholding', 'withholding'], ['Adjustments', 'adjustments'], ['Prior credits', 'broughtForward'], ['Payable', 'payable'], ['Carry forward', 'carriedForward']].map(([header, key]) => ({ header, align: 'right' as const, cell: (b: any) => money(b[key]) })),
      ]} /></Card>
      {!!r.historicalExposure?.length && <Card title="Backdated VAT exposure · not tax collected"><p className="mb-3 text-sm">Calculated using the legal rules captured with each original sale while collection was disabled. Original invoices and payments remain unchanged. Reconcile original periods before filing.</p><Table rows={r.historicalExposure} columns={[{header:'Date',cell:(e:any)=>e.date},{header:'Source',cell:(e:any)=>e.reference},{header:'Type',cell:(e:any)=>e.kind},...['vat','nhil','getfund'].map(k=>({header:k.toUpperCase(),cell:(e:any)=>money(e[k])}))]} /></Card>}
      <Card title="Net supplies by VAT classification" pad={false}><Table rows={r.classification} columns={[{ header: 'Classification', cell: (v: any) => v.classification }, { header: 'Value excluding tax', cell: (v: any) => money(v.base), align: 'right' }]} /></Card>
      <Card title="Review before filing"><p className="mb-3">Deadline before public-holiday checks: {r.deadlineBeforeHolidayCheck}. File and pay through GRA’s authorised channel.</p><ul className="list-disc space-y-2 pl-5 text-sm">{r.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></Card>
      <Card title="Tax evidence and filing history" pad={false}><Table rows={r.records} empty="No input credits, certificates, adjustments, payments or filing records in this month" columns={[{ header: 'Date', cell: (v: any) => v.tax_date }, { header: 'Type', cell: (v: any) => v.kind }, { header: 'Reference', cell: (v: any) => v.reference }, { header: 'Reason', cell: (v: any) => v.data.reason ?? 'Filed return' }]} /></Card>
    </>}</QueryView>
    {d?.registered && <EvatCard owner={owner} />}
    {settings && d && <TaxSettings config={d.config} onClose={() => setSettings(false)} onSaved={saved} />}
    {record && <TaxRecord month={month} onClose={() => setRecord(false)} onSaved={saved} />}
    {reopening && r && <Reopen month={month} filingId={[...r.records].reverse().find((v: any) => v.kind === 'filing')?.id} onClose={() => setReopening(false)} onSaved={saved} />}
    {filing && <Filing month={month} onClose={() => setFiling(false)} onSaved={saved} />}
  </div>;
}
function TaxSettings({ config, onClose, onSaved }: { config: TaxConfig; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...config, effectiveDate: today(), reason: '' });
  const { run, busy } = useAction();
  const save = () => void run(async () => { await call('tax.configure', f); onSaved(); }, 'Tax settings saved');
  return <Modal title="Ghana tax settings" open onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !f.reason.trim()} onClick={save}>Save dated settings</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Settings effective date"><Input required={true} type="date" value={f.effectiveDate} min="2026-01-01" onChange={e => setF({ ...f, effectiveDate: e.target.value })} /></Field>
      <Field label="Business supplies"><Select value={f.supplyType} onChange={e => setF({ ...f, supplyType: e.target.value as TaxConfig['supplyType'] })}><option value="goods">Goods</option><option value="services">Services</option><option value="mixed">Goods and services</option></Select></Field>
      <label className="text-sm"><input type="checkbox" checked={f.automatic} onChange={e => setF({ ...f, automatic: e.target.checked })} /> Automatically schedule VAT when a verified registration threshold is met</label>
      <label className="text-sm"><input type="checkbox" checked={f.registered} onChange={e => setF({ ...f, registered: e.target.checked })} /> VAT registered / legally effective obligation confirmed</label>
      <Field label="Legal VAT effective date"><Input required={f.registered} type="date" value={f.registrationDate ?? ''} onChange={e => setF({ ...f, registrationDate: e.target.value || null })} /></Field>
      <Field label="Business TIN"><Input required={f.registered} value={f.tin} onChange={e => setF({ ...f, tin: e.target.value })} /></Field>
      <Field label="VAT registration number"><Input value={f.vatNumber} onChange={e => setF({ ...f, vatNumber: e.target.value })} /></Field>
      <Field label="Catalogue selling prices"><Select value={f.pricing} onChange={e => setF({ ...f, pricing: e.target.value as TaxConfig['pricing'] })}><option value="inclusive">Include VAT and levies (absorb tax)</option><option value="exclusive">Exclude VAT and levies (add tax)</option></Select></Field>
      <Field label="Annual registration threshold (GHS)"><MoneyInput value={f.threshold} onChange={v => setF({ ...f, threshold: v ?? 0 })} /></Field>
      <Field label="Expected taxable supplies over next 12 months (GHS)"><MoneyInput value={f.forecast} onChange={v => setF({ ...f, forecast: v ?? 0 })} /></Field>
      <Field label="Expected taxable supplies over next 9 months (GHS)"><MoneyInput value={f.forecastNineMonths} onChange={v => setF({ ...f, forecastNineMonths: v ?? 0 })} /></Field>
      <Field label="Early alert at (%)"><Input type="number" min={1} max={100} step="0.01" value={f.alertBps / 100} onChange={e => setF({ ...f, alertBps: Math.round(Number(e.target.value) * 100) })} /></Field>
      {([['VAT rate (%)', 'vatBps'], ['NHIL rate (%)', 'nhilBps'], ['GETFund rate (%)', 'getfundBps']] as const).map(([label, key]) => <Field label={label} key={key}><Input type="number" min={0} max={100} step="0.01" value={f[key] / 100} onChange={e => setF({ ...f, [key]: Math.round(Number(e.target.value) * 100) })} /></Field>)}
      {f.supplyType !== 'goods' && <><Field label="Service amendment commencement date"><Input required={f.serviceThresholdConfirmed} type="date" value={f.serviceThresholdDate ?? ''} onChange={e => setF({ ...f, serviceThresholdDate: e.target.value || null })} /></Field><Field label="Service amendment authority / GRA reference"><Input required={f.serviceThresholdConfirmed} value={f.serviceThresholdAuthority} maxLength={400} onChange={e => setF({ ...f, serviceThresholdAuthority: e.target.value })} /></Field></>}
      <label className="text-sm"><input type="checkbox" checked={f.serviceThresholdConfirmed} onChange={e => setF({ ...f, serviceThresholdConfirmed: e.target.checked })} /> Service-threshold applicability and commencement checked</label>
      <label className="text-sm"><input type="checkbox" checked={f.mandatoryRegistration} onChange={e => setF({ ...f, mandatoryRegistration: e.target.checked })} /> Special registration obligation / GRA direction applies</label>
      <Field label="Legal authority for non-standard rates or threshold"><Input required={f.vatBps !== 1500 || f.nhilBps !== 250 || f.getfundBps !== 250 || f.threshold !== 75000000} value={f.ruleOverrideAuthority} maxLength={400} onChange={e => setF({ ...f, ruleOverrideAuthority: e.target.value })} /></Field>
      <Field label="GRA cancellation / deregistration authority"><Input value={f.deregistrationAuthority} maxLength={400} onChange={e => setF({ ...f, deregistrationAuthority: e.target.value })} /></Field>
      <Field label="Reason and supporting authority" className="sm:col-span-2"><Input required={true} value={f.reason} maxLength={400} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
    </div><p className="mt-4 text-sm">Changes apply to new transactions from the settings date. Previous receipts and refund tax remain tied to their original snapshots. Automatic threshold triggers schedule charging for the next tax period. The legal effective date controls charging; complete GRA registration without delay.</p>
  </Modal>;
}
function TaxRecord({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(uuid);
  const [f, setF] = useState({ classification: 'standard', reconcilesTurnoverId: '', reconcilesSaleItemId: '', attribution: 'direct_taxable', inputCategory: 'ordinary', exceptionConfirmed: false, financialInstitution: false, onHandAtRegistration: false, legalAuthority: '', originalPeriod: month, accrualDate: '', accrualBasis: '', kind: 'input', date: month === today().slice(0, 7) ? today() : month + '-01', invoiceDate: today(), supplierTin: '', reference: '', reason: '', base: 0 as number | null, vat: 0 as number | null, nhil: 0 as number | null, getfund: 0 as number | null, amount: 0 as number | null, eligibleBps: 10000, purchaseId: '', period: month === today().slice(0, 7) ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7) : month });
  const [confirmed, setConfirmed] = useState(false);
  const { run, busy } = useAction();
  const save = () => void run(async () => { await call('tax.record', { ...f, id, invoiceDate: f.kind === 'input' ? f.invoiceDate : undefined, purchaseId: f.purchaseId || undefined, period: f.kind === 'payment' ? f.period : undefined, reconcilesTurnoverId: f.reconcilesTurnoverId || undefined, reconcilesSaleItemId: f.reconcilesSaleItemId || undefined, originalPeriod: f.kind === 'adjustment' ? f.originalPeriod : undefined, accrualDate: f.kind === 'input' && f.accrualDate ? f.accrualDate : undefined, evidenceConfirmed: confirmed }); onSaved(); }, 'Tax evidence recorded');
  return <Modal title="Record tax evidence" open wide onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || [f.base, f.vat, f.nhil, f.getfund, f.amount].some(v => v == null) || !confirmed || !f.reference.trim() || !f.reason.trim()} onClick={save}>Save evidence</Button></>}><div className="grid gap-4 sm:grid-cols-2">
    <Field label="Evidence type"><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="input">Eligible purchase input credits</option><option value="withholding">VAT withholding certificate received</option><option value="adjustment">Tax adjustment (signed amounts)</option><option value="opening_credit">Verified opening carry-forward credit</option><option value="turnover">Unregistered turnover outside Mansora (threshold only)</option><option value="external_sale">External sale for VAT reporting</option><option value="payment">GRA payment for selected tax month</option></Select></Field>
    <Field label="Tax date / month being settled"><Input required={true} type="date" value={f.date} max={today()} min="2026-01-01" onChange={e => setF({ ...f, date: e.target.value })} /></Field>
    <Field label="Invoice / certificate / payment reference"><Input required={true} value={f.reference} maxLength={120} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
    {f.kind === 'input' && <><Field label="Supplier TIN"><Input required={true} value={f.supplierTin} onChange={e => setF({ ...f, supplierTin: e.target.value })} /></Field><Field label="Supplier invoice date"><Input required={true} type="date" value={f.invoiceDate} onChange={e => setF({ ...f, invoiceDate: e.target.value })} /></Field><Field label="Linked purchase ID (optional)"><Input value={f.purchaseId} onChange={e => setF({ ...f, purchaseId: e.target.value })} /></Field><Field label="Eligible taxable-business use (%)"><Input type="number" min={0} max={100} value={f.eligibleBps / 100} onChange={e => setF({ ...f, eligibleBps: Math.round(Number(e.target.value) * 100) })} /></Field></>}
    {(['turnover', 'input', 'external_sale'].includes(f.kind)) && <Field label="Value excluding taxes (GHS)"><MoneyInput required={true} value={f.base} onChange={v => setF({ ...f, base: v })} /></Field>}
    {f.kind === 'payment' && <Field label="VAT return month this payment settles"><Input required={true} type="month" value={f.period} min="2026-01" max={today().slice(0, 7)} onChange={e => setF({ ...f, period: e.target.value })} /></Field>}
    {f.kind === 'payment' ? <Field label="Amount paid to GRA (GHS)"><MoneyInput required={true} value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field> : f.kind !== 'turnover' && (['vat', ...(f.kind === 'withholding' ? [] : ['nhil', 'getfund'])] as const).map(key => <Field key={key} label={`${key.toUpperCase()} on evidence (GHS)`}><MoneyInput allowNegative={f.kind === 'adjustment'} value={f[key as 'vat']} onChange={v => setF({ ...f, [key]: v })} /></Field>)}
    {f.kind === 'input' && <>
      <Field label="Input-credit accrual date (optional)" hint="Defaults to invoice date, or registration date for eligible pre-registration goods."><Input type="date" value={f.accrualDate} onChange={e => setF({ ...f, accrualDate: e.target.value })} /></Field>
      <Field label="Evidence for a later accrual date"><Input value={f.accrualBasis} maxLength={400} onChange={e => setF({ ...f, accrualBasis: e.target.value })} /></Field>
      <Field label="Input category"><Select value={f.inputCategory} onChange={e => setF({ ...f, inputCategory: e.target.value })}><option value="ordinary">Goods / stock</option><option value="services">Services</option><option value="capital">Capital goods</option><option value="vehicle">Motor vehicle / spare parts</option><option value="entertainment">Entertainment, restaurant, meals or hotel</option><option value="membership">Sporting/social/recreational membership</option></Select></Field>
      <Field label="Input attribution"><Select value={f.attribution} onChange={e => setF({ ...f, attribution: e.target.value })}><option value="direct_taxable">Direct taxable/business use</option><option value="residual_mixed">Unattributable mixed taxable/exempt use (section 52)</option><option value="exempt">Exempt supplies</option><option value="private">Private use</option></Select></Field>
      <label className="text-sm"><input type="checkbox" checked={f.exceptionConfirmed} onChange={e => setF({ ...f, exceptionConfirmed: e.target.checked })} /> Statutory vehicle/entertainment business exception evidenced</label>
      <label className="text-sm"><input type="checkbox" checked={f.financialInstitution} onChange={e => setF({ ...f, financialInstitution: e.target.checked })} /> Bank or financial institution</label>
      <label className="text-sm"><input type="checkbox" checked={f.onHandAtRegistration} onChange={e => setF({ ...f, onHandAtRegistration: e.target.checked })} /> Eligible stock/capital goods held on registration date (pre-registration claim only)</label>
    </>}
    {f.kind === 'external_sale' && <><Field label="External supply classification"><Select value={f.classification} onChange={e => setF({ ...f, classification: e.target.value })}><option value="standard">Standard</option><option value="zero">Zero-rated</option><option value="exempt">Exempt</option><option value="outside">Outside scope</option></Select></Field><Field label="Reconciles threshold entry ID (optional)"><Input value={f.reconcilesTurnoverId} onChange={e => setF({ ...f, reconcilesTurnoverId: e.target.value })} /></Field></>}
    {f.kind === 'adjustment' && <><Field label="Original tax period"><Input type="month" value={f.originalPeriod} onChange={e => setF({ ...f, originalPeriod: e.target.value })} /></Field><Field label="Reconciles original inclusive sale line ID (optional)"><Input value={f.reconcilesSaleItemId} onChange={e => setF({ ...f, reconcilesSaleItemId: e.target.value })} /></Field><Field label="Legal authority for this adjustment"><Input required={true} value={f.legalAuthority} onChange={e => setF({ ...f, legalAuthority: e.target.value })} /></Field></>}
    <Field label="Reason / eligibility evidence" className="sm:col-span-2"><Input required={true} value={f.reason} maxLength={400} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
    <label className="text-sm sm:col-span-2"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I checked the invoice/certificate, eligibility, claim timing and that these amounts have not already been claimed.</label>
  </div><p className="mt-3 text-sm">Keep the original evidence. VAT withholding is a credit against VAT; it does not reduce invoice tax. Input credits are recorded separately from stock costs: use costs excluding recoverable tax when receiving stock. Prior-return errors need GRA amendment approval. Current-period adjustments require their legal basis.</p></Modal>;
}
function Filing({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(uuid), [reference, setReference] = useState(''), [reason, setReason] = useState(''), [reviewed, setReviewed] = useState(false), [fiscal, setFiscal] = useState(false), [submittedDate,setSubmittedDate] = useState(today());
  const { run, busy } = useAction();
  return <Modal title={`Record GRA filing · ${month}`} open onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button disabled={busy || !fiscal || !reviewed || !reference.trim() || !reason.trim()} onClick={() => void run(async () => { await call('tax.file', { id, month, reference, reason, reviewed, fiscalEvidenceConfirmed: fiscal, submittedDate }); onSaved(); }, 'Filing recorded; period locked')}>Record filed return</Button></>}><div className="space-y-4"><Alert>This records a return already filed through GRA. It does not submit a return. The month’s tax entries will be locked; prior-return errors require GRA-authorised amendment; they cannot simply reduce a later return.</Alert><Field label="Actual GRA submission date"><Input required={true} type="date" value={submittedDate} max={today()} onChange={e => setSubmittedDate(e.target.value)} /></Field><Field label="GRA acknowledgement reference"><Input required={true} value={reference} onChange={e => setReference(e.target.value)} /></Field><Field label="Reconciliation / filing note"><Input required={true} value={reason} onChange={e => setReason(e.target.value)} /></Field><label className="text-sm"><input type="checkbox" required checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I reconciled the export, reviewed the warnings and filed these figures with GRA.</label><label className="block text-sm"><input type="checkbox" required checked={fiscal} onChange={e => setFiscal(e.target.checked)} /> I reconciled the figures and tax documents to the GRA-approved fiscal records or authorised filing process.</label></div></Modal>;
}

function Reopen({ month, filingId, onClose, onSaved }: { month: string; filingId: string; onClose: () => void; onSaved: () => void }) {
  const [id] = useState(uuid), [originalSubmissionDate,setOriginalSubmissionDate] = useState(''), [submissionEvidence,setSubmissionEvidence] = useState(''), [applicationDate,setApplicationDate] = useState(today()), [approvalReference,setApprovalReference] = useState(''), [legalAuthority,setLegalAuthority] = useState(''), [reason,setReason] = useState(''), [confirmed,setConfirmed] = useState(false);
  const { run,busy } = useAction();
  return <Modal title={`GRA-authorised amendment · ${month}`} open onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button disabled={busy || !confirmed || !approvalReference.trim() || !legalAuthority.trim() || !reason.trim()} onClick={() => void run(async () => { await call('tax.reopen',{ id,filingId,month,applicationDate,originalSubmissionDate: originalSubmissionDate || undefined, submissionEvidence: submissionEvidence || undefined,approvalReference,legalAuthority,reason,approvalConfirmed: confirmed }); onSaved(); },'Amendment draft opened; original filing preserved')}>Open amendment draft</Button></>}><div className="space-y-4"><Alert>Use only after GRA approval. Section 63 applications must be made within three months of the original submission. Reopen later filed periods first and reconcile carry-forward credits; refile earlier periods first. The original acknowledgements and snapshots remain immutable.</Alert><Field label="Original GRA submission date (required for legacy filing records)"><Input type="date" value={originalSubmissionDate} max={today()} onChange={e => setOriginalSubmissionDate(e.target.value)} /></Field><Field label="Original acknowledgement/date evidence"><Input value={submissionEvidence} onChange={e => setSubmissionEvidence(e.target.value)} /></Field><Field label="Date amendment application was made"><Input required={true} type="date" value={applicationDate} max={today()} onChange={e => setApplicationDate(e.target.value)} /></Field><Field label="GRA approval reference"><Input required={true} value={approvalReference} onChange={e => setApprovalReference(e.target.value)} /></Field><Field label="Applicable legal/GRA authority"><Input required={true} value={legalAuthority} onChange={e => setLegalAuthority(e.target.value)} /></Field><Field label="Grounds for amendment"><Input required={true} value={reason} onChange={e => setReason(e.target.value)} /></Field><label><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I hold GRA approval for this amendment.</label></div></Modal>;
}

/**
 * Audit F01: GRA E-VAT submission queue. Live submission needs the GRA-issued specification, credentials and
 * sign-off; until then only Off and Test (practice identifiers, not valid for tax) are available.
 */
function EvatCard({ owner }: { owner: boolean }) {
  const q = useQuery<any>('evat.status');
  const { run, busy } = useAction();
  const [reason, setReason] = useState('');
  const e = q.data;
  return <QueryView query={q} label="E-VAT status">{e && <Card title="GRA E-VAT submissions">
    <p className="mb-3 text-sm">Mode: <strong>{e.mode === 'off' ? 'Off' : e.mode === 'test' ? 'Test (practice identifiers, not valid for tax)' : 'Live'}</strong>. Live E-VAT is not available until Mansora completes GRA onboarding (API specification, credentials and sign-off). Receipts say they are not issued through GRA E-VAT until then.</p>
    <div className="mb-3 grid gap-3 sm:grid-cols-3"><Stat label="Waiting to submit" value={e.pending} tone={e.pending ? 'warn' : 'default'} /><Stat label="Accepted" value={e.accepted} /><Stat label="Rejected" value={e.rejected} tone={e.rejected ? 'bad' : 'default'} /></div>
    {e.downtimeNoticeRequired && <Alert tone="bad" className="mb-3">Documents have waited more than 24 hours to be submitted. GRA guidance expects longer downtime to be notified. Reconnect and submit, and notify GRA if the outage continues.</Alert>}
    {e.rejectedDocuments.length > 0 && <Table rows={e.rejectedDocuments} columns={[{ header: 'Document', cell: (r: any) => r.document_no }, { header: 'Reason', cell: (r: any) => r.last_error }, { header: '', align: 'right', cell: (r: any) => owner && <Button size="sm" disabled={busy} onClick={() => void run(async () => { await call('evat.retry', { id: r.id }); q.reload(); }, 'Queued again')}>Send again</Button> }]} />}
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <Button disabled={busy || !e.pending || e.mode === 'off'} onClick={() => void run(async () => { await call('evat.run'); q.reload(); }, 'Submitted')}>Submit now</Button>
      {owner && <><Field label="Reason for change"><Input required id="evat-reason" value={reason} onChange={ev => setReason(ev.target.value)} /></Field>
        <Button disabled={busy || !reason.trim()} onClick={() => void run(async () => { await call('evat.configure', { mode: e.mode === 'test' ? 'off' : 'test', reason }); setReason(''); q.reload(); }, 'E-VAT mode changed')}>{e.mode === 'test' ? 'Turn test mode off' : 'Turn on test mode'}</Button></>}
    </div>
  </Card>}</QueryView>;
}
