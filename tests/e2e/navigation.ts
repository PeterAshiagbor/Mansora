/** Exercise the actual progressive navigation, including hidden feature groups. */
/** Who owes us, Invoices and Payments received are tabs of the admin Billing page. */
const BILLING_TABS: Record<string, string> = { Collections: 'Who owes us', Invoices: 'Invoices', Payments: 'Payments received' };
export async function navigate(page: any, name: string) {
  if (BILLING_TABS[name]) {
    await navigate(page, 'Billing');
    await page.getByRole('tab', { name: BILLING_TABS[name], exact: true }).click();
    return;
  }
  const nav = page.getByRole('navigation', { name: 'Main' });
  if (!await nav.isVisible() && await page.getByRole('button', { name: 'Menu', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await nav.waitFor({ state: 'visible' });
  const target = nav.getByRole('button', { name, exact: true });
  if (!await target.isVisible()) {
    const tools = nav.locator('details.m-nav-tools');
    if (!await tools.evaluate((e: HTMLDetailsElement) => e.open)) await tools.locator(':scope > summary').click();
    const group = nav.locator('details[data-nav-group]').filter({ has: page.getByRole('button', { name, exact: true, includeHidden: true }) });
    if (!await group.evaluate((e: HTMLDetailsElement) => e.open)) await group.locator(':scope > summary').click();
  }
  await target.click();
}
