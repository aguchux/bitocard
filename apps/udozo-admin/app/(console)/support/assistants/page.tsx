"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { AssistantProfileForm, botStatusLabels, providerLabels, roleLabels } from "@bitocard/admin-ui/support";
import { type SupportBot, useCreateSupportBotMutation, useSupportBotsQuery } from "@bitocard/api-client/admin";
import { ShopAssistantForm } from "@/components/shop-assistants/form";
import { houseStoreId, useAdminAssistantContext } from "./context";

const status = (row: SupportBot) => <StatusBadge status={row.status === "active" ? "active" : row.status === "suspended" ? "failed" : "pending"} label={botStatusLabels[row.status]} />;

/**
 * Every assistant (to suspend one), and Udozo's own: the marketplace's shop assistants (Anjio, the default, first; then
 * those assigned to countries), udozo.com's support assistant and the one for resellers in Seller HQ.
 */
export default function AdminAssistantsPage() {
  const router = useRouter();
  const query = useSupportBotsQuery("/v1/admin/support/bots");
  const context = useAdminAssistantContext();
  const [create, state] = useCreateSupportBotMutation();
  const [creating, setCreating] = useState<null | "store" | "platform" | "shop">(null);
  const rows = query.data?.data;
  const support = rows?.filter(row => row.scope !== "shop");
  const shop = rows?.filter(row => row.scope === "shop");
  const ours = (row: SupportBot) => row.scope === "platform" || row.store_id === houseStoreId;
  const open = (row: SupportBot) => router.push(`/support/assistants/${row.id}`);
  return (
    <UdozoShell section="assistants" current="/support/assistants" crumbs={[{ label: "Shop assistants", href: "/support/assistants" }, { label: "Assistants" }]}>
      <PageHeader
        title="Assistants"
        description="Udozo’s assistants (the marketplace’s shop assistants, Udozo’s shoppers and resellers in Seller HQ) and every store’s, which you can suspend."
        actions={
          <>
            {!rows?.some(row => row.store_id === houseStoreId) ? (
              <Button variant="secondary" onClick={() => setCreating("store")}>
                udozo.com assistant
              </Button>
            ) : null}
            {!rows?.some(row => row.scope === "platform") ? (
              <Button variant="secondary" onClick={() => setCreating("platform")}>
                Assistant for resellers
              </Button>
            ) : null}
            <Button onClick={() => setCreating("shop")}>Shop assistant</Button>
          </>
        }
      />
      {creating && context ? (
        <Card className="p-5 sm:p-6">
          {creating === "shop" ? (
            <ShopAssistantForm
              context={context}
              submitLabel="Create, then choose its countries"
              busy={state.isLoading}
              error={state.error ? errorMessage(state.error) : null}
              onSubmit={async input => {
                const created = await create({ base: "/v1/admin/support/bots", body: input })
                  .unwrap()
                  .catch(() => null);
                if (created) router.push(`/support/assistants/${created.id}`);
              }}
            />
          ) : (
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
          )}
        </Card>
      ) : null}
      {context && !Object.values(context.ai.bitocard).some(list => (list ?? []).length) ? (
        <Notice tone="amber" title="No AI set up on Udozo’s keys">
          Add an Anthropic, OpenAI or DeepSeek key, and the models offered, in Settings &gt; Integrations.
        </Notice>
      ) : null}
      <Card>
        <CardHeader
          title="Shop assistants"
          description="Anjio answers every country without its own assistant; others take over in their countries and languages."
          actions={
            <AppLink href="/support/assistants/who-answers" className="text-sm font-semibold text-brand-600 hover:underline">
              Coverage
            </AppLink>
          }
        />
        <DataTable<SupportBot>
          caption="Shop assistants"
          rows={query.isLoading ? undefined : shop}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={open}
          empty="No shop assistants."
          columns={[
            {
              key: "name",
              header: "Assistant",
              cell: row => (
                <span className="flex items-center gap-2">
                  <AppLink href={`/support/assistants/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                    {row.name}
                  </AppLink>
                  {row.shop?.default ? <Badge tone="pink">Default</Badge> : null}
                </span>
              ),
            },
            { key: "languages", header: "Languages", cell: row => row.shop?.languages.map(item => item.name).join(", ") ?? "—", hideOnMobile: true },
            { key: "where", header: "Countries", cell: row => (row.shop?.default ? "Every country without its own" : row.shop?.assignments.map(item => (item.language ? `${item.country} (${item.language})` : item.country)).join(", ") || "None yet") },
            { key: "month", header: "This month", cell: row => (row.shop ? `US$${row.shop.month.cost_usd.toFixed(2)}${row.shop.month.budget_usd ? ` of ${row.shop.month.budget_usd}` : ""}` : "—"), hideOnMobile: true },
            { key: "review", header: "Review", cell: row => (row.shop ? `${row.shop.ratings.down} 👎 · ${row.shop.reported} reported` : "—"), hideOnMobile: true },
            { key: "status", header: "Status", cell: status },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Support" description="Udozo’s shoppers, resellers in Seller HQ, and every store’s." />
        <DataTable<SupportBot>
          caption="Assistants"
          rows={query.isLoading ? undefined : support}
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
            { key: "where", header: "For", cell: row => (row.scope === "platform" ? "Resellers in Seller HQ" : ours(row) ? "udozo.com" : (row.store_name ?? "A store")) },
            { key: "does", header: "Answers", cell: row => row.roles.map(role => roleLabels[role]).join(", "), hideOnMobile: true },
            { key: "ai", header: "AI", cell: row => `${providerLabels[row.provider]} · ${row.funding === "own" ? "their key" : "Udozo’s"}`, hideOnMobile: true },
            { key: "status", header: "Status", cell: status },
          ]}
        />
      </Card>
    </UdozoShell>
  );
}
