import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Modal, Textarea } from '@mansora/ui';
import { call, money, useApp, useQuery } from '../lib';

export interface CustomerDraft { name: string; phone: string; email: string; notes: string }
export interface PickedCustomer { id: string; name: string; phone?: string | null; outstanding?: number }

/** The customer details, the same on the Customers page and when adding a customer during a sale. */
export function CustomerFields({ value, onChange, autoFocus = 'name' }: { value: CustomerDraft; onChange: (v: CustomerDraft) => void; autoFocus?: 'name' | 'phone' }) {
  return (
    <div className="space-y-3">
      <Field label="Name" hint="Required when saving a customer record."><Input value={value.name} maxLength={120} onChange={(e) => onChange({ ...value, name: e.target.value })} autoFocus={autoFocus === 'name'} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone (optional)" hint="Needed to remind a credit customer by WhatsApp."><Input type="tel" value={value.phone} maxLength={40} onChange={(e) => onChange({ ...value, phone: e.target.value })} autoFocus={autoFocus === 'phone'} /></Field>
        <Field label="Email (optional)"><Input type="email" value={value.email} maxLength={160} onChange={(e) => onChange({ ...value, email: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><Textarea value={value.notes} maxLength={500} onChange={(e) => onChange({ ...value, notes: e.target.value })} /></Field>
    </div>
  );
}

const looksLikePhone = (s: string) => /^[+\d][\d\s-]{5,}$/.test(s.trim());

/** Add a customer without leaving the sale. A phone number already on file offers that customer instead. */
export function AddCustomerModal({ initial, onClose, onAdded }: { initial: string; onClose: () => void; onAdded: (c: PickedCustomer) => void }) {
  const phone = looksLikePhone(initial);
  const [draft, setDraft] = useState<CustomerDraft>({ name: phone ? '' : initial.trim(), phone: phone ? initial.trim() : '', email: '', notes: '' });
  const [state, setState] = useState<{ busy?: boolean; error?: string; existing?: PickedCustomer }>({});
  const save = async () => {
    setState({ busy: true });
    try { onAdded(await call('customer.add', draft)); }
    catch (e: any) { setState({ error: e?.message ?? 'The customer could not be saved', existing: e?.code === 'DUPLICATE_CUSTOMER' && e.details?.id ? { id: e.details.id, name: e.details.name } : undefined }); }
  };
  return (
    <Modal title="Add a new customer" open onClose={onClose}
      footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="primary" disabled={state.busy || !draft.name.trim()} onClick={save}>{state.busy ? 'Saving…' : 'Save and use for this sale'}</Button></>}>
      <CustomerFields value={draft} onChange={setDraft} autoFocus={phone ? 'name' : draft.name ? 'phone' : 'name'} />
      {state.error && <Alert tone="bad" className="mt-3">{state.error}{state.existing && <> <Button size="sm" className="ml-2" onClick={() => onAdded(state.existing!)}>Use {state.existing.name}</Button></>}</Alert>}
    </Modal>
  );
}

/**
 * Choose the customer for a sale by typing a name or phone number (owner request 2026-11-14). Matching customers
 * drop down as you type, with what they still owe; the last choice adds a new customer with the same details as
 * the Customers page. Leaving it empty keeps the sale a walk-in sale.
 */
export function CustomerPicker({ value, onChange }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void }) {
  const { can } = useApp();
  const canAdd = can('sale.create') || can('customer.manage');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useQuery<any[]>('customer.list', { search: text });
  const matches = (query.data ?? []).slice(0, 8);
  const options: ({ kind: 'customer'; c: any } | { kind: 'add' })[] = [...matches.map((c) => ({ kind: 'customer' as const, c })), ...(canAdd ? [{ kind: 'add' as const }] : [])];
  useEffect(() => { setActive(0); }, [text]);
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'add') { setAdding(text); setOpen(false); return; }
    onChange({ id: o.c.id, name: o.c.name, phone: o.c.phone, outstanding: o.c.outstanding });
    setText(''); setOpen(false);
  };
  if (value) {
    return (
      <div className="flex min-h-[2.5rem] items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
        <span className="min-w-0 truncate"><strong>{value.name}</strong>{value.phone ? ` · ${value.phone}` : ''}{value.outstanding ? <span className="text-amber-800"> · owes {money(value.outstanding)}</span> : ''}</span>
        <Button size="sm" variant="ghost" onClick={() => { onChange(null); setTimeout(() => inputRef.current?.focus(), 0); }} aria-label={`Remove customer ${value.name}`}>Change</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input ref={inputRef} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label="Customer"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        placeholder="Walk-in, or type a name or phone" value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open && options.length) { e.preventDefault(); choose(active); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && (
        <ul id={listId} role="listbox" aria-label="Matching customers" className="absolute inset-x-0 bottom-full z-30 mb-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {query.loading && !matches.length && <li role="presentation" className="px-3 py-2 text-slate-600">Looking…</li>}
          {!query.loading && !matches.length && <li role="presentation" className="px-3 py-2 text-slate-600">{text.trim() ? 'No customer matches.' : 'No customers yet.'}{!canAdd && ' Ask the owner or a manager to add the customer.'}</li>}
          {options.map((o, i) => (
            <li key={o.kind === 'add' ? 'add' : o.c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-slate-100' : ''} ${o.kind === 'add' ? 'border-t border-slate-100 font-medium text-[var(--m-primary,#4b2a7b)]' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              {o.kind === 'add' ? (text.trim() ? `+ Add "${text.trim()}" as a new customer` : '+ Add a new customer') : (
                <span className="flex justify-between gap-3"><span className="truncate">{o.c.name}{o.c.phone ? <span className="text-slate-500"> · {o.c.phone}</span> : ''}</span>{o.c.outstanding ? <span className="shrink-0 text-amber-800">owes {money(o.c.outstanding)}</span> : null}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding !== null && <AddCustomerModal initial={adding} onClose={() => setAdding(null)} onAdded={(c) => { setAdding(null); setText(''); onChange(c); }} />}
    </div>
  );
}
