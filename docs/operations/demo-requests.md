# C39 — demo requests and administrator Leads

This is intake in the existing Mansora application, separate from the corporate website repository. It does not provision a workspace, create a subscription, charge money or send mail. After explicit contact consent, the administrator manually reviews a prospect under **Leads**, with New, Contacted, Qualified and Closed states. Qualifying never creates a client automatically.

The public form is available at `/api/v1/public/demo-request-form` through the gateway, or `/v1/public/demo-request-form` on a standalone API. It has labels, browser validation and a no-script HTML submission/result path. Do not embed it as an iframe: Mansora's existing anti-framing headers remain intact. A corporate page can instead embed its own ordinary HTML form posting to the public endpoint:

```html
<form method="post" action="https://app.mansora-consulting.com/api/v1/public/demo-requests">
  <input type="hidden" name="format" value="html">
  <label>Your name <input name="name" required maxlength="100"></label>
  <label>Business <input name="business" required maxlength="160"></label>
  <label>Email <input name="email" type="email" required maxlength="200"></label>
  <label>Phone (optional) <input name="phone" type="tel" maxlength="40"></label>
  <label>Request <textarea name="message" maxlength="1500"></textarea></label>
  <label><input type="checkbox" name="consent" value="yes" required> Contact me about this request.</label>
  <button type="submit">Request demo</button>
</form>
```

The corporate site's CSP must permit that form action. This change does not edit or publish that site. Native form navigation needs no broad CORS relaxation; authenticated administration retains its existing token checks. A JavaScript client served from an already allowed origin may POST JSON with `consent: true`; an optional UUID `id` makes retries idempotent. Reusing an ID never overwrites the original content. JSON success is a generic 202 without a lead ID or email-existence signal. HTML success redirects to a generic receipt page. A request is not a promise of immediate contact.

## Bounds and access

- Server-side 8 KB body limit; bounded name/business/email/phone/message fields; strict allowed input fields and actual consent required.
- Thirty submissions per observed client IP per hour and three per normalized-email hash per day, with bounded in-memory limiter state. Forwarded identity is trusted only through the API's explicit reviewed proxy configuration; arbitrary caller headers cannot override it. Counters reset on process restart, so edge controls may supplement them before a high-traffic launch.
- Optional hidden `website` honeypot returns the same generic acknowledgement without storing a request. It is a supplement, not a CAPTCHA or proof of identity.
- No outbound email is triggered, preventing an anonymous email relay. Consent does not verify ownership of the address; staff must verify identity before creating or discussing a client account.
- Administrator list/status updates require an active admin session. Responses are paginated at 50 rows. React escapes prospect text, and status changes are audited with lead ID/status only. Client tenant roles have no permission on the platform table.

Migration 6 creates `demo_requests`; no released migration was edited. Every new field is classified in the legal inventory and its retention proposal. Contact data and free text are personal data; use sample requests in team testing. No automatic retention/deletion period is silently selected by this feature. Hosting/legal/retention review remains required before a public business launch.

Validation includes actual public-form submission into the real API, administrator list/status update with script-like text rendered safely, no client/subscription/notification side effects, denied anonymous/tenant reads, idempotent IDs, consent/size/status/page validation, honeypot suppression and spoof-resistant per-address limits. Exact full-suite, CI and deployment evidence is recorded in the shared handoff.
