#!/bin/sh
# Cloudflare's origin certificate for api.bitocard.com, with its private key made here: the key never leaves the
# droplet, Cloudflare signs a request (CSR) and only the certificate, which is public, travels.
#   sh /opt/bitocard/origin-cert.sh csr       makes origin.key (once) and prints the CSR to paste into Cloudflare
#   sh /opt/bitocard/origin-cert.sh install   reads Cloudflare's certificate (paste it, then Ctrl-D), checks it, installs it
set -eu

DIR=/etc/bitocard/certs
KEY=$DIR/origin.key
CERT=$DIR/origin.pem
HOST=api.bitocard.com
umask 077

case "${1:-}" in
  csr)
    [ -f "$KEY" ] || openssl ecparam -name prime256v1 -genkey -noout -out "$KEY"
    chmod 600 "$KEY"
    openssl req -new -key "$KEY" -subj "/CN=$HOST" -addext "subjectAltName=DNS:$HOST"
    ;;
  install)
    [ -f "$KEY" ] || { echo "No $KEY yet: run 'origin-cert.sh csr' first." >&2; exit 1; }
    new=$CERT.new
    cat > "$new"
    fail() { rm -f "$new"; echo "$1: nothing changed." >&2; exit 1; }
    openssl x509 -in "$new" -noout 2>/dev/null || fail "Not a PEM certificate"
    [ "$(openssl x509 -in "$new" -noout -pubkey)" = "$(openssl pkey -in "$KEY" -pubout)" ] ||
      fail "The certificate is not for this droplet's key (was it made from this droplet's CSR?)"
    openssl x509 -in "$new" -noout -checkhost "$HOST" | grep -q 'does match' || fail "The certificate does not cover $HOST"
    openssl x509 -in "$new" -noout -checkend 0 >/dev/null || fail "The certificate has expired"
    mv "$new" "$CERT"
    chmod 600 "$CERT"
    openssl x509 -in "$CERT" -noout -subject -issuer -enddate
    # Caddy reads the files at start and on reload; before the first deploy it is not running yet.
    docker compose -f /opt/bitocard/docker-compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
    echo "Installed $CERT."
    ;;
  *)
    echo "usage: origin-cert.sh csr | install" >&2
    exit 2
    ;;
esac
