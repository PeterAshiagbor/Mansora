# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci && npm run build -w @mansora/desktop && npm run build -w @mansora/admin-web && node scripts/staging/build.mjs && \
    npm prune --ignore-scripts --omit=dev --workspace=@mansora/desktop --include-workspace-root=false && \
    mkdir -p /runtime/app/staging /runtime/app/ui/client /runtime/app/ui/admin /runtime/data/staging && \
    cp -a node_modules /runtime/app/ && cp -a dist/staging/. /runtime/app/staging/ && \
    cp -a apps/desktop/dist/renderer/. /runtime/app/ui/client/ && cp -a apps/admin-web/dist/. /runtime/app/ui/admin/ && \
    chown -R node:node /runtime/data && chmod 700 /runtime/data/staging
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4500 STAGING_DATA_DIR=/data/staging STAGING_CLIENT_DIR=/app/ui/client STAGING_ADMIN_DIR=/app/ui/admin
COPY --from=build /runtime /
WORKDIR /app
USER node:node
EXPOSE 4500
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:4500/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "/app/staging/server.cjs"]
