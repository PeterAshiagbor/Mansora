import type { Permission } from '@mansora/domain';
import { Button } from '@mansora/ui';
import { useApp } from '../lib';

const tasks: Record<string, { label: string; page: string; param?: string; permission: Permission }[]> = {
  inventory: [
    { label: 'Products', page: 'products', permission: 'product.view' },
    { label: 'Receive stock', page: 'purchases', permission: 'purchase.manage' },
    { label: 'Stock count', page: 'stock', param: 'count', permission: 'stock.adjust' },
    { label: 'Stock overview', page: 'stock', permission: 'stock.view' },
    { label: 'Import products', page: 'data', permission: 'data.import' },
  ],
  customers: [
    { label: 'Customer directory', page: 'customers', permission: 'customer.manage' },
    { label: 'Balances & repayments', page: 'credit', permission: 'credit.repayment' },
  ],
  settings: [
    { label: 'Team & access', page: 'staff', permission: 'staff.manage' },
    { label: 'Billing & payments', page: 'billing', permission: 'billing.view' },
    { label: 'Backup & recovery', page: 'backup', permission: 'backup.manage' },
    { label: 'Audit history', page: 'audit', permission: 'audit.view' },
  ],
};

/** Related, authorised tasks stay beside the work; every action uses the normal guarded navigation. */
export function TaskLinks({ group, current }: { group: keyof typeof tasks; current?: string }) {
  const { can, go } = useApp();
  const available = tasks[group].filter(task => can(task.permission) && task.page !== current && !(current === 'products' && task.page === 'data'));
  if (available.length === 0) return null;
  return <div role="group" aria-label={`${group} tasks`} className="m-task-links no-print">{available.map(task => <Button variant="ghost" key={task.label} onClick={() => go(task.page, task.param)}>{task.label}</Button>)}</div>;
}
