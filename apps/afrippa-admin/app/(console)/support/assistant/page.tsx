"use client";

import { useState } from "react";
import { Button, Card, CardHeader, errorMessage, Field, Input, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { AssistantDetail, type AssistantContext, AssistantProfileForm } from "@bitocard/admin-ui/support";
import { type SupportBot, useAdminSupportAiQuery, useCreateSupportBotMutation, useSupportBotsQuery, useUpdateSupportBotMutation } from "@bitocard/api-client/admin";
import { AfrippaShell } from "@/components/shell";

/** BitoCard's admin path: this app's switch (`setAdminProduct`) sends it to `/v1/afrippa/admin/support/bots`. */
const base = "/v1/admin/support/bots";
/** Afrippa's own store, where its assistant lives. */
const afrippaStoreId = "00000000-0000-4000-8000-0000000000a2";

/** Afrippa's assistant runs on Afrippa's own AI: the models with a key and a price in Settings > Integrations. */
function useAfrippaAssistantContext(): AssistantContext | null {
  const ai = useAdminSupportAiQuery();
  if (!ai.data) return null;
  const models: AssistantContext["ai"]["bitocard"] = {};
  for (const item of ai.data.bitocard_models) models[item.provider] = [...(models[item.provider] ?? []), item.model];
  return { base, admin: true, stores: [{ id: afrippaStoreId, name: "Afrippa" }], ai: { premium: true, bitocard: models, own: {} }, realm: "admin", avatarPurpose: "afrippa_bot_avatar", brand: "Afrippa", refresh: false };
}

/** The assistant's monthly spend cap on Afrippa's AI: past it, people answer until next month. */
function Budget({ bot }: { bot: SupportBot }) {
  const current = (bot as SupportBot & { limits?: { monthly_budget_usd?: number | null } }).limits?.monthly_budget_usd ?? null;
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [update, state] = useUpdateSupportBotMutation();
  const dollars = value.trim() === "" ? null : Number(value);
  const valid = dollars === null || (Number.isInteger(dollars) && dollars >= 1 && dollars <= 1_000_000);
  return (
    <Card className="space-y-3 p-5">
      <CardHeader title="Monthly budget" description="What the assistant may spend on Afrippa's AI each month, in US dollars. Past it, people answer until the month ends. Empty: no cap." className="px-0 pt-0 pb-0" />
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="US dollars a month" htmlFor="assistant-budget" error={valid ? undefined : "A whole number of dollars, at least 1."}>
          <Input id="assistant-budget" inputMode="numeric" className="w-40" value={value} onChange={event => setValue(event.target.value)} />
        </Field>
        <Button variant="secondary" disabled={!valid} loading={state.isLoading} onClick={() => void update({ base, id: bot.id, body: { limits: { monthly_budget_usd: dollars } } })}>
          Save
        </Button>
      </div>
    </Card>
  );
}

/**
 * Help > Assistant: Afrippa's one AI assistant, answering traders' and visitors' chats (and tickets, if chosen) with
 * Afrippa's rules, its knowledge generated from Afrippa's live settings, and tools that read ads, fees, safety checks
 * and a trader's own orders. It never acts on money. Runs on Afrippa's own AI, within its monthly budget.
 */
export default function AssistantPage() {
  const admin = useAdmin();
  const context = useAfrippaAssistantContext();
  const query = useSupportBotsQuery(base);
  const [create, createState] = useCreateSupportBotMutation();
  const edits = can(admin, "operations", "support");
  return (
    <AfrippaShell section="support" current="/support/assistant" crumbs={[{ label: "Help", href: "/support" }, { label: "Assistant" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {list => {
          const bot = list.data[0];
          if (bot && context) {
            return (
              <div className="space-y-4">
                <AssistantDetail context={context} bot={bot} />
                <Budget key={bot.id} bot={bot} />
              </div>
            );
          }
          return (
            <>
              <PageHeader title="Assistant" description="An AI assistant that answers traders and visitors on afrippa.com first, and hands over to Afrippa's team when it should. It never acts on money." />
              {!context ? (
                <Skeleton className="h-64 w-full" />
              ) : Object.keys(context.ai.bitocard).length === 0 ? (
                <Notice tone="amber" title="Set up Afrippa's AI first">
                  Add Anthropic or OpenAI in Settings &gt; Integrations, with its key and the price of the model to use. The assistant runs on Afrippa&apos;s own AI only.
                </Notice>
              ) : edits ? (
                <Card className="p-5 sm:p-6">
                  <AssistantProfileForm
                    context={context}
                    submitLabel="Create the assistant"
                    busy={createState.isLoading}
                    error={createState.error ? errorMessage(createState.error) : null}
                    onSubmit={async input => {
                      await create({ base, body: { ...input, funding: "bitocard" } })
                        .unwrap()
                        .catch(() => null);
                    }}
                  />
                </Card>
              ) : (
                <Notice tone="grey">No assistant yet.</Notice>
              )}
            </>
          );
        }}
      </QueryView>
    </AfrippaShell>
  );
}
