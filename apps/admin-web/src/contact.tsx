import { useState } from 'react';
import { Alert, Button, Card, Field, Input, PageHeader, QueryView, useUnsavedChanges } from '@mansora/ui';
import { api, useApi } from './api';
export function ContactSettings() {
  const query = useApi<any>('/v1/admin/contact-settings');
  return <div className="max-w-3xl"><PageHeader title="Support contact" subtitle="These details are public and appear in client Help and sign-in. Use business contact details only." /><QueryView query={query} label="support contact">{query.data && <ContactForm initial={query.data} />}</QueryView></div>;
}
function ContactForm({ initial }: { initial: Record<string, string> }) {
  const [value, setValue] = useState(initial), [saved, setSaved] = useState(JSON.stringify(initial)), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useUnsavedChanges(JSON.stringify(value) !== saved, 'support contact details');
  return <Card><form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    try { await api('PUT', '/v1/admin/contact-settings', value); setSaved(JSON.stringify(value)); setMessage('Contact details saved'); }
    catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  }}>{Object.entries({ name: 'Support team name', email: 'Support email', phone: 'Support phone', whatsapp: 'WhatsApp number (international digits only)', hours: 'Support hours', website: 'Support website (HTTPS)' }).map(([key, label]) => <Field key={key} label={label}><Input type={key === 'email' ? 'email' : key === 'website' ? 'url' : 'text'} required={key === 'name'} maxLength={key === 'website' ? 300 : 200} value={value[key]} onChange={e => setValue({ ...value, [key]: e.target.value })} /></Field>)}{message && <Alert>{message}</Alert>}<Button type="submit" variant="primary" disabled={busy}>Save support contact</Button></form></Card>;
}
