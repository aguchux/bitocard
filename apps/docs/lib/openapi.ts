import "server-only";
import spec from "../../api/openapi.json";

/**
 * The API reference comes only from the API's own OpenAPI document (apps/api/openapi.json, regenerated with
 * `npm run openapi -w @bitocard/api` and checked by the API tests), never written by hand, so docs and API cannot
 * drift. Everything here runs at build time.
 */
export type Schema = {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  const?: unknown;
  example?: unknown;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type Parameter = { name: string; in: "path" | "query" | "header"; required?: boolean; description?: string; schema?: Schema; example?: unknown };
export type MediaContent = { schema?: Schema; example?: unknown };
export type ResponseObject = { description?: string; content?: Record<string, MediaContent> };
export type Auth = "public" | "session" | "api_key";

type RawOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, MediaContent> };
  responses?: Record<string, ResponseObject>;
  "x-bitocard-auth"?: Auth;
  "x-bitocard-scopes"?: string[];
  "x-bitocard-roles"?: string[];
};

export type Operation = {
  id: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  tag: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  body: MediaContent | null;
  bodyRequired: boolean;
  responses: Array<{ status: string; response: ResponseObject }>;
  auth: Auth;
  scopes: string[];
  roles: string[];
  /** Sandbox-only helpers (`…/simulate`). */
  sandboxOnly: boolean;
};

