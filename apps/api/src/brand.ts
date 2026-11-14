/**
 * Mansora brand for everything the server shows or sends: emails and the public payment pages.
 * Colours and type follow packages/ui/src/brand.css (the brand specification used by the apps):
 * deep purple for headings and actions, gold for accents, cream backgrounds, DM Sans for text and
 * a serif display face for headings, and the official logo.
 */
import type { FastifyInstance } from 'fastify';
import { DM_SANS_LATIN_WOFF2_BASE64, LOGO_PNG_BASE64 } from './brand-assets';

export const BRAND = {
  purple900: '#38145c', purple800: '#4a2370', purple700: '#5c2d85', purple600: '#733e9f', purple100: '#efe3f8', purple50: '#f8f3fc',
  gold: '#c48b17', goldInk: '#9a6a0b', goldSoft: '#fff4d6', cream: '#fffaf1', ink: '#221634', muted: '#5e5269', line: '#e6dcef',
  sans: "'DM Sans', 'Segoe UI', Arial, sans-serif", display: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  company: 'Mansora Consulting & Business Solutions', product: 'Sales & Stock platform',
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Serves the logo and font used by emails and payment pages. Public, cacheable, no personal data. */
export function registerBrandRoutes(app: FastifyInstance): void {
  const logo = Buffer.from(LOGO_PNG_BASE64, 'base64'), font = Buffer.from(DM_SANS_LATIN_WOFF2_BASE64, 'base64');
  app.get('/brand/mansora-logo.png', async (_req, reply) => reply.header('cache-control', 'public, max-age=604800').header('cross-origin-resource-policy', 'cross-origin').type('image/png').send(logo));
  app.get('/brand/dm-sans-latin.woff2', async (_req, reply) => reply.header('cache-control', 'public, max-age=31536000, immutable').type('font/woff2').send(font));
}

// ------------------------------------------------------------------ payment pages
/**
 * A branded public page (payment link, payment result). `base` is where the API is reached from the browser,
 * for example "/api" behind the gateway or "" when served directly, so the logo and font resolve.
 */
export function brandPage(title: string, inner: string, o: { base?: string; notice?: string } = {}): string {
  const base = o.base ?? '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Mansora</title><style>
@font-face{font-family:'DM Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(${base}/brand/dm-sans-latin.woff2) format('woff2')}
*{box-sizing:border-box}body{margin:0;min-height:100vh;font:16px/1.55 ${BRAND.sans};color:${BRAND.ink};background:${BRAND.cream};background-image:radial-gradient(circle at 20% 0,${BRAND.purple50},transparent 55%);padding:24px 16px}
.wrap{max-width:480px;margin:6vh auto 0}.card{background:#fff;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;box-shadow:0 18px 40px -24px rgba(56,20,92,.45)}
.head{background:${BRAND.purple900};padding:20px 24px;display:flex;align-items:center;gap:14px;border-bottom:3px solid ${BRAND.gold}}
.head img{width:48px;height:48px;border-radius:10px;background:#fff}.word{font-family:${BRAND.display};color:#fff;font-size:22px;font-weight:600;letter-spacing:.08em;line-height:1.1}.word small{display:block;font-family:${BRAND.sans};font-size:12px;letter-spacing:0;color:#f6dea8;font-weight:600;margin-top:3px}
.body{padding:26px 24px 24px}h1{font-family:${BRAND.display};color:${BRAND.purple900};font-size:24px;line-height:1.25;margin:0 0 4px;font-weight:600}
.muted{color:${BRAND.muted};font-size:14px}.amt{font-size:38px;font-weight:700;color:${BRAND.purple900};margin:18px 0 2px;font-variant-numeric:tabular-nums}
.due{display:inline-block;background:${BRAND.purple50};color:${BRAND.purple700};border-radius:999px;padding:3px 12px;font-size:13px;font-weight:600}
button,.btn{display:block;width:100%;margin-top:22px;padding:15px;border:0;border-radius:10px;background:${BRAND.purple700};color:#fff;font:600 17px ${BRAND.sans};cursor:pointer;text-align:center;text-decoration:none}
button:hover,.btn:hover{background:${BRAND.purple800}}button:focus-visible,.btn:focus-visible{outline:3px solid ${BRAND.gold};outline-offset:2px}
button.alt{background:#fff;color:${BRAND.purple900};border:1px solid ${BRAND.purple100};margin-top:10px}
.notice{background:${BRAND.goldSoft};color:${BRAND.goldInk};border:1px solid #f0d58f;padding:9px 12px;border-radius:8px;margin-bottom:16px;font-weight:600;font-size:14px}
.secure{display:flex;gap:8px;align-items:flex-start;margin-top:16px;color:${BRAND.muted};font-size:13px}.secure b{color:${BRAND.purple700}}
.foot{text-align:center;color:${BRAND.muted};font-size:12px;margin:16px 0 0}.foot b{color:${BRAND.purple900}}
label{display:block;font-size:14px;margin-top:10px}input{width:100%;padding:10px;border:1px solid ${BRAND.line};border-radius:8px;font:inherit}
</style></head><body><div class="wrap"><div class="card"><div class="head"><img src="${base}/brand/mansora-logo.png" alt=""><div class="word">MANSORA<small>${esc(BRAND.product)}</small></div></div><div class="body">${o.notice ? `<div class="notice">${esc(o.notice)}</div>` : ''}${inner}</div></div><p class="foot"><b>${esc(BRAND.company)}</b><br>Payments are processed securely by our licensed payment provider.</p></div></body></html>`;
}

// ------------------------------------------------------------------ emails
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const CTA_RE = /^(Pay securely(?: here)?|Pay now|Pay online|Open this private link[^:]*|Shop address|Administration dashboard|Reset your password[^:]*):\s*(https?:\/\/\S+)\s*$/i;
const ROW_RE = /^\s*([A-Z][A-Za-z ()/'-]{1,34}):\s+(.+)$/;

function inline(text: string): string {
  return esc(text).replace(URL_RE, (u) => `<a href="${u}" style="color:${BRAND.purple700};text-decoration:underline">${u}</a>`);
}

/**
 * Turn a plain-text message into a branded HTML email. The text stays the source of truth (it is also sent as the
 * text part), so every existing message is branded without being rewritten:
 *  - "Pay securely: <link>" and similar lines become a button;
 *  - runs of "Label: value" lines become a details table (invoice number, amount, due date…);
 *  - other lines become paragraphs, with links kept clickable.
 */
export function brandEmailHtml(subject: string, text: string, o: { logoUrl?: string } = {}): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.split('\n').filter((l) => l.trim() !== '')).filter((b) => b.length);
  let preheader = '';
  const parts = blocks.map((lines) => {
    const cta = lines.length === 1 ? CTA_RE.exec(lines[0].trim()) : null;
    if (cta) {
      const label = /^pay/i.test(cta[1]) ? 'Pay securely' : cta[1].replace(/^Open this private link.*/i, 'Open the secure link');
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="border-radius:10px;background:${BRAND.purple700}"><a href="${cta[2]}" style="display:inline-block;padding:14px 26px;font:600 16px ${BRAND.sans};color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table><p style="margin:0 0 16px;font-size:12px;color:${BRAND.muted}">Or copy this link: <a href="${cta[2]}" style="color:${BRAND.purple700};word-break:break-all">${esc(cta[2])}</a></p>`;
    }
    const rows = lines.map((l) => ROW_RE.exec(l));
    if (lines.length >= 2 && rows.every(Boolean)) {
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;border:1px solid ${BRAND.line};border-radius:10px;border-collapse:separate;background:${BRAND.purple50}">${rows.map((m, i) =>
        `<tr><td style="padding:9px 14px;font-size:14px;color:${BRAND.muted};${i ? `border-top:1px solid ${BRAND.line};` : ''}">${esc(m![1])}</td><td align="right" style="padding:9px 14px;font-size:14px;font-weight:600;color:${BRAND.ink};${i ? `border-top:1px solid ${BRAND.line};` : ''}">${inline(m![2])}</td></tr>`).join('')}</table>`;
    }
    if (!preheader) preheader = lines.join(' ').replace(URL_RE, '').slice(0, 140);
    return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.ink}">${lines.map(inline).join('<br>')}</p>`;
  });
  const logo = o.logoUrl ? `<img src="${esc(o.logoUrl)}" width="44" height="44" alt="Mansora" style="display:block;border-radius:9px;background:#ffffff">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:${BRAND.sans};color:${BRAND.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden">
<tr><td style="background:${BRAND.purple900};padding:18px 24px;border-bottom:3px solid ${BRAND.gold}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${logo ? `<td style="padding-right:12px">${logo}</td>` : ''}<td><div style="font-family:${BRAND.display};font-size:20px;font-weight:600;letter-spacing:2px;color:#ffffff">MANSORA</div><div style="font-size:12px;font-weight:600;color:#f6dea8">${esc(BRAND.product)}</div></td></tr></table></td></tr>
<tr><td style="padding:26px 24px 10px"><h1 style="margin:0 0 18px;font-family:${BRAND.display};font-size:22px;line-height:1.3;font-weight:600;color:${BRAND.purple900}">${esc(subject)}</h1>${parts.join('\n')}</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid ${BRAND.line};background:${BRAND.purple50};font-size:12px;line-height:1.5;color:${BRAND.muted}"><strong style="color:${BRAND.purple900}">${esc(BRAND.company)}</strong><br>${esc(BRAND.product)} · This email was sent by Mansora. Reply to it if you need help.</td></tr>
</table></td></tr></table></body></html>`;
}
