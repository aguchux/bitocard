#!/bin/sh
# Deploys one API image on the droplet: pull it, apply migrations from it, start it, wait until it is healthy.
# Run as the deploy user from /opt/bitocard (CI does this over SSH):
#   sh deploy.sh ghcr.io/aguchux/bitocard-api:<commit>
# Rolling back is deploying an earlier image: `sh deploy.sh $(sed -n 2p images.log)`.
#
# Udozo's API (api.udozo.com, docs/UDOZO_SPINOFF_PLAN.md) is the same image with its own database and secrets. It is
# deployed with BitoCard's once /etc/udozo/api.env exists: both environments are checked and both databases migrated
# before either instance is replaced, so a problem with either leaves both on the old image.
set -eu

IMAGE="${1:?usage: deploy.sh <image>}"
cd "$(dirname "$0")"

UDOZO=""
[ -f /etc/udozo/api.env ] && UDOZO=1

echo "[deploy] pulling $IMAGE"
# An image already loaded on the machine (`docker load`) may be deployed without the registry.
docker pull --quiet "$IMAGE" || docker image inspect "$IMAGE" >/dev/null

# The environment first: the database answers, ENCRYPTION_KEY opens the secrets already stored, Redis accepts its
# token, production's safety settings hold. Anything wrong stops here, before migrations, with the old image serving.
echo "[deploy] checking the environment"
API_IMAGE="$IMAGE" docker compose run --rm --no-deps api node scripts/check-env.mjs
if [ -n "$UDOZO" ]; then
  echo "[deploy] checking Udozo's environment"
  API_IMAGE="$IMAGE" docker compose --profile udozo run --rm --no-deps api-udozo node scripts/check-env.mjs
fi

# Migrations once, before the new code runs, with the API's own environment and network (Prisma's lock keeps a
# parallel run safe; the script retries a held lock). A failure stops here, with the old image still serving. Every
# migration runs on both databases; Udozo's then gets its product seed (scripts/product-seed.mjs).
echo "[deploy] applying migrations"
API_IMAGE="$IMAGE" docker compose run --rm --no-deps api node scripts/migrate-deploy.mjs
if [ -n "$UDOZO" ]; then
  echo "[deploy] applying migrations to Udozo's database"
  API_IMAGE="$IMAGE" docker compose --profile udozo run --rm --no-deps api-udozo node scripts/migrate-deploy.mjs
fi

# Compose reads API_IMAGE (and, with Udozo, COMPOSE_PROFILES) from .env, so a manual `docker compose up -d` later starts
# this same image and both products. Other settings there (API_MEMORY, API_HEAP_MB, UDOZO_API_MEMORY…) are kept.
{
  grep -v -e '^API_IMAGE=' -e '^COMPOSE_PROFILES=' .env 2>/dev/null || true
  printf 'API_IMAGE=%s\n' "$IMAGE"
  [ -n "$UDOZO" ] && printf 'COMPOSE_PROFILES=udozo\n'
  true
} > .env.new && mv .env.new .env

# Udozo's Caddy site, only once its certificate is installed (origin-cert.sh … udozo): Caddy refuses to start on a
# certificate file that is not there, and BitoCard must never wait for Udozo's.
mkdir -p sites-enabled
if [ -n "$UDOZO" ] && [ -f /etc/bitocard/certs/udozo-origin.pem ] && [ -f /etc/bitocard/certs/udozo-origin.key ]; then
  cp sites/udozo.caddy sites-enabled/udozo.caddy
else
  rm -f sites-enabled/udozo.caddy
fi

echo "[deploy] starting the API"
docker compose up -d --remove-orphans --wait --wait-timeout 180 api
if [ -n "$UDOZO" ]; then
  echo "[deploy] starting Udozo's API"
  docker compose up -d --wait --wait-timeout 180 api-udozo
  docker compose up -d scheduler-udozo
fi
docker compose up -d --remove-orphans scheduler caddy
# Caddy reloads its config only when told; a changed Caddyfile takes effect here.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true

# The droplet itself, end to end: the host through Caddy and the origin certificate (-k: Cloudflare's origin CA is
# trusted by Cloudflare, not by curl), healthy, serving this image's commit, as the product expected. This holds
# whatever DNS says.
commit=$(docker image inspect "$IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^GIT_COMMIT_SHA=//p' | cut -c1-7)
check() {
  host=$1 product=$2 health=""
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    health=$(curl -fsSk --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/health" || true)
    case "$health" in *'"status":"ok"'*) break ;; esac
    sleep 3
  done
  case "$health" in
    *"\"product\":\"$product\""*"\"commit\":\"$commit\""*) echo "[deploy] $host on this droplet: ok, commit $commit" >&2 ;;
    *) echo "[deploy] $host on this droplet is not serving $product at $commit healthily: $health" >&2; exit 1 ;;
  esac
  # Its database fingerprint (the only thing on stdout), to tell the two instances' databases apart.
  printf '%s' "$health" | sed -n 's/.*"database_id":"\([0-9a-f]*\)".*/\1/p'
}
# A failed check exits its subshell with 1, and set -e stops the deploy on the assignment.
bitocard_db=$(check api.bitocard.com bitocard)
if [ -f sites-enabled/udozo.caddy ]; then
  udozo_db=$(check api.udozo.com udozo)
  if [ -n "$bitocard_db" ] && [ "$bitocard_db" = "$udozo_db" ]; then
    echo "[deploy] api.bitocard.com and api.udozo.com use the same database ($udozo_db): fix /etc/udozo/api.env" >&2
    exit 1
  fi
elif [ -n "$UDOZO" ]; then
  echo "[deploy] Udozo's API is running, but api.udozo.com waits for its origin certificate (origin-cert.sh csr udozo)."
fi

# Newest first, for rollbacks. Only the last three API images are kept on disk (each is over 1 GB; a small droplet's
# disk would fill); older ones are pulled again from the registry if ever rolled back to.
{ echo "$IMAGE"; cat images.log 2>/dev/null || true; } | awk '!seen[$0]++' | head -20 > images.log.new && mv images.log.new images.log
sed -n '4,$p' images.log | while read -r old; do docker image rm "$old" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -af >/dev/null 2>&1 || true

echo "[deploy] done: $(docker compose ps --format '{{.Service}} {{.Status}}' | tr '\n' ';')"
