# BitoCard and Udozo on Kubernetes

Both products' APIs (each with its scheduler beside it) and frontends run on DigitalOcean Kubernetes (the
`golojancluster`, NYC3: one node, 2 vCPUs and 4 GiB), in the namespace `bitocard`. Each product has its own directory.
The databases stay on Neon and Redis on Upstash, as today.

```
deploy/k8s/
  kustomization.yaml   everything: shared, bitocard, udozo
  shared/              the namespace, the Cloudflare Tunnel, the image pull secret, the apps' network policy
  bitocard/            api.bitocard.com, bitocard.com (and resellers' store subdomains), shq, admin, legals, docs, verify
  udozo/               api.udozo.com, udozo.com (store subdomains and own domains), shq, admin, connect, pos, verify
  bootstrap/           Traefik (and its small size), once per cluster
  */env/               settings and secrets: *.env never committed, *.env.example committed
  generate.mjs         writes every product's manifests and images.json from one list
  web.Dockerfile       the image of any Next.js app (its standalone output: NEXT_OUTPUT=standalone)
  init-env.sh          copies each missing env file from its example
  deploy.sh            applies, pinned to one commit's images
  affected.mjs         which images a push needs rebuilt (CI)
```

Never edit the generated files by hand: `api.yaml`, `frontends.yaml`, `ingress.yaml`,
each product's `kustomization.yaml`, and `images.json`. Change `generate.mjs`, run `node deploy/k8s/generate.mjs`, and
commit what it wrote.

## Settings and secrets

Every value comes from kustomize generators over `<shared|bitocard|udozo>/env/*.env`:

