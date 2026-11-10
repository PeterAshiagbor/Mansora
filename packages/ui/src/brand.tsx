/** Official website asset, used unchanged. Keep the client business identity separate. */
const logo = new URL('./assets/mansora-logo.webp', import.meta.url).href;
export function MansoraBrand({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center ${compact ? 'gap-2' : 'gap-3'}`} data-testid="mansora-brand">
      <img src={logo} alt="" width={compact ? 40 : 64} height={compact ? 40 : 64} className="shrink-0 rounded-md border border-brand-200 object-contain" />
      <div className="min-w-0">
        <div className={`inline-block border-b border-mansora-gold pb-0.5 font-display font-semibold tracking-wide ${compact ? 'text-lg' : 'text-2xl'} ${inverse ? 'text-white' : 'text-brand-900'}`}>MANSORA</div>
        <div className={`text-xs leading-snug ${inverse ? 'text-brand-100' : 'text-slate-600'}`}>Consulting &amp; Business Solutions</div>
        <div className={`mt-1 text-xs font-semibold ${inverse ? 'text-[#f6dea8]' : 'text-brand-700'}`}>Sales &amp; Stock platform</div>
      </div>
    </div>
  );
}
