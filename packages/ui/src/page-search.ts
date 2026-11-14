/**
 * "Find a page" search (owner request 2026-11-14): no AI, just words. A page is found by its name, by the words
 * people use for what it does (its keywords), and by everyday words with the same meaning: searching "income"
 * finds Sales history and Reports, "inventory" finds Stock, "debtors" finds Credit. Small typing mistakes are
 * forgiven. Results are ranked: the page's own name first, then what it contains, then related pages.
 */
export interface SearchablePage { id: string; label: string; group: string; keywords?: string[] }
export interface PageMatch<T extends SearchablePage> { page: T; score: number; reason?: string }

/** Words that mean the same thing to a shop owner. A query word in a group also searches for the other words. */
export const RELATED_WORDS: string[][] = [
  ['income', 'revenue', 'takings', 'turnover', 'earnings', 'money in', 'sales', 'sale', 'sold', 'selling', 'sell', 'receipts'],
  ['profit', 'profits', 'margin', 'margins', 'gross profit', 'markup', 'gain'],
  ['expense', 'expenses', 'spending', 'spend', 'spent', 'costs', 'cost', 'bills', 'bill', 'overheads', 'outgoings', 'money out', 'paid out'],
  ['stock', 'inventory', 'goods', 'items', 'products', 'product', 'quantity', 'quantities', 'store', 'warehouse'],
  ['purchase', 'purchases', 'buy', 'buying', 'bought', 'restock', 'restocking', 'reorder', 'supplier', 'suppliers', 'vendor', 'vendors', 'wholesaler', 'delivery', 'deliveries'],
  ['customer', 'customers', 'client', 'clients', 'buyer', 'buyers', 'shopper'],
  ['credit', 'debt', 'debts', 'debtor', 'debtors', 'owe', 'owes', 'owing', 'owed', 'loan', 'repayment', 'repayments', 'outstanding', 'arrears', 'overdue', 'collections'],
  ['staff', 'employee', 'employees', 'worker', 'workers', 'cashier', 'cashiers', 'user', 'users', 'team', 'permissions', 'roles', 'password', 'passwords', 'login'],
  ['shift', 'shifts', 'till', 'drawer', 'float', 'cash up', 'cashing up', 'end of day', 'close day', 'count cash'],
  ['report', 'reports', 'summary', 'summaries', 'analysis', 'performance', 'statistics', 'stats', 'figures', 'numbers', 'chart', 'charts'],
  ['bank', 'momo', 'mobile money', 'statement', 'statements', 'reconcile', 'reconciliation', 'mtn', 'telecel', 'airteltigo', 'transactions'],
  ['backup', 'backups', 'restore', 'recovery', 'recover', 'lost laptop', 'copy'],
  ['sync', 'syncing', 'online', 'offline', 'internet', 'cloud', 'upload'],
  ['import', 'export', 'excel', 'csv', 'spreadsheet', 'download', 'upload file'],
  ['settings', 'setting', 'preferences', 'setup', 'set up', 'configure', 'business details', 'receipt footer', 'logo'],
  ['help', 'guide', 'guides', 'how to', 'tutorial', 'getting started', 'learn', 'support'],
  ['subscription', 'subscriptions', 'plan', 'plans', 'billing', 'invoice', 'invoices', 'pay mansora', 'payment', 'payments', 'paid'],
  ['refund', 'refunds', 'return', 'returns', 'void', 'cancel sale', 'money back'],
  ['discount', 'discounts', 'price', 'prices', 'pricing', 'offer'],
  ['barcode', 'barcodes', 'scan', 'scanner', 'sku', 'camera'],
  ['category', 'categories', 'group', 'groups', 'department', 'type'],
  ['audit', 'history', 'log', 'logs', 'activity', 'who did', 'changes'],
  ['lead', 'leads', 'prospect', 'prospects', 'enquiry', 'enquiries', 'demo'],
  ['administrator', 'administrators', 'admin', 'admins', 'security', 'two-step', '2fa'],
  ['problem', 'problems', 'bug', 'bugs', 'error', 'errors', 'issue', 'issues', 'complaint', 'feedback'],
];

