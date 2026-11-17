// Writes the Kubernetes manifests of BitoCard and Udozo from one list, so every app is set up the same way: each
// product in its own directory (deploy/k8s/bitocard, deploy/k8s/udozo: its API, scheduler, frontends, routes,
// and kustomization), and what both use in deploy/k8s/shared. Run after changing an app, a host or a size,
// then commit what it wrote:
//   node deploy/k8s/generate.mjs
// Secrets and settings are never here: they are kustomize generators over each directory's env/*.env (never
// committed; each has a committed *.env.example). See deploy/k8s/README.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Docker Hub: every image is golojan/bitocard_<app> (bitocard_storefront, bitocard_udozo_api…). */
const registry = 'golojan';
export const namespace = 'bitocard';

/**
 * Every Next.js app: its name (its image is golojan/bitocard_<name>), the hosts it answers, its product, the address it is known by (SITE_URL) and whether
 * it signs requests with its API's store server secret. `wildcard` serves resellers' store subdomains; `build` adds
 * build-time values.
 */
export const frontends = [
  { name: 'storefront', dir: 'apps/storefront', pkg: '@bitocard/storefront', product: 'bitocard', hosts: ['bitocard.com', 'www.bitocard.com'], wildcard: '*.bitocard.com', site: 'https://bitocard.com', storeSecret: true },
  { name: 'shq', dir: 'apps/shq', pkg: '@bitocard/shq', product: 'bitocard', hosts: ['shq.bitocard.com'], site: 'https://shq.bitocard.com' },
  { name: 'admin', dir: 'apps/admin', pkg: '@bitocard/admin', product: 'bitocard', hosts: ['admin.bitocard.com'], site: 'https://admin.bitocard.com' },
  { name: 'legals', dir: 'apps/legals', pkg: '@bitocard/legals', product: 'bitocard', hosts: ['legals.bitocard.com'], site: 'https://legals.bitocard.com' },
  { name: 'docs', dir: 'apps/docs', pkg: '@bitocard/docs', product: 'bitocard', hosts: ['docs.bitocard.com'], site: 'https://docs.bitocard.com' },
  { name: 'verify', dir: 'apps/verify', pkg: '@bitocard/verify', product: 'bitocard', hosts: ['verify.bitocard.com'], site: 'https://verify.bitocard.com' },
  { name: 'udozo', dir: 'apps/udozo', pkg: '@udozo/web', product: 'udozo', hosts: ['udozo.com', 'www.udozo.com'], wildcard: '*.udozo.com', site: 'https://udozo.com', storeSecret: true, catchAll: true },
  { name: 'udozo-shq', dir: 'apps/udozo-shq', pkg: '@udozo/shq', product: 'udozo', hosts: ['shq.udozo.com'], site: 'https://shq.udozo.com' },
  { name: 'udozo-admin', dir: 'apps/udozo-admin', pkg: '@udozo/admin', product: 'udozo', hosts: ['admin.udozo.com'], site: 'https://admin.udozo.com' },
  { name: 'udozo-connect', dir: 'apps/udozo-connect', pkg: '@udozo/connect', product: 'udozo', hosts: ['connect.udozo.com'], site: 'https://connect.udozo.com', storeSecret: true },
  { name: 'udozo-pos', dir: 'apps/udozo-pos', pkg: '@udozo/pos', product: 'udozo', hosts: ['pos.udozo.com'], site: 'https://pos.udozo.com', storeSecret: true },
  { name: 'udozo-verify', dir: 'apps/verify', pkg: '@bitocard/verify', product: 'udozo', hosts: ['verify.udozo.com'], site: 'https://verify.udozo.com', build: { NEXT_PUBLIC_VERIFY_BRAND: 'udozo' } },
];

/** Both APIs: their image, port and host. Each keeps its own Upstash Redis (UPSTASH_REDIS_REST_* in its secrets). */
export const apis = [
  { name: 'bitocard-api', dir: 'apps/api', pkg: '@bitocard/api', product: 'bitocard', port: 3001, host: 'api.bitocard.com', dockerfile: 'apps/api/Dockerfile' },
  { name: 'udozo-api', dir: 'apps/udozo-api', pkg: '@udozo/api', product: 'udozo', port: 3010, host: 'api.udozo.com', dockerfile: 'apps/udozo-api/Dockerfile' },
];

