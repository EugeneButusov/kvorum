# syntax=docker/dockerfile:1.7
#
# Single image for both backend services (api, indexer) and the migration job.
# The service is selected by the container command in Kubernetes:
#   api      → node dist/apps/api/main.js
#   indexer  → node dist/apps/indexer/main.js
#   migrate  → pnpm -w db:migrate && pnpm -w db:migrate:ch
#
# Why one image: apps webpack-bundle to dist/apps/<app>/main.js but EXTERNALIZE
# node_modules (required at runtime as commonjs), and the migration entrypoints run
# via tsx against the TS sources under libs/. Shipping the built workspace + full
# dependency tree keeps all three entrypoints working from one artifact.
#
# KNOWN-013: image ships devDependencies (tsx is needed by the migrate job) and the
# workspace source. A slimmer runtime that prunes to prod deps + precompiled
# migrations is a size optimisation deferred until image pull time becomes a concern.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate
WORKDIR /app

# ── Install + build ───────────────────────────────────────────────────────────
FROM base AS build
# Copy the whole workspace: the install graph spans every package.json under
# apps/*, libs/*, nest/* and the webpack build reads source from all of them.
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter api build && pnpm --filter indexer build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# Re-copy the built workspace under the unprivileged `node` user so tsx (migrate
# job) and the app processes can write caches/tmp without running as root.
COPY --chown=node:node --from=build /app /app
USER node
# Default command; overridden per-service by the Kubernetes Deployment/Job.
CMD ["node", "dist/apps/api/main.js"]
