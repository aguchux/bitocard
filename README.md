# BitoCard

An npm-workspaces Turborepo for BitoCard, a reseller-first platform for digital gift cards, airtime, data and other digital products, owned by Golojan Ltd. It holds five Next.js App Router apps, one NestJS API and the shared packages. Each Next.js app has its own `app/` directory with no `src/` wrapper; the API follows the standard Nest layout under `apps/api/src`.

Product rules, architecture and conventions are in [AGENTS.md](AGENTS.md); the feature plan is in [PLANS.md](PLANS.md).

## Apps

| App | Directory | Local URL | Production | Indexed |
| --- | --- | --- | --- | --- |
| Storefront (BitoCard's store, resellers' hosted stores, `/resellers`) | `apps/storefront` | http://localhost:3000 | bitocard.com | Yes |
| API (NestJS) | `apps/api` | http://localhost:3001 | api.bitocard.com | No |
| API documentation | `apps/docs` | http://localhost:3002 | docs.bitocard.com | Yes |
| Admin console | `apps/admin` | http://localhost:3003 | admin.bitocard.com | No |
| SHQ (Seller Head Quarters, the reseller back office) | `apps/shq` | http://localhost:3004 | shq.bitocard.com | No |
| Legals & Compliance | `apps/legals` | http://localhost:3005 | legals.bitocard.com | Yes |

## Shared packages

| Package | Purpose |
| --- | --- |
| `@bitocard/api-client` | RTK Query client for the API: admin endpoints (`/admin`) and SHQ endpoints (`/reseller`) |
| `@bitocard/admin-ui` | Console theme, components and shell shared by the admin app and SHQ |
| `@bitocard/ui` | Brand, site constants, cross-app URLs, SEO helpers and legal entity data |
| `@bitocard/next-config` | `createNextConfig()`: security headers, noindex for private apps |
| `@bitocard/eslint-config` | Flat ESLint configs for the Next.js apps and the API |
| `@bitocard/typescript-config` | Base `tsconfig` presets |

Packages ship TypeScript source with no build step.

## Development

Use Node.js 22.12+ and npm 11. Run commands from the repository root:

```sh
npm ci
npm run dev              # all apps
npm run dev:storefront   # or dev:api, dev:docs, dev:admin, dev:shq, dev:legals
```

Environment files belong in the app that uses them and are ignored by Git. See `apps/api/.env.example` for the API. Service keys (payments, suppliers, email, SMS, storage) are set by a super admin in the admin app (Settings > Integrations), not in environment files.

**Never put credentials in this README or any committed file**, including database addresses in example commands.

## Tests

```sh
npm run check          # lint and typecheck, then build, then tests
npm test -w @bitocard/api   # API tests on PGlite (no database server needed)
npm run docker:up      # Postgres, Redis and an Upstash-compatible proxy
npm run test:docker    # API tests against them
```

A change is ready only when both the PGlite and the Docker runs pass.

## Deployment

Each app is its own Vercel project with Root Directory `apps/<app>`; install, build and ignore commands are in each app's `vercel.json`. The API runs on Vercel Functions and applies database migrations after its build (`apps/api/scripts/migrate-deploy.mjs`). Details are in AGENTS.md.

Admins are set up and reset from the admin app's sign-in page only, for addresses listed in the API's `ADMIN_SETUP_EMAILS` environment variable; there are no admin scripts.
