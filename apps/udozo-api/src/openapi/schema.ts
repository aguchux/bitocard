/**
 * Builders for the hand-described parts of the OpenAPI document (responses and webhook payloads). JSON Schema 2020-12,
 * as OpenAPI 3.1 uses: nullable fields are `type: [..., 'null']`. Every object lists every field it returns as
 * required, so a test against real responses catches a field added, renamed or removed without its docs.
 */
export type Schema = Record<string, unknown>;

export const str = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
export const nullableStr = (description: string, extra: Schema = {}): Schema => ({ type: ['string', 'null'], description, ...extra });
export const int = (description: string, extra: Schema = {}): Schema => ({ type: 'integer', description, ...extra });
export const nullableInt = (description: string, extra: Schema = {}): Schema => ({ type: ['integer', 'null'], description, ...extra });
export const num = (description: string, extra: Schema = {}): Schema => ({ type: 'number', description, ...extra });
export const bool = (description: string): Schema => ({ type: 'boolean', description });
export const time = (description: string): Schema => str(description, { format: 'date-time' });
export const nullableTime = (description: string): Schema => nullableStr(description, { format: 'date-time' });
export const uuid = (description: string): Schema => str(description, { format: 'uuid' });
export const nullableUuid = (description: string): Schema => nullableStr(description, { format: 'uuid' });
export const mode: Schema = str('`test` (sandbox) or `live`.', { enum: ['test', 'live'] });
export const money = (what: string) => int(`${what}, in minor units of \`currency\` (for example kobo or cents).`);
export const constant = (value: string) => str(`Always \`${value}\`.`, { const: value });
export const oneOf = (description: string, values: readonly string[]) => str(description, { enum: [...values] });
export const array = (items: Schema, description?: string): Schema => ({ type: 'array', items, ...(description ? { description } : {}) });
export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
export const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
/** A free-form object of strings (recipient details, supplier details). */
export const stringMap = (description: string, nullableMap = false): Schema => ({ type: nullableMap ? ['object', 'null'] : 'object', description, additionalProperties: { type: 'string' } });

/** An object whose every field is required (present, possibly null) and nothing else is allowed. */
export const objectSchema = (title: string, properties: Record<string, Schema>, description?: string): Schema => ({
  type: 'object',
  title,
  ...(description ? { description } : {}),
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
});

/** A nested object: every field required, nothing else allowed. */
export const shape = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: 'object',
  ...(description ? { description } : {}),
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
});

/** `{ object: 'list', data: [...], has_more }`, the shape of every paged list. */
export const list = (item: Schema, extra: Record<string, Schema> = {}, hasMore = true): Schema =>
  shape({
    object: constant('list'),
    data: array(item),
    ...(hasMore ? { has_more: bool('Whether there are more items after these; pass the last ID as `starting_after` to get them.') } : {}),
    ...extra,
  });

/** A paged list's example. */
export const listExample = (data: unknown[], hasMore = false) => ({ object: 'list', data, has_more: hasMore });
