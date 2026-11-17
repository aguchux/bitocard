#!/usr/bin/env sh
# A product's Cloudflare Origin CA certificate, for its apex and wildcard (bitocard.com and *.bitocard.com; udozo.com
# and *.udozo.com), with its private key made here: the key never leaves this machine, Cloudflare signs a request
# (CSR) and only the certificate, which is public, travels. Written to deploy/k8s/<product>/env/origin.key and
# origin.pem (git-ignored, mode 600), which become the Secret <product>-tls (the product's kustomization.yaml).
#
#   sh deploy/k8s/origin-cert.sh <bitocard|udozo> csr
#       makes origin.key (once) and prints the CSR. In Cloudflare, on that product's zone: SSL/TLS > Origin Server >
#       Create Certificate > "Use my private key and CSR", paste it, keep the hostnames "<domain>, *.<domain>",
#       validity 15 years, Create; copy the certificate (PEM).
#   sh deploy/k8s/origin-cert.sh <bitocard|udozo> install [certificate.pem]
#       reads Cloudflare's certificate (from the file, or paste it then Ctrl-D), checks it and installs it.
#   sh deploy/k8s/origin-cert.sh <bitocard|udozo> show
#       what is installed: hostnames and expiry.
# Then apply (deploy/k8s/deploy.sh): Traefik picks the new Secret up by itself.
set -eu
product="${1:-}"
case "$product" in
  bitocard) domain=bitocard.com ;;
  udozo) domain=udozo.com ;;
  *) echo "usage: origin-cert.sh <bitocard|udozo> csr | install [file] | show" >&2; exit 2 ;;
esac
dir="$(cd "$(dirname "$0")" && pwd)/$product/env"
key="$dir/origin.key"
cert="$dir/origin.pem"
umask 077
# Git Bash on Windows would rewrite "/CN=..." as a path.
export MSYS2_ARG_CONV_EXCL="/CN="
mkdir -p "$dir"

case "${2:-}" in
  csr)
    [ -f "$key" ] || openssl ecparam -name prime256v1 -genkey -noout -out "$key"
    chmod 600 "$key"
    openssl req -new -key "$key" -subj "/CN=$domain" -addext "subjectAltName=DNS:$domain,DNS:*.$domain"
    ;;
  install)
    [ -f "$key" ] || { echo "No $key yet: run 'origin-cert.sh $product csr' first." >&2; exit 1; }
    new="$cert.new"
    if [ -n "${3:-}" ]; then cp "$3" "$new"; else cat > "$new"; fi
    fail() { rm -f "$new"; echo "$1: nothing changed." >&2; exit 1; }
    openssl x509 -in "$new" -noout 2>/dev/null || fail "Not a PEM certificate"
    [ "$(openssl x509 -in "$new" -noout -pubkey)" = "$(openssl pkey -in "$key" -pubout)" ] ||
      fail "The certificate is not for this key (was it made from this machine's CSR for $product?)"
    for host in "$domain" "shq.$domain"; do
      openssl x509 -in "$new" -noout -checkhost "$host" | grep -q 'does match' || fail "The certificate does not cover $host"
    done
    openssl x509 -in "$new" -noout -checkend 2592000 >/dev/null || fail "The certificate expires within 30 days"
    mv "$new" "$cert"
    chmod 600 "$cert"
    openssl x509 -in "$cert" -noout -subject -issuer -enddate
    echo "Installed $cert. Apply it: sh deploy/k8s/deploy.sh <commit> $product"
    ;;
  show)
    [ -f "$cert" ] || { echo "No certificate installed for $product." >&2; exit 1; }
    openssl x509 -in "$cert" -noout -subject -issuer -enddate -ext subjectAltName
    ;;
  *)
    echo "usage: origin-cert.sh <bitocard|udozo> csr | install [file] | show" >&2
    exit 2
    ;;
esac
