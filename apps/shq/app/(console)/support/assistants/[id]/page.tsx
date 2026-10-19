"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, Notice, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AssistantDetail } from "@bitocard/admin-ui/support";
import { useDeleteSupportBotMutation, useSupportBotQuery } from "@bitocard/api-client/reseller";
import { useAssistantContext } from "@/components/assistants";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** One assistant: its knowledge, store, profile, the playground and switching it on. */
export default function AssistantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { membership } = useReseller();
  const allowed = can(membership, "admin");
  const context = useAssistantContext();
  const query = useSupportBotQuery({ base: "/v1/support/bots", id }, { skip: !allowed });
  const [remove, removeState] = useDeleteSupportBotMutation();
  return (
    <ShqShell section="support" current="/support/assistants" crumbs={[{ label: "Support", href: "/support" }, { label: "Assistants", href: "/support/assistants" }, { label: query.data?.name ?? "Assistant" }]}>
      {!allowed ? (
        <Notice tone="grey" title="Owners and admins only">
          Only the owner and admins set up assistants.
        </Notice>
      ) : (
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {bot =>
            context ? (
              <AssistantDetail
                context={context}
                bot={bot}
                extraActions={
                  bot.status !== "active" ? (
                    <Button
                      variant="ghost"
                      loading={removeState.isLoading}
                      onClick={async () => {
                        if (window.confirm(`Delete ${bot.name}? Its knowledge versions go too.`) && (await remove({ base: "/v1/support/bots", id: bot.id }).unwrap().then(() => true).catch(() => false))) router.push("/support/assistants");
                      }}
                    >
                      Delete
                    </Button>
                  ) : null
                }
              />
            ) : (
              <Skeleton className="h-96 w-full" />
            )
          }
        </QueryView>
      )}
    </ShqShell>
  );
}
