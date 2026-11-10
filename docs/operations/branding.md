# Mansora provider branding

The owner supplied https://mansora-consulting.com and confirmed this is a SaaS
platform from Mansora to client businesses. Both interfaces use the official
MANSORA Consulting & Business Solutions identity. The client app labels its
workspace with the client business name; the provider dashboard says Platform
administration. Receipts continue to identify the client business as merchant.

## Assets and typography

Retrieved from the supplied site on 10 November 2026:

- Unchanged logo: `/static/images/MANSORA.webp`, stored in `packages/ui/src/assets/`.
- Desktop icon: `/static/images/logo-512.png`; favicon: `/static/images/favicon-32.png`.
- Site styles: purple `#5c2d85`, deep purple `#38145c`, gold `#c48b17`, cream `#fffaf1`, ink `#221634`. Gold is an accent; body text uses dark colors.
- DM Sans body text and a Georgia brand wordmark follow the site. The owner’s subsequent accounting-style UX request uses DM Sans for application headings. Latin/Latin Extended variable DM Sans fonts are bundled locally from Google Fonts v17; the SIL Open Font License is included with the sources, both web builds and the desktop package. The Georgia wordmark falls back to local serif fonts.

Shared tokens live in `packages/ui/src/brand.css`; the provider mark lives in
`brand.tsx`. There are no runtime requests to the company site or Google Fonts.
The locally bundled assets keep the desktop interface usable offline. The
font license does not license the company logo.

## Verification

`tests/e2e/branding.test.ts` exercises two isolated client workspaces and provider
administration using the real API and local encrypted desktop stores. It checks
client identities, local logo loading, body/heading fonts, primary button color,
font license delivery, zero external requests and zero browser errors. Screens
were visually reviewed at 1366 × 768. Full accessibility coverage is maintained
in the separate C5 task and must also pass on the combined review branch.

This change supplies product branding and provider/client positioning. It does
not choose hosting, legal ownership terms, subscription expiry enforcement,
automatic billing, or the discount ceiling. Those decisions remain recorded in
the decision log. Windows packaging is verified by CI; physical hardware and
code signing still require the owner's equipment and certificate.
