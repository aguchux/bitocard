import type { Metadata } from "next";
import Link from "next/link";
import { MethodBadge } from "@/components/operation-view";
import { inline } from "@/components/schema-view";
import { apiBase, document, operationHref, operationsFor, sections, tagIntros, tagSlug, tags, webhookEvents, eventSlug } from "@/lib/openapi";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every BitoCard API endpoint, generated from the API's own OpenAPI document: parameters, request bodies, response schemas with examples, errors, scopes and code.",
  alternates: { canonical: "/reference" },
};

export default function ReferenceIndex() {
  return (
    <div className="max-w-5xl space-y-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-[#070f4c]">API reference</h1>
        <div className="prose-docs" dangerouslySetInnerHTML={{ __html: inline(document.info.description) }} />
        <dl className="grid gap-4 rounded-2xl border border-slate-200 p-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-[#070f4c]">Base URL</dt>
            <dd className="mt-1 font-mono text-slate-600">{apiBase}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#070f4c]">Authentication</dt>
            <dd className="mt-1 text-slate-600">
              <code className="font-mono">Authorization: Bearer bc_test_…</code> (<Link href="/guides/authentication" className="font-semibold text-[#e0116d]">guide</Link>)
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[#070f4c]">Machine-readable</dt>
            <dd className="mt-1 text-slate-600">
              <a href={`${apiBase}/v1/openapi.json`} className="font-semibold text-[#e0116d]">
                OpenAPI 3.1 document
              </a>
            </dd>
          </div>
        </dl>
      </header>

      {sections.map(section => {
        const present = section.tags.filter(tag => tags.includes(tag));
        if (!present.length) return null;
        return (
          <section key={section.title} aria-labelledby={tagSlug(section.title)} className="space-y-4">
            <h2 id={tagSlug(section.title)} className="text-2xl font-bold tracking-tight text-[#070f4c]">
              {section.title}
            </h2>
            {section.kind === "dashboard" ? <p className="text-sm text-slate-600">These are what SHQ, the reseller dashboard, calls with its signed-in session. API keys cannot use them; they are documented so you know what the dashboard does.</p> : null}
            <div className="grid gap-4 lg:grid-cols-2">
              {present.map(tag => (
                <div key={tag} className="rounded-2xl border border-slate-200 p-5">
                  <Link href={`/reference/${tagSlug(tag)}`} className="text-lg font-semibold text-[#070f4c] hover:text-[#e0116d]">
                    {tag}
                  </Link>
                  {tagIntros[tag] ? <p className="schema-description mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: inline(tagIntros[tag]) }} /> : null}
                  <ul className="mt-3 space-y-1.5">
                    {operationsFor(tag).map(operation => (
                      <li key={operation.id}>
                        <Link href={operationHref(operation)} className="flex items-center gap-2 text-sm hover:text-[#e0116d]">
                          <MethodBadge method={operation.method} small />
                          <span className="min-w-0 truncate font-mono text-[13px] text-slate-700">{operation.path}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section aria-labelledby="events" className="space-y-4">
        <h2 id="events" className="text-2xl font-bold tracking-tight text-[#070f4c]">
          Webhook events
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {webhookEvents.map(event => (
            <li key={event.type}>
              <Link href={`/reference/webhook-events/${eventSlug(event.type)}`} className="block rounded-xl border border-slate-200 p-3 hover:border-slate-300">
                <code className="font-mono text-sm font-semibold text-[#070f4c]">{event.type}</code>
                <span className="mt-0.5 block text-xs text-slate-600">{event.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
