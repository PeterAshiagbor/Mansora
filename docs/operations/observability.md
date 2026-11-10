# API observability

C7 adds request correlation, safe JSON request logs, health probes, opt-in error reporting and authenticated Prometheus metrics. It does not configure a hosting provider, central log collector or production alert recipient.

## Request IDs and logs

Every handled request gets `x-request-id` in its response. A supplied ID is accepted only when it starts with a letter/digit, contains only letters, digits, `.`, `_`, `:` or `-`, and is at most 128 characters. Otherwise a UUID is generated. Error JSON includes the same `requestId`, including validation, authentication, missing-route and readiness errors. Use opaque identifiers; never put credentials or personal data in correlation headers.

The server enables JSON logging; `buildApp` can leave logging off for embedded use. Completion records contain `event`, `requestId`, HTTP method, registered route pattern, status and duration in milliseconds. Authenticated platform identity metadata adds `adminId`, or `tenantId`/`deviceId`; successful admin client routes also include their validated client ID. No identity is inferred from caller-supplied tenant/device headers. Identity lookup uses only platform metadata through `db.platform`, never business tables or a bypass of report consent. It is best-effort and omitted if the database cannot supply it; it adds a metadata lookup to authenticated requests after the response duration is measured.

Default raw request logging is disabled. Serializers exclude headers, bodies, query strings, credentials, event payloads and backup bytes. Errors retain only an allowlisted type and bounded code, never raw messages, stacks or SQL details. Unexpected HTTP errors are logged with correlation context. Existing internal sync failures retain their safe event identifier and a sanitized exception. This deliberately trades free-form debugging detail for privacy; reproduce with synthetic fixtures using the request ID and error code rather than adding production payload logging.

Log storage, access controls and retention are deployment choices still requiring the hosting/privacy review. Tenant/admin/device/request identifiers are linkable metadata and should be covered by that review.

## Health checks

- `GET /health/live`: the process is serving HTTP; no database query.
- `GET /health/ready`: checks database access under the runtime platform role; returns 503 with `DATABASE_UNAVAILABLE` and a request ID during an outage.
- `GET /health`: compatibility alias for readiness, preserving the existing deployment probe.

Liveness survives a database outage **after startup**. Startup still performs the existing administrator-MFA encryption-key verification against the database and fails closed if that cannot complete; C7 does not weaken it. These probes do not certify S3, hardware or the full external network.

## Prometheus metrics

Set `METRICS_TOKEN` to a separate random 32-256-character printable ASCII secret without spaces. Scrape `GET /metrics` with `Authorization: Bearer <token>`. An unset token disables the endpoint (404); missing/wrong credentials return 401. Credentials are compared using equal-length SHA-256 digests and constant-time comparison. The endpoint uses `Cache-Control: no-store` and standard security headers. Do not expose the secret in URLs or reuse device/admin tokens.

Metrics are in-memory per API process and reset on restart:

| Metric | Meaning |
| --- | --- |
| `mansora_http_requests_total{method,route,status}` | Completed requests, using registered route patterns; unmatched paths share one label. No raw URLs, customer IDs or request IDs become labels. |
| `mansora_http_request_duration_seconds` | Histogram by method/route, with cumulative buckets, count and sum; response duration excludes the subsequent identity lookup/log delivery. |
| `mansora_sync_events_accepted_total` | Accepted acknowledgements in successful sync responses, including acknowledged retries; not a count of unique applied financial operations. |
| `mansora_sync_events_rejected_total` | Explicit rejected acknowledgements. Unacknowledged retryable failures are not reclassified as rejections. |
| `mansora_login_failures_total` | 4xx responses from password and second-factor login routes, including validation and rate-limit failures. |

A scrape does not include itself until its response completes. Aggregate replicas in the collector; secure collector access and network paths in the deployment configuration.

## Optional error receiver

Set `ERROR_WEBHOOK_URL` to an HTTP(S) endpoint; use HTTPS for hosted deployments. Invalid URLs and URL credentials fail startup without echoing the configured value. Unset means no outbound error reporting. Unexpected HTTP 500 errors send only request correlation, registered route/method/status, known identity IDs and sanitized exception type/code. Expected application errors and internally caught retryable sync failures remain in request/error logs; they do not generate HTTP-500 webhook incidents.

Delivery is best-effort: no redirects, five-second timeout, at most eight concurrent deliveries, no durable queue or retries. Excess incidents are dropped while the cap is reached. A delivery failure emits a safe warning with the request ID; it does not expose the receiver URL/error body or change the application's response. Shutdown waits for bounded pending deliveries. The recipient must choose its own authentication (e.g. a private receiver or a secret URL), retention, access rules and deduplication using `requestId`; no third-party service is selected or contacted unless configured.

## Verification

Security tests cover request-ID bounds and propagation, unavailable-database health behavior, valid/invalid metrics authentication, counters/histograms, trusted identity context and ignored spoofed identity headers, disabled reporting, safe webhook delivery/failure, and captured logs/reports containing no login passwords, admin email, session/device/metrics tokens, event data, backup bytes or raw exception text. All receivers and fixtures use localhost or mocked fetch, never a production error service.
