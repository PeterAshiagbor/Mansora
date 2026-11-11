import { navigate } from './navigation';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDevHost } from '../../apps/desktop/dev/host';
import { toXlsx } from '../../apps/desktop/src/core/importer';
import { startCloud, type Cloud } from '../cloud';
import { tempDir } from '../helpers';
const pw = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();
const built = existsSync(join(import.meta.dirname, '../../apps/desktop/dist/renderer/index.html'));

describe.skipIf(!pw || !built)('remaining desktop workflows through the real interface', () => {
  let cloud: Cloud, client: { id: string; code: string }, host: Awaited<ReturnType<typeof startDevHost>>, browser: any, page: any;
  const directory = tempDir('mansora-workflow-browser-');
  const owner = { name: 'Workflow owner', username: 'owner', password: randomUUID() };
  const manager = { name: 'Workflow supervisor', username: 'supervisor', password: randomUUID() };
  const cashier = { name: 'Workflow cashier', username: 'cashier', password: randomUUID() };
  const pageErrors: string[] = [];
  let productId = '';
  beforeAll(async () => {
    cloud = await startCloud(); client = await cloud.createClient('Desktop workflow fixture');
    host = await startDevHost({ dataDir: directory, port: 0, dbKey: randomUUID() });
    browser = await pw.chromium.launch();
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));
    await page.goto(host.url);
  });
  afterAll(async () => {
    await browser?.close();
    if (host) { await new Promise<void>((resolve) => host.server.close(() => resolve())); host.engine.db.close(); }
    await cloud?.close(); rmSync(directory, { recursive: true, force: true });
  });
  const nav = (name: string) => navigate(page, name);
  const read = (sql: string, ...params: unknown[]): any => host.engine.db.prepare(sql).get(...params);
  const balance = () => read('SELECT quantity, average_cost FROM stock_balances WHERE product_id = ?', productId);
  async function signIn(who: typeof owner) {
    await page.getByText('Sign in with the account details provided by your administrator.', { exact: true }).waitFor();
    await page.getByLabel('Username', { exact: true }).fill(who.username);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Lock / sign out', exact: true }).waitFor();
  }
  const signOut = async () => {
    await page.getByRole('button', { name: 'Lock / sign out', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
    if (await discard.isVisible()) await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  };
  async function approve(who: typeof owner) {
    const dialog = page.getByRole('dialog', { name: 'Manager approval needed', exact: true });
    await dialog.getByLabel('Manager username').fill(who.username);
    await dialog.getByLabel('Manager password').fill(who.password);
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  }
  async function nextSale() {
    const done = page.getByRole('dialog', { name: 'Sale completed', exact: true });
    await done.waitFor(); await done.getByRole('button', { name: /New sale/ }).click();
  }
  async function cashMove(direction: string, amount: string) {
    const before = read('SELECT COUNT(*) AS n FROM shift_cash_movements').n;
    await page.getByRole('button', { name: 'Cash in / out', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Cash in / out of the till', exact: true });
    await form.getByLabel(/^Type/).selectOption(direction);
    await form.getByLabel('Amount (GHS)', { exact: true }).fill(amount);
    await form.getByLabel('Reason', { exact: true }).fill('Synthetic till transfer');
    await form.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('dialog', { name: 'Manager approval needed', exact: true }).waitFor();
    expect(read('SELECT COUNT(*) AS n FROM shift_cash_movements').n).toBe(before);
    await approve(manager);
    await expect.poll(() => read('SELECT COUNT(*) AS n FROM shift_cash_movements').n).toBe(before + 1);
  }

  it('activates, creates restricted staff, a product/customer and owner discount settings', async () => {
    await page.getByLabel('Mansora server address').fill(cloud.url);
    await page.getByLabel('Activation code', { exact: true }).fill(client.code);
    await page.getByLabel("Owner's full name").fill(owner.name);
    await page.getByLabel('Username', { exact: true }).fill(owner.username);
    await page.getByLabel(/^Password/).fill(owner.password);
    await page.getByLabel('Repeat password').fill(owner.password);
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await signIn(owner);
    await nav('Staff');
    for (const [who, role] of [[manager, 'manager'], [cashier, 'cashier']] as const) {
      await page.getByRole('button', { name: 'Add staff member', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Add staff member', exact: true });
      await form.getByLabel('Full name', { exact: true }).fill(who.name);
      await form.getByLabel('Username', { exact: true }).fill(who.username);
      await form.getByLabel(/^Role/).selectOption(role);
      await form.getByLabel(/^Password/).fill(who.password);
      if (role === 'manager') {
        await form.getByLabel('View and edit cost prices', { exact: true }).uncheck();
        await form.getByLabel('Manage business settings', { exact: true }).check();
      } else for (const permission of ['Manage customers', 'Receive credit repayments', 'Record expenses']) await form.getByLabel(permission, { exact: true }).check();
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('cell', { name: who.name, exact: true }).waitFor();
    }
    expect(JSON.parse(read('SELECT permissions FROM users WHERE username = ?', cashier.username).permissions)).not.toContain('sale.discount');
    expect(JSON.parse(read('SELECT permissions FROM users WHERE username = ?', manager.username).permissions)).not.toContain('product.cost');
    await nav('Products'); await page.getByRole('button', { name: 'Add product', exact: true }).click();
    const product = page.getByRole('dialog', { name: 'Add product', exact: true });
    await product.getByLabel('Product name').fill('Workflow product');
    await product.getByText('More product details', { exact: true }).click();
    await product.getByLabel('SKU / item code').fill('FLOW-1');
    await product.getByLabel(/^Barcode/).fill('WF-001');
    await product.getByLabel('Selling price (GHS)').fill('10');
    await product.getByLabel('Cost price (GHS)').fill('6');
    await product.getByLabel('Opening stock').fill('10');
    await product.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('cell', { name: 'Workflow product', exact: true }).waitFor();
    productId = read('SELECT id FROM products WHERE sku = ?', 'FLOW-1').id;
    await nav('Customers'); await page.getByRole('button', { name: 'Add customer', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Workflow customer');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('cell', { name: 'Workflow customer', exact: true }).waitFor();
    await nav('Settings'); await page.getByLabel(/^Discount limit/).fill('10');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect.poll(() => host.engine.meta('max_discount_bps')).toBe('1000');
  });

  it('records a count difference, purchase average cost and damaged stock', async () => {
    await nav('Stock'); await page.getByRole('tab', { name: 'Stock count', exact: true }).click();
    await page.getByLabel('Counted quantity of Workflow product', { exact: true }).fill('8');
    await page.getByLabel('Note', { exact: true }).fill('Synthetic physical count');
    await page.getByRole('button', { name: 'Save count (1 counted, 1 different)', exact: true }).click();
    await expect.poll(() => balance().quantity).toBe(8);
    expect(read("SELECT quantity_delta FROM inventory_movements WHERE type = 'STOCK_COUNT_ADJUSTMENT'").quantity_delta).toBe(-2);
    await nav('Purchases & suppliers'); await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    const purchase = page.getByRole('dialog', { name: 'Receive stock', exact: true });
    await purchase.getByLabel('Invoice / waybill number').fill('SYNTHETIC-INVOICE');
    await purchase.getByLabel('Product', { exact: true }).selectOption({ label: 'Workflow product' });
    await purchase.getByLabel('Quantity', { exact: true }).fill('4');
    await purchase.getByLabel('Unit cost', { exact: true }).fill('9');
    await purchase.getByRole('button', { name: 'Receive into stock', exact: true }).click();
    await expect.poll(balance).toMatchObject({ quantity: 12, average_cost: 700 });
    await nav('Stock');
    const row = page.getByRole('row').filter({ hasText: 'Workflow product' });
    await row.getByRole('cell', { name: 'GHS 7.00', exact: true }).waitFor();
    await row.getByRole('button', { name: 'Adjust', exact: true }).click();
    const damage = page.getByRole('dialog', { name: 'Adjust stock: Workflow product', exact: true });
    await damage.getByLabel('Quantity', { exact: true }).fill('1');
    await damage.getByLabel('Reason (required)').fill('Synthetic damaged pack');
    await damage.getByRole('button', { name: 'Record adjustment', exact: true }).click();
    await expect.poll(balance).toMatchObject({ quantity: 11, average_cost: 700 });
    expect(read("SELECT quantity_delta, unit_cost FROM inventory_movements WHERE type = 'DAMAGE'")).toMatchObject({ quantity_delta: -1, unit_cost: 700 });
  });

  it('previews Excel errors/duplicates, commits once and refuses an identical re-import', async () => {
    const headers = ['Name', 'SKU', 'Cost price', 'Selling price', 'Opening stock'];
    const rows = [['Workflow product', 'FLOW-1', '6', '10', '99'], ['Imported workflow', 'IMPORT-1', '2', '3', '2']];
    const broken = await toXlsx([{ name: 'Products', rows: [headers, ...rows, ['Broken workflow', 'BROKEN-1', '2', 'invalid', '0']] }]);
    const clean = await toXlsx([{ name: 'Products', rows: [headers, ...rows] }]);
    const upload = (buffer: Buffer) => page.getByLabel('Choose import file').setInputFiles({ name: 'workflows.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    await nav('Import & export'); await upload(broken);
    await page.getByText('1 row(s) with errors', { exact: true }).waitFor();
    await page.getByText('1 already exist (will be skipped)', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Import 1 product(s)', exact: true }).isDisabled()).toBe(true);
    expect(read('SELECT COUNT(*) AS n FROM products').n).toBe(1);
    await upload(clean); await page.getByRole('cell', { name: 'Imported workflow', exact: true }).waitFor();
    await page.getByLabel('I confirm the opening stock quantities are what is physically in the shop').check();
    await page.getByRole('button', { name: 'Import 1 product(s)', exact: true }).click();
    await page.getByText('Imported 1 product(s)', { exact: true }).waitFor();
    expect(read("SELECT b.quantity FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE p.sku = 'IMPORT-1'").quantity).toBe(2);
    expect(balance().quantity).toBe(11);
    await upload(clean); await page.getByText('This exact file was already imported on', { exact: false }).waitFor();
    expect(await page.getByRole('button', { name: 'Import 0 product(s)', exact: true }).isDisabled()).toBe(true);
    expect(read('SELECT COUNT(*) AS n FROM import_batches').n).toBe(1);
    expect(read("SELECT b.quantity FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE p.sku = 'IMPORT-1'").quantity).toBe(2);
  });

  it('sells on approved credit and records partial cash repayment then settlement', async () => {
    await signOut(); await signIn(cashier);
    expect(await page.getByRole('navigation').getByRole('button', { name: 'Staff', exact: true, includeHidden: true }).count()).toBe(0);
    await nav('Products'); expect(await page.getByRole('button', { name: 'Add product', exact: true }).count()).toBe(0);
    expect(await page.getByRole('columnheader', { name: 'Cost', exact: true }).count()).toBe(0);
    await nav('Settings'); expect(await page.getByLabel(/^Discount limit/).count()).toBe(0);
    await nav('New sale'); await page.getByLabel('Opening cash float (GHS)').fill('100');
    await page.getByRole('button', { name: 'Open shift', exact: true }).click();
    await page.getByRole('button').filter({ hasText: 'Workflow product' }).click();
    await page.getByLabel(/^Customer \(optional\)/).selectOption({ label: 'Workflow customer' });
    await page.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    await page.getByRole('button', { name: 'Credit', exact: true }).click();
    await page.getByLabel('Credit amount', { exact: true }).fill('10');
    await page.getByRole('button', { name: /Complete sale/ }).click();
    await page.getByRole('dialog', { name: 'Manager approval needed', exact: true }).waitFor();
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(0);
    await approve(manager); await nextSale();
    expect(read('SELECT outstanding_balance FROM credit_accounts').outstanding_balance).toBe(1000);
    await nav('Credit & repayments'); await page.getByRole('button', { name: 'Receive payment', exact: true }).click();
    let form = page.getByRole('dialog', { name: 'Repayment from Workflow customer', exact: true });
    await form.getByLabel(/^Amount received/).fill('3');
    await form.getByRole('button', { name: 'Record repayment', exact: true }).click();
    await expect.poll(() => read('SELECT outstanding_balance FROM credit_accounts').outstanding_balance).toBe(700);
    await page.getByRole('button', { name: 'Receive payment', exact: true }).click();
    form = page.getByRole('dialog', { name: 'Repayment from Workflow customer', exact: true });
    await form.getByLabel(/^Amount received/).fill('7'); await form.getByLabel(/^Paid by/).selectOption('momo');
    await form.getByLabel('Reference (optional)').fill('SYNTHETIC-MOMO');
    await form.getByRole('button', { name: 'Record repayment', exact: true }).click();
    await expect.poll(() => read('SELECT outstanding_balance, status FROM credit_accounts')).toMatchObject({ outstanding_balance: 0, status: 'settled' });
    await page.getByText('Nobody owes anything', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'All, including settled', exact: true }).click();
    await page.getByRole('cell', { name: 'Settled', exact: true }).waitFor();
    expect(read("SELECT SUM(amount) AS amount FROM credit_repayments WHERE method = 'cash'").amount).toBe(300);
  });

  it('requires owner approval above the configured discount limit', async () => {
    await nav('New sale'); await page.getByRole('button').filter({ hasText: 'Workflow product' }).click();
    if (await page.getByRole('button', { name: 'Request discount', exact: true }).count()) await page.getByRole('button', { name: 'Request discount', exact: true }).click();
    await page.getByLabel('Basket discount', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Pay (F9)', exact: true }).click();
    await page.getByRole('dialog', { name: 'Take payment', exact: true }).getByRole('button', { name: 'Exact', exact: true }).click();
    await page.getByRole('button', { name: /Complete sale/ }).click(); await approve(manager);
    await page.getByRole('dialog', { name: 'Take payment', exact: true }).getByText("Discounts above 10% need the owner's approval", { exact: true }).waitFor();
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(1);
    await page.getByRole('button', { name: /Complete sale/ }).click(); await approve(owner); await nextSale();
    expect(read('SELECT s.total, s.discount_total, u.username FROM sales s JOIN users u ON u.id = s.discount_approved_by WHERE s.discount_total > 0')).toMatchObject({ total: 800, discount_total: 200, username: owner.username });
  });

  it('approves cash movements, charges an expense to the till, closes short and obtains sign-off', async () => {
    await nav('Cashier shifts'); await cashMove('in', '20'); await cashMove('out', '5');
    const approvals = host.engine.db.prepare('SELECT u.username FROM shift_cash_movements m JOIN users u ON u.id = m.authorised_by').all() as { username: string }[];
    expect(approvals.map((row) => row.username)).toEqual([manager.username, manager.username]);
    await nav('Expenses'); await page.getByRole('button', { name: 'Record expense', exact: true }).click();
    const expense = page.getByRole('dialog', { name: 'Record expense', exact: true });
    await expense.getByLabel('Description', { exact: true }).fill('Synthetic till expense');
    await expense.getByLabel('Amount (GHS)', { exact: true }).fill('4');
    await expense.getByLabel('Paid with cash from my till (reduces my expected cash)', { exact: true }).check();
    await expense.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('cell', { name: 'Synthetic till expense', exact: true }).waitFor();
    expect(read('SELECT amount, shift_id FROM expenses')).toMatchObject({ amount: 400, shift_id: expect.any(String) });
    await nav('Cashier shifts'); await page.getByText('GHS 122.00', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Close shift', exact: true }).click();
    const close = page.getByRole('dialog', { name: 'Close shift', exact: true });
    await close.getByLabel('Cash counted (GHS)').fill('120');
    await close.getByText('The till is short by GHS 2.00.', { exact: true }).waitFor();
    expect(await close.getByRole('button', { name: 'Close shift', exact: true }).isDisabled()).toBe(true);
    await close.getByLabel('Explain the difference (required)').fill('Synthetic shortage for review');
    await close.getByRole('button', { name: 'Close shift', exact: true }).click();
    await page.getByText('Short 2.00', { exact: true }).waitFor();
    await signOut(); await signIn(manager); await nav('Settings');
    expect(await page.getByLabel(/^Discount limit/).isDisabled()).toBe(true);
    expect(await page.getByLabel(/^Allow selling when the system shows no stock/).isDisabled()).toBe(true);
    await nav('Products'); expect(await page.getByRole('columnheader', { name: 'Cost', exact: true }).count()).toBe(0);
    await nav('Cashier shifts'); await page.getByRole('button', { name: 'Sign off', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Sign off shift: Workflow cashier', exact: true });
    await review.getByLabel("Manager's note").fill('Reviewed synthetic shortage');
    await review.getByRole('button', { name: 'Sign off', exact: true }).click();
    await page.getByText('Signed off by Workflow supervisor', { exact: true }).waitFor();
    expect(read('SELECT expected_cash, counted_cash, variance, status FROM shifts')).toMatchObject({ expected_cash: 12200, counted_cash: 12000, variance: -200, status: 'reviewed' });
  });

  it('creates an encrypted backup and verifies it with the shop passphrase', async () => {
    await signOut(); await signIn(owner); await nav('Backup & recovery');
    const passphrase = randomUUID();
    await page.getByLabel(/^Backup passphrase/).fill(passphrase);
    await page.getByLabel('Repeat passphrase', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: 'Create encrypted backup', exact: true }).click();
    await page.getByText('Backup created and checked:', { exact: false }).waitFor();
    expect(read('SELECT COUNT(*) AS n FROM backup_records').n).toBe(1);
    await page.getByRole('button', { name: 'Test this backup', exact: true }).click();
    const verify = page.getByRole('dialog', { name: 'Test backup', exact: true });
    await verify.getByLabel('Backup passphrase', { exact: true }).fill(passphrase);
    await verify.getByRole('button', { name: 'Open and check', exact: true }).click();
    await verify.getByText('The backup opens and passes its integrity checks.', { exact: false }).waitFor();
    await verify.getByText('2 sale(s)', { exact: false }).waitFor();
    await verify.getByRole('button', { name: 'Close', exact: true }).last().click();
  });

  it('recovers the owner password and re-links the same records with a replacement cloud identity', async () => {
    const recovery = await cloud.api('POST', `/v1/admin/clients/${client.id}/recovery-codes`, { reason: 'Synthetic authorised owner recovery fixture' });
    expect(recovery.status).toBe(200); const nextPassword = randomUUID();
    await signOut(); await page.getByRole('button', { name: 'Owner forgot their password?', exact: true }).click();
    await page.getByLabel('Recovery code', { exact: true }).fill(recovery.body.code);
    await page.getByLabel('New owner password', { exact: true }).fill(nextPassword);
    await page.getByLabel('Repeat new password', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: 'Set new owner password', exact: true }).click();
    await page.getByText('Password changed. Sign in above as "owner".', { exact: true }).waitFor();
    owner.password = nextPassword; await signIn(owner);
    const previousId = host.engine.meta('device_id');
    const other = await cloud.createClient('Other relink fixture');
    await nav('Sync status'); await page.getByLabel('New activation code', { exact: true }).fill(other.code);
    await page.getByRole('button', { name: 'Re-link', exact: true }).click();
    await page.getByText('This activation code is not valid or has expired', { exact: false }).waitFor();
    expect(host.engine.meta('device_id')).toBe(previousId);
    expect((await cloud.api('POST', `/v1/admin/devices/${previousId}/revoke`)).status).toBe(200);
    const code = await cloud.api('POST', `/v1/admin/clients/${client.id}/activation-codes`);
    await page.getByLabel('New activation code', { exact: true }).fill(code.body.code);
    await page.getByRole('button', { name: 'Re-link', exact: true }).click();
    await page.getByText('Laptop re-linked', { exact: true }).waitFor();
    expect(host.engine.meta('device_id')).not.toBe(previousId);
    expect(read('SELECT COUNT(*) AS n FROM sales').n).toBe(2);
    expect(read('SELECT COUNT(*) AS n FROM credit_repayments').n).toBe(2);
    expect(balance()).toMatchObject({ quantity: 9, average_cost: 700 });
    expect(read("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'").n).toBe(0);
    expect(pageErrors).toEqual([]);
  });
});
