# BitoCard

npm-workspaces Turborepo with five Next.js 16 App Router applications, one NestJS 12 API and four shared packages. Each Next.js app has its own `app/` directory with no `src/` wrapper; the API follows the standard Nest layout under `apps/api/src`. The repository root contains workspace tooling and AGENTS.md.

## Apps

| App | Directory | Local URL | Indexed | Current scope |
| --- | --- | --- | --- | --- |
| Storefront | apps/storefront | http://localhost:3000 | Yes | Coming-soon page, logo, dialogs, robots.txt and sitemap; `/legal/*` redirects to Legals |
| API (NestJS) | apps/api | http://localhost:3001 | No | JSON service information, `GET /health`, robots.txt |
| Docs | apps/docs | http://localhost:3002 | No | Coming-soon page |
| Admin | apps/admin | http://localhost:3003 | No | Admin console (admin.bitocard.com) |
| SHQ | apps/shq | http://localhost:3004 | No | Seller Head Quarters, the reseller back office (shq.bitocard.com) |
| Legals | apps/legals | http://localhost:3005 | Yes | Legals & Compliance site (legals.bitocard.com): Home, Documents (privacy, terms, cookies, legal notice under /documents) and Contact |

## Shared packages

| Package | Purpose |
| --- | --- |
| `@bitocard/ui` | `Brand` logo (the "b" mark beside "Bitocard"), `BrandLockup` (logo with tagline), `ComingSoon` workspace page, `workspace.css`, brand constants, `siteUrl()`, `appUrl()` for cross-app links, and legal entity data (`/legal`) |
| `@bitocard/next-config` | `createNextConfig()` — Turbopack root, output tracing, security headers, `X-Robots-Tag` for private apps |
| `@bitocard/eslint-config` | Flat ESLint configs: `/next` (Next core-web-vitals + TypeScript) and `/node` (typescript-eslint, for the API) |
| `@bitocard/typescript-config` | Base `tsconfig` presets for Next apps and React packages |

Workspace packages ship TypeScript source; Next.js transpiles them automatically, so they have no build step. Logo files are generated from `assets/logo.png` by `python scripts/brand-assets.py` into each app's `public/` folder (`bitocard-mark*.png`, `bitocard-logo*.png`).

## Development

Use Node.js 22+ and npm 11.12.0. Run all commands from the repository root:

```sh
npm ci
npm run dev              # all apps
npm run dev:storefront   # or dev:api, dev:docs, dev:admin, dev:shq, dev:legals
```

## Validation

```sh
npm run check   # lint + typecheck, then build + test (sequential: typecheck and build both write .next/types)
npm start       # after a build
```

## Deploying to Vercel

Each app is its own Vercel project, all connected to the same Git repository. Build settings live in each app's `vercel.json`, so the dashboard only needs:

1. **New Project → Import** the repository, once per app.
2. **Root Directory:** `apps/<app>` (for example `apps/storefront`). Leave **Include files outside the root directory** enabled.
3. **Framework, install and build commands:** leave as detected; `vercel.json` overrides them.
4. **Node.js version:** 22.x or 24.x.
5. Optional environment variable `SITE_URL` (for example `https://bitocard.com`) to fix the canonical origin. Without it, production uses the project's production domain and previews use the deployment URL.

With the CLI instead: `cd apps/storefront && vercel link && vercel deploy`.

What `vercel.json` does for each app:

- installs from the repository root with `npm ci`, so the single `package-lock.json` is used;
- builds with `turbo run build --filter=@bitocard/<app>`, so workspace dependencies build first;
- skips builds with `turbo-ignore` when neither the app nor a package it depends on changed.

### The NestJS API on Vercel

`apps/api/vercel.json` uses the `nestjs` framework preset. `nest build` compiles `src/` to `dist/` with `tsc`, which keeps the decorator metadata Nest's dependency injection needs. Vercel then deploys `dist/main.js` as a single Vercel Function on Fluid compute. Keep these rules:

- Keep the entrypoint at `src/main.ts`. Do not add files named `app`, `index` or `server` at the top of `src/`: Vercel checks those names in `dist/` before `main` and would deploy the wrong file.
- `main.ts` only calls `listen`. Put app setup in `src/bootstrap.ts` (`createApp()`), which the tests reuse.
- `npm run test --workspace=@bitocard/api` runs a smoke test against the compiled `dist/`.
- Nest 12 packages are ESM-only; the API compiles to CommonJS and loads them through Node's `require(esm)`, so Node 22.12+ is required.

Domains: storefront on the apex domain (`bitocard.com`) and legals on `legals.bitocard.com`; suggested `api.`, `docs.`, `admin.` and `reseller.` subdomains for the rest. Cross-app links default to those production domains on any Vercel build; override with `STOREFRONT_URL` or `LEGALS_URL` if the domains differ. Put admin and reseller behind Vercel Deployment Protection until authentication exists.

To share build cache between machines and Vercel, run `npx turbo login && npx turbo link` (Vercel Remote Cache).

## Scope

No authentication, wallets, payments, fulfilment, live catalogue or reseller API features are implemented. Admin and reseller pages contain no private data or privileged actions. The API health endpoint reports process health only; no database or upstream service is connected.

Environment files belong in the app that consumes them and are ignored by Git. When a new environment variable affects build output, add it to `globalEnv` (or a task's `env`) in `turbo.json`.
