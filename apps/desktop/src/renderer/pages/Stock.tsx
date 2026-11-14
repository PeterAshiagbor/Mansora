import { useState } from 'react';
import { CameraScanButton } from '../components/CameraScanner';
import { TaskLinks } from '../components/TaskLinks';
import { unitCostFromCarton } from '@mansora/domain';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table, Tabs, Textarea, QueryView, useUnsavedChanges } from '@mansora/ui';
import { call, dateTime, ExportButtons, money, MoneyInput, plain, useAction, useApp, useQuery, useToast, uuid } from '../lib';

const TYPE_LABEL: Record<string, string> = {
  OPENING_STOCK: 'Opening stock', PURCHASE_RECEIVED: 'Purchase received', SALE: 'Sale', SALE_REFUND: 'Refund (returned)', DAMAGE: 'Damaged',
  STOCK_COUNT_ADJUSTMENT: 'Stock count', MANUAL_CORRECTION: 'Manual correction',
};

export function StockPage({ initialTab = 'overview' }: { initialTab?: 'overview' | 'count' }) {
  const { can } = useApp();
  const [tab, setTab] = useState<'overview' | 'movements' | 'count'>(initialTab === 'count' && can('stock.adjust') ? 'count' : 'overview');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [adjust, setAdjust] = useState<any | null>(null);
  const overview = useQuery<any>('stock.overview', { filter });
  const [moveType, setMoveType] = useState('');
  const moves = useQuery<any[]>('stock.movements', { type: moveType || undefined, limit: 500 }, [tab]);
  const s = overview.data?.summary;
  return (
    <div>
      <PageHeader title="Stock" subtitle="Every change to stock is recorded as a movement. Quantities are never typed over."
        actions={tab === 'overview' ? <ExportButtons disabled={!overview.data} title="Current stock on hand" columns={['Product', 'SKU', 'In stock', 'Reorder level']} rows={() => (overview.data?.rows ?? []).map((r: any) => [r.name, r.sku ?? '', r.quantity, r.reorder_level])} /> : undefined} />
      <TaskLinks group="inventory" current="stock" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Stock overview' }, { id: 'movements', label: 'Stock movements' }, ...(can('stock.adjust') ? [{ id: 'count' as const, label: 'Stock count' }] : [])]} />
      {tab === 'overview' && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3">
            <Stat label="Products" value={s?.products ?? '…'} />
            <Stat label="Low stock" value={s?.low ?? '…'} tone={s?.low ? 'warn' : 'default'} />
            <Stat label="Out of stock" value={s?.out ?? '…'} tone={s?.out ? 'bad' : 'default'} />
            {s?.valuation != null && <Stat label="Stock value (at cost)" value={money(s.valuation)} />}
          </div>
          <div className="mb-3 flex gap-2 no-print">{(['all', 'low', 'out'] as const).map((f) => <Button key={f} size="sm" variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>{{ all: 'All products', low: 'At or below reorder level', out: 'Out of stock' }[f]}</Button>)}</div>
          <QueryView query={overview} label="stock levels"><Card pad={false}>
            <Table rows={overview.data?.rows} rowKey={(r: any) => r.id} empty="No products match"
              columns={[
                { header: 'Product', cell: (r: any) => r.name },
                { header: 'SKU', cell: (r: any) => r.sku ?? '' },
                { header: 'In stock', align: 'right', cell: (r: any) => (r.quantity <= 0 ? <Badge tone="bad">{r.quantity} · Out of stock</Badge> : r.quantity <= r.reorder_level ? <Badge tone="warn">{r.quantity} · Low stock</Badge> : r.quantity) },
                { header: 'Reorder at', align: 'right', cell: (r: any) => r.reorder_level },
                ...(s?.valuation != null ? [{ header: 'Avg cost', align: 'right' as const, cell: (r: any) => money(r.average_cost) }, { header: 'Value', align: 'right' as const, cell: (r: any) => money(Math.max(0, r.quantity) * r.average_cost) }] : []),
                ...(can('stock.adjust') ? [{ header: '', align: 'right' as const, cell: (r: any) => <Button size="sm" onClick={() => setAdjust(r)}>Adjust</Button> }] : []),
              ]} />
          </Card></QueryView>
        </>
      )}
      {tab === 'movements' && (
        <>
          <Select value={moveType} onChange={(e) => setMoveType(e.target.value)} className="mb-3 w-64 no-print" aria-label="Movement type"><option value="">All movement types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <QueryView query={moves} label="stock movements"><Card pad={false}>
            <Table rows={moves.data} rowKey={(r) => r.id} empty="No stock movements yet"
              columns={[
                { header: 'When', cell: (r) => dateTime(r.occurred_at) },
                { header: 'Product', cell: (r) => r.product_name },
                { header: 'Type', cell: (r) => TYPE_LABEL[r.type] ?? r.type },
                { header: 'Change', align: 'right', cell: (r) => <span className={r.quantity_delta < 0 ? 'text-red-700' : 'text-emerald-700'}>{r.quantity_delta > 0 ? '+' : ''}{r.quantity_delta}</span> },
                { header: 'By', cell: (r) => r.actor_name },
                { header: 'Reason', cell: (r) => r.reason ?? '' },
              ]} />
          </Card></QueryView>
        </>
      )}
      {tab === 'count' && <StockCount onDone={() => { overview.reload(); setTab('movements'); }} />}
      {adjust && <AdjustModal product={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); overview.reload(); }} />}
    </div>
  );
}

