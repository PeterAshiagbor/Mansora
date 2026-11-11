# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci && npm run build -w @mansora/desktop && npm run build -w @mansora/admin-web && \
    node scripts/staging/build.mjs && node scripts/railway/build.mjs && \
    npm prune --ignore-scripts --omit=dev --workspace=@mansora/desktop --include-workspace-root=false && \
    mkdir -p /runtime/app/railway /runtime/app/staging /runtime/app/ui/client /runtime/app/ui/admin /runtime/data && \
    cp -a node_modules /runtime/app/ && cp -a dist/railway/. /runtime/app/railway/ && cp -a dist/staging/. /runtime/app/staging/ && \
    cp infrastructure/railway/entrypoint.mjs /runtime/app/railway/ && \
    cp -a apps/desktop/dist/renderer/. /runtime/app/ui/client/ && cp -a apps/admin-web/dist/. /runtime/app/ui/admin/
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 MANSORA_STAGING_MODE=team-test STAGING_CLIENT_DIR=/app/ui/client STAGING_ADMIN_DIR=/app/ui/admin
COPY --from=build /runtime /
WORKDIR /app
# Entrypoint repairs the fresh volume's ownership, then drops to UID/GID 1000 before importing application code.
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/railway/entrypoint.mjs"]
