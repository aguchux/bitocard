"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, DataTable, errorMessage, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { AssistantProfileForm, botStatusLabels, providerLabels, roleLabels } from "@bitocard/admin-ui/support";
import { type SupportBot, useCreateSupportBotMutation, useSupportBotsQuery } from "@bitocard/api-client/admin";
import { houseStoreId, useAdminAssistantContext } from "./context";

const status = (row: SupportBot) => <StatusBadge status={row.status === "active" ? "active" : row.status === "suspended" ? "failed" : "pending"} label={botStatusLabels[row.status]} />;

/** Every assistant (to suspend one), and BitoCard's own: bitocard.com's and the assistant for resellers in SHQ. */
export default function AdminAssistantsPage() {
  const router = useRouter();
  const query = useSupportBotsQuery("/v1/admin/support/bots");
  const context = useAdminAssistantContext();
  const [create, state] = useCreateSupportBotMutation();
  const [creating, setCreating] = useState<null | "store" | "platform">(null);
  // BitoCard Shop's assistants left with the Shop (docs/UDOZO_SPINOFF_PLAN.md): Udozo's admin manages them.
  const rows = query.data?.data.filter(row => row.scope !== "shop");
  const ours = (row: SupportBot) => row.scope === "platform" || row.store_id === houseStoreId;
  const open = (row: SupportBot) => router.push(`/support/assistants/${row.id}`);
  return (
    <AdminShell section="support" current="/support/assistants" crumbs={[{ label: "Support", href: "/support" }, { label: "Assistants" }]}>
      <PageHeader
        title="Assistants"
        description="BitoCard’s assistants (bitocard.com’s customers and resellers in SHQ) and every store’s, which you can suspend."
        actions={
          <>
            {!rows?.some(row => row.store_id === houseStoreId) ? (
              <Button variant="secondary" onClick={() => setCreating("store")}>
                bitocard.com assistant
              </Button>
            ) : null}
            {!rows?.some(row => row.scope === "platform") ? (
              <Button variant="secondary" onClick={() => setCreating("platform")}>
                Assistant for resellers
              </Button>
            ) : null}
          </>
        }
      />
      {creating && context ? (
        <Card className="p-5 sm:p-6">
          <AssistantProfileForm
            context={context}
            showStore={creating === "store"}
            submitLabel="Create and add knowledge"
            busy={state.isLoading}
            error={state.error ? errorMessage(state.error) : null}
            onSubmit={async input => {
              const created = await create({ base: "/v1/admin/support/bots", body: { ...input, funding: "bitocard", ...(creating === "platform" ? { scope: "platform", store_id: null } : { store_id: houseStoreId }) } })
                .unwrap()
                .catch(() => null);
              if (created) router.push(`/support/assistants/${created.id}`);
            }}
          />
        </Card>
      ) : null}
      {context && !Object.values(context.ai.bitocard).some(list => (list ?? []).length) ? (
        <Notice tone="amber" title="No AI set up on BitoCard’s keys">
          Add an Anthropic, OpenAI or DeepSeek key, and the models offered, in Settings &gt; Integrations.
        </Notice>
      ) : null}
      <Card>
        <CardHeader title="Support" description="bitocard.com’s customers, resellers in SHQ, and every store’s." />
        <DataTable<SupportBot>
          caption="Assistants"
          rows={query.isLoading ? undefined : rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={open}
          empty="No assistants yet."
          columns={[
            {
              key: "name",
              header: "Assistant",
              cell: row => (
                <AppLink href={`/support/assistants/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                  {row.name}
                </AppLink>
              ),
            },
            { key: "where", header: "For", cell: row => (row.scope === "platform" ? "Resellers in SHQ" : ours(row) ? "bitocard.com" : (row.store_name ?? "A store")) },
            { key: "does", header: "Answers", cell: row => row.roles.map(role => roleLabels[role]).join(", "), hideOnMobile: true },
            { key: "ai", header: "AI", cell: row => `${providerLabels[row.provider]} · ${row.funding === "own" ? "their key" : "BitoCard’s"}`, hideOnMobile: true },
            { key: "status", header: "Status", cell: status },
          ]}
        />
      </Card>
    </AdminShell>
  );
}
