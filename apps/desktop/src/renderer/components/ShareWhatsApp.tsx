import { useState } from 'react';
import { Alert, Button, Field, Input, Modal, Textarea } from '@mansora/ui';
import { openExternal, useAction } from '../lib';
import { MAX_WHATSAPP_TEXT, whatsappPhone, whatsappUrl } from '../customer-sharing';
export function ShareWhatsApp({ label = 'Share on WhatsApp', phone: initialPhone = '', message }: { label?: string; phone?: string | null; message: string }) {
  const [open, setOpen] = useState(false), [phone, setPhone] = useState(initialPhone ?? ''), [confirmed, setConfirmed] = useState(false);
  const { run, busy } = useAction();
  return <><Button onClick={() => { setPhone(initialPhone ?? ''); setConfirmed(false); setOpen(true); }}>{label}</Button>{open && <Modal title="Review WhatsApp draft" trackChanges={false} open onClose={() => { if (!busy) setOpen(false); }} footer={<><Button onClick={() => setOpen(false)}>Cancel sharing</Button><Button variant="primary" disabled={busy || !confirmed || !whatsappPhone(phone) || message.length > MAX_WHATSAPP_TEXT} onClick={() => run(async () => { await openExternal(whatsappUrl(phone, message)); })}>Open WhatsApp draft</Button></>}>
    <p className="mb-4 text-sm text-slate-600">Check the recipient and figures. Opening WhatsApp passes this preview and number to WhatsApp; you choose whether to send it. Mansora does not send a message, record a payment or mark a reminder delivered.</p>
    <Field label="Customer WhatsApp number" hint="Include the country code, for example +233. A local number is not automatically converted."><Input value={phone} onChange={e => { setPhone(e.target.value); setConfirmed(false); }} inputMode="tel" autoComplete="off" /></Field>
    <Field label="Message preview" className="mt-4"><Textarea readOnly value={message} rows={10} /></Field>
    {message.length > MAX_WHATSAPP_TEXT && <Alert tone="warn">This statement is too long for this sharing action. Save or print it and attach the file manually.</Alert>}
    <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I have checked that this is the intended customer and that sharing these records is appropriate.</span></label>
  </Modal>}</>;
}
