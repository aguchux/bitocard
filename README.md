# BitoCard

Turborepo with five independent Next.js App Router applications. Each app has its own app/ directory; there are no src/ wrappers. The repository root contains workspace tooling and AGENTS.md.

| App | Directory | Local URL | Current scope |
| --- | --- | --- | --- |
| Storefront | apps/storefront | http://localhost:3000 | Existing coming-soon page, logo and dialogs |
| API | apps/api | http://localhost:3001 | JSON service information and GET /health |
| Docs | apps/docs | http://localhost:3002 | Documentation starter |
| Admin | apps/admin | http://localhost:3003 | Operator workspace starter |
| Reseller | apps/reseller | http://localhost:3004 | Reseller workspace starter |

## Development

Use Node.js 22+ and npm 11.12.0. Run all commands from the repository root:

```sh
npm ci
npm run dev
```

Run a single app with npm run dev:storefront, dev:api, dev:docs, dev:admin or dev:reseller.

## Validation and production

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

Turbo builds and checks all five apps. Build outputs are cached locally in .turbo and each app's .next directory. Development and production servers are persistent, uncached tasks. Run npm run build before npm start. No remote cache or deployment is configured.

To target one production app: npm run start --workspace=@bitocard/storefront. Each app's port is defined in its package.json. The API health endpoint reports process health only; no database or upstream service is connected.

## Scope

The storefront retains the approved logo in apps/storefront/public/bitocard-logo.png and the mobile-first coming-soon design. The other UI apps are starter pages. No authentication, wallets, payments, fulfilment, live catalogue or reseller API features are implemented. Admin and reseller pages contain no private data or privileged actions.

App configuration and dependencies are declared per workspace, with one root package-lock.json. Next.js uses the repository root for Turbopack resolution and output tracing. Environment files belong in the app that consumes them and are ignored by Git. Update Turbo's environment declarations when introducing environment-dependent build inputs.
