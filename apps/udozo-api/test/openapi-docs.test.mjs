// The OpenAPI document as the docs app renders it: every operation documents its success response with a full
// example that matches its own schema, says who may call it, and lists the errors it can return.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { operationKeys } from '../dist/openapi/responses/index.js';
import { startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let check;

before(async () => {
  server = await startApp();
  check = await responseChecker(server.app);
});

after(() => server?.close());

const operations = () =>
  operationKeys(check.document).map(key => {
    const [method, path] = key.split(' ');
    return { key, operation: check.document.paths[path][method.toLowerCase()] };
  });

describe('every operation is documented', () => {
  test('each has a success response, and a body schema with a full example unless it returns nothing', () => {
    const missing = [];
    for (const { key, operation } of operations()) {
      const success = Object.entries(operation.responses).find(([status]) => /^(2\d\d|302)$/.test(status));
      if (!success) {
        missing.push(`${key}: no success response`);
        continue;
      }
      const [status, response] = success;
      const content = response.content?.['application/json'];
      if (status === '204' || status === '302') continue;
      if (!content?.schema || content.example === undefined) missing.push(`${key}: ${status} needs a schema and an example`);
    }
    assert.deepEqual(missing, [], `Document these in src/openapi/responses:\n${missing.join('\n')}`);
  });

  test('each example matches its schema', () => {
    const wrong = [];
    for (const { key, operation } of operations()) {
      for (const [status, response] of Object.entries(operation.responses)) {
        const content = response.content?.['application/json'];
        if (!content?.schema || content.example === undefined) continue;
        const validate = check.compile(content.schema);
        if (!validate(content.example)) wrong.push(`${key} ${status}: ${check.ajv.errorsText(validate.errors)}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  test('each says who may call it: public, dashboard sessions only, or API keys (with their scopes)', () => {
    for (const { key, operation } of operations()) {
      assert.ok(['public', 'session', 'api_key'].includes(operation['x-bitocard-auth']), `${key} auth`);
    }
    const order = check.document.paths['/v1/orders'].post;
    assert.deepEqual([order['x-bitocard-auth'], order['x-bitocard-scopes']], ['api_key', ['orders:write']]);
    assert.equal(check.document.paths['/v1/api-keys'].post['x-bitocard-auth'], 'session');
    assert.equal(check.document.paths['/v1/countries'].get['x-bitocard-auth'], 'public');
  });

  test('errors are listed with the shared error shape', () => {
    const responses = check.document.paths['/v1/orders/{id}'].get.responses;
    for (const status of ['401', '403', '404', '429']) assert.equal(responses[status].content['application/json'].schema.$ref, '#/components/schemas/Error');
    assert.equal(check.document.paths['/v1/countries'].get.responses['401'], undefined, 'public routes do not list 401');
  });
});
