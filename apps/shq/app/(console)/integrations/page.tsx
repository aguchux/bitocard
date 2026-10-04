"use client";

import { useId, useState } from "react";
import { CreditCard, DownloadCloud, Package, Plug, RefreshCw, Unplug } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, EmptyState, ErrorState, errorMessage, Field, formatRelative, Input, Notice, PageHeader, Select, Skeleton, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  type IntegrationAccessReason,
  type ResellerIntegration,
  useCheckIntegrationMutation,
  useConnectIntegrationMutation,
  useDisconnectIntegrationMutation,
  useResellerIntegrationsQuery,
  useSetIntegrationRoutingMutation,
  useSyncIntegrationMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const statusLabels = { active: "Active", pending_review: "Waiting for review", rejected: "Not approved", suspended: "Suspended", disconnected: "Not connected" } as const;

const accessHelp: Record<Exclude<IntegrationAccessReason, null>, { text: string; href?: string; action?: string }> = {
  switch_off: { text: "Connecting your own integrations is not switched on for your account yet. Contact BitoCard support to ask for it." },
  plan: { text: "Your plan does not include your own integrations.", href: "/settings/plan", action: "See plans" },
  not_verified: { text: "Live integrations need a live account: the business owner completes the identity check first.", href: "/settings/verification", action: "Identity check" },
  no_country: { text: "Choose your business country first.", href: "/settings", action: "Business settings" },
};

/** Saves credentials. Secrets are never shown again: leave one blank to keep it. */
function ConnectDialog({ integration, sandbox, onClose }: { integration: ResellerIntegration; sandbox: boolean; onClose: () => void }) {
  const id = useId();
  const [connect] = useConnectIntegrationMutation();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(integration.fields.map(field => [field.key, field.secret ? "" : (field.value ?? "")])));
  const connected = Boolean(integration.connection);

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`${connected ? "Update" : "Connect"} ${integration.name}`}
      description={
        sandbox
          ? "Sandbox: use your sandbox credentials. They are stored but never sent to the provider; orders in the sandbox are simulated."
          : `We check these with ${integration.name} before saving them. They are encrypted and never shown again.${integration.approval === "review" ? " BitoCard reviews new and changed credentials before you can use them." : ""}`
      }
      confirmLabel={connected ? "Save credentials" : "Connect"}
      requireReason={false}
      onConfirm={async () => {
        // Blank secrets keep the saved ones, so only send what was typed.
        const submitted = Object.fromEntries(integration.fields.filter(field => !field.secret || values[field.key].trim()).map(field => [field.key, values[field.key].trim()]));
        await connect({ id: integration.id, values: submitted }).unwrap();
      }}
    >
      {integration.fields.map(field => (
        <Field key={field.key} label={`${field.label}${field.required ? "" : " (optional)"}`} htmlFor={`${id}-${field.key}`} hint={field.help ?? undefined}>
          <Input
            id={`${id}-${field.key}`}
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            placeholder={field.secret && field.hint ? `Leave blank to keep (${field.hint})` : undefined}
            value={values[field.key]}
            onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
          />
        </Field>
      ))}
    </ActionDialog>
  );
}

const routingLabels = {
  preferred: "Use first, before BitoCard’s suppliers",
  fallback: "Use only when BitoCard has no offer",
  off: "Don’t use for orders",
} as const;

