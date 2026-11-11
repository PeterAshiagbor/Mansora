# Shared-browser operational boundaries

See ../../docs/operations/platform-hardening.md for the gateway controls and their acceptance evidence. Both the standalone staging image and the combined Railway image bundle the same gateway/import preflight. No new deployment variables or native bridge methods are required.

Default limits: 16 active route handlers, 128 sockets, 100 headers, 100 keep-alive requests per socket, 30-second request and 10-second header deadlines; health checks bypass handler admission. Imports have one shared processing slot and a 32 MB expanded XLSX limit. The native engine retains its existing file, authentication and permission limits. Increasing these limits requires reviewing the service's memory/CPU budget and rerunning the acceptance tests.

Railway's GitHub trigger must keep checkSuites=true. Keep the single replica and persistent /data volume. Do not print or publish private Railway variables or credential manifests. HTTPS-only HSTS and no-index headers apply to this team-test gateway, not the native desktop renderer.
