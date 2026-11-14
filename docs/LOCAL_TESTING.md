# Local testing with a copy of the live data

BitoCard and Udozo run on your computer in Docker, with a copy of each product's live database. Nothing you do there reaches production: the copy is scrubbed of every provider key, so no email, text, payment, supplier order, push or webhook leaves your machine.

## What runs

| Product | App | Address |
|---|---|---|
| BitoCard | Store (bitocard.com) | http://localhost:3000 |
| | API | http://localhost:3001 |
| | Docs | http://localhost:3002 |
| | Admin | http://localhost:3003 |
| | SHQ | http://localhost:3004 |
| | Legals | http://localhost:3005 |
| | Verify | http://localhost:3006 |
| Udozo | udozo.com | http://localhost:3007 |
| | API | http://localhost:3010 |
| | Seller HQ | http://localhost:3011 |
| | Admin | http://localhost:3012 |
| | Connect | http://localhost:3013 |
| | POS | http://localhost:3014 |

A reseller's store opens at `http://<subdomain>.localhost:3000`, and an Udozo store's at `http://<subdomain>.localhost:3007`.

The local Postgres is on `localhost:5433` (user `local`, password `local`), with the databases `bitocard` and `udozo`.

## First time

1. Install Docker Desktop and start it.
2. Run `npm run local:setup`. This creates `.env.docker`, which git ignores and which is never copied into an image.
3. Fill in `.env.docker`:
   - `SOURCE_BITOCARD_DATABASE_URL` and `SOURCE_UDOZO_DATABASE_URL`: each product's live database address (Neon). They are only read, by `pg_dump`, and the apps never see them.
   - `BITOCARD_ENCRYPTION_KEY` and `UDOZO_ENCRYPTION_KEY`: each product's live `ENCRYPTION_KEY`. They let the copy's encrypted fields (phone numbers, sealed codes) be read. Without them the apps still run, but those fields cannot be read.
4. Run `npm run local:refresh` to copy the live data in.
5. Run `npm run local:up`. The first build compiles every app and takes a while; later builds redo only what changed.

Then sign in with your usual accounts and passwords: they are copied too.

## Every day

| Command | What it does |
|---|---|
| `npm run local:up` | Builds what changed in your code, then starts everything |
| `npm run local:refresh` | Copies the live data again, replacing the local copy (`npm run local:refresh -- udozo` copies one product) |
| `npm run local:logs` | Follows every app's output, each line labelled with the app |
| `npm run local:down` | Stops everything, keeping the local data |

To test a change, run `npm run local:up` after editing; it rebuilds and restarts. On start, each API runs your branch's new migrations on the local copy, never on production.

## What the copy does not do

When a copy is made, `docker/local/scrub.sql` removes or switches off everything that could reach the outside world:

- **Provider settings:** every integration setting is deleted, including API keys, secrets and live addresses. As a result:
  - email and texts go to the outbox instead of being sent;
  - payment gateways and suppliers are not set up;
  - checkout runs in sandbox;
  - AI, push, file uploads, domains and WhatsApp stay off.
- **Webhooks:** resellers' endpoints are switched off.
- **Push:** registered browsers are forgotten.
- **Resellers' own connections:** their supplier and gateway connections lose their credentials and are suspended.
- **AI keys:** resellers' own AI keys are removed.
- **Stores:** every store's checkout is in sandbox.

To try something that needs a provider, add its sandbox keys in the local admin, under Settings > Integrations. Never add live keys to the local copy.

**Photos:** images still load from the live storage CDN, but uploading new ones needs storage keys.

**Scheduled jobs:** they do not run on their own. To run one, call it with the local cron secret:

```sh
curl -H "Authorization: Bearer <LOCAL_CRON_SECRET>" http://localhost:3001/v1/cron/<job>
```

## Files

- `docker-compose.local.yml`: the services (Postgres, Redis, one container with every app, and the copy tool).
- `docker/local/Dockerfile`: the image that builds every app.
- `docker/local/apps.mjs`: each app's port and settings.
- `docker/local/run.mjs`: migrates both databases, then starts every app.
- `docker/local/refresh.sh`: copies the live databases into the local Postgres.
- `docker/local/scrub.sql`: makes each copy safe to use.
- `docker/local/cli.mjs`: the `local:*` commands.

Add a new app to `apps.mjs` and to the Dockerfile's build filters. Add any new table that can reach the outside world to `scrub.sql`.

The other Compose file, `docker-compose.yml`, is the API test databases (`npm run docker:up`). It is separate from this one.
