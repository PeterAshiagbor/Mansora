/** Unsubmitted drafts only. Never persist credentials, tenders or completed sales. */
export interface ParkedBasket<L> {
  id: string; createdAt: string; lines: L[]; cartDiscount: number;
  customerId: string; customer: { id: string; name: string } | null; requestingDiscount: boolean;
}
const drafts = new Map<string, ParkedBasket<any>[]>();
export function parkedBaskets<L>(scope: string): ParkedBasket<L>[] { return [...(drafts.get(scope) ?? [])]; }
export function parkBasket<L>(scope: string, basket: ParkedBasket<L>) {
  const current = drafts.get(scope) ?? [];
  if (current.some(d => d.id === basket.id)) throw new Error('This basket is already parked.');
  if (current.length >= 10) throw new Error('Resume or discard a parked basket before parking another.');
  drafts.set(scope, [...current, structuredClone(basket)]);
}
/** Consume exactly once, only after the caller has checked current product data. */
export function takeParkedBasket<L>(scope: string, id: string): ParkedBasket<L> | undefined {
  const current = drafts.get(scope) ?? [], found = current.find(d => d.id === id);
  if (found) {
    const remaining = current.filter(d => d.id !== id);
    if (remaining.length) drafts.set(scope, remaining); else drafts.delete(scope);
  }
  return found;
}
export function clearParkedBaskets() { drafts.clear(); }
if (typeof window !== 'undefined') {
  window.addEventListener('mansora:session-ended', clearParkedBaskets);
  window.addEventListener('mansora:signed-out', clearParkedBaskets);
  window.addEventListener('beforeunload', event => { if (drafts.size) { event.preventDefault(); event.returnValue = ''; } });
}
