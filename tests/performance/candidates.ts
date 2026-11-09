/** Rejected tuning experiment, opt-in on disposable benchmark stores only. */
export const REPORT_INDEX_CANDIDATES = `
CREATE INDEX sales_report_cover ON sales(created_at, total, discount_total, cashier_id);
CREATE INDEX sale_items_report_cover ON sale_items(sale_id, product_id, product_name, quantity, line_total, cost_snapshot);
CREATE INDEX payments_report_cover ON payments(sale_id, method, amount);
`;
