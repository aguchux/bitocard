"use client";

import { useId, useState, type FormEvent } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, DataTable, errorMessage, ExternalLinks, Field, formatRelative, Input, Notice, PageHeader, QueryView, Skeleton, StatusBadge } from "@bitocard/admin-ui";
import { type AiProviderName, type AiUsageRow, type SupportAi, useAiUsageQuery, useDeleteAiKeyMutation, useSaveAiKeyMutation, useSupportAiQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const keyLinks: Record<AiProviderName, Array<{ label: string; url: string }>> = {
  anthropic: [{ label: "Get an Anthropic key", url: "https://console.anthropic.com/settings/keys" }],
  openai: [{ label: "Get an OpenAI key", url: "https://platform.openai.com/api-keys" }],
  deepseek: [{ label: "Get a DeepSeek key", url: "https://platform.deepseek.com/api_keys" }],
};

function ProviderCard({ provider }: { provider: SupportAi["providers"][number] }) {
  const id = useId();
  const [save, saveState] = useSaveAiKeyMutation();
  const [remove, removeState] = useDeleteAiKeyMutation();
  const [key, setKey] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (key.trim().length < 16) return;
    if (await save({ provider: provider.provider, api_key: key.trim() }).unwrap().catch(() => null)) setKey("");
  };
  const own = provider.own_key;
  return (
    <Card className="space-y-4 p-5">
      <CardHeader title={provider.label} className="px-0 pt-0 pb-0" />
      <p className="text-sm text-muted">
        {provider.bitocard_models.length ? `On BitoCard’s AI (Premium): ${provider.bitocard_models.join(", ")}.` : "Not offered on BitoCard’s AI: use your own key."}
      </p>
      {own ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas p-3 text-sm">
          <span className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted" aria-hidden />
            Your key ending {own.last4} · checked {formatRelative(own.checked_at)}
          </span>
          {own.failed_at ? <StatusBadge status="failed" label="Refused by the provider: replace it" /> : <StatusBadge status="active" label="Working" />}
          <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} loading={removeState.isLoading} onClick={() => void remove(provider.provider)}>
            Remove
          </Button>
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-3" noValidate>
        {saveState.error ? <Notice tone="red">{errorMessage(saveState.error)}</Notice> : null}
        <Field label={own ? "Replace your key" : "Your API key"} htmlFor={`${id}-key`} hint="Checked with the provider before it is saved, then kept encrypted. You pay the provider for what your assistants use.">
          <Input id={`${id}-key`} type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ExternalLinks links={keyLinks[provider.provider]} />
          <Button type="submit" loading={saveState.isLoading} disabled={key.trim().length < 16}>
            Save key
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Overview({ ai }: { ai: SupportAi }) {
  const usage = useAiUsageQuery();
  const stores = new Map(ai.allowance.stores.map(store => [store.store_id, store.store_name]));
  return (
    <div className="space-y-4">
      {ai.premium ? (
        <Notice tone="green" title="Premium: BitoCard’s AI is included">
          {`Each store gets ${ai.allowance.replies_per_store.toLocaleString("en-GB")} assistant replies a month on BitoCard’s AI. Past that, people answer until next month, or your own key takes over.`}
        </Notice>
      ) : (
        <Notice tone="blue" title="Use your own AI key, or Premium">
          Add a key from Anthropic, OpenAI or DeepSeek below and your assistants run on it (you pay the provider). On Premium, BitoCard’s AI is included.
        </Notice>
      )}
      {ai.premium && ai.allowance.stores.length ? (
        <Card className="p-5">
          <CardHeader title="This month on BitoCard’s AI" className="px-0 pt-0 pb-3" />
          <ul className="space-y-1 text-sm">
            {ai.allowance.stores.map(store => (
              <li key={store.store_id} className="flex justify-between gap-3">
                <span>{store.store_name}</span>
                <span className="text-muted">{`${store.bitocard_replies.toLocaleString("en-GB")} of ${ai.allowance.replies_per_store.toLocaleString("en-GB")} replies`}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {ai.providers.map(provider => (
          <ProviderCard key={provider.provider} provider={provider} />
        ))}
      </div>
      <Card>
        <DataTable<AiUsageRow>
          caption="AI use this month"
          rows={usage.isLoading ? undefined : usage.data?.data}
          loading={usage.isLoading}
          error={usage.error ? errorMessage(usage.error) : null}
          onRetry={usage.refetch}
          rowKey={row => `${row.store_id}-${row.funding}-${row.provider}-${row.model}`}
          empty="No AI use yet this month."
          columns={[
            { key: "store", header: "Store", cell: row => (row.store_id ? (stores.get(row.store_id) ?? "A store") : "—") },
            { key: "ai", header: "AI", cell: row => `${row.model} · ${row.funding === "own" ? "your key" : "BitoCard’s"}` },
            { key: "calls", header: "Calls", cell: row => row.calls.toLocaleString("en-GB") },
            { key: "tokens", header: "Tokens in / out", cell: row => `${row.input_tokens.toLocaleString("en-GB")} / ${row.output_tokens.toLocaleString("en-GB")}`, hideOnMobile: true },
          ]}
        />
      </Card>
    </div>
  );
}

/** The AI behind the reseller's support assistants: BitoCard's on Premium, or their own keys; and how much is used. */
export default function SupportAiPage() {
  const { membership } = useReseller();
  const allowed = can(membership, "admin");
  const query = useSupportAiQuery(undefined, { skip: !allowed });
  return (
    <ShqShell section="support" current="/support/ai" crumbs={[{ label: "Support", href: "/support" }, { label: "AI keys" }]}>
      <PageHeader title="AI for your assistants" description="Your support assistants answer with Anthropic, OpenAI or DeepSeek: on your own key, or on BitoCard’s with Premium." />
      {allowed ? (
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {ai => <Overview ai={ai} />}
        </QueryView>
      ) : (
        <Notice tone="grey" title="Owners and admins only">
          Only the owner and admins manage AI keys.
        </Notice>
      )}
    </ShqShell>
  );
}
