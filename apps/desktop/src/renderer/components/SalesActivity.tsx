import { money } from '../lib';
export function SalesActivity({ rows }: { rows: { day: string; net: number }[] }) {
  const days = rows.slice(-14), max = Math.max(1, ...days.map((d) => Math.abs(d.net)));
  return <figure aria-label="Daily net sales"><div>{days.map((d) => <div key={d.day} className="m-chart-row"><span>{d.day.slice(5)}</span><div className="m-chart-track" aria-hidden="true"><span style={{ width: `${Math.abs(d.net) / max * 100}%`, background: d.net < 0 ? '#b91c1c' : undefined }} /></div><span className="m-chart-value">{money(d.net)}</span></div>)}</div>{!days.length && <p className="py-8 text-center text-sm text-slate-600">No sales or refunds in this period.</p>}<figcaption className="mt-4 text-[11px] leading-relaxed text-slate-500">Net sales after refunds · latest 14 days with activity in the selected period. Dates without activity are omitted; negative amounts mean refunds exceeded sales.</figcaption></figure>;
}
