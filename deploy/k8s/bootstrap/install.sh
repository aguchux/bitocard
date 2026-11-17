#!/usr/bin/env sh
# Once per cluster, before `kubectl apply -k deploy/k8s`: Traefik, the way in. (Certificates need nothing installed:
# each product's is Cloudflare's Origin CA, a Secret from deploy/k8s/origin-cert.sh.) Safe to run again: it upgrades it.
# Needs kubectl and helm, with KUBECONFIG set to the cluster.
#   KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/bootstrap/install.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
TRAEFIK_CHART_VERSION="${TRAEFIK_CHART_VERSION:-}"
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
echo "The load balancer's address (point the DNS records at it, proxied through Cloudflare):"
kubectl get service traefik --namespace traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}{"\n"}'
