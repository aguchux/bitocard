#!/bin/sh
# Copies the live BitoCard and Udozo databases into the local Postgres, then scrubs the copies (scrub.sql) so nothing
# done locally reaches a real person or provider. Read only on the live side: pg_dump never writes to the source.
# Run by `npm run local:refresh` in the `refresh` service (postgres:17-alpine), with the source addresses from
# .env.docker. Usage: refresh.sh [bitocard|udozo]... (both when none is named).
set -eu

direct() {
  # Neon's pooled address (-pooler) cannot run pg_dump's snapshot; its direct host can.
  echo "$1" | sed -e 's/-pooler\././' -e 's/[?&]pgbouncer=true//'
}

copy() {
  name="$1"; source="$2"
  if [ -z "$source" ]; then
    echo "[refresh] $name: no source address in .env.docker; skipped"
    return
  fi
  echo "[refresh] $name: copying the live database (read only)"
  dump="/tmp/$name.dump"
  pg_dump "$(direct "$source")" --schema=public --no-owner --no-acl --format=custom --file="$dump"

  psql -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" -c "CREATE DATABASE \"$name\""
  # The new database already has its public schema; pg_trgm (used by indexes) is created here, so the restore leaves
  # out the dump's own schema, extension and comment entries.
  psql -q -v ON_ERROR_STOP=1 -d "$name" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public'
  pg_restore -l "$dump" | grep -v -E ' (SCHEMA|EXTENSION|COMMENT) - ' > "$dump.list"
  pg_restore --no-owner --no-acl --exit-on-error --use-list="$dump.list" -d "$name" "$dump"
  rm -f "$dump.list"
  rm -f "$dump"

  echo "[refresh] $name: scrubbing the copy"
  psql -q -v ON_ERROR_STOP=1 -d "$name" -f /scripts/scrub.sql
  echo "[refresh] $name: done ($(psql -tA -d "$name" -c 'SELECT count(*) FROM _prisma_migrations') migrations applied on live)"
}

targets="${*:-bitocard udozo}"
for target in $targets; do
  case "$target" in
    bitocard) copy bitocard "${SOURCE_BITOCARD_DATABASE_URL:-}" ;;
    udozo) copy udozo "${SOURCE_UDOZO_DATABASE_URL:-}" ;;
    *) echo "[refresh] unknown database: $target (bitocard or udozo)"; exit 1 ;;
  esac
done
