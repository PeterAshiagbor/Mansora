import { useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Modal, QueryView, Select, Table, Textarea, useUnsavedChanges } from '@mansora/ui';
import { api, useApi } from './api';

export function Communications() {
  const messages = useApi<any[]>('/v1/admin/billing/notifications');
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const action = async (path: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await api('POST', path, {}); messages.reload(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <>
    <Alert tone="info" className="mb-3">Reminders, client messages and platform alerts appear here. “Sent” means accepted by the email provider; it does not confirm arrival in the recipient’s inbox. Delivery retries temporary failures automatically.</Alert>
    <div className="mb-3 flex flex-wrap gap-2"><Button variant="primary" onClick={() => setComposing(true)}>Write client message</Button><Button disabled={busy} onClick={() => action('/v1/admin/billing/notifications/deliver')}>Process queued email</Button><Button onClick={messages.reload}>Refresh messages</Button></div>
    {error && <Alert tone="bad" className="mb-3">{error}</Alert>}
    <Card pad={false}><QueryView query={messages} label="email messages"><Table rows={messages.data} rowKey={r => r.id} empty="No messages yet" columns={[
      { header: 'When', cell: r => new Date(r.created_at).toLocaleString('en-GB') },
      { header: 'To', cell: r => r.to_address ?? '(no address)' }, { header: 'Client', cell: r => r.client ?? 'Platform' },
      { header: 'Subject', cell: r => r.subject }, { header: 'Type', cell: r => r.kind.replaceAll('_', ' ') },
      { header: 'Status', cell: r => <Badge tone={r.status === 'failed' ? 'bad' : r.status === 'sent' ? 'good' : 'neutral'}>{r.status}</Badge> },
      { header: 'Delivery', cell: r => <span className="text-xs">{r.error ?? (r.provider_message_id ? 'Accepted by Resend' : '—')}{r.attempt_count > 0 && <> · {r.attempt_count} attempt(s)</>}</span> },
      { header: 'Action', cell: r => r.status === 'failed' ? <Button size="sm" disabled={busy} onClick={() => action(`/v1/admin/billing/notifications/${r.id}/retry`)}>Retry email</Button> : null },
    ]} /></QueryView></Card>
    {composing && <Compose onClose={() => setComposing(false)} onQueued={() => { setComposing(false); messages.reload(); }} />}
  </>;
}
function Compose({ onClose, onQueued }: { onClose: () => void; onQueued: () => void }) {
  const clients = useApi<any[]>('/v1/admin/clients');
  const [tenantId, setTenantId] = useState(''), [subject, setSubject] = useState(''), [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const id = useRef(crypto.randomUUID());
  useUnsavedChanges(!!(tenantId || subject || body), 'the client message');
  return <Modal title="Write client message" open onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" form="client-message" variant="primary" disabled={busy || !tenantId || !subject.trim() || !body.trim()}>Queue message</Button></>}>
    <p className="mb-4 text-sm text-slate-600">Send a service message to this client’s billing contact. Review the client and message before submitting. This is not a bulk marketing tool.</p>
    {error && <Alert tone="bad" className="mb-3">{error}</Alert>}
    <form id="client-message" className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError(null);
      try { await api('POST', '/v1/admin/billing/notifications', { id: id.current, tenantId, subject: subject.trim(), body: body.trim() }); onQueued(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
    }}>
      <QueryView query={clients} label="client list"><Field label="Client" hint="Uses the saved billing email, or the client email when no separate billing email exists."><Select required value={tenantId} onChange={e => setTenantId(e.target.value)}><option value="">Choose a client</option>{clients.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field></QueryView>
      <Field label="Subject"><Input required maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} /></Field>
      <Field label="Message"><Textarea required rows={8} maxLength={10000} value={body} onChange={e => setBody(e.target.value)} /></Field>
    </form>
  </Modal>;
}
