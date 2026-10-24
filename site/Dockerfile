# syntax=docker/dockerfile:1
# The site of rcllr. Build context is the repository root (Coolify: Base Directory "/",
# Dockerfile Location "site/Dockerfile"), because the site reads README, CHANGELOG and the CLI help.
# Node build (adapter-static), then a small Caddy server on port 3000, as on schmidbauer.dev.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# Manifests first for the layer cache; install only the site and what it needs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY site/package.json site/
# The site reads the CLI help from the workspace packages.
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile --filter site...
COPY . .
RUN pnpm --dir site build

FROM caddy:2-alpine
COPY site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/site/build /srv
EXPOSE 3000
