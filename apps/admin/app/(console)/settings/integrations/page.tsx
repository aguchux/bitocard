"use client";

import { useId, useState } from "react";
import { Check, Copy, KeyRound, Pencil } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, ErrorState, errorMessage, Field, formatRelative, Input, Notice, PageHeader, Skeleton, StatusBadge, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type Integration, type IntegrationField, type IntegrationSource, useIntegrationsQuery, useUpdateIntegrationMutation } from "@bitocard/api-client/admin";

const sourceLabels: Record<IntegrationSource, string> = { admin: "Set here", environment: "From .env", default: "Default", unset: "Not set" };
const statusLabels: Record<Integration["status"], string> = { connected: "Connected", incomplete: "Incomplete", not_connected: "Not connected" };

function displayValue(field: IntegrationField) {
  if (field.secret) return field.hint ? `Set (${field.hint})` : "Not set";
  if (field.kind === "flag") return field.value ? "On" : "Off";
  return field.value === null ? "Not set" : String(field.value);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={copied ? "Copied" : "Copy webhook address"}
      icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable: the address is shown to copy by hand */
        }
      }}
    />
  );
}

function IntegrationCard({ integration, editable, onEdit }: { integration: Integration; editable: boolean; onEdit: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={integration.name}
        description={integration.description}
        actions={
          <>
            <StatusBadge status={integration.status} label={statusLabels[integration.status]} />
            {editable ? (
              <Button variant="secondary" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit} aria-label={`Edit ${integration.name}`}>
                Edit
              </Button>
            ) : null}
          </>
        }
      />
      <dl className="mt-4 divide-y divide-line border-t border-line">
        {integration.fields.map(field => (
          <div key={field.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 sm:px-6">
            <dt className="min-w-0 text-sm">
              <span className="font-medium text-ink">{field.label}</span>
              {field.required ? <span className="text-muted"> · required</span> : null}
            </dt>
            <dd className="flex min-w-0 items-center gap-2 text-sm">
              <span className={field.source === "unset" ? "text-subtle" : "break-all text-ink"}>{displayValue(field)}</span>
              {field.source !== "unset" ? (
                <Badge tone={field.source === "admin" ? "blue" : "grey"} dot={false}>
                  {sourceLabels[field.source]}
                </Badge>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {integration.webhook_url ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm sm:px-6">
          <span className="text-muted">Webhook address</span>
          <span className="flex min-w-0 items-center gap-1">
            <code className="break-all rounded-lg bg-canvas px-2 py-1 text-xs text-ink">{integration.webhook_url}</code>
            <CopyButton text={integration.webhook_url} />
          </span>
        </div>
      ) : null}
      {integration.updated_at ? <p className="px-5 pb-4 text-xs text-subtle sm:px-6">{`Changed here ${formatRelative(integration.updated_at)}`}</p> : null}
    </Card>
  );
}

type Draft = Record<string, { value: string | boolean; clear: boolean }>;

const initialDraft = (integration: Integration): Draft =>
  Object.fromEntries(
    integration.fields.map(field => [field.key, { value: field.kind === "flag" ? Boolean(field.value) : field.secret || field.value === null ? "" : String(field.value), clear: false }]),
  );

/** Only what the admin changed: new secrets, edited values, and admin values cleared back to the environment. */
function changesOf(integration: Integration, draft: Draft) {
  const values: Record<string, string | number | boolean | null> = {};
  for (const field of integration.fields) {
    const entry = draft[field.key];
    if (entry.clear) {
      values[field.key] = null;
      continue;
    }
    if (field.kind === "flag") {
      if (entry.value !== Boolean(field.value)) values[field.key] = entry.value;
      continue;
    }
    const text = String(entry.value).trim();
    if (field.secret ? text !== "" : text !== "" && text !== String(field.value ?? "")) values[field.key] = field.kind === "number" ? Number(text) : text;
  }
  return values;
}

function EditDialog({ integration, onClose }: { integration: Integration; onClose: () => void }) {
  const id = useId();
  const [update] = useUpdateIntegrationMutation();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(integration));
  const [code, setCode] = useState("");
  const set = (key: string, change: Partial<Draft[string]>) => setDraft(current => ({ ...current, [key]: { ...current[key], ...change } }));

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Edit ${integration.name}`}
      description="Secrets are encrypted and never shown again; leave a secret blank to keep it. Changes apply within 30 seconds, without a restart."
      confirmLabel="Save changes"
      requireReason={false}
      onConfirm={async () => {
        const values = changesOf(integration, draft);
        if (Object.keys(values).length === 0) throw new Error("Nothing has changed.");
        if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from your authenticator app.");
        await update({ id: integration.id, values, code }).unwrap();
      }}
    >
      {integration.fields.map(field => {
        const inputId = `${id}-${field.key}`;
        const entry = draft[field.key];
        const hint = [field.help, field.source === "environment" ? "Currently from the API’s environment; a value here replaces it." : null].filter(Boolean).join(" ");
        return (
          <div key={field.key} className="space-y-2">
            {field.kind === "flag" ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{field.label}</p>
                  {hint ? <p className="text-xs text-muted">{hint}</p> : null}
                </div>
                <Toggle label={field.label} checked={Boolean(entry.value)} disabled={entry.clear} onChange={checked => set(field.key, { value: checked })} />
              </div>
            ) : (
              <Field label={field.label} htmlFor={inputId} hint={hint || undefined}>
                <Input
                  id={inputId}
                  type={field.secret ? "password" : field.kind === "number" ? "number" : field.kind === "email" ? "email" : field.kind === "url" ? "url" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={entry.clear}
                  placeholder={field.secret ? (field.hint ? `Leave blank to keep (${field.hint})` : "Paste the key") : undefined}
                  value={String(entry.value)}
                  onChange={event => set(field.key, { value: event.target.value })}
                />
              </Field>
            )}
            {field.source === "admin" ? (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="size-4 accent-brand-500" checked={entry.clear} onChange={event => set(field.key, { clear: event.target.checked })} />
                Remove the value set here (the environment or default applies again)
              </label>
            ) : null}
          </div>
        );
      })}
      <div className="rounded-xl bg-canvas p-4">
        <Field label="Authenticator code" htmlFor={`${id}-code`} hint="Changing credentials needs a fresh code from your authenticator app.">
          <Input
            id={`${id}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>
    </ActionDialog>
  );
}

/** Service credentials and settings, set here instead of in the API's environment. Super admins only. */
export default function IntegrationsPage() {
  const admin = useAdmin();
  const allowed = can(admin);
  const { data, error, isLoading, refetch } = useIntegrationsQuery(undefined, { skip: !allowed });
  const [editing, setEditing] = useState<string | null>(null);
  const current = data?.data.find(item => item.id === editing) ?? null;
  const connected = data?.data.filter(item => item.status === "connected").length ?? 0;

  return (
    <AdminShell section="settings" current="/settings/integrations" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Integrations" }]}>
      <PageHeader
        title="Integrations"
        description="Keys and settings for the services BitoCard uses. Values set here replace the API’s environment and apply within 30 seconds, without a restart."
      />
      {!allowed ? (
        <Notice tone="amber" title="Super admins only">
          Service credentials can be viewed and changed only by a super admin.
        </Notice>
      ) : error ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        </Card>
      ) : isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map(index => (
            <Skeleton key={index} className="h-56 w-full" />
          ))}
        </div>
      ) : (
        <>
          <Notice tone="blue">
            <span className="inline-flex items-center gap-2">
              <KeyRound className="size-4 shrink-0" aria-hidden />
              {`${connected} of ${data.data.length} connected. Secrets are encrypted at rest, never shown again, and every change is recorded in the activity log without its value.`}
            </span>
          </Notice>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.data.map(integration => (
              <IntegrationCard key={integration.id} integration={integration} editable={allowed} onEdit={() => setEditing(integration.id)} />
            ))}
          </div>
        </>
      )}
      {current ? <EditDialog key={current.id} integration={current} onClose={() => setEditing(null)} /> : null}
    </AdminShell>
  );
}
