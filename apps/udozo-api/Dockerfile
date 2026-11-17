# Udozo's API image, for the Kubernetes cluster (deploy/k8s; until then Udozo's API runs on Vercel). Built by
# .github/workflows/k8s-images.yml from the repository root:
#   docker build -f apps/udozo-api/Dockerfile -t udozo-api .
# Migrations run before the new pods start (the Deployment's init container: `node scripts/migrate-deploy.mjs`), and
# the scheduler (`node scripts/scheduler.mjs`, vercel.json's crons) runs from the same image.

# Only Udozo's API and the workspace packages it uses, so other apps' changes never invalidate its layers.
FROM node:22-alpine AS prune
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.5 prune @udozo/api --docker

FROM node:22-alpine AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ .
RUN npx turbo run build --filter=@udozo/api

FROM node:22-alpine
ENV NODE_ENV=production PORT=3010 APP_PRODUCT=udozo
# ffmpeg re-encodes listing videos (src/classifieds/video.ts), dropping their metadata.
RUN apk add --no-cache ffmpeg
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/udozo-api
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
USER node
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3010) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main"]
