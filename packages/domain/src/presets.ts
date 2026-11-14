/**
 * Business-type setup presets (acquisition spec PR-06, owner decision D04). One shared engine for every shop; a
 * preset only suggests a starting point using features that exist today: product categories (added if missing,
 * never removed or renamed), recommended settings the owner chooses to apply, and setup guidance pointing at real
 * pages. A preset never changes prices, stock, money rules or permissions, and never creates products, customers
 * or sales. Versioned, so later improvements can be offered without touching what a shop already set up.
 */
export const PRESET_IDS = ['retail', 'mini_mart', 'general_merchandise', 'wholesale', 'other'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export interface Preset {
  id: PresetId; version: number; label: string; summary: string;
  categories: string[];
  /** Recommended, not applied: the owner turns them on in Settings. */
  recommended: { allowNegativeStock: boolean; lockMinutes: number; maxDiscountPercent: number };
  /** Setup steps, each pointing at an existing page id. */
  guidance: { text: string; page: string }[];
}
const common = { allowNegativeStock: false, lockMinutes: 15 };
export const PRESETS: Record<PresetId, Preset> = {
  retail: {
    id: 'retail', version: 1, label: 'Retail shop', summary: 'Fast checkout, a tidy catalogue, regular stock counts and sales history.',
    categories: ['Groceries', 'Drinks', 'Toiletries', 'Household', 'Stationery', 'Other'],
    recommended: { ...common, maxDiscountPercent: 10 },
    guidance: [
      { text: 'Add your products with barcodes where they have one, so checkout is a scan.', page: 'products' },
      { text: 'Count your stock once a month (Stock → Stock count) to catch losses early.', page: 'stock' },
      { text: 'Review Sales history and the daily summary at the end of each day.', page: 'sales' },
    ],
  },
  mini_mart: {
    id: 'mini_mart', version: 1, label: 'Mini mart', summary: 'Barcode scanning, reordering before you run out, and cash and Mobile Money in one place.',
    categories: ['Provisions', 'Beverages', 'Dairy & frozen', 'Toiletries', 'Household', 'Snacks', 'Baby care', 'Other'],
    recommended: { ...common, maxDiscountPercent: 5 },
    guidance: [
      { text: 'Scan every product once when you add it (a USB scanner or the phone camera).', page: 'products' },
      { text: 'Set a reorder level on fast sellers; Stock → Needs reordering lists them with their supplier.', page: 'stock' },
      { text: 'Record Mobile Money with its transaction ID at the till, then match it to your MoMo statement.', page: 'statements' },
    ],
  },
  general_merchandise: {
    id: 'general_merchandise', version: 1, label: 'General merchandise', summary: 'Many kinds of goods: categories, suppliers, purchases and expenses kept in order.',
    categories: ['Electronics', 'Clothing', 'Kitchenware', 'Hardware', 'Cosmetics', 'Stationery', 'Other'],
    recommended: { ...common, maxDiscountPercent: 10 },
    guidance: [
      { text: 'Group your products into categories so reports show what sells.', page: 'categories' },
      { text: 'Record each delivery under Purchases & suppliers, so stock and cost prices stay right.', page: 'purchases' },
      { text: 'Record shop costs under Expenses to see real profit in Reports.', page: 'expenses' },
    ],
  },
  wholesale: {
    id: 'wholesale', version: 1, label: 'Wholesale', summary: 'Larger quantities, suppliers and purchases, and customers who buy on credit.',
    categories: ['Cartons', 'Bags & sacks', 'Bulk drinks', 'Bulk provisions', 'Household bulk', 'Other'],
    recommended: { ...common, maxDiscountPercent: 5 },
    guidance: [
      { text: 'Add products in the unit you sell (for example a carton), with its own price.', page: 'products' },
      { text: 'Record supplier deliveries under Purchases & suppliers.', page: 'purchases' },
      { text: 'Add credit customers with a phone number, and follow what they owe under Credit & repayments.', page: 'credit' },
    ],
  },
  other: {
    id: 'other', version: 1, label: 'Other / general', summary: 'A neutral start: add only what your business needs.',
    categories: ['General', 'Other'],
    recommended: { ...common, maxDiscountPercent: 0 },
    guidance: [
      { text: 'Add your products and opening stock.', page: 'products' },
      { text: 'Give each staff member their own login.', page: 'staff' },
    ],
  },
};
export const isPresetId = (v: unknown): v is PresetId => typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
