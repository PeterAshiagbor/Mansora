/** Exercise the actual progressive navigation, including hidden feature groups. */
export async function navigate(page: any, name: string) {
  const nav = page.getByRole('navigation', { name: 'Main' });
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