function AdjustModal({ product, onClose, onDone }: { product: any; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('DAMAGE');
  const [qty, setQty] = useState('');
  const [direction, setDirection] = useState('-');
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  const n = Number(qty);
  const delta = type === 'DAMAGE' || direction === '-' ? -n : n;
  return (
    <Modal title={`Adjust stock: ${product.name}`} open onClose={onClose}
      footer={<><Button dismiss onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !Number.isSafeInteger(n) || n <= 0 || !reason.trim()} onClick={() => run(async () => { await call('stock.adjust', { productId: product.id, type, delta, reason }); onDone(); }, 'Stock adjusted')}>Record adjustment</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Currently in stock: <strong>{product.quantity}</strong>{n > 0 && <> → <strong>{product.quantity + delta}</strong></>}</p>
        <Field label="What happened?"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="DAMAGE">Damaged, expired or lost</option><option value="MANUAL_CORRECTION">Correction of a mistake</option></Select></Field>
        <div className="grid grid-cols-2 gap-3">
          {type === 'MANUAL_CORRECTION' && <Field label="Direction"><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="-">Remove from stock</option><option value="+">Add to stock</option></Select></Field>}
          <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        </div>
        <Field label="Reason (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function StockCount({ onDone }: { onDone: () => void }) {
  const countQuery = useQuery<any>('stock.overview', { filter: 'all' });
  const { data } = countQuery;
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  useUnsavedChanges(Object.values(counted).some((value) => value !== '') || !!note.trim(), 'the physical stock count');
  const rows: any[] = data?.rows ?? [];
  const invalidCounts = Object.values(counted).some((value) => value !== '' && (!Number.isSafeInteger(Number(value)) || Number(value) < 0));
  const lines = rows.filter((r) => counted[r.id] !== undefined && counted[r.id] !== '').map((r) => ({ productId: r.id, counted: Number(counted[r.id]), system: r.quantity }));
  const diffs = lines.filter((l) => l.counted !== l.system);
  const toast = useToast();
  const [scan, setScan] = useState('');
  // Each scan adds one to that product's count, so a shelf can be counted by scanning every item on it.
  const scanned = (raw: string) => {
    const code = raw.trim().toLowerCase();
    if (!code) return;
    const row = rows.find((r) => r.barcode?.toLowerCase() === code || r.sku?.toLowerCase() === code);
    if (!row) return toast(`No product has the barcode or SKU "${raw.trim()}"`, 'bad');
    setCounted((c) => ({ ...c, [row.id]: String((Number(c[row.id]) || 0) + 1) }));
    toast(`${row.name}: ${(Number(counted[row.id]) || 0) + 1}`);
  };
  return (
    <div>
      <Alert className="mb-3">Count the items on the shelf and type the number you counted, or scan each item: every scan adds one. Leave a row empty if you did not count it. Only differences are recorded.</Alert>
      <div className="mb-3 flex max-w-xl gap-2">
        <Input aria-label="Scan to count" placeholder="Scan an item to add one to its count" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanned(scan); setScan(''); } }} />
        <CameraScanButton continuous label="Camera" onCode={scanned} />
      </div>
      <QueryView query={countQuery} label="stock to count"><Card pad={false}>
        <Table rows={rows} rowKey={(r) => r.id} columns={[
          { header: 'Product', cell: (r) => r.name },
          { header: 'System quantity', align: 'right', cell: (r) => r.quantity },
          { header: 'Counted', align: 'right', cell: (r) => <Input type="number" min={0} className="ml-auto w-24 text-right" aria-label={`Counted quantity of ${r.name}`} value={counted[r.id] ?? ''} onChange={(e) => setCounted({ ...counted, [r.id]: e.target.value })} /> },
          { header: 'Difference', align: 'right', cell: (r) => { const l = lines.find((x) => x.productId === r.id); if (!l || l.counted === l.system) return ''; const d = l.counted - l.system; return <Badge tone={d < 0 ? 'bad' : 'info'}>{d > 0 ? '+' : ''}{d}</Badge>; } },
        ]} />
      </Card></QueryView>
      <div className="mt-3 flex items-end gap-3">
        <Field label="Note" className="flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Month-end count" /></Field>
        <Button variant="primary" disabled={busy || !!countQuery.error || !data || invalidCounts || lines.length === 0} onClick={() => run(async () => { const r = await call('stock.count', { note: note || null, lines: lines.map(({ productId, counted }) => ({ productId, counted })) }); setCounted({}); onDone(); return r; }, `Stock count saved: ${diffs.length} adjustment(s)`)}>
          Save count ({lines.length} counted, {diffs.length} different)
        </Button>
      </div>
    </div>
  );
}

