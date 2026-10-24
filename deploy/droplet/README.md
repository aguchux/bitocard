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
- **Size:** Basic, 2 vCPU / 4 GB to start. Resize later without changing anything else.
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

Fill `/etc/bitocard/api.env` (template: `api.env.example`) with the **same values** as the Vercel project. They are
listed in Vercel > `bitocard-api` > Settings > Environment Variables (Production). Or, from `apps/api` on your machine:

```sh
vercel env pull /tmp/api.env --environment=production --scope golojan-tech-ltd
scp /tmp/api.env deploy@<droplet>:/etc/bitocard/api.env && rm /tmp/api.env
```

Then on the droplet:

- Delete the lines Vercel adds itself (`VERCEL*`, `TURBO*`, `NX_*`).
- Check `COOKIE_SECURE=on`.

`ENCRYPTION_KEY` must be exactly the production value.

## 4. TLS and Cloudflare

1. Cloudflare > bitocard.com > SSL/TLS > Origin Server > **Create certificate**: hosts `*.bitocard.com` and
   `bitocard.com`, 15 years.
2. Save it as `/etc/bitocard/certs/origin.pem` and the key as `/etc/bitocard/certs/origin.key`, both mode 600 and
   owned by `deploy`.
3. SSL/TLS > Overview: **Full (strict)**.
4. Cloudflare must not block or challenge the API's callers: suppliers', payment providers' and GitHub's webhooks, and
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

- **Variables:**
  - `API_DROPLET_HOST`: the droplet's address.
  - `API_SMOKE_URL`: `https://api-next.bitocard.com` until the cutover.
- **Secrets:**
  - `API_DROPLET_SSH_KEY`: the private key `bitocard-deploy`.
  - `API_DROPLET_KNOWN_HOSTS`: the output of `ssh-keyscan <droplet address>`.
- **Environment** `production`: optionally add yourself as a required reviewer before each deploy.

Then Actions > Deploy API > Run workflow (or push to `main`).

## 7. Try it before moving the address

Cloudflare DNS: add `api-next` as an A record to the droplet, **proxied**. The droplet serves it exactly like
`api.bitocard.com` (`Caddyfile`).

- `https://api-next.bitocard.com/health` shows `"environment":"production"`, the commit and `"database":"ok"`.
- `node apps/api/scripts/smoke.mjs https://api-next.bitocard.com` passes.
- `docker compose -f /opt/bitocard/docker-compose.yml logs scheduler` shows each job `ok`.

Until the cutover both Vercel and the droplet run the scheduled jobs. Every job is safe to run twice, but cut over the
same day.

## 8. Cutover

1. Cloudflare DNS: `api` becomes an **A record to the droplet, proxied** (today a DNS-only CNAME to Vercel).
2. Check it is the droplet: `curl -s https://api.bitocard.com/health` shows `"environment":"production"` and the
   droplet's commit.
3. Remove `api.bitocard.com` from the Vercel project's domains, then **pause** the project (Settings > General). Its
   cron jobs stop, and nothing reaches it any more.
4. Set `API_SMOKE_URL` to `https://api.bitocard.com` (or delete it). Delete the `api-next` record when you no longer
   need it.
5. Webhook addresses given to suppliers and payment providers keep working: they name `api.bitocard.com`.

Rolling back the cutover: point `api` back at Vercel (`cname.vercel-dns.com`, DNS only), add the domain back to the
project and resume it.

## Day to day

```sh
cd /opt/bitocard
docker compose ps                          # what runs, and health
docker compose logs -f --tail=200 api      # the API's JSON logs (scheduler, caddy likewise)
docker compose up -d --force-recreate api scheduler   # after changing /etc/bitocard/api.env (restart does not reread it)
cat images.log                             # deployed images, newest first
```
