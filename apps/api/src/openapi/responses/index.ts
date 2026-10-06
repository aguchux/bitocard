import { objectSchema, type Schema, shape, str } from '../schema.js';
import { accountDocs } from './account.js';
import { commerceDocs } from './commerce.js';
import { dashboardDocs } from './dashboard.js';
import { developersDocs } from './developers.js';
import { moneyDocs } from './money.js';
import { storesDocs } from './stores.js';

/**
 * What every operation returns, written once per area of the API and merged into the OpenAPI document, so the docs
 * app can show the response schema and a full, realistic example for every endpoint. Tests check that every operation
 * is covered, that each example matches its schema, and that real responses match the schemas.
 */
export type ResponseDoc = {
  /** The success status. 204 and 302 have no body. */
  status: 200 | 201 | 202 | 204 | 302;
  description: string;
  /** A component name (`Order`) or an inline schema; omit for 204 and 302. */
  schema?: string | Schema;
  /** A full, realistic example; required whenever there is a schema. */
  example?: unknown;
};

/** One area of the API: its reusable object schemas, and the response of each operation (`'GET /v1/orders/{id}'`). */
export type DocsArea = { schemas: Record<string, Schema>; responses: Record<string, ResponseDoc> };

export const docsAreas: Record<string, DocsArea> = { accountDocs, commerceDocs, moneyDocs, developersDocs, storesDocs, dashboardDocs };

/** Every error has this shape; `param` is present only when the error is about one field. */
export const errorSchema = objectSchema(
  'Error',
  {
    error: {
      ...shape({
        type: str('The kind of error.', { enum: ['invalid_request_error', 'idempotency_error', 'authentication_error', 'permission_error', 'not_found_error', 'conflict_error', 'rate_limit_error', 'api_error'] }),
        code: str('A stable, machine-readable code, for example `insufficient_funds` or `quote_expired`. Branch on this, not on the message.'),
        message: str('What went wrong, in plain English. Safe to show to your staff; never includes internal details.'),
        param: str('The request field the error is about (for example `quantity` or `recipient.phone`). Only present when there is one.'),
        request_id: str('Quote this when contacting support.'),
      }),
      required: ['type', 'code', 'message', 'request_id'],
    },
  },
  'Every error has this shape. `param` is present only when the error is about one field.',
);

const errorExample = (type: string, code: string, message: string, param?: string) => ({
  error: { type, code, message, ...(param ? { param } : {}), request_id: 'req_8f2c1a7d4e6b' },
});

const errorResponses = {
  400: { description: 'The request is invalid: a field is missing, malformed or not allowed.', example: errorExample('invalid_request_error', 'parameter_invalid', 'quantity must not be greater than 10', 'quantity') },
  401: { description: 'No valid API key or session.', example: errorExample('authentication_error', 'not_authenticated', 'Sign in, or send a valid API key as a Bearer token.') },
  403: { description: 'Authenticated, but not allowed: a missing API key scope, a plan restriction, or a dashboard-only endpoint.', example: errorExample('permission_error', 'not_permitted', 'This API key is missing the scope orders:write.') },
  404: { description: 'Nothing with that ID belongs to your account.', example: errorExample('not_found_error', 'resource_missing', 'No such order.') },
  429: { description: 'Too many requests. Wait for the number of seconds in `Retry-After`, then retry.', example: errorExample('rate_limit_error', 'rate_limited', 'Too many requests. Try again shortly.') },
} as const;

const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Operation = { responses?: Record<string, unknown>; parameters?: Array<{ in: string }>; requestBody?: unknown; [extension: `x-${string}`]: unknown };
type Document = { openapi: string; paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>>; components?: { schemas?: Record<string, unknown> } };

/** Every operation of the document as `'GET /v1/orders/{id}'`. */
export const operationKeys = (document: Pick<Document, 'paths'>) =>
  Object.entries(document.paths).flatMap(([path, item]) => methods.filter(method => item[method]).map(method => `${method.toUpperCase()} ${path}`));

/**
 * Replaces each operation's responses with the documented success response and the errors it can return, and marks
 * routes that accept API keys (`x-bitocard-auth: api_key`) when they do not say otherwise.
 */
export function addResponses<T extends object>(input: T): T {
  const document = input as unknown as Document;
  const schemas: Record<string, unknown> = { ...(document.components?.schemas ?? {}), Error: errorSchema };
  const responses: Record<string, ResponseDoc> = {};
  for (const area of Object.values(docsAreas)) {
    Object.assign(schemas, area.schemas);
    Object.assign(responses, area.responses);
  }
  const errorContent = (example: unknown) => ({ 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example } });

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const doc = responses[`${method.toUpperCase()} ${path}`];
      const auth = (operation['x-bitocard-auth'] as string | undefined) ?? 'api_key';
      operation['x-bitocard-auth'] = auth;
      const next: Record<string, unknown> = {};
      if (doc) {
        const schema = typeof doc.schema === 'string' ? { $ref: `#/components/schemas/${doc.schema}` } : doc.schema;
        next[String(doc.status)] = schema ? { description: doc.description, content: { 'application/json': { schema, example: doc.example } } } : { description: doc.description };
      } else {
        // Undocumented operations keep what Nest generated, and a test fails until they are documented.
        Object.assign(next, operation.responses ?? {});
      }
      const hasInput = Boolean(operation.requestBody) || (operation.parameters ?? []).some(parameter => parameter.in !== 'header');
      if (hasInput) next['400'] = { description: errorResponses[400].description, content: errorContent(errorResponses[400].example) };
      if (auth !== 'public') {
        next['401'] = { description: errorResponses[401].description, content: errorContent(errorResponses[401].example) };
        next['403'] = { description: errorResponses[403].description, content: errorContent(errorResponses[403].example) };
      }
      if (path.includes('{')) next['404'] = { description: errorResponses[404].description, content: errorContent(errorResponses[404].example) };
      next['429'] = { description: errorResponses[429].description, content: errorContent(errorResponses[429].example) };
      operation.responses = next;
    }
  }
  return { ...input, components: { ...document.components, schemas } };
}
