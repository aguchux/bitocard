# The API on a DigitalOcean droplet

`api.bitocard.com` moves from Vercel (project `bitocard-api`) to one DigitalOcean droplet. Everything else stays where
it is: the apps on Vercel, the database on Neon, Redis on Upstash, files on Spaces, DNS on Cloudflare. They all reach
the API at the same address, so nothing else changes.

```
visitor ──https──▶ Cloudflare (proxied, Full (strict)) ──https──▶ droplet: Caddy ──▶ api (Node, port 3001)
                                                                            scheduler ──▶ api /v1/cron/<job>
```

- **api**: the image from `apps/api/Dockerfile`, built by CI and kept in GitHub's registry as
  `ghcr.io/aguchux/bitocard-api:<commit>`.
- **scheduler**: the same image running `scripts/scheduler.mjs`. It calls the 25 jobs in `apps/api/cron.json` on
  their schedules (UTC), as Vercel Cron did, never starting a job still running.
- **caddy**: TLS with Cloudflare's origin certificate. It takes the visitor's address from `CF-Connecting-IP` only for
  requests from Cloudflare's ranges, and holds requests for up to 30 seconds while a deploy restarts the API.
- **Webhooks to resellers** are delivered straight after each change (the `database` transport) plus the `webhooks`
  job, as everywhere off Vercel. Vercel Queues is not used.
- **Deploys** (`.github/workflows/deploy-api.yml`): each push to `main` touching the API builds the image, applies
  migrations from it, starts it, waits until healthy, then smoke tests and checks the new commit is served.
- **Rollback**: Actions > Deploy API > Run workflow with an earlier image. Or on the droplet:
  `sh /opt/bitocard/deploy.sh $(sed -n 2p /opt/bitocard/images.log)`.

## 1. Create the droplet

- **Image:** Ubuntu 24.04 LTS. **Region:** NYC3, the nearest to the Neon database (AWS us-east-2).
- **Size:** Basic, 1 vCPU / 2 GB / 50 GB ($12) to start. The API uses about 220 MB, Caddy and the scheduler about 30 MB,
  and images are built in CI, never on the droplet. Each container's memory is capped (`docker-compose.yml`), so a
  runaway API restarts itself. Grow when needed (Growing, below).
- **SSH key:** your own, for root.
- Turn on **monitoring** and **backups** (weekly snapshots).
- Its public IPv4 address is the API's fixed outgoing address. Give it to suppliers who allowlist callers (Remita,
  and any other "IP not whitelisted" refusal). Keep the droplet; a new droplet has a new address.

## 2. Set it up (once)

On your machine, make the key CI deploys with: `ssh-keygen -t ed25519 -f bitocard-deploy -N "" -C "github-actions deploy"`.

Then on the droplet, as root:

```sh
curl -fsSL https://raw.githubusercontent.com/aguchux/bitocard/main/deploy/droplet/setup.sh -o setup.sh
sh setup.sh "$(cat bitocard-deploy.pub)"   # paste the public key's text
```

It installs Docker and creates the `deploy` user, `/opt/bitocard`, `/etc/bitocard` (secrets) and a swap file. It
also turns on automatic security updates and turns off SSH password logins.

## 3. The environment

`/etc/bitocard/api.env` (template: `api.env.example`) holds the same settings as the Vercel project `bitocard-api`.
Vercel never gives back variables marked Sensitive (`vercel env pull` writes `[SENSITIVE]`), so secrets come from where
they were first saved. Set each one without it showing anywhere, from your own terminal:

```sh
ssh -t deploy@<droplet> sh /opt/bitocard/set-env.sh ENCRYPTION_KEY
```

- **`ENCRYPTION_KEY`** must be exactly the production value. Every deploy first runs `scripts/check-env.mjs`, which
  refuses to go on unless the key opens the secrets already stored in the database, the database answers, Redis
  accepts its token, and `COOKIE_SECURE`, `ALLOWED_ORIGINS` (no `http://`) and `CRON_SECRET` (32 characters or more)
  are safe for production.
- **`STORE_SERVER_SECRET`** must equal the storefront project's own. If it is lost, set a new one (at least 32
  characters) on both: the droplet, and Vercel `bitocard-storefront` (redeploy it).
