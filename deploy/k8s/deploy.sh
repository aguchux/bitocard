#!/usr/bin/env sh
# Applies BitoCard and Udozo to the cluster with every image pinned to one commit's (built by the Kubernetes images
# workflow), or `latest`. The committed kustomizations are never changed: a copy is pinned and applied.
#   KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/deploy.sh <commit|latest> [all|shared|bitocard|udozo]
# Then: kubectl -n bitocard rollout status deployment --watch=false; kubectl -n bitocard get pods
set -eu
tag="${1:?the commit whose images to run, or latest}"
part="${2:-all}"
here="$(cd "$(dirname "$0")" && pwd)"

# Nothing applied half set up: every env file present and filled in.
missing=$(cd "$here" && for example in shared/env/*.example bitocard/env/*.example udozo/env/*.example; do
  target="${example%.example}"; [ -s "$target" ] || echo "$target"; done)
[ -z "$missing" ] || { echo "Missing (run deploy/k8s/init-env.sh, then fill them in):" >&2; echo "$missing" >&2; exit 1; }
blank=$(cd "$here" && grep -lE '^[^#]*=$' shared/env/*.env bitocard/env/*.env udozo/env/*.env 2>/dev/null || true)
[ -z "$blank" ] || { echo "Still blank:" >&2; echo "$blank" >&2; exit 1; }
# Each product's Cloudflare Origin CA certificate and its key (deploy/k8s/origin-cert.sh).
nocert=$(cd "$here" && for product in bitocard udozo; do for file in origin.key origin.pem; do
  [ -s "$product/env/$file" ] || echo "$product/env/$file"; done; done)
[ -z "$nocert" ] || { echo "No Origin CA certificate (run deploy/k8s/origin-cert.sh <product> csr, then install):" >&2; echo "$nocert" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$here/." "$work/"
for product in bitocard udozo; do
  sed -i.bak "s/newTag: latest/newTag: ${tag}/" "$work/$product/kustomization.yaml"
done
target="$work"
[ "$part" = all ] || target="$work/$part"
kubectl apply -k "$target" --server-side --force-conflicts
