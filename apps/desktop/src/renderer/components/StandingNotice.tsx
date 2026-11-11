import { restrictionMessage, type ServiceStanding } from '@mansora/domain';
import { Alert, Button } from '@mansora/ui';
import { useApp, useQuery } from '../lib';

/** The non-payment standing the engine enforces (D-28), read from the same place so screen and rules agree. */
export function useStanding(): ServiceStanding | null {
  return useQuery<any>('sync.status').data?.standing ?? null;
}

/** Shown to people who can act on it (billing) or who are affected by it (reports). Cashiers are not alarmed. */
export function StandingNotice({ className = 'mb-4', onBillingPage = false }: { className?: string; onBillingPage?: boolean }) {
  const { can, go } = useApp();
  const s = useStanding();
  if (!s || s.stage === 'good') return null;
  const payer = can('billing.view');
  const affected = can('report.sales') || can('report.profit') || can('report.stock');
  if (!payer && !(affected && s.stage !== 'notice')) return null;
  const invoice = s.invoiceNumber ? `Mansora invoice ${s.invoiceNumber}` : 'Your Mansora invoice';
  const action = payer && !onBillingPage ? <Button size="sm" className="ml-3" onClick={() => go('billing')}>Open Billing & payments</Button> : null;
  const arrangement = s.holdUntil ? ` A payment arrangement is in place until ${s.holdUntil}.` : '';
  if (s.stage === 'restricted') return <Alert tone="bad" className={className}>{restrictionMessage(s)}{payer ? '' : ' Ask the owner to settle it.'}{action}</Alert>;
  if (s.stage === 'warning') return <Alert tone="warn" className={className}>{invoice} was due on {s.dueDate}. If it is still unpaid on {s.restrictFrom}, reports and report exports pause until it is paid. Selling never stops.{arrangement}{action}</Alert>;
  return <Alert className={className}>{invoice} was due on {s.dueDate}. Please pay it from Billing & payments.{arrangement}{action}</Alert>;
}
