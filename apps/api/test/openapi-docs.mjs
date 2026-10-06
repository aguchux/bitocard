// Checks real API responses against the response schemas in the OpenAPI document, so the docs can never drift from
// what the API returns. Use in any test: `const check = await responseChecker(server.app); check('GET /v1/orders/{id}', 200, json);`
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildOpenApi } from '../dist/bootstrap.js';

/** The OpenAPI document with an Ajv validator for every documented response. */
export async function responseChecker(app) {
  const document = buildOpenApi(app);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'bitocard', components: document.components });
  const validators = new Map();
  const validatorFor = (key, status) => {
    const cacheKey = `${key} ${status}`;
    if (!validators.has(cacheKey)) {
      const [method, path] = key.split(' ');
      const response = document.paths[path]?.[method.toLowerCase()]?.responses?.[String(status)];
      assert.ok(response, `${key} has no documented ${status} response`);
      const schema = response.content?.['application/json']?.schema;
      assert.ok(schema, `${key} ${status} has no documented body`);
      validators.set(cacheKey, ajv.compile(rewriteRefs(schema)));
    }
    return validators.get(cacheKey);
  };
  const check = (key, status, body) => {
    const validate = validatorFor(key, status);
    if (!validate(body)) assert.fail(`${key} ${status} does not match its documented schema:\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n${JSON.stringify(body, null, 2).slice(0, 2000)}`);
  };
  check.document = document;
  check.ajv = ajv;
  check.compile = schema => ajv.compile(rewriteRefs(schema));
  return check;
}

/** `#/components/...` refs point into the schema registered as `bitocard`. */
function rewriteRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === '$ref' && typeof item === 'string' && item.startsWith('#/') ? `bitocard${item}` : rewriteRefs(item)]));
}
