import { parkBasket, parkedBaskets, takeParkedBasket } from '../parked-baskets';
import { CameraScanButton } from '../components/CameraScanner';
import { CustomerPicker, type PickedCustomer } from '../components/CustomerPicker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { priceCart, settlePayments } from '@mansora/domain';
import { Alert, Badge, Button, cx, Field, Input, Modal, Select, QueryView, PageHeader, WorkflowSteps, useUnsavedChanges, useNavigationGuard } from '@mansora/ui';
import { ApprovalModal, call, METHOD, money, MoneyInput, printHtml, useAction, useApp, useQuery, useToast, uuid, type Approver } from '../lib';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  selling_price: number;
  quantity: number;
  category_id: string | null;
}
interface Line {
  product: Product;
  quantity: number;
  discount: number;
}

export function Checkout() {
  const { can, state } = useApp();
  const toast = useToast();
  const scope = `${(state.business as any).tenantId ?? state.business.name}:${state.user?.id}`;
  const [parked, setParked] = useState(() => parkedBaskets<Line>(scope));
  const [discardParked, setDiscardParked] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false), [resuming, setResuming] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const transition = useRef(false), basketVersion = useRef(0), pendingScans = useRef(0);
  const [scanning, setScanning] = useState(false);
  const navigate = useNavigationGuard();
  const [saleId, setSaleId] = useState<string>(uuid);
  const [lines, setLines] = useState<Line[]>([]);
  const [quantityEdits, setQuantityEdits] = useState<Record<string, string>>({});
  const [requestingDiscount, setRequestingDiscount] = useState(false);
  const discountEntry = can('sale.discount') || requestingDiscount;
  const [cartDiscount, setCartDiscount] = useState<number | null>(0);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [customerId, setCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<PickedCustomer | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ id: string; receiptNo: string; total: number; change: number } | null>(null);
  useUnsavedChanges(lines.length > 0 && !done, 'the current basket');
  const searchRef = useRef<HTMLInputElement>(null);
  const shift = useQuery<any>('shift.current');
  const categoryQuery = useQuery<any[]>('category.list');
  const categories = categoryQuery.data ?? [];
  const productQuery = useQuery<Product[]>('product.list', { search, categoryId, limit: 60 }, [done]);
  const products = productQuery.data;
  const quantityProblem = Object.values(quantityEdits).some((value) => value.trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 1);
  const stockProblem = !state.business.allowNegativeStock && lines.some((line) => line.quantity > line.product.quantity);

  const add = useCallback((p: Product, qty = 1) => {
    setQuantityEdits((values) => { const next = { ...values }; delete next[p.id]; return next; });
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, quantity: l.quantity + qty } : l));
      return [...ls, { product: p, quantity: qty, discount: 0 }];
    });
  }, []);
  const setQty = (id: string, q: number) => { setQuantityEdits((values) => { const next = { ...values }; delete next[id]; return next; }); setLines((ls) => (q <= 0 ? ls.filter((l) => l.product.id !== id) : ls.map((l) => (l.product.id === id ? { ...l, quantity: q } : l)))); };

  // Scans arrive as fast keystrokes ending in Enter. Process them strictly one after another so none is lost or mixed up.
  const scanQueue = useRef(Promise.resolve());
  const onEnter = () => scanCode(search.trim(), true);
  const scanCode = (code: string, typed = false) => {
    if (transition.current) return;
    const version = basketVersion.current;
    if (!code) return;
    if (typed) setSearch('');
    pendingScans.current++; setScanning(true);
    scanQueue.current = scanQueue.current.then(async () => {
      try {
        const exact = await call<Product | null>('product.lookup', { code });
        if (version !== basketVersion.current) return;
        if (exact) return add(exact);
        const found = await call<Product[]>('product.list', { search: code, limit: 2 });
        if (version !== basketVersion.current) return;
        if (found.length === 1) add(found[0]);
        else if (found.length === 0) toast(`No product found for "${code}"`, 'bad');
        else setSearch(code); // several matches: leave them on screen to choose from
      } catch (e: any) {
        toast(e.message, 'bad');
      } finally { pendingScans.current--; setScanning(pendingScans.current > 0); }
    });
  };

  const cart = useMemo(() => {
    if (!lines.length) return null;
    try {
      return priceCart(lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.product.selling_price, discount: l.discount })), cartDiscount ?? 0);
    } catch (e: any) {
      return { error: e.message as string };
    }
  }, [lines, cartDiscount]);
  const total = cart && 'total' in cart ? cart.total : 0;

  const reset = () => {
    basketVersion.current++;
    setLines([]);
    setQuantityEdits({});
    setCartDiscount(0);
    setRequestingDiscount(false);
    setCustomerId('');
    setSelectedCustomer(null);
    setDone(null);
    setSaleId(uuid());
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const park = () => {
    if (transition.current || paying || done || pendingScans.current || !lines.length || quantityProblem || !cart || 'error' in cart) return;
    try {
      parkBasket(scope, { id: saleId, createdAt: new Date().toISOString(), lines: lines.map(line => ({ ...line, product: Object.fromEntries(['id', 'name', 'sku', 'barcode', 'selling_price', 'quantity', 'category_id'].map(key => [key, (line.product as any)[key]])) as unknown as Product })), cartDiscount: cartDiscount ?? 0, customerId, customer: customerId ? { id: customerId, name: selectedCustomer?.name ?? 'Customer' } : null, requestingDiscount });
      setParked(parkedBaskets<Line>(scope)); reset(); toast('Basket parked for this signed-in session. Stock has not changed.');
    } catch (error: any) { toast(error.message, 'bad'); }
  };
  const resume = async (id: string) => {
    if (transition.current || lines.length || pendingScans.current) { toast('Park or clear the current basket before resuming another.', 'bad'); return; }
    transition.current = true; setResuming(true);
    try {
      const draft = parkedBaskets<Line>(scope).find(d => d.id === id);
      if (!draft) throw new Error('This basket has already been resumed or discarded.');
      const refreshed: Line[] = [];
      for (const line of draft.lines) {
        const matches = await call<Product[]>('product.list', { search: line.product.name.slice(0, 100), limit: 1000 });
        const product = matches.find(p => p.id === line.product.id);
        if (!product) throw new Error(`${line.product.name} changed or is unavailable. The parked basket is preserved; review the catalogue before retrying.`);
        refreshed.push({ ...line, product });
      }
      if (!mounted.current) return;
      if (!takeParkedBasket<Line>(scope, id)) throw new Error('This basket has already been resumed.');
      basketVersion.current++; setLines(refreshed); setQuantityEdits({}); setSaleId(draft.id); setCartDiscount(draft.cartDiscount);
      setCustomerId(draft.customerId); setSelectedCustomer(draft.customer); setRequestingDiscount(draft.requestingDiscount);
      setParked(parkedBaskets<Line>(scope)); setShowParked(false); toast('Basket resumed. Review current prices and stock before payment.');
    } catch (error: any) { toast(error.message, 'bad'); }
    finally { transition.current = false; setResuming(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'F4' && !document.querySelector('[role=dialog]')) { e.preventDefault(); park(); }
      if (e.key === 'F6' && !document.querySelector('[role=dialog]')) { e.preventDefault(); setShowParked(true); }
      if (e.key === 'F2') (e.preventDefault(), searchRef.current?.focus());
      if (e.key === 'F9' && document.querySelector<HTMLInputElement>('section[aria-label="Basket"] input:invalid')) { e.preventDefault(); document.querySelector<HTMLInputElement>('section[aria-label="Basket"] input:invalid')?.reportValidity(); return; }
      if (e.key === 'F9' && !scanning && lines.length && !stockProblem && !quantityProblem && !paying && !done && cart && 'total' in cart) (e.preventDefault(), setPaying(true));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines, stockProblem, quantityProblem, paying, done, cart, customerId, selectedCustomer, requestingDiscount, saleId, scanning]);

  if (shift.data === undefined) return <QueryView query={shift} label="your current shift">{null}</QueryView>;
  if (shift.data === null) return <OpenShift onOpened={shift.reload} />;

  return (
    <div><PageHeader title="New sale" subtitle="Scan or search. Add items. Take payment." actions={<><Button disabled={!lines.length || paying || !!done || scanning || quantityProblem || !cart || 'error' in cart} onClick={park}>Park basket (F4)</Button><Button onClick={() => setShowParked(true)}>Parked baskets ({parked.length}) · F6</Button></>} /><div className="m-checkout">
      <section aria-label="Products" className="flex min-h-64 min-w-0 flex-1 flex-col">
        <div className="flex gap-2">
          <Input ref={searchRef as any} autoFocus value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onEnter())}
            placeholder="Scan a barcode, or type a product name or SKU   (F2)" aria-label="Search or scan product" className="!py-3 !text-base" />
          <CameraScanButton continuous label="Camera" onCode={(code) => scanCode(code)} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip active={!categoryId} onClick={() => setCategoryId(undefined)}>All</Chip>
          {categories.filter((c) => c.active).map((c) => <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</Chip>)}
        </div>
        {categoryQuery.error && <QueryView query={categoryQuery} label="product categories">{null}</QueryView>}
        <QueryView query={productQuery} label="products"><div className="m-product-grid">
          {(products ?? []).map((p) => {
            const inBasket = lines.find((l) => l.product.id === p.id)?.quantity ?? 0;
            const left = p.quantity - inBasket;
            return (
              <button key={p.id} type="button" onClick={() => add(p)} disabled={left <= 0 && !state.business.allowNegativeStock}
                className="m-sale-product rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
                <div className="line-clamp-2 min-h-10 text-sm font-medium text-slate-900">{p.name}</div>
                <div className="mt-1 flex items-end justify-between">
                  <span className="text-base font-semibold tabular-nums text-brand-800">{money(p.selling_price)}</span>
                  <span className={cx('text-xs', left <= 0 ? 'font-semibold text-red-700' : 'text-slate-500')}>{left <= 0 ? state.business.allowNegativeStock ? 'No stock recorded' : 'Out of stock' : `${left} left`}</span>
                </div>
              </button>
            );
          })}
          {products && products.length === 0 && <div className="col-span-full py-10 text-center text-sm text-slate-500">{search || categoryId ? 'No products match. Clear the search or choose All categories.' : 'No products are available. Ask the owner to add a catalogue and opening stock before selling.'}</div>}
        </div></QueryView>
        {products?.length === 60 && <p className="mt-2 text-xs text-slate-500">Showing up to 60 matches. Scan a barcode or refine the search to find another item.</p>}
      </section>

      <section aria-label="Basket" className="m-basket flex w-full min-w-0 flex-col border bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Basket {lines.length > 0 && <span className="font-normal text-slate-500">· {lines.reduce((a, l) => a + l.quantity, 0)} item(s)</span>}</h2>
          {lines.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate(reset)}>Clear</Button>}
        </div>
        <div className="m-basket-lines flex-1 overflow-y-auto" role="region" aria-label="Basket items" tabIndex={0}>
          {lines.length === 0 && <div className="px-4 py-12 text-center text-sm text-slate-500">Scan or choose a product to start a sale.</div>}
          {lines.map((l) => (
            <div key={l.product.id} className="border-b border-slate-100 px-4 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm font-medium text-slate-900">{l.product.name}</div>
                <div className="text-sm font-semibold tabular-nums">{money(l.quantity * l.product.selling_price - l.discount)}</div>
              </div>
              <div className="m-basket-quantity mt-1 flex flex-wrap items-center gap-2">
                <button type="button" aria-label={`Decrease ${l.product.name}`} className="h-8 w-8 rounded border border-slate-300 text-lg leading-none hover:bg-slate-100" onClick={() => setQty(l.product.id, l.quantity - 1)}>−</button>
                <input type="number" min={1} step={1} required aria-label={`Quantity of ${l.product.name}`} className="h-8 w-14 rounded border border-slate-300 text-center text-sm tabular-nums" value={quantityEdits[l.product.id] ?? l.quantity} inputMode="numeric"
                  onChange={(e) => { const value = e.target.value; setQuantityEdits((edits) => ({ ...edits, [l.product.id]: value })); const n = Number(value); if (value !== '' && Number.isSafeInteger(n) && n > 0) setLines((items) => items.map((item) => item.product.id === l.product.id ? { ...item, quantity: n } : item)); }} onFocus={(e) => e.target.select()} />
                <button type="button" aria-label={`Increase ${l.product.name}`} disabled={!state.business.allowNegativeStock && l.quantity >= l.product.quantity} className="h-8 w-8 rounded border border-slate-300 text-lg leading-none hover:bg-slate-100 disabled:opacity-40" onClick={() => setQty(l.product.id, l.quantity + 1)}>+</button>
                <span className="text-xs text-slate-500">× {money(l.product.selling_price)}</span>
                {l.quantity > l.product.quantity && <Badge tone="bad">Only {l.product.quantity} in stock</Badge>}
                {discountEntry && <label className="ml-1 flex items-center gap-1 text-xs text-slate-500">Disc.
                  <MoneyInput value={l.discount || null} onChange={(v) => setLines((ls) => ls.map((x) => (x.product.id === l.product.id ? { ...x, discount: v ?? 0 } : x)))} aria-label={`Discount on ${l.product.name}`} className="!w-20 !px-2 !py-1 !text-xs" />
                </label>}
                <button type="button" className="ml-auto text-xs text-red-700 hover:underline" onClick={() => setQty(l.product.id, 0)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="m-basket-summary space-y-2 border-t border-slate-200 p-4">
          <div className="grid grid-cols-2 gap-2">
            {discountEntry ? <Field label={can('sale.discount') ? 'Basket discount (GHS)' : 'Requested discount (GHS)'}><MoneyInput value={cartDiscount} onChange={setCartDiscount} aria-label="Basket discount" /></Field> : <Button onClick={() => setRequestingDiscount(true)}>Request discount</Button>}
          </div>
          <div>
            {/* Not a <label>: the chosen customer shows a Change button that a label would press on any click. */}
            <span className="mb-1 block text-sm font-medium text-slate-700">Customer (optional)</span>
            <CustomerPicker value={selectedCustomer} onChange={(c) => { setSelectedCustomer(c); setCustomerId(c?.id ?? ''); }} />
            {!selectedCustomer && <span className="mt-1 block text-xs text-slate-500">Needed to sell on credit. Leave empty for a walk-in sale.</span>}
          </div>
          {quantityProblem && <Alert tone="bad">Enter a whole-number quantity of at least 1 for each item. Use Remove to take an item out of the basket.</Alert>}
          {stockProblem && <Alert tone="bad">One or more quantities exceed recorded stock. Reduce the quantity or ask the owner to receive or count the stock before taking payment.</Alert>}
          {!can('sale.discount') && requestingDiscount && <p className="text-sm text-amber-900">Discount requests need an authorised approver at payment. You cannot apply a discount yourself.</p>}
          {cart && 'error' in cart && <Alert tone="bad">{cart.error}</Alert>}
          {cart && 'total' in cart && (
            <dl className="space-y-0.5 text-sm">
              <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular-nums">{money(cart.subtotal)}</dd></div>
              {cart.discountTotal > 0 && <div className="flex justify-between text-slate-600"><dt>Discount {(!can('sale.discount') || (state.business.maxDiscountBps > 0 && state.user?.role !== 'owner' && cart.discountTotal * 10_000 > state.business.maxDiscountBps * cart.subtotal)) && <span className="text-xs">(needs approval)</span>}</dt><dd className="tabular-nums">−{money(cart.discountTotal)}</dd></div>}
            </dl>
          )}
          <div className="flex items-end justify-between">
            <span className="text-sm font-medium text-slate-600">Total</span>
            <span className="text-4xl font-bold tabular-nums text-slate-900" data-testid="basket-total">{money(total)}</span>
          </div>
          <Button variant="primary" size="lg" className="w-full !py-4 !text-lg" disabled={scanning || !cart || 'error' in cart || stockProblem || quantityProblem} onClick={() => setPaying(true)}>Pay  (F9)</Button>
        </div>
      </section>

      {paying && cart && 'total' in cart && (
        <PayModal total={cart.total} needsDiscountApproval={cart.discountTotal > 0 && (!can('sale.discount') || (state.business.maxDiscountBps > 0 && state.user?.role !== 'owner' && cart.discountTotal * 10_000 > state.business.maxDiscountBps * cart.subtotal))} customerId={customerId} customerName={selectedCustomer?.name}
          onClose={() => setPaying(false)}
          submit={async (tenders, dueDate, approver) => {
            const res = await call('sale.complete', {
              id: saleId, cartDiscount: cartDiscount ?? 0, customerId: customerId || null, dueDate, approver, tenders,
              lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, discount: l.discount })),
            });
            setPaying(false);
            setDone({ id: res.id, receiptNo: res.receiptNo, total: res.total ?? total, change: res.change ?? 0 });
          }} />
      )}
      {showParked && <Modal title="Parked baskets" trackChanges={false} open onClose={() => { if (!resuming) setShowParked(false); }}>
        <p className="mb-4 text-sm text-slate-600">Drafts belong to your current business and user. They reserve no stock and are cleared on sign-out, lock or closing this tab. No payment has been recorded.</p>
        {!parked.length && <p>No parked baskets.</p>}
        {parked.map((draft, index) => <div key={draft.id} className="mb-3 rounded-lg border p-4"><strong>Basket {index + 1}</strong><p className="my-2 text-sm">{draft.lines.map(line => `${line.quantity} × ${line.product.name}`).join(', ')}</p><div className="flex gap-2"><Button disabled={resuming || !!lines.length || scanning} onClick={() => void resume(draft.id)}>Resume basket {index + 1}</Button><Button disabled={resuming} onClick={() => setDiscardParked(draft.id)}>Discard basket {index + 1}</Button></div></div>)}
      </Modal>}
      {discardParked && <Modal title="Discard parked basket?" trackChanges={false} open onClose={() => setDiscardParked(null)} footer={<><Button onClick={() => setDiscardParked(null)}>Keep basket</Button><Button variant="danger" onClick={() => { takeParkedBasket(scope, discardParked); setParked(parkedBaskets<Line>(scope)); setDiscardParked(null); }}>Discard parked basket</Button></>}><p>This removes only this unfinished draft. No sale or stock movement has been recorded.</p></Modal>}
      {done && <DoneModal sale={done} onNew={reset} />}
    </div></div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cx('rounded-full border px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600', active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
      {children}
    </button>
  );
}