export function PurchasesPage() {
  const [tab, setTab] = useState<'purchases' | 'reorder' | 'suppliers'>('purchases');
  const purchases = useQuery<any[]>('purchase.list');
  const suppliers = useQuery<any[]>('supplier.list');
  const [receiving, setReceiving] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const { run, busy } = useAction();
  return (
    <div>
      <PageHeader title="Purchases & suppliers" subtitle="Record stock you receive. This adds to stock and updates the average cost."
        actions={tab === 'purchases' ? <Button variant="primary" onClick={() => setReceiving(true)}>Receive stock</Button> : <Button variant="primary" onClick={() => setEdit({ name: '', phone: '', notes: '' })}>Add supplier</Button>} />
      <TaskLinks group="inventory" current="purchases" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'purchases', label: 'Purchases received' }, { id: 'reorder', label: 'Needs reordering' }, { id: 'suppliers', label: 'Suppliers' }]} />
      {tab === 'reorder' && <ReorderList />}
      {tab === 'purchases' && (
        <QueryView query={purchases} label="purchases"><Card pad={false}>
          <Table rows={purchases.data} rowKey={(r) => r.id} onRowClick={(r) => setView(r.id)} empty="No purchases recorded yet"
            columns={[{ header: 'Received', cell: (r) => dateTime(r.received_at) }, { header: 'Supplier', cell: (r) => r.supplier_name ?? '—' }, { header: 'Reference', cell: (r) => r.reference ?? '' }, { header: 'Items', align: 'right', cell: (r) => r.item_count }, { header: 'Total cost', align: 'right', cell: (r) => money(r.total_cost) }, { header: 'Recorded by', cell: (r) => r.created_by_name }]} />
        </Card></QueryView>
      )}
      {tab === 'suppliers' && (
        <QueryView query={suppliers} label="suppliers"><Card pad={false}>
          <Table rows={suppliers.data} rowKey={(r) => r.id} onRowClick={setEdit} empty="No suppliers yet" columns={[{ header: 'Name', cell: (r) => r.name }, { header: 'Phone', cell: (r) => r.phone ?? '' }, { header: 'Supplies', cell: (r) => r.supplies ?? '' }, { header: 'Purchases', align: 'right', cell: (r) => r.purchases }, ...(suppliers.data?.some((r) => r.total_bought != null) ? [{ header: 'Total bought', align: 'right' as const, cell: (r: any) => money(r.total_bought) }] : []), { header: 'Last purchase', cell: (r) => (r.last_purchase_at ? dateTime(r.last_purchase_at) : 'Never') }]} />
        </Card></QueryView>
      )}
      {receiving && <ReceiveModal suppliers={suppliers.data ?? []} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); purchases.reload(); }} />}
      {view && <PurchaseView id={view} onClose={() => setView(null)} />}
      {edit && (
        <Modal title={edit.id ? 'Edit supplier' : 'Add supplier'} open onClose={() => setEdit(null)}
          footer={<><Button dismiss onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={busy || !edit.name.trim()} onClick={() => run(async () => { await call('supplier.save', { id: edit.id, name: edit.name, phone: edit.phone, momoNumber: edit.momo_number, location: edit.location, supplies: edit.supplies, notes: edit.notes }); setEdit(null); suppliers.reload(); }, 'Supplier saved')}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Supplier name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Phone"><Input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Mobile Money number" hint="For paying this supplier"><Input value={edit.momo_number ?? ''} onChange={(e) => setEdit({ ...edit, momo_number: e.target.value })} /></Field>
            <Field label="Location"><Input value={edit.location ?? ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} placeholder="e.g. Makola Market, Accra" /></Field>
            <Field label="What they supply"><Input value={edit.supplies ?? ''} onChange={(e) => setEdit({ ...edit, supplies: e.target.value })} placeholder="e.g. Rice, oil, tinned tomatoes" /></Field>
            {edit.id && <SupplierHistory id={edit.id} />}
            <Field label="Notes"><Textarea value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PurchaseView({ id, onClose }: { id: string; onClose: () => void }) {
  const purchaseDetail = useQuery<any>('purchase.get', { id });
  const { data } = purchaseDetail;
  if (!data) return <Modal title="Purchase details" open trackChanges={false} onClose={onClose}><QueryView query={purchaseDetail} label="purchase details">{null}</QueryView></Modal>;
  return (
    <Modal title={`Purchase ${data.purchase.reference ?? ''}`} open onClose={onClose} wide>
      <p className="mb-2 text-sm text-slate-600">{dateTime(data.purchase.received_at)} · {data.purchase.supplier_name ?? 'No supplier'} · Total {money(data.purchase.total_cost)}</p>
      <Table rows={data.items} rowKey={(r: any) => r.id} columns={[{ header: 'Product', cell: (r: any) => r.product_name }, { header: 'Qty', align: 'right', cell: (r: any) => r.quantity }, { header: 'Unit cost', align: 'right', cell: (r: any) => money(r.unit_cost) }, { header: 'Line cost', align: 'right', cell: (r: any) => money(r.quantity * r.unit_cost) }]} />
    </Modal>
  );
}

/** C60: products at or below their reorder level, grouped by the supplier they were last bought from. */
function ReorderList() {
  const query = useQuery<any[]>('stock.reorderList');
  const rows = [...(query.data ?? [])].sort((a, b) => (a.supplier?.name ?? '~').localeCompare(b.supplier?.name ?? '~') || a.name.localeCompare(b.name));
  return (
    <QueryView query={query} label="products to reorder"><Card pad={false} title="Needs reordering" actions={<ExportButtons disabled={!query.data} title="Products to reorder" columns={['Supplier', 'Supplier phone', 'Product', 'SKU', 'In stock', 'Reorder level', 'Suggested order', 'Unit']}
      rows={() => rows.map((r) => [r.supplier?.name ?? '', r.supplier?.phone ?? '', r.name, r.sku ?? '', r.quantity, r.reorder_level, r.suggested, r.unit])} />}>
      <Table rows={rows} rowKey={(r) => r.id} empty="Nothing is at or below its reorder level" caption="Suggested quantity brings stock back to twice the reorder level"
        columns={[{ header: 'Supplier', cell: (r) => r.supplier ? <>{r.supplier.name}{r.supplier.phone ? <span className="text-slate-500"> · {r.supplier.phone}</span> : null}</> : <span className="text-slate-500">No supplier yet</span> },
          { header: 'Product', cell: (r) => r.name }, { header: 'In stock', align: 'right', cell: (r) => r.quantity }, { header: 'Reorder level', align: 'right', cell: (r) => r.reorder_level },
          { header: 'Suggested order', align: 'right', cell: (r) => `${r.suggested} ${r.unit}` }]} />
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">When the goods arrive, use Receive stock to add them. Export or print this list to send to a supplier.</p>
    </Card></QueryView>
  );
}

/** C60: what the shop has bought from this supplier. */
function SupplierHistory({ id }: { id: string }) {
  const { data } = useQuery<any>('supplier.get', { id });
  if (!data) return null;
  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm">
      <p className="font-medium text-slate-800">{data.purchases.length ? `${data.purchases.length} purchase(s), last on ${dateTime(data.purchases[0].received_at)}` : 'No purchases from this supplier yet'}</p>
      {data.products.length > 0 && <p className="mt-1 text-slate-700">Usually bought: {data.products.slice(0, 12).map((p: any) => `${p.name}${p.in_stock <= p.reorder_level && p.reorder_level > 0 ? ' (low)' : ''}`).join(', ')}</p>}
    </div>
  );
}

function ReceiveModal({ suppliers, onClose, onDone }: { suppliers: any[]; onClose: () => void; onDone: () => void }) {
  const [id] = useState(uuid);
  const productOptions = useQuery<any[]>('product.list', { limit: 1000 });
  const products = productOptions.data ?? [];
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [items, setItems] = useState<{ productId: string; quantity: string; unitCost: number | null }[]>([{ productId: '', quantity: '', unitCost: null }]);
  const { run, busy } = useAction();
  const set = (i: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const valid = items.filter((i) => i.productId && Number.isSafeInteger(Number(i.quantity)) && Number(i.quantity) > 0 && i.unitCost != null);
  const total = valid.reduce((a, i) => a + Number(i.quantity) * (i.unitCost ?? 0), 0);
  return (
    <Modal title="Receive stock" open onClose={onClose} wide
      footer={<><span className="mr-auto self-center text-sm">Total cost: <strong>{money(total)}</strong></span><Button dismiss onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || valid.length === 0 || valid.length !== items.length} onClick={() => run(async () => { await call('purchase.receive', { id, supplierId: supplierId || null, reference: reference || null, items: valid.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), unitCost: i.unitCost })) }); onDone(); }, 'Stock received')}>Receive into stock</Button></>}>
      {productOptions.error && <QueryView query={productOptions} label="products for this receipt">{null}</QueryView>}
      <p className="mb-3 text-xs leading-relaxed text-slate-600">Enter whole selling units and their unit purchase cost. A carton must be converted to its individual items before receiving.</p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">No supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Invoice / waybill number"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
      {items.map((it, i) => (
        <div key={i} className="m-receive-line mb-4">
          <Field label={i === 0 ? 'Product' : ''}><Select value={it.productId} aria-label="Product" onChange={(e) => { const p = products.find((x) => x.id === e.target.value); set(i, { productId: e.target.value, unitCost: it.unitCost ?? p?.cost_price ?? null }); }}><option value="">Choose product…</option>{products.filter((p) => p.id === it.productId || !items.some((x) => x.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={i === 0 ? 'Quantity' : ''}><Input type="number" min={1} aria-label="Quantity" value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></Field>
          <Field label={i === 0 ? 'Unit cost (GHS)' : ''}><MoneyInput value={it.unitCost} aria-label="Unit cost" onChange={(v) => set(i, { unitCost: v })} /></Field>
          <button type="button" aria-label="Remove line" className="mb-2 text-red-700" onClick={() => setItems(items.length > 1 ? items.filter((_, k) => k !== i) : items)}>✕</button>
          <CartonReceiptCalculator onApply={(quantity, unitCost) => set(i, { quantity: String(quantity), unitCost })} />
        </div>
      ))}
      <Button size="sm" onClick={() => setItems([...items, { productId: '', quantity: '', unitCost: null }])}>Add another product</Button>
    </Modal>
  );
}

function CartonReceiptCalculator({ onApply }: { onApply: (quantity: number, unitCost: number) => void }) {
  const [cartons, setCartons] = useState('');
  const [units, setUnits] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const count = Number(cartons), perCarton = Number(units), quantity = count * perCarton;
  const valid = Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(perCarton) && perCarton > 0 && Number.isSafeInteger(quantity) && cost != null && Number.isSafeInteger(cost) && cost >= 0;
  const unitCost = valid ? unitCostFromCarton(cost!, perCarton) : null;
  const total = unitCost == null ? null : unitCost * quantity;
  return <details className="m-form-details"><summary>Receiving cartons? Calculate selling units</summary><div className="space-y-4"><div className="grid grid-cols-3 gap-3">
    <Field label="Cartons received"><Input type="number" min={1} step={1} value={cartons} onChange={e => setCartons(e.target.value)} /></Field>
    <Field label="Units per carton"><Input type="number" min={1} step={1} value={units} onChange={e => setUnits(e.target.value)} /></Field>
    <Field label="Cost per carton (GHS)"><MoneyInput value={cost} onChange={setCost} /></Field>
  </div><p className="text-sm" aria-live="polite">{unitCost == null ? 'Enter the carton quantity, selling units and purchase cost.' : `${quantity} individual units · ${money(unitCost)} per unit · recorded cost ${money(total)}`}</p>
  <p className="text-xs leading-relaxed text-slate-600">Unit cost rounds to the nearest pesewa. The recorded cost uses this rounded unit cost and can differ slightly from the supplier’s carton total. Review before applying.</p>
  <Button disabled={unitCost == null || !Number.isSafeInteger(total)} onClick={() => onApply(quantity, unitCost!)}>Apply carton quantities & cost</Button>
  </div></details>;
}
