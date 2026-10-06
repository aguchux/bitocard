import Link from "next/link";
import { ArrowRight, BookOpen, Braces, FlaskConical, KeyRound, Play, Webhook } from "lucide-react";
import { CodeTabs } from "@/components/code-tabs";
import { highlight } from "@/lib/highlight";
import { apiBase, operations, sections, tagIntros, tagSlug, tags, webhookEvents } from "@/lib/openapi";

const firstCall = {
  curl: `curl ${apiBase}/v1/account \\\n  -H "Authorization: Bearer $BITOCARD_API_KEY"`,
  node: `const response = await fetch("${apiBase}/v1/account", {\n  headers: { Authorization: \`Bearer \${process.env.BITOCARD_API_KEY}\` },\n});\nconsole.log(await response.json());`,
  python: `import os\n\nimport requests\n\nresponse = requests.get(\n    "${apiBase}/v1/account",\n    headers={"Authorization": f"Bearer {os.environ['BITOCARD_API_KEY']}"},\n    timeout=30,\n)\nprint(response.json())`,
  php: `<?php\n$client = new \\GuzzleHttp\\Client();\n$response = $client->get('${apiBase}/v1/account', [\n    'headers' => ['Authorization' => 'Bearer ' . getenv('BITOCARD_API_KEY')],\n]);\nprint_r(json_decode((string) $response->getBody(), true));`,
};

const cards = [
  { href: "/guides/quickstart", icon: Play, title: "Quickstart", body: "From a sandbox key to a completed order in five calls." },
  { href: "/reference", icon: Braces, title: "API reference", body: `All ${operations.length} endpoints, with every field, response and error, and code in four languages.` },
  { href: "/guides/webhooks", icon: Webhook, title: "Webhooks", body: `Signed events for orders, top-ups and payouts; ${webhookEvents.length} event types.` },
  { href: "/guides/sandbox-and-live", icon: FlaskConical, title: "Sandbox and live", body: "Simulated fulfilment and money for building; one key change to go live." },
  { href: "/guides/authentication", icon: KeyRound, title: "Authentication", body: "Test and live API keys, scopes, and keeping keys safe." },
  { href: "/guides/try-it", icon: BookOpen, title: "Try it in the docs", body: "Sign in with SHQ and call your own sandbox or live account from any endpoint." },
];

export default async function Home() {
  const tabs = await Promise.all(
    (
      [
        ["curl", "cURL", "bash"],
        ["node", "Node.js", "javascript"],
        ["python", "Python", "python"],
        ["php", "PHP", "php"],
      ] as const
    ).map(async ([id, label, lang]) => ({ id, label, code: firstCall[id], html: await highlight(firstCall[id], lang) })),
  );
  const core = sections.find(section => section.kind === "api")!;

  return (
    <div className="space-y-16">
      <section className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:items-center">
        <div className="space-y-5">
          <p className="inline-flex rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold tracking-wide text-[#e0116d] uppercase">BitoCard API · v1</p>
          <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-[#070f4c] sm:text-5xl">Sell digital products from your own systems</h1>
          <p className="max-w-2xl text-lg text-slate-600">
            One REST API for the BitoCard catalogue, quotes, orders, your wallet and webhooks. Your website, app or back office sells gift cards, airtime, data, bills and more to your
            own customers; BitoCard fulfils them.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/guides/quickstart" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#ff2382] px-5 font-semibold text-white hover:bg-[#e8116d]">
              Start building <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/reference" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-5 font-semibold text-[#070f4c] hover:border-slate-300">
              API reference
            </Link>
          </div>
          <ul className="grid gap-2 pt-2 text-sm text-slate-600 sm:grid-cols-2">
            <li>• One address, {apiBase.replace("https://", "")}; the key picks sandbox or live</li>
            <li>• Every reseller gets a full sandbox</li>
            <li>• Safe retries with idempotency keys</li>
            <li>• Signed webhooks, retried for 3 days</li>
          </ul>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-500">Your first call: which account is this key for?</p>
          <CodeTabs tabs={tabs} title="GET /v1/account" />
        </div>
      </section>

      <section aria-labelledby="start" className="space-y-4">
        <h2 id="start" className="text-2xl font-bold tracking-tight text-[#070f4c]">
          Start here
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(card => (
            <li key={card.href}>
              <Link href={card.href} className="group flex h-full flex-col gap-2 rounded-2xl border border-slate-200 p-5 transition hover:border-[#ff2382] hover:shadow-sm">
                <card.icon className="size-6 text-[#ff2382]" aria-hidden />
                <span className="font-semibold text-[#070f4c] group-hover:text-[#e0116d]">{card.title}</span>
                <span className="text-sm text-slate-600">{card.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="core" className="space-y-4">
        <h2 id="core" className="text-2xl font-bold tracking-tight text-[#070f4c]">
          The core API
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {core.tags
            .filter(tag => tags.includes(tag))
            .map(tag => (
              <li key={tag}>
                <Link href={`/reference/${tagSlug(tag)}`} className="block h-full rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:bg-slate-50">
                  <span className="font-semibold text-[#070f4c]">{tag}</span>
                  <span className="mt-1 block text-sm text-slate-600">{tagIntros[tag]?.replace(/`/g, "")}</span>
                </Link>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
