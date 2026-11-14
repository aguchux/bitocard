# syntax=docker/dockerfile:1.7
# The local copy of BitoCard and Udozo (docs/LOCAL_TESTING.md): both APIs and every web app built as for production,
# run together in one container by docker/local/run.mjs. Built by `npm run local:up` from the repository root.
# Build caches (npm, turbo, Next.js) are kept between builds, so a rebuild only redoes what changed.

FROM node:22-bookworm-slim AS prune
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.5 prune @bitocard/api @udozo/api @bitocard/storefront @bitocard/docs @bitocard/admin @bitocard/shq @bitocard/legals @bitocard/verify @udozo/web @udozo/shq @udozo/admin @udozo/connect @udozo/pos --docker

FROM node:22-bookworm-slim
# openssl for Prisma; ffmpeg re-encodes listing videos, as on the droplet.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ .
COPY docker/local/ docker/local/
# Each Next.js app's API and sibling addresses, baked into its browser code.
RUN node docker/local/run.mjs write-public
RUN --mount=type=cache,target=/repo/.turbo/cache \
    npx turbo run build --cache-dir=.turbo/cache --concurrency=3 \
      --filter=@bitocard/api --filter=@udozo/api --filter=@bitocard/storefront --filter=@bitocard/docs --filter=@bitocard/admin \
      --filter=@bitocard/shq --filter=@bitocard/legals --filter=@bitocard/verify --filter=@udozo/web --filter=@udozo/shq \
      --filter=@udozo/admin --filter=@udozo/connect --filter=@udozo/pos
EXPOSE 3000 3001 3002 3003 3004 3005 3006 3007 3010 3011 3012 3013 3014
CMD ["node", "docker/local/run.mjs"]