export const products = [
  { key: 'bitocard', label: 'BitoCard', domain: 'bitocard.com' },
  { key: 'udozo', label: 'Udozo', domain: 'udozo.com' },
];

/** The addresses a product's frontends are built with (their server-side defaults are Vercel's only). */
export const buildAddresses = {
  bitocard: { API_URL: 'https://api.bitocard.com', STOREFRONT_URL: 'https://bitocard.com', LEGALS_URL: 'https://legals.bitocard.com', SHQ_URL: 'https://shq.bitocard.com' },
  udozo: { API_URL: 'https://api.udozo.com', UDOZO_URL: 'https://udozo.com', CONNECT_URL: 'https://connect.udozo.com', POS_URL: 'https://pos.udozo.com' },
};

/**
 * How big everything is, sized for a low-traffic start on the one node the cluster has (2 vCPUs, about 2.9 GB of which
 * DigitalOcean's own pods ask for about 0.6 GB): everything asks for about 1.6 GB, and each Node.js process's heap is
 * capped (`heapMb`) so it stays near what it asks for. Frontends restart in place on a deploy (`rollout: 'replace'`, a
 * few seconds each), so a rollout never needs room for a second copy; the APIs start their new pod first. Grow these
 * (and set `rollout: 'surge'`) once the node pool grows.
 */
export const sizes = {
  web: { cpu: '10m', memory: '96Mi', limit: '320Mi', heapMb: 160, rollout: 'replace' },
  api: { cpu: '50m', memory: '192Mi', limit: '640Mi', heapMb: 384, rollout: 'surge' },
  migrate: { cpu: '20m', memory: '128Mi', limit: '512Mi' },
  scheduler: { cpu: '5m', memory: '24Mi', limit: '96Mi', heapMb: 48 },
};

const rollout = kind =>
  kind === 'surge' ? 'rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }' : 'rollingUpdate: { maxSurge: 0, maxUnavailable: 1 }';

/** Each app's Docker Hub repository, `bitocard_` and its name: bitocard_api, bitocard_storefront, bitocard_udozo_shq. */
export const repoOf = app => `bitocard_${app.name.replace(/^bitocard-/, '').replace(/-/g, '_')}`;

/** Each app's image: `golojan/bitocard_storefront`. */
export const imageOf = app => `${registry}/${repoOf(app)}`;

const header = what => `# ${what}\n# Written by deploy/k8s/generate.mjs: change that file and run it again, never edit this one by hand.\n`;

/** Locked-down containers: never root, no extra privileges, no Linux capabilities. */
const security = (indent, uid = 1000) =>
  [`securityContext:`, `  allowPrivilegeEscalation: false`, `  runAsNonRoot: true`, `  runAsUser: ${uid}`, `  capabilities:`, `    drop: [ALL]`].map((line, n) => (n ? ' '.repeat(indent) : '') + line).join('\n');

const metadata = (name, product, extra = '') => `metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: ${name}
    app.kubernetes.io/part-of: ${product}${extra}`;

function frontend(app) {
  const secretEnv = app.storeSecret
    ? `
            - name: STORE_SERVER_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${app.product}-web-secrets
                  key: STORE_SERVER_SECRET`
    : '';
  return `---
apiVersion: apps/v1
kind: Deployment
${metadata(app.name, app.product)}
spec:
  replicas: 1
  revisionHistoryLimit: 3
  strategy:
    ${rollout(sizes.web.rollout)}
  selector:
    matchLabels:
      app.kubernetes.io/name: ${app.name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${app.name}
        app.kubernetes.io/part-of: ${app.product}
    spec:
      imagePullSecrets:
        - name: registry
      securityContext:
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: web
          image: ${imageOf(app)}:latest
          ports:
            - { name: http, containerPort: 3000 }
          envFrom:
            - configMapRef:
                name: ${app.product}-web-config
          env:
            - { name: PORT, value: "3000" }
            - { name: SITE_URL, value: "${app.site}" }
            - { name: NODE_OPTIONS, value: "--max-old-space-size=${sizes.web.heapMb}" }${secretEnv}
          readinessProbe:
            tcpSocket: { port: http }
            periodSeconds: 5
          livenessProbe:
            tcpSocket: { port: http }
            initialDelaySeconds: 20
            periodSeconds: 20
          resources:
            requests: { cpu: ${sizes.web.cpu}, memory: ${sizes.web.memory} }
            limits: { memory: ${sizes.web.limit} }
          ${security(10)}
---
apiVersion: v1
kind: Service
${metadata(app.name, app.product)}
spec:
  selector:
    app.kubernetes.io/name: ${app.name}
  ports:
    - { name: http, port: 80, targetPort: http }
`;
}