- **`AFRIPPA_SERVER_SECRET`** (optional until Afrippa's site is built): shared with Afrippa's server, which signs every
  request to Afrippa's routes (`/v1/afrippa/`) with it. At least 32 characters and never the same as
  `STORE_SERVER_SECRET` (the API refuses to start otherwise). Unset, Afrippa's routes stay closed.
- **`UPSTASH_REDIS_REST_TOKEN`**: Upstash console > the database > REST API (or Vercel > Storage > the Upstash store).
- **`CRON_SECRET`** is the droplet's own (only its scheduler sends it), a new random value.

## 4. TLS and Cloudflare

1. On the droplet, make the key and its signing request (the key never leaves the droplet):
   `ssh deploy@<droplet> sh /opt/bitocard/origin-cert.sh csr` prints the CSR (`-----BEGIN CERTIFICATE REQUEST-----`).
2. Cloudflare > bitocard.com > SSL/TLS > Origin Server > **Create certificate** > **Use my private key and CSR**: paste
   the CSR, hostname `api.bitocard.com` only, 15 years. Copy the certificate it shows (PEM).
3. Install it: `ssh deploy@<droplet> sh /opt/bitocard/origin-cert.sh install`, paste the certificate, then Ctrl-D. It
   refuses a certificate that is not for the droplet's key or does not cover `api.bitocard.com`, then reloads Caddy.
   The files are `/etc/bitocard/certs/origin.key` and `origin.pem`, mode 600, owned by `deploy`.
4. SSL/TLS > Overview: **Full (strict)**.
5. Cloudflare must not block or challenge the API's callers: suppliers', payment providers' and GitHub's webhooks, and
   resellers' servers.
   - Keep **Bot Fight Mode off**.
   - Add a WAF custom rule **Skip** (all remaining custom rules, Super Bot Fight Mode, managed rules) for
     `http.host eq "api.bitocard.com"`.
   - Turn off **Always Use HTTPS** rewrites only if a caller breaks; Caddy redirects HTTP itself.

## 5. DigitalOcean firewall

Networking > Firewalls > Create, applied to the droplet:

| Inbound | Sources |
|---|---|
| TCP 443 and 80 | Cloudflare's ranges only (https://www.cloudflare.com/ips/: every IPv4 and IPv6 line) |
| TCP 22 | your own address, and GitHub Actions (or 0.0.0.0/0 with keys only; `setup.sh` turned passwords off) |

Docker opens published ports past `ufw`, so this firewall (outside the droplet) is the one that counts. Outbound: all.

## 6. Connect CI

GitHub > the repository > Settings > Secrets and variables > Actions:

- **Variable** `API_DROPLET_HOST`: the droplet's address. Set it last: from then on every push deploys.
- **Secrets:**
  - `API_DROPLET_SSH_KEY`: the private key `bitocard-deploy`.
  - `API_DROPLET_KNOWN_HOSTS`: the output of `ssh-keyscan <droplet address>`.
- **Environment** `production`: optionally add yourself as a required reviewer before each deploy.

Then Actions > Deploy API > Run workflow (or push to `main`).

## 7. Check the droplet before moving the address

The first deploy ends with `deploy.sh` asking the droplet itself for `https://api.bitocard.com/health` through its own
Caddy and certificate, and failing unless it is healthy and serves the new commit. That holds while DNS still points at
Vercel. By hand, on the droplet:

- `curl -sk --resolve api.bitocard.com:443:127.0.0.1 https://api.bitocard.com/health` shows `"environment":"production"`,
  the commit and `"database":"ok"`.
- `docker compose -f /opt/bitocard/docker-compose.yml logs scheduler` shows each job `ok`.

## 8. Cutover (done 24 October 2026)

1. Cloudflare DNS: `api` became an **A record to `138.197.85.139`, proxied** (it was a DNS-only CNAME to Vercel).
2. Checked: `curl -sI https://api.bitocard.com/health` shows `server: cloudflare` and the droplet's commit, and Caddy's
   log shows callers' own addresses.
3. The Vercel project `bitocard-api` was deleted, with its cron jobs and its environment, and the API's `vercel.json`,
   Vercel Queues entry and post-deployment smoke workflow were removed from the repository. There is no Vercel copy to
   fall back to: a broken droplet is fixed by rolling back an image (Day to day), or by a new droplet from this runbook.
4. Webhook addresses given to suppliers and payment providers keep working: they name `api.bitocard.com`.

## Udozo's API (api.udozo.com)

Udozo (docs/UDOZO_SPINOFF_PLAN.md) runs the same image beside BitoCard's, as `api-udozo` and `scheduler-udozo` (the
`udozo` profile in `docker-compose.yml`), with its own database, Redis and secrets. udozo.com's DNS is on Cloudflare
too, so it sits behind Cloudflare and this firewall exactly as `api.bitocard.com` does.

