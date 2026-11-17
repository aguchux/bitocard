#!/usr/bin/env sh
# Once per cluster, before `kubectl apply -k deploy/k8s`: Traefik (the way in) and cert-manager (the certificates).
# Safe to run again: it upgrades both to the versions below. Needs kubectl and helm, with KUBECONFIG set to the cluster.
#   KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/bootstrap/install.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
TRAEFIK_CHART_VERSION="${TRAEFIK_CHART_VERSION:-}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-}"
pin() { [ -n "$1" ] && printf -- '--version %s' "$1" || true; }

helm repo add traefik https://traefik.github.io/charts >/dev/null
helm repo add jetstack https://charts.jetstack.io >/dev/null
helm repo update >/dev/null

# shellcheck disable=SC2046
helm upgrade --install traefik traefik/traefik --namespace traefik --create-namespace \
  $(pin "$TRAEFIK_CHART_VERSION") --values "$here/traefik-values.yaml" --wait

# shellcheck disable=SC2046
helm upgrade --install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace   $(pin "$CERT_MANAGER_VERSION") --values "$here/cert-manager-values.yaml" --wait

echo
echo "The load balancer's address (point the DNS records at it, proxied through Cloudflare):"
kubectl get service traefik --namespace traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}{"\n"}'
