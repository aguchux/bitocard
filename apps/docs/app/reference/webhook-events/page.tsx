import type { Metadata } from "next";
import Link from "next/link";
import { eventSlug, webhookEvents } from "@/lib/openapi";

export const metadata: Metadata = {
  title: "Webhook events",
  description: "Every BitoCard webhook event: when it fires, its full payload with an example, and the headers every delivery carries.",
  alternates: { canonical: "/reference/webhook-events" },
};

export default function WebhookEvents() {
  const groups = [...new Set(webhookEvents.map(event => event.type.split(".")[0]))];
  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-[#e0116d]">
          <Link href="/reference">API reference</Link>
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight text-[#070f4c]">Webhook events</h1>
        <p className="text-lg text-slate-600">
          BitoCard sends these to your endpoints as signed HTTPS <code className="font-mono">POST</code>s. Read the <Link href="/guides/webhooks" className="font-semibold text-[#e0116d]">webhooks guide</Link> to
          receive and verify them; manage endpoints with the <Link href="/reference/webhooks" className="font-semibold text-[#e0116d]">Webhooks API</Link>.
        </p>
      </header>
      {groups.map(group => (
        <section key={group} className="space-y-3">
          <h2 className="text-xl font-bold text-[#070f4c] capitalize">{group.replace(/_/g, " ")}</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {webhookEvents
              .filter(event => event.type.startsWith(`${group}.`))
              .map(event => (
                <li key={event.type}>
                  <Link href={`/reference/webhook-events/${eventSlug(event.type)}`} className="flex flex-col gap-0.5 p-4 hover:bg-slate-50 sm:flex-row sm:items-baseline sm:gap-4">
                    <code className="w-64 shrink-0 font-mono text-sm font-semibold text-[#070f4c]">{event.type}</code>
                    <span className="text-sm text-slate-600">{event.summary}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