function api(app) {
  const env = `envFrom:
            - configMapRef:
                name: ${app.name}-config
            - secretRef:
                name: ${app.name}-secrets
          env:`;
  return `---
apiVersion: apps/v1
kind: Deployment
${metadata(app.name, app.product)}
spec:
  replicas: 1
  revisionHistoryLimit: 3
  strategy:
    ${rollout(sizes.api.rollout)}
  selector:
    matchLabels:
      app.kubernetes.io/name: ${app.name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${app.name}
        app.kubernetes.io/part-of: ${app.product}
    spec:
      imagePullSecrets:
        - name: registry
      securityContext:
        seccompProfile: { type: RuntimeDefault }
      # Before the new image serves: the settings checked (the database answers, ENCRYPTION_KEY opens the stored
      # secrets, Redis accepts its token), then the migrations (Prisma's lock keeps a second pod from running them too).
      initContainers:
        - name: migrate
          image: ${imageOf(app)}:latest
          command: ["sh", "-c", "node scripts/check-env.mjs && node scripts/migrate-deploy.mjs"]
          ${env}
            - { name: NODE_OPTIONS, value: "--max-old-space-size=256" }
          resources:
            requests: { cpu: ${sizes.migrate.cpu}, memory: ${sizes.migrate.memory} }
            limits: { memory: ${sizes.migrate.limit} }
          ${security(10)}
      containers:
        - name: api
          image: ${imageOf(app)}:latest
          ports:
            - { name: http, containerPort: ${app.port} }
          ${env}
            - { name: NODE_OPTIONS, value: "--max-old-space-size=${sizes.api.heapMb}" }
          readinessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 5
            timeoutSeconds: 5
          livenessProbe:
            httpGet: { path: /health, port: http }
            initialDelaySeconds: 30
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 4
          resources:
            requests: { cpu: ${sizes.api.cpu}, memory: ${sizes.api.memory} }
            limits: { memory: ${sizes.api.limit} }
          ${security(10)}
        # The scheduled jobs, beside the API (one pod fewer): each minute (UTC), every due job is called as
        # GET /v1/cron/<job> on this pod's own API, with its CRON_SECRET; a job still running is never started again.
        # With more than one replica each pod's scheduler calls its own API: every job is safe to run twice.
        - name: scheduler
          image: ${imageOf(app)}:latest
          command: ["node", "scripts/scheduler.mjs"]
          env:
            - { name: API_INTERNAL_URL, value: "http://127.0.0.1:${app.port}" }
            - { name: APP_PRODUCT, value: "${app.product}" }
            - { name: NODE_OPTIONS, value: "--max-old-space-size=${sizes.scheduler.heapMb}" }
            - name: CRON_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${app.name}-secrets
                  key: CRON_SECRET
          resources:
            requests: { cpu: ${sizes.scheduler.cpu}, memory: ${sizes.scheduler.memory} }
            limits: { memory: ${sizes.scheduler.limit} }
          ${security(10)}
      # Long requests (catalogue syncs, reports) finish before the pod goes.
      terminationGracePeriodSeconds: 60
---
apiVersion: v1
kind: Service
${metadata(app.name, app.product)}
spec:
  selector:
    app.kubernetes.io/name: ${app.name}
  ports:
    - { name: http, port: 80, targetPort: http }
    - { name: direct, port: ${app.port}, targetPort: http }
`;
}