type Document = {
  info: { title: string; description: string; version: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Partial<Record<Operation["method"], RawOperation>>>;
  webhooks?: Record<string, { post: RawOperation }>;
  components: { schemas: Record<string, Schema> };
};

export const document = spec as unknown as Document;
export const apiBase = document.servers?.[0]?.url ?? "https://api.bitocard.com";

const methods: Operation["method"][] = ["get", "post", "put", "patch", "delete"];

/** URL-friendly names: `API keys` → `api-keys`. */
export const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** An operation's anchor on its tag page, stable across builds: `get-v1-orders-id`. */
export const operationAnchor = (operation: Pick<Operation, "method" | "path">) => slug(`${operation.method} ${operation.path.replace(/[{}]/g, "")}`);

export const operations: Operation[] = Object.entries(document.paths).flatMap(([path, item]) =>
  methods.flatMap(method => {
    const raw = item[method];
    if (!raw) return [];
    const json = raw.requestBody?.content?.["application/json"];
    return [
      {
        id: operationAnchor({ method, path }),
        method,
        path,
        tag: raw.tags?.[0] ?? "Other",
        summary: raw.summary ?? `${method.toUpperCase()} ${path}`,
        description: raw.description ?? "",
        parameters: raw.parameters ?? [],
        body: json ?? null,
        bodyRequired: Boolean(raw.requestBody?.required),
        responses: Object.entries(raw.responses ?? {})
          .map(([status, response]) => ({ status, response }))
          .sort((a, b) => a.status.localeCompare(b.status)),
        auth: raw["x-bitocard-auth"] ?? "api_key",
        scopes: raw["x-bitocard-scopes"] ?? [],
        roles: raw["x-bitocard-roles"] ?? [],
        sandboxOnly: /\/simulate(-deposit)?$/.test(path),
      } satisfies Operation,
    ];
  }),
);

/**
 * The reference's sections, in the order a reseller builds an integration. `api` sections accept API keys; `dashboard`
 * sections are what SHQ (the reseller dashboard) uses with its own sign-in; `public` needs no sign-in.
 */
export const sections: Array<{ title: string; kind: "api" | "dashboard" | "public"; tags: string[] }> = [
  { title: "Core API", kind: "api", tags: ["Account", "Catalogue", "Quotes", "Orders", "Numbers", "Wallet", "Payouts", "Customers", "Disputes"] },
  { title: "Webhooks and events", kind: "api", tags: ["Webhooks", "Events"] },
  { title: "Stores and markets", kind: "api", tags: ["Stores", "Countries", "Exchange rates", "Plans", "Settings"] },
  { title: "Dashboard (SHQ)", kind: "dashboard", tags: ["Authentication", "API keys", "Team", "Notifications", "Integrations"] },
  { title: "BitoCard store", kind: "public", tags: ["Storefront"] },
];

/** Every tag with at least one operation, in section order, then any not placed in a section. */
export const tags: string[] = (() => {
  const present = new Set(operations.map(operation => operation.tag));
  const ordered = sections.flatMap(section => section.tags).filter(tag => present.has(tag));
  return [...ordered, ...[...present].filter(tag => !ordered.includes(tag)).sort()];
})();

export const tagSlug = (tag: string) => slug(tag);
export const tagBySlug = (value: string) => tags.find(tag => tagSlug(tag) === value);
export const operationsFor = (tag: string) => operations.filter(operation => operation.tag === tag);
export const operationHref = (operation: Operation) => `/reference/${tagSlug(operation.tag)}#${operation.id}`;

/** What each tag is for, shown at the top of its page. */
export const tagIntros: Record<string, string> = {
  Account: "The reseller account your key acts for, and your business verification. `GET /v1/account` is the simplest first call: it tells you which account and mode a key belongs to.",
  Catalogue: "Every product you can sell, priced for you, and the markups you add. Prices are in your wallet currency; a quote locks the exact price.",
  Quotes: "A quote locks a product's price, your wholesale cost and the recipient check for 10 minutes. Every order is placed from one open quote.",
  Orders: "Place an order from a quote; BitoCard holds the wholesale cost from your wallet, fulfils it and tells you the outcome. Codes and PINs are only on the single order.",
  Numbers: "Virtual numbers your orders bought: renew them from your wallet (auto-renew is on by default), read their SMS and send SMS. A number not renewed is paused at expiry and deleted 15 days later.",
  Wallet: "Your pre-funded wallet: balances, ledger transactions, top-ups, reserved bank accounts and BitoCard's fees.",
  Payouts: "Withdraw matured earnings to your verified bank account.",
  Customers: "Check your customers' identity by your own customer reference: BVN in Nigeria, ID document and face check elsewhere.",
  Disputes:
    "Your customers' disputes, your own disputes with BitoCard and chargebacks. You investigate customers' disputes and chargebacks first: resolve them yourself, or escalate them to BitoCard with a report and a recommendation. BitoCard decides and executes anything that moves money.",
  Webhooks: "Endpoints that receive signed events, their delivery logs, resends and test events.",
  Events: "Every event, oldest first. The source of truth when a webhook was missed.",
  Stores: "Your BitoCard-hosted storefront: subdomain, branding and publishing.",
  Countries: "Markets BitoCard serves, with the money rules resellers there work under. Public.",
  "Exchange rates": "BitoCard's conversion rates for each currency against the US dollar. Public.",
  Plans: "The Standard and Premium plans, and your subscription.",
  Settings: "Options BitoCard enables per country, and your choices among them.",
  Authentication: "Sign-in for SHQ, the reseller dashboard. Uses the dashboard's session cookie; API keys cannot call these.",
  "API keys": "Create, roll and revoke API keys. Dashboard only: a key can never manage keys.",
  Team: "Invite staff to your reseller account and manage their roles.",
  Notifications: "The dashboard inbox, browser push devices and push preferences.",
  Integrations: "Connect your own supplier and payment accounts (where BitoCard offers them in your country).",
  Storefront: "The public API behind bitocard.com: the home page layout, products, search and menus. No sign-in.",
};

export function resolve(schema: Schema | undefined): Schema | undefined {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.split("/").pop()!;
  return resolve(document.components.schemas[name]);
}

export const refName = (schema: Schema | undefined) => schema?.$ref?.split("/").pop();

/** A request example built from the schema's own examples and defaults (only what the API documents). */
/** A realistic value for a string field with no documented example, from its name and format. */
function stringFor(name: string | undefined, format: string | undefined) {
  if (format === "uuid" || (name && /(^|_)id$/.test(name))) return "5f0c6a8e-3b1d-4c9a-9e2f-7a1b2c3d4e5f";
  if (format === "date-time") return "2026-10-06T09:30:00Z";
  if (format === "email" || name === "email") return "ada@example.com";
  if (format === "uri" || format === "url" || (name && /url$/.test(name))) return "https://example.com/bitocard/return";
  if (name === "phone") return "+2348031234567";
  if (name === "country") return "NG";
  if (name === "currency") return "NGN";
  if (name === "reason") return "Customer asked to cancel";
  if (name) return name.replace(/_/g, " ");
  return "string";
}

export function exampleFor(schema: Schema | undefined, depth = 0, name?: string): unknown {
  const resolved = resolve(schema);
  if (!resolved || depth > 6) return undefined;
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.enum?.length) return resolved.enum[0];
  const variant = resolved.oneOf?.[0] ?? resolved.anyOf?.find(item => item.type !== "null") ?? resolved.allOf?.[0];
  if (variant) return exampleFor(variant, depth + 1, name);
  const type = Array.isArray(resolved.type) ? resolved.type.find(item => item !== "null") : resolved.type;
  if (type === "object" || resolved.properties) {
    const out: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(resolved.properties ?? {})) {
      const required = resolved.required?.includes(name);
      const value = exampleFor(property, depth + 1, name);
      if (value !== undefined && (required || resolve(property)?.example !== undefined)) out[name] = value;
    }
    return out;
  }
  if (type === "array") {
    const item = exampleFor(resolved.items, depth + 1, name);
    return item === undefined ? [] : [item];
  }
  if (type === "integer" || type === "number") return resolved.minimum ?? 1;
  if (type === "boolean") return true;
  if (type === "string") return stringFor(name, resolved.format);
  return undefined;
}

/** The documented request body example, or one built from the schema. */
export const requestExample = (operation: Operation) => (operation.body ? (operation.body.example ?? exampleFor(operation.body.schema)) : undefined);

/** The success response: first 2xx (or 302). */
export const successResponse = (operation: Operation) => operation.responses.find(item => /^(2\d\d|302)$/.test(item.status));

export type WebhookEvent = { type: string; summary: string; description: string; payload: MediaContent; headers: Parameter[] };

export const webhookEvents: WebhookEvent[] = Object.entries(document.webhooks ?? {}).map(([type, item]) => ({
  type,
  summary: item.post.summary ?? type,
  description: item.post.description ?? "",
  payload: item.post.requestBody?.content?.["application/json"] ?? {},
  headers: item.post.parameters ?? [],
}));

export const eventSlug = (type: string) => type.replace(/\./g, "-");
export const eventBySlug = (value: string) => webhookEvents.find(event => eventSlug(event.type) === value);
