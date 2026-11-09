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
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLES = ['owner', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

const MANAGER_DENIED: Permission[] = ['staff.manage', 'settings.manage', 'support.grant', 'data.export', 'backup.manage', 'audit.view'];

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
