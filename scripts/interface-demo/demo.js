/* Isolated UI demonstration. No production API, passwords, device tokens or business writes. */
(() => {
  'use strict';
  const fixture = window.MANSORA_DEMO_DATA;
  if (!fixture) return;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const desktop = clone(fixture.desktop);
  const provider = clone(fixture.admin);
  let role = sessionStorage.getItem('mansora-demo-role') === 'cashier' ? 'cashier' : 'owner', signedIn = true;
  const blocked = 'This is an interface preview with sample records. Transactions, imports, backups and account changes are available in the desktop application, and are not submitted from this demo.';
  const filter = (rows, input) => rows.filter((r) => !input.search || [r.name, r.sku, r.barcode, r.receipt_no].some((v) => String(v ?? '').toLowerCase().includes(input.search.toLowerCase())));
  const safeProduct = (p) => {
    if (p == null) return null;
    const copy = clone(p);
    if (role !== 'owner') { delete copy.cost_price; delete copy.average_cost; }
    return copy;
  };
  const user = () => role === 'owner' ? desktop['app.state'].user : desktop.cashier.user;
  function execute(command, input = {}) {
    if (command === 'app.state') return { ...clone(desktop['app.state']), user: signedIn ? clone(user()) : null };
    if (command === 'auth.logout') { signedIn = false; return { ok: true }; }
    if (command === 'auth.login') throw new Error('Use the “Enter sample workspace” button above. No account or password is needed for this demo.');
    if (!signedIn) throw new Error('Enter the sample workspace using the demo toolbar.');
    if (command === 'product.list') return filter(desktop[command], input).filter((p) => (input.includeInactive || p.active) && (!input.categoryId || p.category_id === input.categoryId)).slice(0, input.limit ?? 1000).map(safeProduct);
    if (command === 'product.lookup') return safeProduct(desktop['product.list'].find((p) => p.barcode === input.code || p.sku === input.code) ?? null);
    if (command === 'report.dashboard' && role !== 'owner') return clone(desktop.cashierDashboard);
    if (command === 'import.template') return clone(desktop[`import.template:${input.format ?? 'xlsx'}`]);
    if (command === 'stock.overview') {
      const rows = desktop['product.list'].filter((p) => input.filter === 'out' ? p.quantity <= 0 : input.filter === 'low' ? p.quantity <= p.reorder_level : true).map(safeProduct);
      return { ...clone(desktop[command]), rows };
    }
    if (command === 'stock.movements') return clone(desktop[command].filter((r) => !input.type || r.type === input.type));
    if (command === 'customer.list' || command === 'sale.list') return clone(filter(desktop[command], input));
    if (command.endsWith('.get')) {
      const result = desktop[`${command}:${input.id}`];
      if (result) return clone(result);
      if (command === 'customer.get') return { customer: desktop['customer.list'].find((c) => c.id === input.id), sales: [], credit: [] };
      throw new Error('This sample record has no detail view.');
    }
    if (command === 'audit.list') return clone(desktop[command].filter((r) => !input.action || r.action.includes(input.action)));
    if (command === 'credit.list') { const data = clone(desktop[command]); if (input.status === 'open') data.accounts = data.accounts.filter((a) => a.status === 'open'); return data; }
    if (command === 'shift.current' && role !== 'owner') return clone(desktop.cashierShift);
    if (['product.save', 'category.save', 'customer.save', 'supplier.save', 'business.update'].includes(command)) {
      if (role !== 'owner') throw new Error('Switch to the Owner preview to edit sample records.');
      if (command === 'business.update') { Object.assign(desktop['app.state'].business, input, { maxDiscountBps: (input.maxDiscountPercent ?? 0) * 100 }); return { ok: true }; }
      const list = command.replace('.save', '.list'), rows = desktop[list], id = input.id ?? crypto.randomUUID();
      let row = rows.find((r) => r.id === id);
      if (!row) { row = { id }; rows.push(row); }
      Object.assign(row, input);
      if (command === 'product.save') Object.assign(row, {
        cost_price: input.costPrice ?? row.cost_price ?? 0, selling_price: input.sellingPrice,
        category_id: input.categoryId, category_name: desktop['category.list'].find((c) => c.id === input.categoryId)?.name,
        reorder_level: input.reorderLevel ?? 0, quantity: row.quantity ?? input.openingStock ?? 0,
        average_cost: row.average_cost ?? input.costPrice ?? 0, active: input.active === false ? 0 : 1,
      });
      return { id };
    }
    if (Object.prototype.hasOwnProperty.call(desktop, command)) return clone(desktop[command]);
    throw new Error(blocked);
  }
  window.mansora = { invoke: async (command, input) => {
    try { return { ok: true, data: execute(command, input) }; }
    catch (error) { return { ok: false, error: { code: 'INTERFACE_DEMO', message: error.message } }; }
  } };
  // Admin reads are supplied exclusively from synthetic API responses. Never contact localhost or a live server.
  window.MANSORA_API_URL = '';
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (request, init = {}) => {
    const url = new URL(typeof request === 'string' ? request : request.url ?? request, location.href);
    if (url.pathname.startsWith('/v1/')) {
      if ((init.method ?? 'GET') !== 'GET') return new Response(JSON.stringify({ code: 'INTERFACE_DEMO', message: blocked }), { status: 409, headers: { 'content-type': 'application/json' } });
      const key = url.pathname + (url.searchParams.has('tenantId') ? `?tenantId=${encodeURIComponent(url.searchParams.get('tenantId'))}` : '');
      const data = provider[key];
      return new Response(JSON.stringify(data ?? { code: 'INTERFACE_DEMO', message: 'This preview has no live service connection.' }), { status: data === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
    }
    return nativeFetch(request, init);
  };
  if (location.pathname.startsWith('/admin')) sessionStorage.setItem('mansora-admin-token', 'interface-preview-only');
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div'); bar.className = 'demo-toolbar'; bar.setAttribute('aria-label', 'Interface preview controls');
    bar.innerHTML = '<a href="/">Mansora demo</a><span class="demo-note">SAMPLE DATA · No live transactions</span><a href="/client/">Client app</a><a href="/admin/">Mansora admin</a>';
    if (location.pathname.startsWith('/client')) {
      const label = document.createElement('label'); label.textContent = 'View as ';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Demo staff role');
      select.innerHTML = '<option value="owner">Owner</option><option value="cashier">Cashier</option>';
      select.value = role;
      select.onchange = () => { sessionStorage.setItem('mansora-demo-role', select.value); location.reload(); };
      label.append(select); bar.append(label);
      const enter = document.createElement('button'); enter.textContent = 'Enter sample workspace';
      enter.onclick = () => { signedIn = true; window.dispatchEvent(new Event('mansora:signed-out')); }; bar.append(enter);
    }
    const reset = document.createElement('button'); reset.textContent = 'Reset demo'; reset.onclick = () => location.reload(); bar.append(reset);
    const help = document.createElement('span'); help.className = 'demo-help'; help.textContent = 'Browse pages and forms. Product/customer edits stay in this tab. Reload resets them. Reports show the original sample records.';
    bar.append(help); document.body.prepend(bar); document.body.classList.add('interface-demo');
  });
})();
