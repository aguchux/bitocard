"use client";

import { useRouter } from "next/navigation";
import { Card, errorMessage, Notice, PageHeader, Skeleton } from "@bitocard/admin-ui";
import { AssistantProfileForm } from "@bitocard/admin-ui/support";
import { useCreateSupportBotMutation } from "@bitocard/api-client/reseller";
import { useAssistantContext } from "@/components/assistants";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/**
 * New assistant: role, AI agent, profile and store here; its page then takes the knowledge (upload, or generate from
 * BitoCard), the test and activation.
 */
export default function NewAssistantPage() {
  const router = useRouter();
  const { membership } = useReseller();
  const allowed = can(membership, "admin");
  const context = useAssistantContext();
  const [create, state] = useCreateSupportBotMutation();
  return (
    <ShqShell section="support" current="/support/assistants" crumbs={[{ label: "Support", href: "/support" }, { label: "Assistants", href: "/support/assistants" }, { label: "New" }]}>
      <PageHeader title="New assistant" description="Choose what it answers and its AI, give it a profile and a store. Next you add what it knows, try it, and switch it on." />
      {!allowed ? (
        <Notice tone="grey" title="Owners and admins only">
          Only the owner and admins set up assistants.
        </Notice>
      ) : !context ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card className="p-5 sm:p-6">
          {!context.ai.premium && !Object.keys(context.ai.own).length ? (
            <Notice tone="amber" title="Add an AI key first, or go Premium">
              Your assistant needs an AI to answer with. Add your own Anthropic, OpenAI or DeepSeek key in Support &gt; AI keys, or change to Premium to use BitoCard’s.
            </Notice>
          ) : null}
          <AssistantProfileForm
            context={context}
            showStore
            submitLabel="Create and add knowledge"
            busy={state.isLoading}
            error={state.error ? errorMessage(state.error) : null}
            onSubmit={async input => {
              const created = await create({ base: "/v1/support/bots", body: input }).unwrap().catch(() => null);
              if (created) router.push(`/support/assistants/${created.id}`);
            }}
          />
        </Card>
      )}
    </ShqShell>
  );
}
