#!/usr/bin/env sh
# Once per cluster, before `kubectl apply -k deploy/k8s`: Traefik, which routes by host. No load balancer: requests
# arrive through the Cloudflare Tunnel (deploy/k8s/shared/tunnel.yaml). Safe to run again: it upgrades Traefik.
# Needs kubectl and helm, with KUBECONFIG set to the cluster.
#   KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/bootstrap/install.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
# The chart version these values were checked against (traefik-values.yaml follows its schema).
TRAEFIK_CHART_VERSION="${TRAEFIK_CHART_VERSION:-42.4.0}"
pin() { [ -n "$1" ] && printf -- '--version %s' "$1" || true; }

helm repo add traefik https://traefik.github.io/charts >/dev/null
helm repo update >/dev/null

# shellcheck disable=SC2046
helm upgrade --install traefik traefik/traefik --namespace traefik --create-namespace \
  $(pin "$TRAEFIK_CHART_VERSION") --values "$here/traefik-values.yaml" --wait

# cert-manager was used before the Origin CA certificates; remove it if an earlier run installed it.
if helm status cert-manager --namespace cert-manager >/dev/null 2>&1; then
  helm uninstall cert-manager --namespace cert-manager
  kubectl delete namespace cert-manager --ignore-not-found
fi

echo
echo "Traefik is ready, inside the cluster only (no load balancer):"
kubectl get service traefik --namespace traefik
