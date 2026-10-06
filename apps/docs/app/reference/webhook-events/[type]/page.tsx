import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeTabs } from "@/components/code-tabs";
import { inline, SchemaFields } from "@/components/schema-view";
import { highlight } from "@/lib/highlight";
import { eventBySlug, eventSlug, webhookEvents } from "@/lib/openapi";
import { renderMarkdown } from "@/lib/highlight";

export const dynamicParams = false;

export function generateStaticParams() {
  return webhookEvents.map(event => ({ type: eventSlug(event.type) }));
}

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const event = eventBySlug((await params).type);
  if (!event) return {};
  return { title: `${event.type} webhook`, description: event.summary, alternates: { canonical: `/reference/webhook-events/${eventSlug(event.type)}` } };
}

export default async function EventPage({ params }: { params: Promise<{ type: string }> }) {
  const event = eventBySlug((await params).type);
  if (!event) notFound();
  const example = event.payload.example !== undefined ? JSON.stringify(event.payload.example, null, 2) : null;
  const exampleHtml = example ? await highlight(example, "json") : null;
  const description = await renderMarkdown(event.description);
  const others = webhookEvents.filter(item => item.type !== event.type && item.type.split(".")[0] === event.type.split(".")[0]);

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <div className="min-w-0 space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold text-[#e0116d]">
            <Link href="/reference/webhook-events">Webhook events</Link>
          </p>
          <h1 className="font-mono text-3xl font-bold tracking-tight text-[#070f4c]">{event.type}</h1>
          <p className="text-lg text-slate-600">{event.summary}</p>
        </header>
        <div className="prose-docs" dangerouslySetInnerHTML={{ __html: description.html }} />

        <section aria-labelledby="payload" className="space-y-2">
          <h2 id="payload" className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Payload
          </h2>
          <div className="rounded-xl border border-slate-200 px-4">
            <SchemaFields schema={event.payload.schema} />
          </div>
        </section>

        <section aria-labelledby="headers" className="space-y-2">
          <h2 id="headers" className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Headers on every delivery
          </h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
            {event.headers.map(header => (
              <li key={header.name} className="py-3">
                <code className="font-mono text-[13px] font-semibold text-[#070f4c]">{header.name}</code>
                {header.description ? <div className="schema-description mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: inline(header.description) }} /> : null}
              </li>
            ))}
          </ul>
        </section>

        {others.length ? (
          <p className="text-sm text-slate-600">
            Related:{" "}
            {others.map((item, index) => (
              <span key={item.type}>
                {index ? ", " : ""}
                <Link href={`/reference/webhook-events/${eventSlug(item.type)}`} className="font-mono font-semibold text-[#e0116d]">
                  {item.type}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
        {example && exampleHtml ? <CodeTabs tabs={[{ id: "payload", label: "Example delivery body", code: example, html: exampleHtml }]} /> : null}
      </aside>
    </div>
  );
}
