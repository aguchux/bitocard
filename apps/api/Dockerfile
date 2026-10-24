# The API image. Built by CI (.github/workflows/deploy-api.yml) and run on the DigitalOcean droplet (deploy/droplet),
# and locally with `npm run docker:api`. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t bitocard-api .
# Migrations are their own step (`node scripts/migrate-deploy.mjs`), run once per deploy before the new image starts.

# Only the API and the workspace packages it uses, so other apps' changes never invalidate its layers.
FROM node:22-alpine AS prune
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.5 prune @bitocard/api --docker

FROM node:22-alpine AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ .
RUN npx turbo run build --filter=@bitocard/api

FROM node:22-alpine
ENV NODE_ENV=production PORT=3001
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/api
# The commit this image was built from, shown by /health.
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main"]
