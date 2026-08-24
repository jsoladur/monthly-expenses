# syntax=docker/dockerfile:1.7
# ============================================================================
# Multi-stage Dockerfile for the Next.js BFF (ARCH §9, ADR-1).
# Stages:
#   1. deps     — install all dependencies (devDeps + deps)
#   2. builder  — build the standalone Next.js output + Drizzle artifacts
#   3. runner   — slim runtime image that runs the app and migrations
# ============================================================================

ARG NODE_VERSION=22.15.0

# ----------------------------------------------------------------------------
# 1. deps
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy lockfile + package manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc* ./

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
RUN pnpm install --frozen-lockfile

# ----------------------------------------------------------------------------
# 2. builder
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PHASE=phase-production-build

# Reuse the dependency tree from the previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
RUN npx next build --webpack

# ----------------------------------------------------------------------------
# 3. runner
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for runtime
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server + traced node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Carry the Drizzle migration files so the app can run them on boot
COPY --from=builder --chown=nextjs:nodejs /app/drizzle         ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts          ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres    ./node_modules/postgres

USER nextjs

EXPOSE 3000

# Default: run migrations, then start the server. Override CMD in compose if
# you need a different migration strategy.
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
