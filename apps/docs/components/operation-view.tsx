import { highlight } from "@/lib/highlight";
import { type Operation, requestExample, resolve, successResponse } from "@/lib/openapi";
import { codeSamples, languages } from "@/lib/samples";
import { CodeTabs } from "./code-tabs";
import { constraints, inline, SchemaFields, typeLabel } from "./schema-view";
import { TryIt, type TryItOperation } from "./try-it";

const methodTone: Record<string, string> = {
  get: "bg-emerald-100 text-emerald-800",
  post: "bg-blue-100 text-blue-800",
  put: "bg-amber-100 text-amber-900",
  patch: "bg-amber-100 text-amber-900",
  delete: "bg-red-100 text-red-800",
};

export function MethodBadge({ method, small = false }: { method: string; small?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md font-mono font-bold uppercase ${small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"} ${methodTone[method.toLowerCase()] ?? "bg-slate-100 text-slate-700"}`}>
      {method.toUpperCase()}
    </span>
  );
}

/** Who may call it: API keys (with scopes), dashboard sessions only, or anyone. */
export function AuthBadge({ operation }: { operation: Operation }) {
  if (operation.auth === "public") return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Public: no sign-in</span>;
  if (operation.auth === "session") return <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">Dashboard only (SHQ session)</span>;
  return (
    <span className="rounded-full bg-[#070f4c]/5 px-2.5 py-1 text-xs font-semibold text-[#070f4c]">
      API key{operation.scopes.length ? ` · ${operation.scopes.join(", ")}` : ""}
    </span>
  );
}

const statusTone = (status: string) => (status.startsWith("2") || status === "302" ? "text-emerald-700" : status.startsWith("4") ? "text-amber-700" : "text-red-700");

/** One endpoint: what it does, who may call it, its inputs, every response with an example, code and Try it. */
export async function OperationView({ operation }: { operation: Operation }) {
  const parameters = operation.parameters.filter(parameter => parameter.in !== "header" || parameter.name !== "BitoCard-Mode");
  const body = operation.body;
  const example = requestExample(operation);
  const samples = codeSamples(operation);
  const tabs = await Promise.all(languages.map(async language => ({ id: language.id, label: language.label, code: samples[language.id], html: await highlight(samples[language.id], language.shiki) })));
  const success = successResponse(operation);
  const responses = await Promise.all(
    operation.responses.map(async ({ status, response }) => {
      const content = response.content?.["application/json"];
      const code = content?.example !== undefined ? JSON.stringify(content.example, null, 2) : null;
      return { status, response, content, code, html: code ? await highlight(code, "json") : null };
    }),
  );
  const successExample = responses.find(item => item.status === success?.status && item.code);

  const tryIt: TryItOperation = {
    method: operation.method.toUpperCase(),
    path: operation.path,
    summary: operation.summary,
    auth: operation.auth,
    scopes: operation.scopes,
    sandboxOnly: operation.sandboxOnly,
    parameters: parameters
      .filter(parameter => parameter.in === "path" || parameter.in === "query")
      .map(parameter => ({
        name: parameter.name,
        in: parameter.in as "path" | "query",
        required: Boolean(parameter.required || parameter.in === "path"),
        description: parameter.description ?? "",
        example: String(parameter.example ?? parameter.schema?.example ?? (parameter.in === "path" ? "" : (parameter.schema?.default ?? ""))),
      })),
    body: body ? JSON.stringify(example ?? {}, null, 2) : null,
  };

  return (
    <section id={operation.id} aria-labelledby={`${operation.id}-title`} className="scroll-mt-24 border-t border-slate-200 py-10 first:border-t-0 first:pt-2">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="min-w-0 space-y-6">
          <header className="space-y-3">
            <h2 id={`${operation.id}-title`} className="text-2xl font-bold tracking-tight text-[#070f4c]">
              <a href={`#${operation.id}`} className="hover:underline">
                {operation.summary}
              </a>
            </h2>
            <p className="flex flex-wrap items-center gap-2">
              <MethodBadge method={operation.method} />
              <code className="min-w-0 break-all font-mono text-sm text-slate-700">{operation.path}</code>
            </p>
            <p className="flex flex-wrap gap-2">
              <AuthBadge operation={operation} />
              {operation.sandboxOnly ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">Sandbox only</span> : null}
              {operation.method === "post" ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Idempotency-Key required</span> : null}
            </p>
            {operation.roles.length ? <p className="text-xs text-slate-500">Dashboard roles: owner, {operation.roles.join(", ")}.</p> : null}
          </header>

          {operation.description ? <div className="prose-docs" dangerouslySetInnerHTML={{ __html: inline(operation.description) }} /> : null}

          {parameters.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Parameters</h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-4">
                {parameters.map(parameter => (
                  <li key={`${parameter.in}:${parameter.name}`} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <code className="font-mono text-[13px] font-semibold text-[#070f4c]">{parameter.name}</code>
                      <span className="font-mono text-xs text-slate-500">{typeLabel(parameter.schema)}</span>
                      <span className="text-xs text-slate-500">{parameter.in}</span>
                      {parameter.required || parameter.in === "path" ? <span className="text-xs font-semibold text-[#e0116d]">required</span> : null}
                    </div>
                    {parameter.description ? <div className="schema-description mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: inline(parameter.description) }} /> : null}
                    {constraints(resolve(parameter.schema) ?? {}).length ? <p className="mt-1 text-xs text-slate-500">{constraints(resolve(parameter.schema) ?? {}).join(" · ")}</p> : null}
                    {resolve(parameter.schema)?.enum?.length ? (
                      <p className="mt-1.5 flex flex-wrap gap-1 text-xs">
                        <span className="text-slate-500">One of</span>
                        {resolve(parameter.schema)!.enum!.map(value => (
                          <code key={String(value)} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                            {String(value)}
                          </code>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {body ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Request body{operation.bodyRequired ? "" : " (optional)"}</h3>
              <div className="rounded-xl border border-slate-200 bg-white px-4">
                <SchemaFields schema={body.schema} />
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Responses</h3>
            <div className="space-y-2">
              {responses.map(({ status, response, content }) => (
                <details key={status} className="group rounded-xl border border-slate-200 bg-white" open={status === success?.status}>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                    <span className={`font-mono text-sm font-bold ${statusTone(status)}`}>{status}</span>
                    <span className="min-w-0 flex-1 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: inline(response.description) }} />
                    {content?.schema ? <span className="font-mono text-xs text-slate-500">{typeLabel(content.schema)}</span> : null}
                  </summary>
                  {content?.schema && status === success?.status ? (
                    <div className="border-t border-slate-100 px-4">
                      <SchemaFields schema={content.schema} />
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          </div>

          <TryIt operation={tryIt} />
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
          <CodeTabs tabs={tabs} title="Request" />
          {successExample?.html ? (
            <CodeTabs tabs={[{ id: "response", label: `Response ${successExample.status}`, code: successExample.code!, html: successExample.html }]} />
          ) : success ? (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <span className="font-mono font-bold text-emerald-700">{success.status}</span> {success.response.description}
            </p>
          ) : null}
          {responses
            .filter(item => item.status.startsWith("4") && item.html)
            .slice(0, 1)
            .map(item => (
              <details key={item.status} className="rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Error example</summary>
                <div className="px-2 pb-2">
                  <CodeTabs tabs={[{ id: "error", label: `Error ${item.status}`, code: item.code!, html: item.html! }]} />
                </div>
              </details>
            ))}
        </aside>
      </div>
    </section>
  );
}
