# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --ignore-scripts --workspace=@mansora/api --workspace=@mansora/domain --include-workspace-root=false && \
    npm run build --workspace=@mansora/api && \
    npm exec --workspace=@mansora/api -- esbuild ../../infrastructure/admin-bootstrap.ts ../../infrastructure/check-runtime.ts --bundle --platform=node --format=esm --target=node22 --outdir=../../infrastructure/dist --packages=external --alias:@mansora/domain=../../packages/domain/src/index.ts && \
    npm prune --ignore-scripts --omit=dev --workspace=@mansora/api --workspace=@mansora/domain --include-workspace-root=false && \
    mkdir -p /runtime/app/apps/api /runtime/app/packages/domain /runtime/app/infrastructure /runtime/data/backups && \
    cp -a node_modules package.json /runtime/app/ && \
    cp -a apps/api/package.json apps/api/dist /runtime/app/apps/api/ && \
    cp -a packages/domain/package.json /runtime/app/packages/domain/ && \
    cp -a infrastructure/dist infrastructure/entrypoint.mjs infrastructure/healthcheck.mjs infrastructure/smoke.mjs /runtime/app/infrastructure/ && \
    find /runtime/app -type d -exec chmod 755 {} + && \
    find /runtime/app -type f -exec chmod 644 {} + && \
    chmod 700 /runtime/data/backups && chown -R node:node /runtime/data

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 BACKUP_DIR=/data/backups
COPY --from=build /runtime /
USER node:node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 CMD ["node", "/app/infrastructure/healthcheck.mjs"]
ENTRYPOINT ["node", "/app/infrastructure/entrypoint.mjs"]
CMD ["api"]
