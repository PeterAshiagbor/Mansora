# Platform visual refinement — 12 November 2026

The owner requested a slight relationship to mansora-consulting.com, while keeping the platform style: gentle glows, clearer text and no unnecessary eyebrow labels. This work changes the existing client and administrator applications only.

The live website styles were reviewed at `/static/css/style.css` and `/static/css/enhance.css`. Its existing purple `#5c2d85`, deep purple `#38145c`, gold `#c48b17`, cream `#fffaf1`, ink `#221634` and muted `#5e5269` already match the platform brand tokens. Those tokens, bundled fonts/logo, page layout, navigation and component structure are preserved.

The shared surface now has a slightly warmer canvas and website-aligned text/border colours. Soft static purple shadows, a restrained gold active-navigation marker and faint purple/gold sign-in backgrounds provide depth. There are no animated or pulsing glows, new assets, remote fonts or dependencies. Existing reduced-motion, forced-colour, focus and print rules remain.

Sign-in wording is shorter and clearer. Redundant labels above the administrator sign-in heading, dashboard metrics and sign-in story headline are removed. Useful navigation group names, workspace identity, metric labels, date context and security notices remain.

Verification: interface/API build and TypeScript checks passed. The existing branding, progressive-interface and accessibility suites passed all 19 browser tests, with no skipped tests. They cover desktop/mobile navigation, zoom-equivalent layouts, dialog and page accessibility, keyboard/focus behavior, local brand assets and tenant identity. Screenshots of sign-in, dashboard, products, sale, summary and administrator pages were inspected locally; synthetic records only. These changes are integrated onto C37 before publication, with combined CI required before merge.

No authentication behavior, permissions, financial calculations, test records or deployment mode is altered by this refinement.