1. **Its own services first:** a Neon project (US) and an Upstash Redis database for Udozo, never BitoCard's.
2. **Its environment:** as root once, `install -m 600 -o deploy -g deploy /dev/null /etc/udozo/api.env` (`setup.sh`
   made the folder), then fill it from `udozo.env.example` with `set-env.sh <NAME> udozo` for each secret
   (`DATABASE_URL`, `ENCRYPTION_KEY` (a new key: `openssl rand -base64 32`, kept safe), `CRON_SECRET`,
   `STORE_SERVER_SECRET`, the Upstash pair, `ADMIN_SETUP_EMAILS`). The file's presence switches Udozo on at the next
   deploy: both environments are checked and both databases migrated (Udozo's then gets its product seed) before either
   instance is replaced.
3. **Its certificate:** `sh /opt/bitocard/origin-cert.sh csr udozo`, then Cloudflare > udozo.com > SSL/TLS > Origin
   Server > Create certificate with that CSR, hostname `api.udozo.com` only, and `origin-cert.sh install udozo`. Until
   it is installed, Udozo's API runs but Caddy does not serve `api.udozo.com` (the deploy says so).
4. **Cloudflare (udozo.com):** an A record `api` to the droplet's IPv4, **proxied**; SSL/TLS **Full (strict)**; Bot
   Fight Mode off and the same WAF Skip rule for `http.host eq "api.udozo.com"`. The firewall already admits only
   Cloudflare.
5. **Deploy** (Actions > Deploy API, or the next push). It checks `api.udozo.com` through this droplet's Caddy serves
   Udozo at the new commit, and that its database is not BitoCard's (`database_id` in `/health`).
6. Set the repository variable `UDOZO_API_LIVE` to `true`: each deploy then smoke-tests `https://api.udozo.com` too.

Memory: Udozo's API is capped at 512 MB (`UDOZO_API_MEMORY`, `UDOZO_API_HEAP_MB` in `.env`). With both products on the
2 GB droplet that is close to full; resize to 4 GB before Udozo takes real traffic (Growing).

```sh
docker compose logs -f --tail=200 api-udozo
docker compose up -d --force-recreate api-udozo scheduler-udozo   # after changing /etc/udozo/api.env
```

## Growing

Watch the droplet's Graphs. Grow when memory stays above about 85% (swap in use outside deploys), the API container
restarts (`docker compose ps` shows a recent start; `docker inspect bitocard-api-1 --format '{{.State.OOMKilled}}'`),
or CPU stays above about 70%.

1. Power off, then **Resize > CPU and RAM only** (for example 2 vCPU / 4 GB). It keeps the
   disk and the IP address, so suppliers' allowlists still match, and it can be undone. A disk resize cannot.
2. Power on. The API starts by itself (`restart: unless-stopped`); expect a few minutes offline, so pick a quiet hour.
3. Raise the caps in `/opt/bitocard/.env`, then `docker compose up -d`:

| Droplet | `API_MEMORY` | `API_HEAP_MB` |
|---|---|---|
| 2 GB (the defaults) | `1024m` | `768` |
| 4 GB | `2560m` | `2048` |
| 8 GB | `5120m` | `4096` |

## Day to day

```sh
cd /opt/bitocard
docker compose ps                          # what runs, and health
docker compose logs -f --tail=200 api      # the API's JSON logs (scheduler, caddy likewise)
docker compose up -d --force-recreate api scheduler   # after changing /etc/bitocard/api.env (restart does not reread it)
cat images.log                             # deployed images, newest first
```
