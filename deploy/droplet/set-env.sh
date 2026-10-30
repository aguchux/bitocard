#!/bin/sh
# Sets one variable in /etc/bitocard/api.env (or, with `udozo`, Udozo's /etc/udozo/api.env) without it appearing on
# screen, in shell history or in a chat. From your own terminal (it asks for the value, hidden):
#   ssh -t deploy@<droplet> sh /opt/bitocard/set-env.sh ENCRYPTION_KEY
#   ssh -t deploy@<droplet> sh /opt/bitocard/set-env.sh DATABASE_URL udozo
# Then `docker compose up -d --force-recreate api scheduler` (api-udozo scheduler-udozo), or the next deploy, uses it.
set -eu

NAME="${1:?usage: set-env.sh <NAME> [udozo]}"
case "${2:-bitocard}" in
  bitocard) FILE=/etc/bitocard/api.env SERVICE=api PROFILE="" ;;
  udozo) FILE=/etc/udozo/api.env SERVICE=api-udozo PROFILE="--profile udozo" ;;
  *) echo "usage: set-env.sh <NAME> [udozo]" >&2; exit 2 ;;
esac
case "$NAME" in *[!A-Z0-9_]*) echo "Not a variable name: $NAME" >&2; exit 2 ;; esac

printf '%s (hidden, then Enter): ' "$NAME"
stty -echo 2>/dev/null || true
IFS= read -r VALUE
stty echo 2>/dev/null || true
printf '\n'
# A terminal may pass a pasted line's carriage return and surrounding spaces along; no value here has them.
VALUE=$(printf '%s' "$VALUE" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
[ -n "$VALUE" ] || { echo "Nothing entered; $NAME unchanged." >&2; exit 1; }
case "$VALUE" in *[![:print:]]*)
  echo "$NAME came through with control characters (${#VALUE} characters), so it was not pasted: in Git Bash paste with right-click or Shift+Insert, not Ctrl+V. Unchanged." >&2
  exit 1 ;;
esac

if [ "$NAME" = ENCRYPTION_KEY ]; then
  # Decoded as the API decodes it (Node's base64: URL-safe letters and missing padding accepted). The value is stored as
  # entered, since order links are signed with the string itself.
  case "$VALUE" in *[!A-Za-z0-9+/=_-]*)
    echo "ENCRYPTION_KEY has characters base64 never uses (${#VALUE} characters received): unchanged." >&2
    exit 1 ;;
  esac
  b64=$(printf '%s' "$VALUE" | tr -d '=' | tr -- '-_' '+/')
  case $((${#b64} % 4)) in 2) b64="$b64==" ;; 3) b64="$b64=" ;; esac
  bytes=$(printf '%s' "$b64" | base64 -d 2>/dev/null | wc -c)
  [ "$bytes" -eq 32 ] || { echo "ENCRYPTION_KEY must be 32 bytes, base64-encoded (this is $bytes, from ${#VALUE} characters): unchanged." >&2; exit 1; }
fi

umask 077
{ grep -v "^$NAME=" "$FILE" 2>/dev/null || true; printf '%s=%s\n' "$NAME" "$VALUE"; } > "$FILE.new"
mv "$FILE.new" "$FILE"
chmod 600 "$FILE"
echo "$NAME set (${#VALUE} characters)."

# Whether the key opens the secrets already stored (and the rest of the deploy check), with the newest API image here.
image=$(docker images ghcr.io/aguchux/bitocard-api --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -1)
if [ "$NAME" = ENCRYPTION_KEY ] && [ -n "$image" ] && [ -f /opt/bitocard/docker-compose.yml ]; then
  echo "Checking it against the database..."
  API_IMAGE="$image" docker compose -f /opt/bitocard/docker-compose.yml $PROFILE run --rm --no-deps "$SERVICE" node scripts/check-env.mjs 2>&1 | grep '\[env\]' || true
fi
