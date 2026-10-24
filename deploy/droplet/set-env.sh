#!/bin/sh
# Sets one variable in /etc/bitocard/api.env without it appearing on screen, in shell history or in a chat.
# From your own terminal (it asks for the value, hidden):
#   ssh -t deploy@<droplet> sh /opt/bitocard/set-env.sh ENCRYPTION_KEY
# Then `docker compose up -d --force-recreate api scheduler` (or the next deploy) uses it.
set -eu

NAME="${1:?usage: set-env.sh <NAME>}"
FILE=/etc/bitocard/api.env
case "$NAME" in *[!A-Z0-9_]*) echo "Not a variable name: $NAME" >&2; exit 2 ;; esac

printf '%s (hidden, then Enter): ' "$NAME"
stty -echo 2>/dev/null || true
IFS= read -r VALUE
stty echo 2>/dev/null || true
printf '\n'
[ -n "$VALUE" ] || { echo "Nothing entered; $NAME unchanged." >&2; exit 1; }

if [ "$NAME" = ENCRYPTION_KEY ]; then
  bytes=$(printf '%s' "$VALUE" | base64 -d 2>/dev/null | wc -c)
  [ "$bytes" -eq 32 ] || { echo "ENCRYPTION_KEY must be 32 bytes, base64-encoded (this is $bytes): unchanged." >&2; exit 1; }
fi

umask 077
{ grep -v "^$NAME=" "$FILE" 2>/dev/null || true; printf '%s=%s\n' "$NAME" "$VALUE"; } > "$FILE.new"
mv "$FILE.new" "$FILE"
chmod 600 "$FILE"
echo "$NAME set (${#VALUE} characters)."
