# BitoCard and Udozo on Kubernetes

Both products' APIs (each with its scheduler beside it) and frontends run on DigitalOcean Kubernetes (the
`golojancluster`, NYC3: one node, 2 vCPUs and 4 GiB), in the namespace `bitocard`. Each product has its own directory.
The databases stay on Neon and Redis on Upstash, as today.

```
deploy/k8s/
  kustomization.yaml   everything: shared, bitocard, udozo
  shared/              the namespace, the Let's Encrypt issuer, the image pull secret, the apps' network policy
  bitocard/            api.bitocard.com, bitocard.com (and resellers' store subdomains), shq, admin, legals, docs, verify
  udozo/               api.udozo.com, udozo.com (store subdomains and own domains), shq, admin, connect, pos, verify
  bootstrap/           Traefik and cert-manager (and their small sizes), once per cluster
  */env/               settings and secrets: *.env never committed, *.env.example committed
  generate.mjs         writes every product's manifests and images.json from one list
  web.Dockerfile       the image of any Next.js app
  init-env.sh          copies each missing env file from its example
  deploy.sh            applies, pinned to one commit's images
```

Never edit the generated files by hand: `api.yaml`, `frontends.yaml`, `ingress.yaml`, `certificate.yaml`,
each product's `kustomization.yaml`, and `images.json`. Change `generate.mjs`, run `node deploy/k8s/generate.mjs`, and
commit what it wrote.

## Settings and secrets

Every value comes from kustomize generators over `<shared|bitocard|udozo>/env/*.env`:

| File | Becomes | Holds |
|---|---|---|
| `shared/env/cluster.config.env` | (replacement) | `ACME_EMAIL`, Let's Encrypt's contact |
| `shared/env/cloudflare.secret.env` | Secret `cloudflare-api-token` | the DNS-01 token |
| `shared/env/ghcr.dockerconfigjson` | Secret `ghcr` | pulls the private images |
| `<product>/env/api.config.env` | ConfigMap `<product>-api-config` | origins, cookies, rate limits |
| `<product>/env/api.secret.env` | Secret `<product>-api-secrets` | `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `STORE_SERVER_SECRET`, its Upstash `UPSTASH_REDIS_REST_URL` and `_TOKEN`… |
| `<product>/env/web.config.env` | ConfigMap `<product>-web-config` | the addresses the frontends' servers use |
| `<product>/env/web.secret.env` | Secret `<product>-web-secrets` | `STORE_SERVER_SECRET` |

- **Protected.** `.gitignore` keeps every `deploy/k8s/*/env/*` out of git except the `*.example` files.
  `init-env.sh` creates the real files readable by their owner only (`chmod 600`).
- **Hashed names.** A product's generated names carry a hash of their contents, so a changed value rolls the pods
  that use it. The shared ones keep their exact names, because cert-manager and every pod find them by name.
- **Where the values come from:**
  - BitoCard's API: the droplet's `/etc/bitocard/api.env`, value for value.
  - Udozo's API: the Vercel project `udozo-api` (`vercel env pull`).
  - Never generate a new `ENCRYPTION_KEY`: it decrypts everything already stored.
  - `deploy.sh` refuses while any file is missing or blank.

## One-time setup

1. **Install Traefik and cert-manager:**
   `KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/bootstrap/install.sh`.
   It prints the load balancer's address.
2. **Fill in the settings:** run `sh deploy/k8s/init-env.sh`, then fill in every file it lists.
3. **Build the images:** run GitHub Actions > **Kubernetes images** > Run workflow. It pushes
   `ghcr.io/aguchux/<image>:<commit>` and `:latest` for all 14 images.

## Deploying

```
KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/deploy.sh <commit>            # everything
KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/deploy.sh <commit> udozo      # one product
kubectl -n bitocard get pods
```

Each API pod checks its settings and runs the migrations in its init container before it serves. Prisma's lock
stops two pods migrating at once. To roll back, run `deploy.sh` with an earlier commit.

## How requests arrive

Cloudflare (proxied) sends requests to the DigitalOcean load balancer, then Traefik, then the app's Service.

- **Proxy protocol:** the load balancer passes the real sender's address to Traefik.
- **Forwarded headers:** Traefik believes them only from Cloudflare's ranges (`bootstrap/traefik-values.yaml`). That
  is why the APIs use `TRUST_PROXY=2`.
- **Route order:**
  - exact hosts come first;
  - each product's wildcard, for resellers' store subdomains, is below them;
  - Udozo's catch-all, for live stores on their own domains, is last.
- **Certificates:** each product has a Let's Encrypt certificate for its apex and wildcard, issued by DNS-01 on
  Cloudflare.

## Sized for a low-traffic start

Everything fits on the one node (2 vCPUs, 4 GiB, about 2.9 GiB allocatable):

| | Asks for (memory) | Limit |
|---|---|---|
| DigitalOcean's own pods | about 580 MiB | |
| 12 frontends (Node.js heap capped at 160 MB) | 96 MiB each | 320 MiB |
| 2 APIs (heap 384 MB) with their schedulers beside them (heap 48 MB) | 216 MiB each | 736 MiB |
| Traefik (1 replica), cert-manager | about 130 MiB | |
| **Total** | **about 2.3 GiB** | |

That leaves about 0.7 GiB for a deploy:
- **APIs:** each starts its new pod first, so it never goes down.
- **Frontends:** each restarts in place, which costs a few seconds per app, so a deploy never needs room for a second
  copy of every app.

Every size is in `sizes` in `generate.mjs`. Once traffic grows:
1. Add nodes.
2. Raise the sizes.
3. Set the frontends' `rollout` to `surge`.
4. Set Traefik to 2 replicas.
5. Raise the replicas of the busiest apps.

## Redis

Each API keeps its own Upstash database, as on the droplet and Vercel. `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are in its `api.secret.env`. Nothing about Redis runs on the cluster.

## Moving over (still to do)

1. **DNS.** Point each host at the load balancer, proxied through Cloudflare. BitoCard's store subdomains are made
   one by one today (`StoreHostsService`, a DNS-only CNAME to Vercel). Replace them with one proxied
   `*.bitocard.com` record. Then stop the API adding each store to Vercel and Cloudflare.
2. **Resellers' own domains.**
   - Udozo's live stores and BitoCard's connected domains are on Vercel today (`VERCEL_STOREFRONT_PROJECT`).
   - The catch-all route serves them here. Their certificates need Cloudflare for SaaS: custom hostnames with this
     load balancer as the fallback origin.
   - The domain integration still writes to Vercel until that is built.
3. **Udozo's scheduled jobs.** Remove the Vercel project's crons once its API runs here. Every job is safe to run
   twice, but they should not run in both places for long.
4. **The droplet.** Stop BitoCard's droplet API once `api.bitocard.com` points here. Suppliers that allowlist an
   address (Remita) need the cluster's outgoing address: the nodes' public IPs, or a NAT gateway.
5. **Vercel.** Delete the projects only after a week on the cluster.