/** Host routing: exact hosts first, the wildcard (resellers' stores) below them, then Udozo's own-domain stores. */
function ingresses(product) {
  const rule = (host, service) => `    - host: "${host}"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${service}
                port: { name: http }`;
  const ingress = (name, rules, priority) => `---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name}
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web${priority ? `\n    traefik.ingress.kubernetes.io/router.priority: "${priority}"` : ''}
spec:
  ingressClassName: traefik
  rules:
${rules.join('\n')}
`;
  const own = frontends.filter(app => app.product === product.key);
  const exact = [...apis.filter(app => app.product === product.key).map(app => rule(app.host, app.name)), ...own.flatMap(app => app.hosts.map(host => rule(host, app.name)))];
  const store = own.find(app => app.wildcard);
  let out = header(`${product.label}'s routes by host, through Traefik (deploy/k8s/bootstrap/traefik-values.yaml), which the Cloudflare Tunnel\n# feeds (deploy/k8s/shared/tunnel.yaml).`);
  out += ingress(`${product.key}-sites`, exact, 0);
  // Resellers' store subdomains: below every exact host, so shq.<domain> never reaches the store.
  out += ingress(`${product.key}-stores`, [rule(store.wildcard, store.name)], 2);
  const catchAll = own.find(app => app.catchAll);
  if (catchAll) {
    // Live stores on their own domains: any other host reaches the store app, which names the store from the host.
    // Their certificates are Cloudflare for SaaS's at the edge, which reaches here through the tunnel
    // (deploy/k8s/README.md).
    out += `---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${product.key}-custom-domains
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
    traefik.ingress.kubernetes.io/router.priority: "1"
spec:
  ingressClassName: traefik
  defaultBackend:
    service:
      name: ${catchAll.name}
      port: { name: http }
`;
  }
  return out;
}

function kustomization(product) {
  const own = [...apis, ...frontends].filter(app => app.product === product.key);
  const images = [...new Set(own.map(imageOf))].map(image => `  - { name: ${image}, newTag: latest }`).join('\n');
  return `${header(`${product.label} on Kubernetes: its API and scheduler, frontends and routes, in the namespace
# \`${namespace}\`. Applied with the rest by \`kubectl apply -k deploy/k8s\`, or alone by \`kubectl apply -k deploy/k8s/${product.key}\`
# (after deploy/k8s/shared once).
#
# Settings and secrets come from env/*.env, never committed: copy each from its *.env.example (deploy/k8s/init-env.sh).
# A generated ConfigMap or Secret is named with a hash of its contents, so a changed value rolls the pods using it.`)}apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${namespace}

labels:
  - pairs:
      app.kubernetes.io/part-of: ${product.key}

resources:
  - api.yaml
  - frontends.yaml
  - ingress.yaml

configMapGenerator:
  # The API's settings that are not secret (origins, cookies, rate limits, Redis's address).
  - name: ${product.key}-api-config
    envs: [env/api.config.env]
  # The addresses the frontends' servers call and link to.
  - name: ${product.key}-web-config
    envs: [env/web.config.env]

secretGenerator:
  - name: ${product.key}-api-secrets
    envs: [env/api.secret.env]
  - name: ${product.key}-web-secrets
    envs: [env/web.secret.env]

# The images to run; deploy/k8s/deploy.sh pins each to the commit CI built (\`kustomize edit set image\`).
images:
${images}
`;
}

/**
 * What CI builds (.github/workflows/docker-images.yml reads images.json): each image's Dockerfile and build arguments, the
 * frontends' with their product's addresses and their own SITE_URL.
 */
export function imageBuilds() {
  return [
    ...apis.map(app => ({ name: repoOf(app), image: imageOf(app), deployment: app.name, pkg: app.pkg, dockerfile: app.dockerfile, args: '' })),
    ...frontends.map(app => ({
      name: repoOf(app),
      image: imageOf(app),
      deployment: app.name,
      pkg: app.pkg,
      dockerfile: 'deploy/k8s/web.Dockerfile',
      args: Object.entries({ APP: app.pkg, APP_DIR: app.dir, SITE_URL: app.site, ...buildAddresses[app.product], ...(app.build ?? {}) })
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    })),
  ];
}

const write = (path, text) => {
  mkdirSync(new URL('.', path), { recursive: true });
  writeFileSync(path, text);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const here = new URL('.', import.meta.url);
  for (const product of products) {
    const dir = new URL(`${product.key}/`, here);
    write(new URL('api.yaml', dir), header(`${product.label}'s API: its migrations, its Service and its scheduler.`) + apis.filter(app => app.product === product.key).map(api).join(''));
    write(new URL('frontends.yaml', dir), header(`${product.label}'s Next.js apps: a Deployment and a Service each.`) + frontends.filter(app => app.product === product.key).map(frontend).join(''));
    write(new URL('ingress.yaml', dir), ingresses(product));
    write(new URL('kustomization.yaml', dir), kustomization(product));
  }
  write(new URL('images.json', here), `${JSON.stringify(imageBuilds(), null, 2)}\n`);
  console.log('Wrote deploy/k8s/bitocard, deploy/k8s/udozo and deploy/k8s/images.json');
}
