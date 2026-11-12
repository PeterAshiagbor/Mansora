import { useEffect, useState } from 'react';
import { Button, Card, Modal } from '@mansora/ui';
import { openExternal } from '../lib';

interface Contact { name: string; email: string; phone: string; whatsapp: string; hours: string; website: string }
export function ContactMansora({ recovery = false }: { recovery?: boolean }) {
  const [open, setOpen] = useState(false), [contact, setContact] = useState<Contact | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const base = (import.meta as any).env?.VITE_PUBLIC_API_URL ?? (location.protocol === 'file:' ? null : '/api');
    if (!base) { setFailed(true); return; }
    fetch(base + '/v1/public/contact', { signal: AbortSignal.timeout(8000), credentials: 'omit' }).then(async r => {
      if (!r.ok) throw new Error();
      const value = await r.json();
      if (live) { setContact(value); setFailed(false); }
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open]);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>{recovery ? 'Forgot password? Get help' : 'Contact Mansora'}</Button>{open && <Modal title={recovery ? 'Help signing in' : 'Contact Mansora'} trackChanges={false} open onClose={() => setOpen(false)}>
    {recovery && <div className="mb-5 space-y-3 text-sm"><p><strong>Staff:</strong> ask your business owner to reset your staff password. Mansora cannot disclose it.</p><p><strong>Business owners:</strong> use the owner recovery form on the sign-in screen. You will need a recovery code issued after your identity is verified. {window.MANSORA_OWNER_RECOVERY_URL ? <>For this browser workspace, <a className="underline" href={window.MANSORA_OWNER_RECOVERY_URL}>request a private recovery link</a> at the recorded owner email.</> : <>For a browser workspace, contact Mansora for the recovery process.</>}</p><p>Never send your password, passphrase, payment PIN or recovery code through email or WhatsApp.</p></div>}
    <Card title={contact?.name || 'Mansora support'}>
      {!contact && !failed && <p role="status">Loading contact details…</p>}
      {failed && <p role="status" className="text-sm">Contact details could not be loaded. Use the contact details in your invitation or service agreement. No password has been changed.</p>}
      {contact && <div className="space-y-3 text-sm">{contact.hours && <p>Support hours: {contact.hours}</p>}
        {contact.email && <p><a className="underline" href={`mailto:${contact.email}`}>{contact.email}</a></p>}
        {contact.phone && <p><a className="underline" href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}>{contact.phone}</a></p>}
        {contact.whatsapp && <Button onClick={() => void openExternal(`https://wa.me/${contact.whatsapp}`)}>Open WhatsApp</Button>}
        {contact.website && <Button onClick={() => void openExternal(contact.website)}>Visit support website</Button>}
        {!contact.email && !contact.phone && !contact.whatsapp && !contact.website && <p>Contact details have not been configured. Use your invitation or service agreement to reach Mansora.</p>}
      </div>}
    </Card>
  </Modal>}</>;
}
