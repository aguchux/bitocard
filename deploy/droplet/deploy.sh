#!/bin/sh
# Deploys one API image on the droplet: pull it, apply migrations from it, start it, wait until it is healthy.
# Run as the deploy user from /opt/bitocard (CI does this over SSH):
#   sh deploy.sh ghcr.io/aguchux/bitocard-api:<commit>
# Rolling back is deploying an earlier image: `sh deploy.sh $(sed -n 2p images.log)`.
set -eu

IMAGE="${1:?usage: deploy.sh <image>}"
cd "$(dirname "$0")"

echo "[deploy] pulling $IMAGE"
# An image already loaded on the machine (`docker load`) may be deployed without the registry.
docker pull --quiet "$IMAGE" || docker image inspect "$IMAGE" >/dev/null

# Migrations once, before the new code runs, with the API's own environment and network (Prisma's lock keeps a
# parallel run safe; the script retries a held lock). A failure stops here, with the old image still serving.
echo "[deploy] applying migrations"
API_IMAGE="$IMAGE" docker compose run --rm --no-deps api node scripts/migrate-deploy.mjs

# Compose reads API_IMAGE from .env, so a manual `docker compose up -d` later starts this same image. Other settings
# there (API_MEMORY, API_HEAP_MB) are kept.
{ grep -v '^API_IMAGE=' .env 2>/dev/null || true; printf 'API_IMAGE=%s\n' "$IMAGE"; } > .env.new && mv .env.new .env

echo "[deploy] starting the API"
docker compose up -d --remove-orphans --wait --wait-timeout 180 api
docker compose up -d --remove-orphans scheduler caddy
# Caddy reloads its config only when told; a changed Caddyfile takes effect here.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true

# Newest first, for rollbacks. Only the last three API images are kept on disk (each is over 1 GB; a small droplet's
# disk would fill); older ones are pulled again from the registry if ever rolled back to.
{ echo "$IMAGE"; cat images.log 2>/dev/null || true; } | awk '!seen[$0]++' | head -20 > images.log.new && mv images.log.new images.log
sed -n '4,$p' images.log | while read -r old; do docker image rm "$old" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -af >/dev/null 2>&1 || true

echo "[deploy] done: $(docker compose ps --format '{{.Service}} {{.Status}}' | tr '\n' ';')"
