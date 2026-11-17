# BitoCard and Udozo on Kubernetes

Both products' APIs, schedulers, frontends and Redis run on DigitalOcean Kubernetes (the `golojancluster`, NYC3), in
the namespace `bitocard`. Each product has its own directory. The databases stay on Neon.

```
deploy/k8s/
  kustomization.yaml   everything: shared, bitocard, udozo
  shared/              the namespace, the Let's Encrypt issuer, the image pull secret, the apps' network policy
  bitocard/            api.bitocard.com, bitocard.com (and resellers' store subdomains), shq, admin, legals, docs, verify
  udozo/               api.udozo.com, udozo.com (store subdomains and own domains), shq, admin, connect, pos, verify
  */env/               settings and secrets: *.env never committed, *.env.example committed
  bootstrap/           Traefik and cert-manager, once per cluster
  generate.mjs         writes every product's manifests and images.json from one list
  web.Dockerfile       the image of any Next.js app
  init-env.sh          copies each missing env file from its example
  deploy.sh            applies, pinned to one commit's images
```

Never edit the generated files by hand: `api.yaml`, `frontends.yaml`, `redis.yaml`, `ingress.yaml`, `certificate.yaml`,
each product's `kustomization.yaml`, and `images.json`. Change `generate.mjs`, run `node deploy/k8s/generate.mjs`, and
commit what it wrote.

## Settings and secrets

Every value comes from kustomize generators over `<shared|bitocard|udozo>/env/*.env`:

| File | Becomes | Holds |
|---|---|---|
| `shared/env/cluster.config.env` | (replacement) | `ACME_EMAIL`, Let's Encrypt's contact |
| `shared/env/cloudflare.secret.env` | Secret `cloudflare-api-token` | the DNS-01 token |
| `shared/env/ghcr.dockerconfigjson` | Secret `ghcr` | pulls the private images |
| `<product>/env/api.config.env` | ConfigMap `<product>-api-config` | origins, cookies, rate limits, Redis's address |
| `<product>/env/api.secret.env` | Secret `<product>-api-secrets` | `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `STORE_SERVER_SECRET`… |
| `<product>/env/web.config.env` | ConfigMap `<product>-web-config` | the addresses the frontends' servers use |
| `<product>/env/web.secret.env` | Secret `<product>-web-secrets` | `STORE_SERVER_SECRET` |
| `<product>/env/redis.secret.env` | Secret `redis-<product>-secrets` | Redis's password and REST token |

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

1. **Grow the node pool.** One node of 2 vCPUs and 4 GB (about 2.9 GB allocatable) cannot hold everything. The pods ask
   for about 3 GB of memory before DigitalOcean's own system pods. Use at least 3 nodes of `s-2vcpu-4gb`, or turn on
   the pool's autoscaler.
2. **Install Traefik and cert-manager:**
   `KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/bootstrap/install.sh`.
   It prints the load balancer's address.
3. **Fill in the settings:** run `sh deploy/k8s/init-env.sh`, then fill in every file it lists.
4. **Build the images:** run GitHub Actions > **Kubernetes images** > Run workflow. It pushes
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

## Redis

Each product has its own Redis: a StatefulSet with a password, an append-only file and a 5 GB volume that is kept if
the claim is deleted. Beside it runs serverless-redis-http, which speaks Upstash's REST protocol. So the APIs keep
their Upstash client: `UPSTASH_REDIS_REST_URL=http://redis-<product>` with the product's token. A network policy
lets only the product's own API reach its Redis.

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
