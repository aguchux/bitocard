# One image per Next.js app (BitoCard's and Udozo's frontends) for the Kubernetes cluster (deploy/k8s). Built by
# .github/workflows/k8s-images.yml from the repository root, for example:
#   docker build -f deploy/k8s/web.Dockerfile --build-arg APP=@bitocard/storefront --build-arg APP_DIR=apps/storefront \
#     --build-arg SITE_URL=https://bitocard.com -t bitocard-storefront .
#
# The apps pick their production addresses only on Vercel (`process.env.VERCEL`); here they are given explicitly, at
# build time (metadata, redirects and prerendered pages read them) and again at run time (deploy/k8s/env/*.env).
# Browser code needs nothing: NEXT_PUBLIC_* fall back to the production API and sites.

FROM node:22-alpine AS prune
ARG APP
WORKDIR /repo
COPY . .
RUN test -n "$APP" && npx --yes turbo@2.11.5 prune "$APP" --docker \
  # The docs read the API's OpenAPI document, which is not a workspace dependency.
  && mkdir -p out/full/apps/api && cp apps/api/openapi.json out/full/apps/api/openapi.json

FROM node:22-alpine AS build
ARG APP
ARG APP_DIR
# Addresses baked in at build time (empty: left unset).
ARG SITE_URL=""
ARG API_URL=""
ARG STOREFRONT_URL=""
ARG LEGALS_URL=""
ARG SHQ_URL=""
ARG SHOP_URL=""
ARG UDOZO_URL=""
ARG CONNECT_URL=""
ARG POS_URL=""
ARG NEXT_PUBLIC_VERIFY_BRAND=""
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ .
RUN set -e; \
  for name in SITE_URL API_URL STOREFRONT_URL LEGALS_URL SHQ_URL SHOP_URL UDOZO_URL CONNECT_URL POS_URL NEXT_PUBLIC_VERIFY_BRAND; do \
    value=$(eval "echo \$$name"); [ -n "$value" ] || unset "$name"; \
  done; \
  npx turbo run build --filter="$APP"

FROM node:22-alpine
ARG APP_DIR
ARG NEXT_PUBLIC_VERIFY_BRAND=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/${APP_DIR}
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node /repo/node_modules/next/dist/bin/next start --port \"$PORT\" --hostname 0.0.0.0"]