| File | Becomes | Holds |
|---|---|---|
| `shared/env/tunnel.secret.env` | Secret `cloudflare-tunnel` | `TUNNEL_TOKEN`, the Cloudflare Tunnel's token |
| `shared/env/registry.dockerconfigjson` | Secret `registry` | pulls the images from Docker Hub (`golojan`, a read-only access token) |
| `<product>/env/api.config.env` | ConfigMap `<product>-api-config` | origins, cookies, rate limits |
| `<product>/env/api.secret.env` | Secret `<product>-api-secrets` | `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `STORE_SERVER_SECRET`, its Upstash `UPSTASH_REDIS_REST_URL` and `_TOKEN`… |
| `<product>/env/web.config.env` | ConfigMap `<product>-web-config` | the addresses the frontends' servers use |
| `<product>/env/web.secret.env` | Secret `<product>-web-secrets` | `STORE_SERVER_SECRET` |

- **Protected.** `.gitignore` keeps every `deploy/k8s/*/env/*` out of git except the `*.example` files.
  `init-env.sh` creates the real files readable by their owner only (`chmod 600`).
- **Hashed names.** A product's generated names carry a hash of their contents, so a changed value rolls the pods
  that use it. The shared ones keep their exact names, because the pods find them by name.
- **Where the values come from:**
  - BitoCard's API: the droplet's `/etc/bitocard/api.env`, value for value.
  - Udozo's API: the Vercel project `udozo-api` (`vercel env pull`).
  - Never generate a new `ENCRYPTION_KEY`: it decrypts everything already stored.
  - `deploy.sh` refuses while any file is missing or blank (commented lines are fine).

## One-time setup

1. **Install Traefik:**
   `KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/bootstrap/install.sh`.
   It runs inside the cluster only: **no load balancer**, so nothing extra to pay for.
   **Load balancers and volumes are managed only through kubectl**, never DigitalOcean's control panel, whose
   changes the cluster's reconciler reverts (or which leave it unusable). Nothing here uses either.
2. **Create the Cloudflare Tunnel** (once, free): Cloudflare dashboard > Zero Trust > Networks > Tunnels > Create a
   tunnel > Cloudflared, name it `golojancluster`. Copy the token from the install command it shows (the long value
   after `--token`) into `shared/env/tunnel.secret.env`. Skip installing anything it offers: the cluster runs
   `cloudflared` itself (`shared/tunnel.yaml`).
3. **Fill in the settings:** run `sh deploy/k8s/init-env.sh`, then fill in every file it lists.
4. **Set up CI/CD** (`.github/workflows/docker-images.yml`), in the GitHub repository's settings:
   - secrets `DOCKERHUB_USERNAME` (`golojan`) and `DOCKERHUB_TOKEN` (a Docker Hub access token, Read & Write);
   - an environment `production` with the secret `K8S_KUBECONFIG` (the kubeconfig's whole text);
   - once the cluster runs everything, the variable `K8S_AUTO_DEPLOY` = `on`.
5. **Build the images:** Actions > **Docker images** > Run workflow (empty: all 14). It pushes
   `golojan/bitocard_<app>:<commit>` and `:latest` to Docker Hub.

## CI/CD

Every push to `main` builds and pushes only the images it affects (`affected.mjs`: an app's package and the
workspace packages it uses, by turbo's graph; all of them when the lockfile, `images.json` or `web.Dockerfile`
changed). With `K8S_AUTO_DEPLOY` on, the cluster is then rolled onto them: each Deployment is set to that commit's
image (an API's migrations run first, in its init container) and waited for. A Deployment not on the cluster yet
is skipped: the first apply, with its settings and secrets, is `deploy.sh` from a machine holding the env files.
Settings and secrets changes are also `deploy.sh`'s, never CI's. Run by hand, the workflow builds the images named
(or all) and deploys them when asked.

| App | Image |
|---|---|
| BitoCard's API, Udozo's API | `golojan/bitocard_api`, `golojan/bitocard_udozo_api` |
| BitoCard: storefront, shq, admin, legals, docs, verify | `golojan/bitocard_storefront` … `golojan/bitocard_verify` |
| Udozo: udozo.com, shq, admin, connect, pos, verify | `golojan/bitocard_udozo`, `golojan/bitocard_udozo_shq` … `golojan/bitocard_udozo_verify` |

## Deploying

```
KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/deploy.sh <commit>            # everything
KUBECONFIG=terraform/golojancluster-kubeconfig.yaml sh deploy/k8s/deploy.sh <commit> udozo      # one product
kubectl -n bitocard get pods
```

Each API pod checks its settings and runs the migrations in its init container before it serves. Prisma's lock
stops two pods migrating at once. To roll back, run `deploy.sh` with an earlier commit.

## How requests arrive

Visitor, then Cloudflare's edge (HTTPS, WAF, caching), then the **Cloudflare Tunnel**, then Traefik, then the app's
Service. The cluster has no load balancer and no public address: the tunnel's `cloudflared` pods
(`shared/tunnel.yaml`, two of them) connect *out* to Cloudflare, so nothing can reach the apps without going through
Cloudflare. It costs nothing.

- **HTTPS ends at Cloudflare.** Inside the cluster the tunnel brings plain HTTP to Traefik's `web` entry point, so
  there are no certificates to make or renew. Turn on **Always Use HTTPS** in each zone (Edge Certificates); the
  apps still see `X-Forwarded-Proto: https`.
- **The visitor's address:** Cloudflare puts it in `X-Forwarded-For`, and Traefik believes forwarded headers only from
  the cluster's own addresses (the tunnel's pods). The APIs count two hops (`TRUST_PROXY=2`: Traefik, then the tunnel).
- **Route order:**
  - exact hosts come first;
  - each product's wildcard, for resellers' store subdomains, is below them;
  - Udozo's catch-all, for live stores on their own domains, is last.

## The tunnel's public hostnames

In Cloudflare: Zero Trust > Networks > Tunnels > `golojancluster` > Public hostnames. Four entries, each to the
service **HTTP** `traefik.traefik.svc.cluster.local:80`, and Traefik sends each host to its app:

| Hostname | Covers |
|---|---|
| `bitocard.com` | the storefront |
| `*.bitocard.com` | every BitoCard subdomain (api, shq, admin, legals, docs, verify) and resellers' stores |
| `udozo.com` | udozo.com |
| `*.udozo.com` | every Udozo subdomain (api, shq, admin, connect, pos, verify) and resellers' stores |

Adding a hostname does not move any traffic: a host moves only when its DNS record does (below).

## Hosts and DNS

What Cloudflare serves now (checked 17 November 2026) and what each host becomes. **At the cut-over each host's
record becomes a proxied (orange) `CNAME` to the tunnel, `<tunnel id>.cfargotunnel.com`** (the tunnel's page shows
its id). A record can only point at the tunnel when it is proxied.

| Host | Today | Served here by |
|---|---|---|
| `bitocard.com` | A to Vercel, DNS only | storefront |
| `www.bitocard.com` | proxied (Vercel behind it) | storefront |
| `api.bitocard.com` | proxied, to the droplet | bitocard-api |
| `shq.bitocard.com` | CNAME to Vercel, DNS only | shq |
| `admin.bitocard.com` | CNAME to Vercel, DNS only | admin |
| `legals.bitocard.com` | CNAME to Vercel, DNS only | legals |
| `docs.bitocard.com` | CNAME to Vercel, DNS only | docs |
| `verify.bitocard.com` | CNAME to Vercel, DNS only | verify |
| `<store>.bitocard.com` | one DNS-only CNAME to Vercel per store (`StoreHostsService`) | storefront: one proxied `*.bitocard.com` CNAME to the tunnel replaces them |
| `udozo.com` | A to Vercel, DNS only | udozo |
| `www.udozo.com` | CNAME to Vercel, DNS only | udozo |
| `api.udozo.com` | CNAME to Vercel, DNS only | udozo-api |
| `shq.udozo.com` | CNAME to Vercel, DNS only | udozo-shq |
| `admin.udozo.com` | CNAME to Vercel, DNS only | udozo-admin |
| `connect.udozo.com` | CNAME to Vercel, DNS only | udozo-connect |
| `pos.udozo.com` | CNAME to Vercel, DNS only | udozo-pos |
| `verify.udozo.com` | CNAME to Vercel, DNS only | udozo-verify |
| `<store>.udozo.com` | one DNS-only CNAME per store | udozo: one proxied `*.udozo.com` CNAME to the tunnel replaces them |

The apex records (`bitocard.com`, `udozo.com`) become CNAMEs too: Cloudflare allows that at the apex (CNAME flattening).

**Not moving** (they stay on Vercel; keep their records as they are):
- `shop.bitocard.com`: a Vercel project with no app in this repository any more.
- `afrippa.com` and its subdomains: Afrippa's own zone and projects.

**Keep every other record:** mail (MX, SPF, DKIM, DMARC), the Resend and Google verification TXT records, and anything
else not in the table. The cut-over changes only the rows above.

**Order:** switch one host at a time, starting with `legals.bitocard.com`, and check each before the next. Switch an
API's host only once its pod is ready. To move a host back, point its record where it was.

## Sized for a low-traffic start

Everything fits on the one node (2 vCPUs, 4 GiB, about 2.9 GiB allocatable):

| | Asks for (memory) | Limit |
|---|---|---|
| DigitalOcean's own pods | about 580 MiB | |
| 12 frontends (Node.js heap capped at 160 MB) | 96 MiB each | 320 MiB |
| 2 APIs (heap 384 MB) with their schedulers beside them (heap 48 MB) | 216 MiB each | 736 MiB |
| Traefik (1 replica), the tunnel (2 `cloudflared`) | about 115 MiB | |
| **Total** | **about 2.2 GiB** | |

That leaves about 0.8 GiB for a deploy:
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

1. **DNS** (Hosts and DNS above): each host a proxied CNAME to the tunnel. Then replace each product's per-store
   CNAMEs with one proxied wildcard, and stop the APIs adding each store to Vercel and Cloudflare
   (`StoreHostsService`).
2. **Resellers' own domains.**
   - Udozo's live stores and BitoCard's connected domains are on Vercel today (`VERCEL_STOREFRONT_PROJECT`).
   - The catch-all route serves them here. Their certificates need Cloudflare for SaaS: custom hostnames with the
     tunnel's hostname as the fallback origin (a proxied record such as `fallback.udozo.com` pointing at the tunnel).
   - The domain integration still writes to Vercel until that is built.
3. **Udozo's scheduled jobs.** Remove the Vercel project's crons once its API runs here. Every job is safe to run
   twice, but they should not run in both places for long.
4. **The droplet.** Stop BitoCard's droplet API once `api.bitocard.com` points here. Suppliers that allowlist an
   address (Remita) need the cluster's outgoing address: the nodes' public IPs, or a NAT gateway.
5. **Vercel.** Delete the projects only after a week on the cluster.