/** A connected supplier: its catalogue (your products and prices) and when your orders use it. */
function SupplierControls({ integration, manage }: { integration: ResellerIntegration; manage: boolean }) {
  const connection = integration.connection!;
  const [sync, syncState] = useSyncIntegrationMutation();
  const [setRouting, routingState] = useSetIntegrationRoutingMutation();
  const id = `routing-${integration.id}`;
  return (
    <div className="space-y-3 rounded-lg bg-canvas p-3">
      <p className="text-xs text-muted">
        {connection.catalogue.synced_at ? `Catalogue synced ${formatRelative(connection.catalogue.synced_at)}.` : "Catalogue not synced yet: sync it to sell your own products."}
        {connection.catalogue.error ? <span className="block text-red-700">{`Last sync failed: ${connection.catalogue.error}`}</span> : null}
      </p>
      {syncState.isSuccess ? <Notice tone="green">{`${syncState.data.offers} products synced.`}</Notice> : null}
      {syncState.error ? <Notice tone="red">{errorMessage(syncState.error)}</Notice> : null}
      {routingState.error ? <Notice tone="red">{errorMessage(routingState.error)}</Notice> : null}
      <Field label="Orders" htmlFor={id} hint="Each sale through your own supplier is yours; BitoCard charges only its fee.">
        <Select id={id} value={connection.routing} disabled={!manage || routingState.isLoading} onChange={event => setRouting({ id: integration.id, routing: event.target.value as keyof typeof routingLabels })}>
          {Object.entries(routingLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {manage ? (
        <Button size="sm" variant="secondary" icon={<DownloadCloud className="size-4" aria-hidden />} loading={syncState.isLoading} onClick={() => sync(integration.id)}>
          Sync catalogue
        </Button>
      ) : null}
    </div>
  );
}

function IntegrationCard({ integration, manage, onConnect, onDisconnect }: { integration: ResellerIntegration; manage: boolean; onConnect: () => void; onDisconnect: () => void }) {
  const [check, checkState] = useCheckIntegrationMutation();
  const connection = integration.connection;
  const status = connection?.status ?? "disconnected";

  return (
    <Card className="flex flex-col">
      <CardHeader title={integration.name} description={integration.description} actions={<StatusBadge status={status} label={statusLabels[status]} />} />
      <div className="flex flex-1 flex-col gap-3 px-5 pb-5 sm:px-6">
        {connection ? (
          <dl className="grid gap-2 text-sm">
            {integration.fields
              .filter(field => field.value || field.hint)
              .map(field => (
                <div key={field.key} className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted">{field.label}</dt>
                  <dd className="font-medium break-all text-ink">{field.secret ? `Set (${field.hint})` : field.value}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">{integration.approval === "review" ? "Live connections are reviewed by BitoCard before use." : "Live connections are active as soon as the credentials check out."}</p>
        )}
        {integration.kind === "supplier" && connection?.status === "active" ? <SupplierControls integration={integration} manage={manage} /> : null}
        {connection?.decision_note ? <Notice tone={status === "suspended" || status === "rejected" ? "red" : "grey"}>{connection.decision_note}</Notice> : null}
        {connection?.last_check ? (
          <p className={connection.last_check.ok === false ? "text-xs text-red-700" : "text-xs text-muted"}>
            {connection.last_check.ok === false ? `Last check failed ${formatRelative(connection.last_check.checked_at)}: ${connection.last_check.message ?? ""}` : `Checked ${formatRelative(connection.last_check.checked_at)}`}
          </p>
        ) : null}
        {checkState.error ? <Notice tone="red">{errorMessage(checkState.error)}</Notice> : null}
        {manage ? (
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {status !== "suspended" ? (
              <Button size="sm" variant={connection ? "secondary" : "primary"} icon={<Plug className="size-4" aria-hidden />} onClick={onConnect}>
                {connection ? "Update credentials" : "Connect"}
              </Button>
            ) : null}
            {connection && connection.mode === "live" && (status === "active" || status === "pending_review") ? (
              <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} loading={checkState.isLoading} onClick={() => check(integration.id)}>
                Check
              </Button>
            ) : null}
            {connection && status !== "suspended" ? (
              <Button size="sm" variant="ghost" icon={<Unplug className="size-4" aria-hidden />} onClick={onDisconnect}>
                Disconnect
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Group({ title, icon, items, render }: { title: string; icon: React.ReactNode; items: ResellerIntegration[]; render: (item: ResellerIntegration) => React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        {icon}
        {title}
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">{items.map(render)}</div>
    </section>
  );
}

/**
 * Your own supplier and payment gateway accounts, where BitoCard offers them in your country. You fund them yourself;
 * BitoCard is paid by its fees and your subscription from your wallet. Owners and admins manage them.
 */
export default function IntegrationsPage() {
  const { membership, mode } = useReseller();
  const manage = can(membership, "admin");
  const sandbox = mode === "test";
  const { data, error, isLoading, refetch } = useResellerIntegrationsQuery();
  const [disconnect] = useDisconnectIntegrationMutation();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const current = data?.data.find(item => item.id === connecting) ?? null;
  const toRemove = data?.data.find(item => item.id === removing) ?? null;
  const help = data?.access.reason ? accessHelp[data.access.reason] : null;
  const allowed = Boolean(data?.access.allowed);

  const card = (integration: ResellerIntegration) => (
    <IntegrationCard
      key={integration.id}
      integration={integration}
      manage={manage && allowed}
      onConnect={() => setConnecting(integration.id)}
      onDisconnect={() => setRemoving(integration.id)}
    />
  );

  return (
    <ShqShell section="integrations" current="/integrations" crumbs={[{ label: "Integrations" }]}>
      <PageHeader
        title="Your integrations"
        description="Connect your own supplier and payment gateway accounts. You fund them yourself, at your own prices; sales through your own suppliers are yours, and BitoCard charges a small fee per transaction from your wallet."
      />
      {error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map(index => (
            <Skeleton key={index} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {help ? (
            <Notice tone="amber" title="Not available on your account yet">
              {help.text}{" "}
              {help.href ? (
                <AppLink href={help.href} className="font-semibold underline">
                  {help.action}
                </AppLink>
              ) : null}
            </Notice>
          ) : null}
          {!manage ? <Notice tone="grey">Only the owner and admins can connect or change integrations.</Notice> : null}
          {data.data.length === 0 ? (
            <Card>
              <EmptyState title="No integrations in your country yet" icon={<Plug className="size-6" aria-hidden />}>
                BitoCard adds integrations country by country. They appear here as soon as they are available to you.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Group title="Suppliers" icon={<Package className="size-5 text-brand-600" aria-hidden />} items={data.data.filter(item => item.kind === "supplier")} render={card} />
              <Group title="Payment gateways" icon={<CreditCard className="size-5 text-brand-600" aria-hidden />} items={data.data.filter(item => item.kind === "payment_gateway")} render={card} />
            </>
          )}
        </div>
      )}
      {current ? <ConnectDialog key={`${current.id}-${mode}`} integration={current} sandbox={sandbox} onClose={() => setConnecting(null)} /> : null}
      {toRemove ? (
        <ActionDialog
          open
          onClose={() => setRemoving(null)}
          title={`Disconnect ${toRemove.name}?`}
          description="Your saved credentials are erased. You can connect again at any time."
          confirmLabel="Disconnect"
          tone="danger"
          requireReason={false}
          onConfirm={() => disconnect(toRemove.id).unwrap()}
        />
      ) : null}
    </ShqShell>
  );
}
