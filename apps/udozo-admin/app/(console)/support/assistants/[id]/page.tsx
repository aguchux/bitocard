"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ActionDialog, Button, Card, Field, Notice, QueryView, Skeleton, Textarea, errorMessage } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { AssistantDetail, botStatusLabels, providerLabels } from "@bitocard/admin-ui/support";
import { type SupportBot, useSupportBotQuery, useSuspendSupportBotMutation, useUnsuspendSupportBotMutation } from "@bitocard/api-client/admin";
import { ShopAssistantDetail } from "@/components/shop-assistants/detail";
import { houseStoreId, useAdminAssistantContext } from "../context";

function SuspendControls({ bot }: { bot: SupportBot }) {
  const [suspend] = useSuspendSupportBotMutation();
  const [unsuspend, unsuspendState] = useUnsuspendSupportBotMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      {bot.status === "suspended" ? (
        <Button variant="secondary" loading={unsuspendState.isLoading} onClick={() => void unsuspend(bot.id)}>
          Lift suspension
        </Button>
      ) : (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Suspend
        </Button>
      )}
      <ActionDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Suspend ${bot.name}`}
        description="It stops answering at once and its owner is told why. They cannot switch it back on until you lift the suspension."
        confirmLabel="Suspend"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          await suspend({ id: bot.id, reason: reason.trim() }).unwrap();
          setReason("");
        }}
      >
        <Field label="Why (the owner sees this)" htmlFor="suspend-reason" hint="At least 5 characters.">
          <Textarea id="suspend-reason" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        </Field>
      </ActionDialog>
    </>
  );
}

/** One assistant: Udozo's own are managed in full (shop assistants with their own screen); a reseller's are read and can be suspended. */
export default function AdminAssistantPage() {
  const { id } = useParams<{ id: string }>();
  const context = useAdminAssistantContext();
  const query = useSupportBotQuery({ base: "/v1/admin/support/bots", id });
  return (
    <UdozoShell section="assistants" current="/support/assistants" crumbs={[{ label: "Shop assistants", href: "/support/assistants" }, { label: query.data?.name ?? "Assistant" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {bot => {
          if (bot.scope === "shop" && context) return <ShopAssistantDetail context={context} bot={bot} extraActions={<SuspendControls bot={bot} />} />;
          const ours = bot.scope === "platform" || bot.store_id === houseStoreId;
          if (ours && context) return <AssistantDetail context={context} bot={bot} extraActions={<SuspendControls bot={bot} />} />;
          return (
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight text-ink">{bot.name}</h1>
                  <p className="text-sm text-muted">{`${bot.store_name ?? "A store"} · ${providerLabels[bot.provider]} ${bot.model} · ${bot.funding === "own" ? "their key" : "Udozo’s AI"} · ${botStatusLabels[bot.status]}`}</p>
                </div>
                <SuspendControls bot={bot} />
              </div>
              {bot.status === "suspended" ? <Notice tone="red" title="Suspended">{bot.suspended_reason ?? "—"}</Notice> : null}
              {bot.reseller_id ? (
                <AppLink href={`/resellers/${bot.reseller_id}`} className="font-semibold text-brand-600 hover:underline">
                  View the reseller
                </AppLink>
              ) : null}
              {query.error ? <Notice tone="red">{errorMessage(query.error)}</Notice> : null}
            </Card>
          );
        }}
      </QueryView>
    </UdozoShell>
  );
}
