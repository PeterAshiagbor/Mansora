import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { priceCart, settlePayments } from '@mansora/domain';
import { Alert, Badge, Button, cx, Field, Input, Modal, Select } from '@mansora/ui';
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
  const { can } = useApp();
  const toast = useToast();
  const [saleId, setSaleId] = useState(uuid);
  const [lines, setLines] = useState<Line[]>([]);
  const [cartDiscount, setCartDiscount] = useState<number | null>(0);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [customerId, setCustomerId] = useState('');
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ id: string; receiptNo: string; total: number; change: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shift = useQuery<any>('shift.current');
  const categories = useQuery<any[]>('category.list').data ?? [];
  const products = useQuery<Product[]>('product.list', { search, categoryId, limit: 60 }, [done]).data;
  const customers = useQuery<any[]>('customer.list', {}).data ?? [];

  const add = useCallback((p: Product, qty = 1) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, quantity: l.quantity + qty } : l));
      return [...ls, { product: p, quantity: qty, discount: 0 }];
    });
  }, []);
  const setQty = (id: string, q: number) => setLines((ls) => (q <= 0 ? ls.filter((l) => l.product.id !== id) : ls.map((l) => (l.product.id === id ? { ...l, quantity: q } : l))));

  // Scans arrive as fast keystrokes ending in Enter. Process them strictly one after another so none is lost or mixed up.
  const scanQueue = useRef(Promise.resolve());
  const onEnter = () => {
    const code = search.trim();
    if (!code) return;
    setSearch('');
    scanQueue.current = scanQueue.current.then(async () => {
      try {
        const exact = await call<Product | null>('product.lookup', { code });
        if (exact) return add(exact);
        const found = await call<Product[]>('product.list', { search: code, limit: 2 });
        if (found.length === 1) add(found[0]);
        else if (found.length === 0) toast(`No product found for "${code}"`, 'bad');
        else setSearch(code); // several matches: leave them on screen to choose from
      } catch (e: any) {
        toast(e.message, 'bad');
      }
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
    setLines([]);
    setCartDiscount(0);
    setCustomerId('');
    setDone(null);
    setSaleId(uuid());
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') (e.preventDefault(), searchRef.current?.focus());
      if (e.key === 'F9' && lines.length && !paying && !done && cart && 'total' in cart) (e.preventDefault(), setPaying(true));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length, paying, done, cart]);

  if (shift.data === null) return <OpenShift onOpened={shift.reload} />;

  return (
    <div className="flex h-full gap-4">
      <section aria-label="Products" className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-2">
          <Input ref={searchRef as any} autoFocus value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onEnter())}
            placeholder="Scan a barcode, or type a product name or SKU   (F2)" aria-label="Search or scan product" className="!py-3 !text-base" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip active={!categoryId} onClick={() => setCategoryId(undefined)}>All</Chip>
          {categories.filter((c) => c.active).map((c) => <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</Chip>)}
        </div>
        <div className="mt-3 grid flex-1 auto-rows-min grid-cols-2 content-start gap-2 overflow-y-auto pr-1 lg:grid-cols-3 xl:grid-cols-4">
          {(products ?? []).map((p) => {
            const inBasket = lines.find((l) => l.product.id === p.id)?.quantity ?? 0;
            const left = p.quantity - inBasket;
            return (
              <button key={p.id} type="button" onClick={() => add(p)} disabled={left <= 0}
                className="rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
                <div className="line-clamp-2 min-h-10 text-sm font-medium text-slate-900">{p.name}</div>
                <div className="mt-1 flex items-end justify-between">
                  <span className="text-base font-semibold tabular-nums text-brand-800">{money(p.selling_price)}</span>
                  <span className={cx('text-xs', left <= 0 ? 'font-semibold text-red-700' : 'text-slate-500')}>{left <= 0 ? 'Out of stock' : `${left} left`}</span>
                </div>
              </button>
            );
          })}
          {products && products.length === 0 && <div className="col-span-full py-10 text-center text-sm text-slate-500">No products match. Add products under Stock → Products.</div>}
        </div>
      </section>

      <section aria-label="Basket" className="flex w-[26rem] shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Basket {lines.length > 0 && <span className="font-normal text-slate-500">· {lines.reduce((a, l) => a + l.quantity, 0)} item(s)</span>}</h2>
          {lines.length > 0 && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 && <div className="px-4 py-12 text-center text-sm text-slate-500">Scan or choose a product to start a sale.</div>}
          {lines.map((l) => (
            <div key={l.product.id} className="border-b border-slate-100 px-4 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm font-medium text-slate-900">{l.product.name}</div>
                <div className="text-sm font-semibold tabular-nums">{money(l.quantity * l.product.selling_price - l.discount)}</div>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <button type="button" aria-label={`Decrease ${l.product.name}`} className="h-8 w-8 rounded border border-slate-300 text-lg leading-none hover:bg-slate-100" onClick={() => setQty(l.product.id, l.quantity - 1)}>−</button>
                <input aria-label={`Quantity of ${l.product.name}`} className="h-8 w-14 rounded border border-slate-300 text-center text-sm tabular-nums" value={l.quantity} inputMode="numeric"
                  onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); setQty(l.product.id, n || 1); }} onFocus={(e) => e.target.select()} />
                <button type="button" aria-label={`Increase ${l.product.name}`} className="h-8 w-8 rounded border border-slate-300 text-lg leading-none hover:bg-slate-100" onClick={() => setQty(l.product.id, l.quantity + 1)}>+</button>
                <span className="text-xs text-slate-500">× {money(l.product.selling_price)}</span>
                {l.quantity > l.product.quantity && <Badge tone="bad">Only {l.product.quantity} in stock</Badge>}
                <label className="ml-1 flex items-center gap-1 text-xs text-slate-500">Disc.
                  <MoneyInput value={l.discount || null} onChange={(v) => setLines((ls) => ls.map((x) => (x.product.id === l.product.id ? { ...x, discount: v ?? 0 } : x)))} aria-label={`Discount on ${l.product.name}`} className="!w-20 !px-2 !py-1 !text-xs" />
                </label>
                <button type="button" className="ml-auto text-xs text-red-700 hover:underline" onClick={() => setQty(l.product.id, 0)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-slate-200 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Basket discount (GHS)"><MoneyInput value={cartDiscount} onChange={setCartDiscount} aria-label="Basket discount" /></Field>
            <Field label="Customer (optional)">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          {cart && 'error' in cart && <Alert tone="bad">{cart.error}</Alert>}
          {cart && 'total' in cart && (
            <dl className="space-y-0.5 text-sm">
              <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular-nums">{money(cart.subtotal)}</dd></div>
              {cart.discountTotal > 0 && <div className="flex justify-between text-slate-600"><dt>Discount {!can('sale.discount') && <span className="text-xs">(needs approval)</span>}</dt><dd className="tabular-nums">−{money(cart.discountTotal)}</dd></div>}
            </dl>
          )}
          <div className="flex items-end justify-between">
            <span className="text-sm font-medium text-slate-600">Total</span>
            <span className="text-4xl font-bold tabular-nums text-slate-900" data-testid="basket-total">{money(total)}</span>
          </div>
          <Button variant="primary" size="lg" className="w-full !py-4 !text-lg" disabled={!cart || 'error' in cart} onClick={() => setPaying(true)}>Pay  (F9)</Button>
        </div>
      </section>

      {paying && cart && 'total' in cart && (
        <PayModal total={cart.total} needsDiscountApproval={cart.discountTotal > 0 && !can('sale.discount')} customerId={customerId} customerName={customers.find((c) => c.id === customerId)?.name}
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
      {done && <DoneModal sale={done} onNew={reset} />}
    </div>
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
      <Modal title="Take payment" open={!approval} onClose={onClose} wide
        footer={<><Button onClick={onClose}>Back to basket</Button><Button variant="primary" size="lg" disabled={!!problem || busy} onClick={() => go()}>{busy ? 'Saving…' : 'Complete sale  (Enter)'}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); go(); }}>
          <div className="mb-4 flex items-end justify-between rounded-lg bg-slate-900 px-5 py-4 text-white">
            <span className="text-sm uppercase tracking-wide text-slate-300">Amount due</span>
            <span className="text-4xl font-bold tabular-nums">{money(total)}</span>
          </div>
          {error && <Alert tone="bad" className="mb-3">{error}</Alert>}
          <div className="grid grid-cols-[9rem_1fr_1fr] items-end gap-x-3 gap-y-3">
            <div className="pb-2 text-sm font-medium">Cash received</div>
            <MoneyInput value={cash} onChange={setCash} autoFocus aria-label="Cash received" className="!text-lg" />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => setCash(rest)}>Exact</Button>
              {[1000, 2000, 5000, 10000, 20000].filter((n) => n > rest).slice(0, 3).map((n) => <Button key={n} size="sm" onClick={() => setCash(n)}>{n / 100}</Button>)}
            </div>
            <div className="pb-2 text-sm font-medium">Mobile money</div>
            <MoneyInput value={momo} onChange={setMomo} aria-label="Mobile money amount" />
            <Input placeholder="Transaction ID (optional)" value={momoRef} onChange={(e) => setMomoRef(e.target.value)} aria-label="Mobile money reference" />
            <div className="pb-2 text-sm font-medium">Card</div>
            <MoneyInput value={card} onChange={setCard} aria-label="Card amount" />
            <Input placeholder="Slip number (optional)" value={cardRef} onChange={(e) => setCardRef(e.target.value)} aria-label="Card reference" />
            <div className="pb-2 text-sm font-medium">On credit</div>
            <MoneyInput value={credit} onChange={setCredit} aria-label="Credit amount" />
            <div className="flex items-center gap-2 text-sm text-slate-600">{customerName ? <>to <strong>{customerName}</strong></> : 'No customer chosen'}<Input type="date" aria-label="Credit due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-40" /></div>
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
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden>✓</div>
        <p className="mt-2 text-sm text-slate-600">Receipt <strong data-testid="receipt-no">{sale.receiptNo}</strong> saved on this laptop.</p>
        <p className="mt-3 text-sm uppercase tracking-wide text-slate-500">Change to give</p>
        <p className="text-5xl font-bold tabular-nums text-slate-900">{money(sale.change)}</p>
        <p className="mt-2 text-sm text-slate-600">Total {money(sale.total)}</p>
        <p className="mt-3 text-xs text-slate-500">If the printer fails, the sale is still saved. Reprint any time from Sales history.</p>
      </div>
    </Modal>
  );
}
export { METHOD };
