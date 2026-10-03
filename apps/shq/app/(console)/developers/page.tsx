"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  errorMessage,
  Field,
  formatDateTime,
  formatRelative,
  Input,
  Notice,
  PageHeader,
  Select,
} from "@bitocard/admin-ui";
import { type ApiKey, type ApiKeyScope, apiKeyScopes, type Mode, useApiKeysQuery, useCreateApiKeyMutation, useRevokeApiKeyMutation, useRollApiKeyMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { CopyButton, ModeBadge, SecretDialog } from "./developer-parts";

const docsUrl = "https://docs.bitocard.com";
const apiUrl = "https://api.bitocard.com";

const scopeLabels: Record<ApiKeyScope, string> = {
  "catalogue:read": "See the catalogue",
  "quotes:write": "Create quotes",
  "orders:read": "See orders",
  "orders:write": "Place orders",
  "wallet:read": "See the wallet",
  "wallet:write": "Top up the wallet",
  "webhooks:manage": "Manage webhooks",
  "events:read": "Read events",
  "stores:manage": "Manage the store",
  "customers:verify": "Verify customers",
};

const isPast = (iso: string | null) => Boolean(iso && new Date(iso).getTime() <= Date.now());

function keyStatus(key: ApiKey) {
  if (key.revoked_at) return <Badge tone="red">Revoked</Badge>;
  if (isPast(key.expires_at)) return <Badge tone="grey">Expired</Badge>;
  if (key.expires_at) return <Badge tone="amber">{`Expires ${formatRelative(key.expires_at)}`}</Badge>;
  return <Badge tone="green">Active</Badge>;
}

const usable = (key: ApiKey) => !key.revoked_at && !isPast(key.expires_at);

function CreateKeyDialog({ open, onClose, onCreated, verified }: { open: boolean; onClose: () => void; onCreated: (secret: string) => void; verified: boolean }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("test");
  const [scopes, setScopes] = useState<ApiKeyScope[]>([...apiKeyScopes]);
  const [create, state] = useCreateApiKeyMutation();

  const close = () => {
    setName("");
    setMode("test");
    setScopes([...apiKeyScopes]);
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await create({ name: name.trim(), mode, scopes }).unwrap().catch(() => null);
    if (!created) return;
    close();
    onCreated(created.secret);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create an API key"
      description="For your own website, app or back office to call the BitoCard API."
      footer={
        <>
          <Button variant="ghost" type="button" onClick={close} disabled={state.isLoading}>
            Cancel
          </Button>
          <Button type="submit" form="create-api-key" loading={state.isLoading} disabled={!name.trim() || !scopes.length}>
            Create key
          </Button>
        </>
      }
    >
      <form id="create-api-key" onSubmit={submit} className="space-y-5">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Name" htmlFor="key-name" hint="To recognise the key by, such as the system that uses it.">
          <Input id="key-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="Website backend" required autoFocus />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Mode</legend>
          {(
            [
              { value: "test", title: "Test (sandbox)", text: "Test money and simulated orders. Starts with bc_test_." },
              { value: "live", title: "Live", text: "Real orders and real money. Starts with bc_live_." },
            ] as const
          ).map(option => (
            <label key={option.value} htmlFor={`key-mode-${option.value}`} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-sm has-checked:border-brand-500 has-checked:bg-brand-50">
              <input id={`key-mode-${option.value}`} type="radio" name="key-mode" className="mt-0.5 size-4 accent-brand-500" checked={mode === option.value} onChange={() => setMode(option.value)} />
              <span>
                <span className="block font-semibold text-ink">{option.title}</span>
                <span className="text-muted">{option.text}</span>
              </span>
            </label>
          ))}
          {mode === "live" && !verified ? <p className="text-xs text-amber-700">Live keys are available once your business is verified. Use a test key until then.</p> : null}
        </fieldset>
        <fieldset className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className="text-sm font-semibold text-ink">What the key may do</legend>
            <button
              type="button"
              className="text-xs font-semibold text-brand-600 hover:underline"
              onClick={() => setScopes(scopes.length === apiKeyScopes.length ? [] : [...apiKeyScopes])}
            >
              {scopes.length === apiKeyScopes.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {apiKeyScopes.map(scope => (
              <label key={scope} htmlFor={`scope-${scope}`} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-canvas">
                <input
                  id={`scope-${scope}`}
                  type="checkbox"
                  className="size-4 shrink-0 accent-brand-500"
                  checked={scopes.includes(scope)}
                  onChange={event => setScopes(event.target.checked ? [...scopes, scope] : scopes.filter(item => item !== scope))}
                />
                <span className="min-w-0">
                  <span className="block text-ink">{scopeLabels[scope]}</span>
                  <span className="block font-mono text-xs text-subtle">{scope}</span>
                </span>
              </label>
            ))}
          </div>
          {!scopes.length ? <p className="text-xs text-red-700">Choose at least one.</p> : <p className="text-xs text-muted">Give each key only what its system needs.</p>}
        </fieldset>
      </form>
    </Dialog>
  );
}

/** API keys for resellers' own systems. Secrets are shown once, after create or roll, and kept only in this page's state. */
export default function ApiKeysPage() {
  const { membership } = useReseller();
  const allowed = can(membership, "admin", "developer");
  const keys = useApiKeysQuery(undefined, { skip: !allowed });
  const [roll] = useRollApiKeyMutation();
  const [revoke] = useRevokeApiKeyMutation();
  const [creating, setCreating] = useState(false);
  const [rolling, setRolling] = useState<ApiKey | null>(null);
  const [overlap, setOverlap] = useState("24");
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <ShqShell
      section="developers"
      current="/developers"
      crumbs={[{ label: "Developers", href: "/developers" }, { label: "API keys" }]}
    >
      <PageHeader
        title="API keys"
        description="Connect your own website, app or back office to BitoCard. Each key has its own mode, whatever the dashboard switch shows."
        actions={
          allowed ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              Create key
            </Button>
          ) : null
        }
      />

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2 text-sm text-muted">
            <p>
              Your API base URL is <code className="break-all rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">{apiUrl}</code> for both sandbox and live.
            </p>
            <p>
              The key decides the mode: test keys start <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">bc_test_</code> and use the sandbox; live keys start{" "}
              <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">bc_live_</code> and move real money. Send it as <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink [overflow-wrap:anywhere]">Authorization: Bearer &lt;key&gt;</code>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={apiUrl} label="Copy URL" />
            <a href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              <BookOpen className="size-4" aria-hidden />
              API docs
            </a>
          </div>
        </div>
      </Card>

      {!allowed ? (
        <Notice tone="grey" title="Owners, admins and developers only">
          Your role cannot see or manage API keys. Ask the account owner if you need one.
        </Notice>
      ) : (
        <Card>
          <CardHeader title="Your keys" description="Up to 20 active keys. Revoked and expired keys stay listed for your records." />
          <div className="mt-4">
            <DataTable
              caption="API keys"
              rows={keys.data?.data}
              loading={keys.isLoading}
              error={keys.error ? errorMessage(keys.error) : null}
              onRetry={keys.refetch}
              rowKey={key => key.id}
              empty="No API keys yet. Create a test key to try the API in the sandbox."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  cell: key => (
                    <span className="flex min-w-0 items-center gap-2">
                      <KeyRound className="size-4 shrink-0 text-subtle" aria-hidden />
                      <span className="truncate font-semibold text-ink">{key.name}</span>
                    </span>
                  ),
                },
                { key: "mode", header: "Mode", cell: key => <ModeBadge mode={key.mode} /> },
                { key: "key", header: "Key", cell: key => <code className="break-all font-mono text-xs text-muted">{`${key.prefix}…`}</code> },
                {
                  key: "scopes",
                  header: "Access",
                  hideOnMobile: true,
                  cell: key =>
                    key.scopes.length >= apiKeyScopes.length ? (
                      <span className="text-sm">Everything</span>
                    ) : (
                      <span className="text-sm" title={key.scopes.join(", ")}>
                        {key.scopes.length === 1 ? key.scopes[0] : `${key.scopes.length} scopes`}
                      </span>
                    ),
                },
                {
                  key: "used",
                  header: "Last used",
                  hideOnMobile: true,
                  cell: key => <span title={formatDateTime(key.last_used_at)}>{key.last_used_at ? formatRelative(key.last_used_at) : "Never"}</span>,
                },
                { key: "status", header: "Status", cell: keyStatus },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: key =>
                    usable(key) ? (
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => setRolling(key)}>
                          Roll
                        </Button>
                        <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setRevoking(key)}>
                          Revoke
                        </Button>
                      </span>
                    ) : null,
                },
              ]}
            />
          </div>
        </Card>
      )}

      <CreateKeyDialog open={creating} onClose={() => setCreating(false)} onCreated={setSecret} verified={membership.reseller.status === "active"} />

      <ActionDialog
        open={Boolean(rolling)}
        onClose={() => {
          setRolling(null);
          setOverlap("24");
        }}
        title="Roll this key?"
        description={rolling ? `"${rolling.name}" gets a new secret with the same mode and access.` : undefined}
        confirmLabel="Roll key"
        requireReason={false}
        onConfirm={async () => {
          if (!rolling) return;
          const created = await roll({ id: rolling.id, overlap_hours: Number(overlap) }).unwrap();
          setSecret(created.secret);
        }}
      >
        <Field label="Keep the old key working for" htmlFor="roll-overlap" hint="Time to put the new key in place before the old one stops.">
          <Select id="roll-overlap" value={overlap} onChange={event => setOverlap(event.target.value)}>
            <option value="0">No time: stop it now</option>
            <option value="1">1 hour</option>
            <option value="24">24 hours</option>
            <option value="72">72 hours</option>
          </Select>
        </Field>
      </ActionDialog>

      <ActionDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title="Revoke this key?"
        description={revoking ? `"${revoking.name}" stops working immediately. Any system using it will get errors. This cannot be undone.` : undefined}
        confirmLabel="Revoke key"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          if (revoking) await revoke(revoking.id).unwrap();
        }}
      />

      <SecretDialog
        secret={secret}
        title="Your new API key"
        description="Use it from your server only, sent as a Bearer token."
        onClose={() => setSecret(null)}
      />
    </ShqShell>
  );
}