function OpenShift({ onOpened }: { onOpened: () => void }) {
  const [float, setFloat] = useState<number | null>(0);
  const { run, busy } = useAction();
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Open your shift</h1>
      <p className="mt-1 text-sm text-slate-600">Count the cash in the till before you start selling. This is your opening float.</p>
      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); if (float != null) run(async () => { await call('shift.open', { openingFloat: float }); onOpened(); }, 'Shift opened'); }}>
        <Field label="Opening cash float (GHS)"><MoneyInput value={float} onChange={setFloat} autoFocus /></Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || float == null}>Open shift</Button>
      </form>
    </div>
  );
}

type Tenders = { method: string; amount: number; reference?: string | null }[];
function PayModal({ total, customerId, customerName, needsDiscountApproval, onClose, submit }: {
  total: number; customerId: string; customerName?: string; needsDiscountApproval: boolean; onClose: () => void;
  submit: (tenders: Tenders, dueDate: string | null, approver?: Approver) => Promise<void>;
}) {
  const { can } = useApp();
  const [cash, setCash] = useState<number | null>(null);
  const [momo, setMomo] = useState<number | null>(null);
  const [card, setCard] = useState<number | null>(null);
  const [credit, setCredit] = useState<number | null>(null);
  const [momoRef, setMomoRef] = useState('');
  const [cardRef, setCardRef] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState(false);
  const [entry, setEntry] = useState('cash');

  const tenders: Tenders = [
    { method: 'cash', amount: cash ?? 0 },
    { method: 'momo', amount: momo ?? 0, reference: momoRef || null },
    { method: 'card', amount: card ?? 0, reference: cardRef || null },
    { method: 'credit', amount: credit ?? 0 },
  ].filter((t) => t.amount > 0);
  const nonCash = (momo ?? 0) + (card ?? 0) + (credit ?? 0);
  let settlement: ReturnType<typeof settlePayments> | null = null;
  let problem: string | null = null;
  try {
    settlement = settlePayments(total, tenders as any);
  } catch (e: any) {
    problem = e.code === 'UNDERPAID' ? `${money(e.details.shortBy)} still to pay` : e.message;
  }
  if (!problem && (credit ?? 0) > 0 && !customerId) problem = 'Choose a customer on the basket to sell on credit';
  const needsApproval = needsDiscountApproval || ((credit ?? 0) > 0 && !can('credit.sell'));

  const go = async (approver?: Approver) => {
    if (problem || busy) return;
    if (needsApproval && !approver) return setApproval(true);
    setBusy(true);
    setError(null);
    try {
      await submit(tenders, (credit ?? 0) > 0 && dueDate ? dueDate : null, approver);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  const rest = Math.max(0, total - nonCash);
  return (
    <>
      <Modal trackChanges={false} title="Take payment" open={!approval} onClose={onClose} wide
        footer={<><Button onClick={onClose}>Back to basket</Button><Button variant="primary" size="lg" disabled={!!problem || busy} onClick={() => go()}>{busy ? 'Saving…' : 'Complete sale  (Enter)'}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); go(); }}>
          <WorkflowSteps steps={['Basket', 'Payment', 'Receipt']} current={1} />
          <div className="m-payment-due">
            <span className="text-sm uppercase tracking-wide text-slate-300">Amount due</span>
            <span className="text-4xl font-bold tabular-nums">{money(total)}</span>
          </div>
          {error && <Alert tone="bad" className="mb-3">{error}</Alert>}
          <div className="m-payment-methods" aria-label="Payment entry">{[['cash', 'Cash'], ['momo', 'Mobile money'], ['card', 'Card'], ['credit', 'Credit'], ['split', 'Split payment']].map(([id, label]) => <Button key={id} aria-pressed={entry === id} onClick={(event) => { const invalid = event.currentTarget.closest('form')?.querySelector<HTMLInputElement>('input:invalid'); if (invalid) { invalid.focus(); invalid.reportValidity(); return; } setEntry(id); }}>{label}</Button>)}</div>
          <p className="mb-2 text-xs text-slate-600">Choose a method to enter. Entered amounts stay visible; use Split payment to combine methods.</p>
          <div>
            <div className="m-payment-row" hidden={entry !== 'cash' && entry !== 'split' && !(cash && cash > 0)}>
            <div className="pb-2 text-sm font-medium">Cash received</div>
            <MoneyInput value={cash} onChange={setCash} autoFocus aria-label="Cash received" className="!text-lg" />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => setCash(rest)}>Exact</Button>
              {[1000, 2000, 5000, 10000, 20000].filter((n) => n > rest).slice(0, 3).map((n) => <Button key={n} size="sm" onClick={() => setCash(n)}>{n / 100}</Button>)}
            </div>
            </div><div className="m-payment-row" hidden={entry !== 'momo' && entry !== 'split' && !(momo && momo > 0)}>
            <div className="pb-2 text-sm font-medium">Mobile money</div>
            <MoneyInput value={momo} onChange={setMomo} aria-label="Mobile money amount" />
            <Input placeholder="Transaction ID (optional)" value={momoRef} onChange={(e) => setMomoRef(e.target.value)} aria-label="Mobile money reference" />
            </div><div className="m-payment-row" hidden={entry !== 'card' && entry !== 'split' && !(card && card > 0)}>
            <div className="pb-2 text-sm font-medium">Card</div>
            <MoneyInput value={card} onChange={setCard} aria-label="Card amount" />
            <Input placeholder="Slip number (optional)" value={cardRef} onChange={(e) => setCardRef(e.target.value)} aria-label="Card reference" />
            </div><div className="m-payment-row" hidden={entry !== 'credit' && entry !== 'split' && !(credit && credit > 0)}>
            <div className="pb-2 text-sm font-medium">On credit</div>
            <MoneyInput value={credit} onChange={setCredit} aria-label="Credit amount" />
            <div className="flex items-center gap-2 text-sm text-slate-600">{customerName ? <>to <strong>{customerName}</strong></> : 'No customer chosen'}<Input type="date" aria-label="Credit due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-40" /></div>
          </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Card and mobile money amounts are recorded only. Confirm on the POS terminal or phone that the money has actually arrived before completing the sale.</p>
          <div className={cx('mt-4 flex items-end justify-between rounded-lg border px-5 py-3', problem ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')}>
            <span className="text-sm font-medium">{problem ?? 'Change to give'}</span>
            {!problem && <span className="text-3xl font-bold tabular-nums text-emerald-800" data-testid="change">{money(settlement?.change ?? 0)}</span>}
          </div>
          {needsApproval && <p className="mt-2 text-sm text-amber-800">This sale needs a manager's approval ({needsDiscountApproval ? 'discount' : 'credit sale'}).</p>}
          <button type="submit" hidden />
        </form>
      </Modal>
      <ApprovalModal open={approval} reason="This sale includes a discount or credit you are not allowed to give on your own." onCancel={() => setApproval(false)} onApprove={(a) => { setApproval(false); go(a); }} />
    </>
  );
}

function DoneModal({ sale, onNew }: { sale: { id: string; receiptNo: string; total: number; change: number }; onNew: () => void }) {
  const { run, busy } = useAction();
  const print = () => run(async () => printHtml((await call('sale.receipt', { id: sale.id })).html));
  return (
    <Modal title="Sale completed" open onClose={onNew}
      footer={<><Button disabled={busy} onClick={print}>Print receipt</Button><Button variant="primary" size="lg" autoFocus onClick={onNew}>New sale  (Enter)</Button></>}>
      <WorkflowSteps steps={['Basket', 'Payment', 'Receipt']} current={2} />
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden>✓</div>
        <p className="mt-2 text-sm text-slate-600">Receipt <strong data-testid="receipt-no">{sale.receiptNo}</strong> saved in your business records.</p>
        <p className="mt-3 text-sm uppercase tracking-wide text-slate-500">Change to give</p>
        <p className="text-5xl font-bold tabular-nums text-slate-900">{money(sale.change)}</p>
        <p className="mt-2 text-sm text-slate-600">Total {money(sale.total)}</p>
        <p className="mt-3 text-xs text-slate-500">If the printer fails, the sale is still saved. Reprint any time from Sales history.</p>
      </div>
    </Modal>
  );
}
export { METHOD };