// Filler words carry no meaning for finding a page: "who owes me" is about debt, "show my sales" about sales.
const FILLER = new Set(['a', 'an', 'the', 'my', 'me', 'i', 'we', 'our', 'is', 'are', 'was', 'of', 'to', 'for', 'in', 'on', 'at', 'and', 'or', 'with',
  'who', 'what', 'where', 'when', 'how', 'which', 'show', 'see', 'find', 'view', 'open', 'do', 'does', 'can', 'page', 'all', 'this', 'that']);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).split(' ').filter(Boolean);

/** Edit distance, stopping early once it is over the limit. */
function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return false;
    prev = row;
  }
  return prev[b.length] <= limit;
}
const typoLimit = (w: string) => (w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0);
/** A query word matches a text word when it starts it ("rep" → "reports") or is one typing mistake away. */
const wordMatches = (q: string, w: string) => w.startsWith(q) || (typoLimit(q) > 0 && within(q, w, typoLimit(q)));
const phraseIn = (phrase: string, text: string) => ` ${norm(text)} `.includes(` ${phrase} `);

/** The related words for one query word or phrase, including near-misspellings of them. */
function related(term: string): string[] {
  const out = new Set<string>();
  for (const group of RELATED_WORDS) {
    if (group.some((g) => g === term || (!g.includes(' ') && term.length >= 3 && (g.startsWith(term) || (typoLimit(term) > 0 && within(term, g, typoLimit(term))))))) group.forEach((g) => out.add(g));
  }
  out.delete(term);
  return [...out];
}

export function searchPages<T extends SearchablePage>(pages: T[], query: string): PageMatch<T>[] {
  const q = norm(query);
  if (!q) return pages.map((page) => ({ page, score: 0 }));
  const meaningful = words(q).filter((w) => !FILLER.has(w));
  const terms = meaningful.length ? meaningful : words(q);
  // Two-word phrases such as "money in" or "end of day" are related words too.
  const phrases = [q, ...terms.slice(1).map((t, i) => `${terms[i]} ${t}`)].filter((p, i, a) => a.indexOf(p) === i);
  const out: PageMatch<T>[] = [];
  for (const page of pages) {
    const label = norm(page.label), labelWords = words(page.label), keywords = (page.keywords ?? []).map(norm), keywordWords = keywords.flatMap(words);
    let score = 0; let reason: string | undefined;
    if (label === q) score = 1000;
    else if (label.startsWith(q)) score = 800;
    else if (terms.every((t) => labelWords.some((w) => wordMatches(t, w)))) score = 600;
    else if (keywords.some((k) => k === q || phraseIn(q, k))) { score = 450; reason = keywords.find((k) => k === q || phraseIn(q, k)); }
    else if (terms.every((t) => labelWords.some((w) => wordMatches(t, w)) || keywordWords.some((w) => wordMatches(t, w)))) {
      score = 350; reason = keywords.find((k) => terms.some((t) => words(k).some((w) => wordMatches(t, w))));
    } else if (terms.every((t) => norm(page.group).split(' ').some((w) => wordMatches(t, w)))) score = 150;
    if (!score) {
      // Related words: "income" → sales, revenue…; every query word (or a phrase) must lead somewhere on the page.
      const haystack = [label, ...keywords];
      const hit = (alts: string[]) => alts.find((a) => haystack.some((h) => phraseIn(a, h) || (!a.includes(' ') && words(h).some((w) => w === a))));
      const viaPhrase = phrases.map((p) => ({ p, h: hit(related(p)) })).find((x) => x.h);
      const perTerm = terms.map((t) => hit(related(t)) ?? (labelWords.concat(keywordWords).some((w) => wordMatches(t, w)) ? t : undefined));
      if (viaPhrase) { score = 250; reason = `related to “${viaPhrase.p}”`; }
      else if (perTerm.every(Boolean)) { score = 200; reason = `related to “${q}”`; }
    }
    if (score) out.push({ page, score, reason });
  }
  // Same score: keep the menu order, so results read like the menu.
  return out.map((m, i) => ({ m, i })).sort((a, b) => b.m.score - a.m.score || a.i - b.i).map((x) => x.m);
}
