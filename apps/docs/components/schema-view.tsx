import { marked } from "marked";
import { refName, resolve, type Schema } from "@/lib/openapi";

/** Descriptions are short Markdown (code spans, links, emphasis). */
export const inline = (text: string | undefined) => (text ? (marked.parseInline(text, { async: false }) as string) : "");

/** `CreateOrderDto` → `CreateOrder`; component names read as object names. */
const readable = (name: string) => name.replace(/Dto$/, "");

const typeOf = (schema: Schema): string[] => (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []);

/** A short type label: `string (uuid)`, `integer`, `array of Order`, `Order`, `string or null`. */
export function typeLabel(input: Schema | undefined): string {
  if (!input) return "any";
  const name = refName(input);
  if (name) return readable(name);
  const variants = input.oneOf ?? input.anyOf;
  if (variants) {
    const labels = variants.map(variant => (variant.type === "null" ? "null" : typeLabel(variant)));
    return [...new Set(labels)].join(" or ");
  }
  if (input.allOf?.length) return input.allOf.map(typeLabel).join(" + ");
  const types = typeOf(input);
  const nullable = types.includes("null");
  const main = types.filter(type => type !== "null");
  let label = main.join(" or ") || (input.properties ? "object" : "any");
  if (main.includes("array")) label = `array of ${typeLabel(input.items)}`;
  if (input.format && !["int32", "int64", "double", "float"].includes(input.format)) label += ` (${input.format})`;
  return nullable ? `${label} or null` : label;
}

const isObject = (schema: Schema | undefined): boolean => {
  const resolved = resolve(schema);
  if (!resolved) return false;
  if (resolved.properties) return true;
  if (resolved.oneOf || resolved.anyOf) return (resolved.oneOf ?? resolved.anyOf)!.some(variant => variant.type !== "null" && isObject(variant));
  if (typeOf(resolved).includes("array")) return isObject(resolved.items);
  return Boolean(resolved.allOf);
};

/** Constraints worth showing: allowed values, ranges, lengths, defaults. */
export function constraints(schema: Schema) {
  const out: string[] = [];
  if (schema.minimum !== undefined && schema.maximum !== undefined) out.push(`${schema.minimum} to ${schema.maximum}`);
  else if (schema.minimum !== undefined) out.push(`at least ${schema.minimum}`);
  else if (schema.maximum !== undefined) out.push(`at most ${schema.maximum}`);
  if (schema.minLength !== undefined && schema.maxLength !== undefined) out.push(`${schema.minLength} to ${schema.maxLength} characters`);
  else if (schema.maxLength !== undefined) out.push(`up to ${schema.maxLength} characters`);
  if (schema.default !== undefined) out.push(`default ${JSON.stringify(schema.default)}`);
  return out;
}

/** The fields of an object: name, type, required, description, allowed values; nested objects open on demand. */
export function SchemaFields({ schema, depth = 0 }: { schema: Schema | undefined; depth?: number }) {
  const resolved = resolve(schema);
  if (!resolved || depth > 6) return null;

  const variants = resolved.oneOf ?? resolved.anyOf;
  if (variants && !resolved.properties) {
    const objects = variants.filter(variant => variant.type !== "null");
    if (objects.length === 1) return <SchemaFields schema={objects[0]} depth={depth} />;
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">One of:</p>
        {objects.map((variant, index) => (
          <details key={index} className="rounded-lg border border-slate-200 bg-white" open={depth === 0 && index === 0}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[#070f4c]">{resolve(variant)?.title ?? typeLabel(variant)}</summary>
            <div className="border-t border-slate-100 px-3 py-2">
              <SchemaFields schema={variant} depth={depth + 1} />
            </div>
          </details>
        ))}
      </div>
    );
  }
  if (resolved.allOf) {
    return (
      <>
        {resolved.allOf.map((part, index) => (
          <SchemaFields key={index} schema={part} depth={depth} />
        ))}
      </>
    );
  }
  if (typeOf(resolved).includes("array") && resolved.items) return <SchemaFields schema={resolved.items} depth={depth} />;
  if (!resolved.properties) {
    return resolved.additionalProperties ? <p className="text-sm text-slate-600">Any keys, each a {typeLabel(resolved.additionalProperties === true ? undefined : resolved.additionalProperties)}.</p> : null;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {Object.entries(resolved.properties).map(([name, property]) => {
        const field = resolve(property) ?? {};
        const required = resolved.required?.includes(name);
        const values = field.enum ?? (field.oneOf ?? field.anyOf)?.flatMap(variant => resolve(variant)?.enum ?? []);
        const notes = constraints(field);
        const nested = isObject(property);
        return (
          <li key={name} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-[13px] font-semibold text-[#070f4c]">{name}</code>
              <span className="font-mono text-xs text-slate-500">{typeLabel(property)}</span>
              {required ? <span className="text-xs font-semibold text-[#e0116d]">required</span> : null}
            </div>
            {field.description ? <div className="schema-description mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: inline(field.description) }} /> : null}
            {values?.length ? (
              <p className="mt-1.5 flex flex-wrap gap-1 text-xs">
                <span className="text-slate-500">One of</span>
                {[...new Set(values)].map(value => (
                  <code key={String(value)} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    {String(value)}
                  </code>
                ))}
              </p>
            ) : null}
            {notes.length ? <p className="mt-1 text-xs text-slate-500">{notes.join(" · ")}</p> : null}
            {nested ? (
              <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60">
                <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-slate-600">Fields of {name}</summary>
                <div className="border-t border-slate-200 bg-white px-3">
                  <SchemaFields schema={property} depth={depth + 1} />
                </div>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
