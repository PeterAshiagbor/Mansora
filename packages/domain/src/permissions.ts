export const PERMISSIONS = {
  'sale.create': 'Make sales',
  'sale.view_all': 'View all sales history',
  'sale.discount': 'Apply discounts',
  'refund.approve': 'Approve and process refunds',
  'product.view': 'View products',
  'product.manage': 'Create and edit products and categories',
  'product.cost': 'View and edit cost prices',
  'stock.view': 'View stock levels and movements',
  'stock.adjust': 'Adjust stock, record damages and stock counts',
  'purchase.manage': 'Record purchases and suppliers',
  'customer.manage': 'Manage customers',
  'credit.sell': 'Sell on credit',
  'credit.repayment': 'Receive credit repayments',
  'expense.manage': 'Record expenses',
  'shift.own': 'Open and close own shift',
  'shift.review': 'Review and sign off shifts',
  'report.sales': 'View sales and payment reports',
  'report.stock': 'View stock reports',
  'report.profit': 'View gross profit reports',
  'staff.manage': 'Manage staff and permissions',
  'settings.manage': 'Manage business settings',
  'data.import': 'Import products and opening stock',
  'data.export': 'Export business data',
  'backup.manage': 'Create and restore backups',
  'audit.view': 'View audit history',
  'support.grant': 'Grant or revoke Mansora support access',
  'billing.view': 'View the Mansora subscription, invoices and receipts',
  'billing.manage': 'Pay Mansora invoices and manage automatic payments',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLES = ['owner', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

const MANAGER_DENIED: Permission[] = ['staff.manage', 'settings.manage', 'support.grant', 'data.export', 'backup.manage', 'audit.view', 'billing.view', 'billing.manage'];

/** Default permissions a role starts with. Owners can adjust manager/cashier permissions per person. */
export const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => !MANAGER_DENIED.includes(p)),
  cashier: ['sale.create', 'product.view', 'shift.own'],
};

/** Permissions that can never be delegated away from the owner. */
export const OWNER_ONLY: Permission[] = ['staff.manage', 'support.grant'];

export interface Actor {
  id: string;
  role: Role;
  permissions: string[];
  status: string;
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor || actor.status !== 'active') return false;
  if (actor.role === 'owner') return true;
  if (OWNER_ONLY.includes(permission)) return false;
  return actor.permissions.includes(permission);
}

/** Clean a requested permission list for a role (drops unknown and owner-only permissions). */
export function sanitisePermissions(role: Role, requested: string[]): Permission[] {
  if (role === 'owner') return ALL_PERMISSIONS;
  return ALL_PERMISSIONS.filter((p) => requested.includes(p) && !OWNER_ONLY.includes(p));
}

/** What each role can do by default, grouped for the "Who can do what" page. Generated from the table above,
 *  so the page in the app and the guide never drift from what the software enforces. */
export function roleMatrix(): { permission: Permission; label: string; owner: boolean; manager: boolean; cashier: boolean; ownerOnly: boolean }[] {
  return ALL_PERMISSIONS.map((p) => ({
    permission: p, label: PERMISSIONS[p], owner: true, manager: ROLE_DEFAULTS.manager.includes(p), cashier: ROLE_DEFAULTS.cashier.includes(p), ownerOnly: OWNER_ONLY.includes(p),
  }));
}

export function roleMatrixMarkdown(): string {
  const yes = (b: boolean) => (b ? 'Yes' : '–');
  const rows = roleMatrix().map((r) => `| ${r.label} | ${yes(r.owner)} | ${r.ownerOnly ? 'Never' : yes(r.manager)} | ${r.ownerOnly ? 'Never' : yes(r.cashier)} |`);
  return [
    '# Who can do what',
    '',
    'Generated from the permission table in `packages/domain/src/permissions.ts`; a test fails if this page and the code differ.',
    'Run `npx tsx scripts/docs/roles.ts` after changing permissions.',
    '',
    'These are the starting permissions for each role. The owner can give a manager or cashier more or fewer permissions,',
    'person by person, on the Staff page, except the ones marked "Never", which only the owner can ever have.',
    '',
    '| What | Owner | Manager | Cashier |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Logins and shifts',
    '',
    '- Everyone signs in with their **own** username and password. There is no shared shop password: the records show who did each sale, refund, discount and cash movement.',
    '- Each shop has its own web address. Staff open it and sign in with their own login.',
    '- A person must **open a shift** (count the opening float) before selling, taking cash refunds or recording cash in or out.',
    '- A shift belongs to the person who opened it. Nobody else can sell on it.',
    '- At the end of the day, the person **closes their shift** by counting the cash. Mansora shows the expected cash and any difference.',
    '- A shift still open from an earlier day is flagged to the person and to the owner and managers. Close it with a count before starting the next day.',
    '- If someone goes home without closing their shift, an owner or manager closes it for them from **Cashier shifts → Shifts left open by others**, after counting the cash in that till. The difference is recorded with their name and reason.',
    '- Cash in or out of the till that is not a sale needs a manager or owner to approve.',
    '- The app locks after the idle time set in Settings. The same person signs back in and returns to where they were.',
    '',
  ].join('\n');
}
