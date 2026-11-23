import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, QueryView, Select, Table, Textarea } from '@mansora/ui';
import { api, useApi } from './api';

/**
 * Leads: people who asked for a software demo (acquisition spec PR-03). Each lead keeps its enquiry, who looks
 * after it, when it was last contacted, the next follow-up, what was learned, an activity timeline and the emails
 * sent about it. Recording a call, meeting or email marks a new lead contacted, which stops the automatic
 * follow-ups. Contacting or qualifying a lead never creates a client account or subscription.
 */
const STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const;
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
const TYPE: Record<string, string> = { retail: 'Retail shop', mini_mart: 'Mini mart', general_merchandise: 'General merchandise', wholesale: 'Wholesale', other: 'Other' };
const EVENT: Record<string, string> = { note: 'Note', call: 'Phone call', meeting: 'Meeting', email_out: 'Email sent', email_in_logged: 'Email received', status: 'Status', assignment: 'Assigned', follow_up: 'Follow-up', opt_out: 'Opt-out', conversion: 'Converted', system: 'System' };
const EMAIL: Record<string, string> = { lead_ack: 'Acknowledgement to prospect', lead_alert: 'Team alert', lead_team_reminder: 'Team reminder (24 h)', lead_customer_followup: 'Prospect follow-up (48 h)', client_onboarding: 'Welcome email to client' };
const DELIVERY: Record<string, [string, string]> = { delivered: ['Delivered to inbox server', 'good'], bounced: ['Bounced', 'bad'], complained: ['Marked as spam', 'bad'], delayed: ['Delayed', 'warn'] };
// Times are stored in UTC and shown in Ghana time (GMT, no daylight saving), labelled as such.
const accra = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra', dateStyle: 'medium', timeStyle: 'short' }) + ' GMT' : '');
const tone = (s: string) => (s === 'new' ? 'warn' : s === 'closed' ? 'neutral' : 'good') as any;

export function Leads() {
  const [status, setStatus] = useState(''), [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null);
  const query = useApi<any>(`/v1/admin/leads?page=${page}${status ? `&status=${status}` : ''}`);
  return <div><PageHeader title="Leads" subtitle="People who asked for a software demo. Contacting or qualifying a lead never creates a client account or subscription." />
    <Field label="Request status"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All requests</option>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
    <Card pad={false} className="mt-4"><QueryView query={query} label="demo requests"><Table rows={query.data?.rows} rowKey={(r: any) => r.id} onRowClick={(r: any) => setSelected(r.id)} empty="No demo requests in this view" columns={[
      { header: 'Name', cell: (r: any) => r.name }, { header: 'Business', cell: (r: any) => r.business }, { header: 'Email', cell: (r: any) => r.email },
      { header: 'Status', cell: (r: any) => <Badge tone={tone(r.status)}>{label(r.status)}</Badge> },
      { header: 'Looked after by', cell: (r: any) => r.assigned_name ?? '—' },
      { header: 'Next follow-up', cell: (r: any) => (r.next_follow_up_at ? accra(r.next_follow_up_at) : '') },
      { header: 'Received', cell: (r: any) => r.created_at.slice(0, 10) }]} /></QueryView></Card>
    <div className="my-4 flex items-center gap-3"><Button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous leads</Button><span>Page {page}</span><Button disabled={!query.data?.hasMore} onClick={() => setPage(p => p + 1)}>Next leads</Button></div>
    {selected && <LeadDetail id={selected} onClose={() => setSelected(null)} onChanged={() => query.reload()} />}
  </div>;
}

function LeadDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<any>(`/v1/admin/leads/${id}`);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [kind, setKind] = useState('call'), [text, setText] = useState('');
  const [follow, setFollow] = useState<string | null>(null);
  const [qual, setQual] = useState<any>(null);
  const d = detail.data, lead = d?.lead;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); detail.reload(); onChanged(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const put = (body: object) => run(() => api('PUT', `/v1/admin/leads/${id}`, body));
  const q = qual ?? lead?.qualification ?? {};
  return <Modal title="Demo request" wide trackChanges={false} open onClose={() => { if (!busy) onClose(); }}>
    <QueryView query={detail} label="demo request">{lead && <div className="space-y-5">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">{[['Reference', lead.reference ?? '—'], ['Name', lead.name], ['Business', lead.business], ['Email', lead.email], ['Phone', lead.phone || 'Not provided'],
        ['Kind of business', lead.business_type ? TYPE[lead.business_type] : 'Not given'], ['Came from', lead.source === 'website' ? 'Mansora website' : lead.source === 'admin' ? 'Added by Mansora' : 'Demo request form'],
        ['Received', accra(lead.created_at)], ['Contact consent recorded', accra(lead.consent_at)], ['Last contacted', lead.last_contacted_at ? accra(lead.last_contacted_at) : 'Not yet']].map(([k, v]) =>
        <div key={k}><dt className="font-semibold">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>)}
        <div className="sm:col-span-2"><dt className="font-semibold">What they would like to see</dt><dd className="whitespace-pre-wrap break-words">{lead.message || 'Not provided'}</dd></div></dl>

      {lead.tenant_id
        ? <Alert tone="good">Converted to a client on {accra(lead.converted_at)}. Continue onboarding under Clients.</Alert>
        : lead.status === 'qualified' && <ConvertLead lead={lead} onDone={() => { detail.reload(); onChanged(); }} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Lead status"><Select disabled={busy} value={lead.status} onChange={e => put({ status: e.target.value })}>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
        <Field label="Looked after by"><Select disabled={busy} value={lead.assigned_admin_id ?? ''} onChange={e => put({ assignedAdminId: e.target.value || null })}><option value="">Nobody yet</option>{d.admins.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Next follow-up (Ghana time)"><div className="flex gap-2"><Input type="datetime-local" disabled={busy} aria-label="Next follow-up (Ghana time)" value={follow ?? (lead.next_follow_up_at ? lead.next_follow_up_at.slice(0, 16) : '')} onChange={e => setFollow(e.target.value)} />
          <Button size="sm" disabled={busy || follow === null} onClick={() => put({ nextFollowUpAt: follow ? new Date(`${follow}:00Z`).toISOString() : null }).then(() => setFollow(null))}>Save</Button></div></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={!!lead.follow_up_opt_out_at} onChange={e => put({ optOut: e.target.checked })} /> The prospect asked not to receive the automatic follow-up email</label>

      <Card title="Record a contact or note">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="What happened"><Select value={kind} onChange={e => setKind(e.target.value)}><option value="call">Phone call</option><option value="meeting">Meeting or demo</option><option value="email_out">Email we sent</option><option value="email_in_logged">Email they sent</option><option value="note">Internal note</option></Select></Field>
          <Field label="Details" className="sm:col-span-3"><Textarea rows={2} maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder="What was said or agreed" /></Field>
        </div>
        <div className="mt-2 flex items-center gap-3"><Button variant="primary" disabled={busy || !text.trim()} onClick={() => run(async () => { await api('POST', `/v1/admin/leads/${id}/events`, { kind, body: text }); setText(''); })}>Record</Button>
          <span className="text-xs text-slate-600">A call, meeting or email marks a new lead as contacted and stops the automatic follow-ups.</span></div>
      </Card>

      <Card title="What we learned">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Shops"><Input type="number" min={0} value={q.shops ?? ''} onChange={e => setQual({ ...q, shops: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
          <Field label="Tills"><Input type="number" min={0} value={q.tills ?? ''} onChange={e => setQual({ ...q, tills: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
          <Field label="Plan interest"><Select value={q.planInterest ?? ''} onChange={e => setQual({ ...q, planInterest: e.target.value || undefined })}><option value="">Not discussed</option><option value="starter">Starter</option><option value="business">Business</option><option value="plus">Plus</option><option value="undecided">Undecided</option></Select></Field>
          <Field label="System they use now"><Input maxLength={200} value={q.currentSystem ?? ''} onChange={e => setQual({ ...q, currentSystem: e.target.value })} /></Field>
          <Field label="Budget"><Input maxLength={200} value={q.budget ?? ''} onChange={e => setQual({ ...q, budget: e.target.value })} /></Field>
          <Field label="Needs" className="sm:col-span-3"><Textarea rows={2} maxLength={2000} value={q.needs ?? ''} onChange={e => setQual({ ...q, needs: e.target.value })} /></Field>
        </div>
        <Button className="mt-2" disabled={busy || qual === null} onClick={() => put({ qualification: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) }).then(() => setQual(null))}>Save what we learned</Button>
      </Card>

      {error && <Alert tone="bad">{error}</Alert>}

      <Card title="Timeline" pad={false}><Table rows={d.events} rowKey={(e: any) => e.id} empty="Nothing recorded yet" columns={[
        { header: 'When (Ghana time)', cell: (e: any) => accra(e.occurred_at) }, { header: 'What', cell: (e: any) => EVENT[e.kind] ?? e.kind },
        { header: 'Details', cell: (e: any) => <span className="whitespace-pre-wrap">{e.body}</span> }, { header: 'By', cell: (e: any) => e.actor_name ?? 'System' }]} /></Card>

      <Card title="Emails about this request" pad={false}><Table rows={d.emails} rowKey={(m: any) => m.id} empty="No emails" columns={[
        { header: 'Email', cell: (m: any) => EMAIL[m.kind] ?? m.kind }, { header: 'To', cell: (m: any) => m.to_address ?? '' },
        { header: 'Status', cell: (m: any) => m.delivery_status ? <Badge tone={DELIVERY[m.delivery_status][1] as any}>{DELIVERY[m.delivery_status][0]}</Badge> : <Badge tone={m.status === 'sent' ? 'good' : m.status === 'failed' ? 'bad' : m.status === 'skipped' ? 'neutral' : 'warn'}>{m.status === 'sent' ? 'Accepted by email provider' : m.status === 'queued' ? (new Date(m.next_attempt_at) > new Date() ? `Due ${accra(m.next_attempt_at)}` : 'Waiting to send') : m.status === 'skipped' ? 'Not sent' : 'Failed'}</Badge> },
        { header: 'Note', cell: (m: any) => m.error ?? '' }]} /></Card>
      <p className="text-xs text-slate-600">"Accepted by email provider" means Resend took the email. "Delivered to inbox server" appears once Resend confirms delivery; it does not mean the person has read it.</p>
    </div>}</QueryView>
  </Modal>;
}

/** D03: an administrator explicitly approves turning a qualified lead into a client. Nothing is charged. */
function ConvertLead({ lead, onDone }: { lead: any; onDone: () => void }) {
  const plans = useApi<any[]>('/v1/admin/plans');
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [matches, setMatches] = useState<any[]>([]);
  const [f, setF] = useState({ name: lead.business, ownerName: lead.name, email: lead.email, phone: lead.phone ?? '', address: '', businessType: lead.business_type ?? 'retail', planId: '', detailsConfirmed: false });
  const submit = async () => {
    setBusy(true); setError(''); setMatches([]);
    try { await api('POST', `/v1/admin/leads/${lead.id}/convert`, { ...f, planId: f.planId || null, phone: f.phone || null, address: f.address || null }); setOpen(false); onDone(); }
    catch (e: any) { setError(e.message); if (e.code === 'POSSIBLE_DUPLICATE') setMatches(e.details?.matches ?? []); }
    finally { setBusy(false); }
  };
  const link = async (tenantId: string) => { setBusy(true); setError(''); try { await api('POST', `/v1/admin/leads/${lead.id}/link`, { tenantId }); setOpen(false); onDone(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  if (!open) return <Card title="Ready to become a client?"><p className="mb-3 text-sm text-slate-600">Converting creates the client with the usual onboarding checklist and, if a plan was agreed, a draft subscription. Nothing is invoiced or charged. A welcome email with setup guidance is sent to the client.</p><Button variant="primary" onClick={() => setOpen(true)}>Convert to client</Button></Card>;
  return <Card title="Convert to client">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Business name"><Input required maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Owner name"><Input required maxLength={120} value={f.ownerName} onChange={e => setF({ ...f, ownerName: e.target.value })} /></Field>
      <Field label="Email (welcome email goes here)"><Input required type="email" maxLength={200} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Phone"><Input maxLength={40} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Address (optional)"><Input maxLength={300} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Kind of business"><Select value={f.businessType} onChange={e => setF({ ...f, businessType: e.target.value })}>{Object.entries(TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Agreed service plan"><Select value={f.planId} onChange={e => setF({ ...f, planId: e.target.value })}><option value="">Not agreed yet</option>{(plans.data ?? []).filter((p: any) => p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    </div>
    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.detailsConfirmed} onChange={e => setF({ ...f, detailsConfirmed: e.target.checked })} /> I have confirmed these details, the email address and the commercial agreement with the prospect</label>
    {error && <Alert tone="bad" className="mt-3">{error}</Alert>}
    {matches.length > 0 && <div className="mt-3 space-y-2 text-sm"><p className="font-semibold">Possible existing clients:</p>{matches.map((m: any) => <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2"><span>{m.name} · {m.owner_name} · {m.email ?? 'no email'} · {m.phone ?? 'no phone'} · {m.status}</span><Button size="sm" disabled={busy} onClick={() => link(m.id)}>Link to this client</Button></div>)}<p className="text-xs text-slate-600">Linking records that this lead is that client. No new client is created and no email is sent. Or change the details above if this is a different business.</p></div>}
    <div className="mt-3 flex gap-2"><Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy || !f.detailsConfirmed || !f.name.trim() || !f.ownerName.trim() || !f.email.trim()} onClick={submit}>{busy ? 'Converting…' : 'Approve and convert'}</Button></div>
  </Card>;
}
