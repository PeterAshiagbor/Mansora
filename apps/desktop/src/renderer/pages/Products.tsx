import { useState } from 'react';
import { unitCostFromCarton } from '@mansora/domain';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table } from '@mansora/ui';
import { call, ExportButtons, marginLabel, money, MoneyInput, plain, useAction, useApp, useQuery } from '../lib';

export function ProductsPage() {
  const { can, go } = useApp();
  const [search, setSearch] = useState('');
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const { data, reload } = useQuery<any[]>('product.list', { search, includeInactive: inactive, limit: 1000 });
  const cost = can('product.cost');
  return (
    <div>
      <PageHeader title="Products" subtitle={data ? `${data.length} product(s)` : undefined}
        actions={<>
          <ExportButtons title="Products" columns={['Name', 'SKU', 'Barcode', 'Category', 'Selling price', ...(cost ? ['Cost price', 'Gross margin (%)'] : []), 'In stock']} rows={() => (data ?? []).map((p) => [p.name, p.sku ?? '', p.barcode ?? '', p.category_name ?? '', plain(p.selling_price), ...(cost ? [plain(p.cost_price), marginLabel(p.selling_price, p.cost_price)] : []), p.quantity])} />
          {can('data.import') && <Button onClick={() => go('data')}>Upload Excel / CSV</Button>}
          {can('product.manage') && <Button variant="primary" onClick={() => setEdit({})}>Add product</Button>}
        </>} />
      <div className="mb-3 flex items-center gap-3 no-print">
        <Input placeholder="Search by name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} className="w-80" aria-label="Search products" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive</label>
      </div>
      <Card pad={false}>
        <Table rows={data} rowKey={(r) => r.id} onRowClick={can('product.manage') ? setEdit : undefined} empty="No products yet. Add one, or import a list under Import & export."
          columns={[
            { header: 'Product', cell: (p) => <><span className="font-medium">{p.name}</span>{!p.active && <> <Badge>Inactive</Badge></>}</> },
            { header: 'SKU', cell: (p) => p.sku ?? '' },
            { header: 'Barcode', cell: (p) => p.barcode ?? '' },
            { header: 'Category', cell: (p) => p.category_name ?? '' },
            ...(cost ? [{ header: 'Cost', align: 'right' as const, cell: (p: any) => money(p.cost_price) }] : []),
            { header: 'Selling price', align: 'right', cell: (p) => money(p.selling_price) },
            ...(cost ? [{ header: 'Gross margin', align: 'right' as const, cell: (p: any) => marginLabel(p.selling_price, p.cost_price) }] : []),
            { header: 'In stock', align: 'right', cell: (p) => (p.quantity <= 0 ? <Badge tone="bad">{p.quantity}</Badge> : p.quantity <= p.reorder_level ? <Badge tone="warn">{p.quantity}</Badge> : p.quantity) },
          ]} />
      </Card>
      {edit && <ProductForm product={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function ProductForm({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const { can } = useApp();
  const isNew = !product.id;
  const categories = useQuery<any[]>('category.list').data ?? [];
  const [f, setF] = useState({
    name: product.name ?? '', sku: product.sku ?? '', barcode: product.barcode ?? '', categoryId: product.category_id ?? '', unit: product.unit ?? 'each',
    costPrice: (product.cost_price ?? 0) as number | null, sellingPrice: (product.selling_price ?? null) as number | null, reorderLevel: String(product.reorder_level ?? 0), active: product.active !== 0, openingStock: '',
  });
  const [cartonCost, setCartonCost] = useState<number | null>(null);
  const [cartonUnits, setCartonUnits] = useState('');
  let derivedCost: number | null = null;
  if (cartonCost != null && Number.isSafeInteger(Number(cartonUnits)) && Number(cartonUnits) > 0) derivedCost = unitCostFromCarton(cartonCost, Number(cartonUnits));
  const { run, busy } = useAction();
  const cost = can('product.cost');
  const save = () => run(async () => {
    await call('product.save', {
      id: product.id, name: f.name, sku: f.sku || null, barcode: f.barcode || null, categoryId: f.categoryId || null, unit: f.unit, sellingPrice: f.sellingPrice,
      ...(cost ? { costPrice: f.costPrice ?? 0 } : {}), reorderLevel: Number(f.reorderLevel) || 0, active: f.active,
      ...(isNew && Number(f.openingStock) > 0 ? { openingStock: Number(f.openingStock) } : {}),
    });
    onSaved();
  }, 'Product saved');
  return (
    <Modal title={isNew ? 'Add product' : 'Edit product'} open onClose={onClose} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !f.name.trim() || f.sellingPrice == null} onClick={save}>Save</Button></>}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Product name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Barcode" hint="Click here and scan the item"><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
        <Field label="SKU / item code"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">No category</option>{categories.filter((c) => c.active || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Unit of measure"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Selling price (GHS)"><MoneyInput value={f.sellingPrice} onChange={(v) => setF({ ...f, sellingPrice: v })} /></Field>
        {cost && <Field label="Cost price (GHS)" hint={!isNew ? 'Changing this does not re-value stock already on hand.' : undefined}><MoneyInput value={f.costPrice} onChange={(v) => setF({ ...f, costPrice: v })} /></Field>}
        {cost && <fieldset className="col-span-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">Calculate cost from a carton</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Carton purchase cost (GHS)"><MoneyInput value={cartonCost} onChange={setCartonCost} /></Field>
            <Field label="Selling units per carton" hint="Use 1 if you sell the whole carton."><Input type="number" min={1} step={1} value={cartonUnits} onChange={(e) => setCartonUnits(e.target.value)} /></Field>
          </div>
          <p className="my-2 text-sm" aria-live="polite">Unit cost: {derivedCost == null ? 'Enter carton cost and quantity' : money(derivedCost)}</p>
          <Button disabled={derivedCost == null} onClick={() => setF({ ...f, costPrice: derivedCost })}>Use calculated unit cost</Button>
          <p className="mt-2 text-xs text-slate-600">Rounded to the nearest pesewa. Quantities and selling price are per selling unit. This calculator does not record a purchase or change stock.</p>
        </fieldset>}
        {cost && <p className="col-span-2 text-sm">Gross margin: {f.sellingPrice == null || f.costPrice == null ? '—' : marginLabel(f.sellingPrice, f.costPrice)} <span className="text-slate-600">(selling price − cost) ÷ selling price; before discounts and expenses.</span></p>}
        <Field label="Reorder level" hint="Warn when stock falls to this quantity"><Input type="number" min={0} value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
        {isNew && can('stock.adjust') && <Field label="Opening stock" hint="Quantity on the shelf right now"><Input type="number" min={0} value={f.openingStock} onChange={(e) => setF({ ...f, openingStock: e.target.value })} /></Field>}
        {!isNew && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (shown at checkout)</label>}
        {!isNew && <p className="col-span-2 text-xs text-slate-500">Stock quantity is changed through purchases, stock counts and adjustments under Stock, so that every change is recorded.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function CategoriesPage() {
  const { data, reload } = useQuery<any[]>('category.list');
  const [edit, setEdit] = useState<any | null>(null);
  const { run, busy } = useAction();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Categories" subtitle="Group products to find them faster at checkout." actions={<Button variant="primary" onClick={() => setEdit({ name: '', active: 1 })}>Add category</Button>} />
      <Card pad={false}>
        <Table rows={data} rowKey={(r) => r.id} onRowClick={setEdit} empty="No categories yet" columns={[{ header: 'Name', cell: (c) => c.name }, { header: 'Status', cell: (c) => (c.active ? <Badge tone="good">Active</Badge> : <Badge>Hidden</Badge>) }]} />
      </Card>
      {edit && (
        <Modal title={edit.id ? 'Edit category' : 'Add category'} open onClose={() => setEdit(null)}
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={busy || !edit.name.trim()} onClick={() => run(async () => { await call('category.save', { id: edit.id, name: edit.name, active: !!edit.active }); setEdit(null); reload(); }, 'Category saved')}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Category name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Active</label>
          </div>
        </Modal>
      )}
    </div>
  );
}
