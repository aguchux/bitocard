"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Copy, Globe, Mail, RefreshCw, Search, ServerCog, Trash2 } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, Dialog, errorMessage, Field, formatDate, Input, Notice, Select, StatusBadge, Toggle } from "@bitocard/admin-ui";
import {
  type DnsImport,
  type DnsRecordType,
  type DomainContact,
  type DomainOffer,
  type MailProvider,
  type MailSetup,
  type StoreDomain,
  useAddDomainRecordMutation,
  useBuyDomainMutation,
  useCheckDomainMutation,
  useConnectDomainMutation,
  useDeleteDomainRecordMutation,
  useDomainRecordsQuery,
  useDomainTransferCodeMutation,
  useEnableEmailSendingMutation,
  useImportDomainRecordsMutation,
  useLazyDomainImportPreviewQuery,
  useLazySearchDomainsQuery,
  useRemoveDomainMutation,
  useRenewDomainMutation,
  useSetMailProviderMutation,
  useUpdateDomainMutation,
} from "@bitocard/api-client/reseller";

const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
export const statusLabels: Record<StoreDomain["status"], string> = {
  purchasing: "Buying",
  pending: "Waiting for DNS",
  active: "Live",
  failed: "Not bought",
  expired: "Expired",
  suspended: "Suspended",
  removed: "Removed",
};
export const statusTone = (status: StoreDomain["status"]) => (status === "active" ? "green" : status === "pending" || status === "purchasing" ? "amber" : status === "suspended" || status === "expired" || status === "failed" ? "red" : "grey");
export const mailNames: Record<MailProvider, string> = { google: "Google Workspace", microsoft: "Microsoft 365", zoho: "Zoho Mail" };

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}
      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-600 hover:bg-brand-50"
      aria-label={`Copy ${value}`}
    >
      <Copy className="size-3.5" aria-hidden />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** DNS records to set, as a compact table that stacks on phones, each value with copy. */
function RecordsToSet({ records }: { records: Array<{ type: string; name: string; value: string; priority?: number | null }> }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {records.map((record, index) => (
        <li key={`${record.type}-${record.name}-${index}`} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[4.5rem_8rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
          <span className="font-semibold text-ink">{record.type}{record.priority != null ? ` ${record.priority}` : ""}</span>
          <span className="break-all font-mono text-xs text-muted">{record.name || "@"}</span>
          <span className="break-all font-mono text-xs text-ink">{record.value}</span>
          <CopyButton value={record.value} />
        </li>
      ))}
    </ul>
  );
}

/** Find a .com and buy it: price and renewal shown, then the registrant's details, then the wallet charge. */
export function BuyDomain({ store, available, tlds, contactDefaults, live, onBought }: { store: string; available: boolean; tlds: string[]; contactDefaults: Partial<DomainContact>; live: boolean; onBought?: (domain: StoreDomain) => void }) {
  const [query, setQuery] = useState("");
  const [search, results] = useLazySearchDomainsQuery();
  const [chosen, setChosen] = useState<DomainOffer | null>(null);
  if (!available) {
    return (
      <Card>
        <CardHeader title="Buy a domain" description="Buying domains here is not open yet. You can connect a domain you already own instead." />
        <div className="h-5" />
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Buy a domain" description={`Find a ${tlds.map(tld => `.${tld}`).join(", ")} for your store. It is registered in your name, connected for you, and paid from your wallet.`} />
      <form
        className="flex flex-col gap-3 px-5 pb-5 pt-4 sm:flex-row sm:px-6"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (query.trim().length >= 2) void search({ store, q: query.trim() });
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="domain-search" className="sr-only">Domain name</label>
          <Input id="domain-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="yourstore" autoComplete="off" />
        </div>
        <Button type="submit" icon={<Search className="size-4" aria-hidden />} loading={results.isFetching} disabled={query.trim().length < 2}>
          Search
        </Button>
      </form>
      {results.error ? <div className="px-5 pb-5 sm:px-6"><Notice tone="red">{errorMessage(results.error)}</Notice></div> : null}
      {results.data ? (
        <ul className="divide-y divide-line border-t border-line">
          {results.data.data.map(offer => (
            <li key={offer.domain} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="break-all font-semibold text-ink">{offer.domain}</p>
                <p className="text-sm text-muted">{offer.available && offer.price && offer.renewal_price ? `${usd(offer.price.amount)} the first year, then ${usd(offer.renewal_price.amount)} a year` : "Not available"}</p>
              </div>
              {offer.available ? (
                <Button size="sm" onClick={() => setChosen(offer)} disabled={!live}>
                  Buy
                </Button>
              ) : (
                <Badge tone="grey">Taken</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {!live ? <div className="px-5 pb-5 sm:px-6"><Notice tone="amber">Domains are bought with your live wallet. Switch to live to buy one.</Notice></div> : null}
      {chosen ? <BuyDialog store={store} offer={chosen} defaults={contactDefaults} onClose={() => setChosen(null)} onBought={onBought} /> : null}
    </Card>
  );
}

/** The registrant's details, filled from the seller's account where known. */
export const blankContact = (defaults: Partial<DomainContact>): DomainContact => ({ first_name: "", last_name: "", email: "", phone: "", address1: "", city: "", state: "", zip: "", country: "", ...defaults });
export const contactComplete = (contact: DomainContact) => ["first_name", "last_name", "email", "phone", "address1", "city", "state", "zip", "country"].every(key => (contact[key as keyof DomainContact] ?? "").trim());
export const cleanContact = (contact: DomainContact): DomainContact => ({ ...contact, country: contact.country.trim().toUpperCase() });

/** Who the domain is registered to: you or your business. */
export function ContactFields({ contact, onChange }: { contact: DomainContact; onChange: (next: DomainContact) => void }) {
  const set = (key: keyof DomainContact) => (event: { target: { value: string } }) => onChange({ ...contact, [key]: event.target.value });
  const field = (key: keyof DomainContact, label: string, extra: { hint?: string; type?: string; autoComplete?: string } = {}) => (
    <Field label={label} htmlFor={`contact-${key}`} hint={extra.hint}>
      <Input id={`contact-${key}`} value={contact[key] ?? ""} onChange={set(key)} type={extra.type ?? "text"} autoComplete={extra.autoComplete} />
    </Field>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        The domain is registered in this name: you or your business. The registrar emails this address once to confirm it; confirm it within 15 days or the domain is paused. Domains bought
        here are yours.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("first_name", "First name", { autoComplete: "given-name" })}
        {field("last_name", "Last name", { autoComplete: "family-name" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("phone", "Phone", { hint: "International form, for example +2348031234567.", autoComplete: "tel" })}
        {field("company_name", "Business name (optional)", { autoComplete: "organization" })}
        {field("address1", "Address", { autoComplete: "address-line1" })}
        {field("city", "City", { autoComplete: "address-level2" })}
        {field("state", "State or region", { autoComplete: "address-level1" })}
        {field("zip", "Postcode", { hint: "Use 00000 where there is none.", autoComplete: "postal-code" })}
        {field("country", "Country code", { hint: "For example NG.", autoComplete: "country" })}
      </div>
    </div>
  );
}

function BuyDialog({ store, offer, defaults, onClose, onBought }: { store: string; offer: DomainOffer; defaults: Partial<DomainContact>; onClose: () => void; onBought?: (domain: StoreDomain) => void }) {
  const [contact, setContact] = useState<DomainContact>(() => blankContact(defaults));
  const [buy, state] = useBuyDomainMutation();
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Buy ${offer.domain}`}
      description={`${usd(offer.price!.amount)} for the first year, then ${usd(offer.renewal_price!.amount)} a year, taken from your wallet in its currency at today’s rate. It renews automatically 14 days before it expires; you can switch that off.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={state.isLoading}
            disabled={!contactComplete(contact)}
            onClick={() =>
              void buy({ store, domain: offer.domain, expected_price: offer.price!.amount, contact: cleanContact(contact) })
                .unwrap()
                .then(domain => {
                  onClose();
                  onBought?.(domain);
                })
                .catch(() => undefined)
            }
          >
            Pay {usd(offer.price!.amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ContactFields contact={contact} onChange={setContact} />
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      </div>
    </Dialog>
  );
}

/** Connect a domain bought elsewhere. */
export function ConnectDomain({ store, onConnected }: { store: string; onConnected?: (domain: StoreDomain) => void }) {
  const [name, setName] = useState("");
  const [connect, state] = useConnectDomainMutation();
  return (
    <Card>
      <CardHeader title="Connect a domain you own" description="Any ending, from any registrar (for example .ng, .com.ng or .co.uk). You then set two records at your DNS host, or move its nameservers to Udozo." />
      <form
        className="flex flex-col gap-3 px-5 pb-5 pt-4 sm:flex-row sm:px-6"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void connect({ store, domain: name.trim() })
            .unwrap()
            .then(domain => {
              setName("");
              onConnected?.(domain);
            })
            .catch(() => undefined);
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="domain-connect" className="sr-only">Your domain</label>
          <Input id="domain-connect" value={name} onChange={event => setName(event.target.value)} placeholder="yourstore.ng" autoComplete="off" />
        </div>
        <Button type="submit" variant="secondary" icon={<Globe className="size-4" aria-hidden />} loading={state.isLoading} disabled={name.trim().length < 4}>
          Connect
        </Button>
      </form>
      {state.error ? <div className="px-5 pb-5 sm:px-6"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
    </Card>
  );
}

/** One of the store's domains: its status, what to set, DNS records, email and renewal. */
export function DomainCard({ store, domain, owner, canManage, onRemoved }: { store: string; domain: StoreDomain; owner: boolean; canManage: boolean; onRemoved?: () => void }) {
  const ref = { store, id: domain.id };
  const [check, checking] = useCheckDomainMutation();
  const [update, updating] = useUpdateDomainMutation();
  const [remove] = useRemoveDomainMutation();
  const [renew, renewing] = useRenewDomainMutation();
  const [transfer, transferState] = useDomainTransferCodeMutation();
  const [removing, setRemoving] = useState(false);
  const [importing, setImporting] = useState(false);
  const failed = checking.error ?? updating.error ?? renewing.error ?? transferState.error;
  const working = domain.status === "active" || domain.status === "pending";
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
            <a href={domain.url} target="_blank" rel="noreferrer" className="break-all hover:underline">{domain.name}</a>
            <Badge tone={statusTone(domain.status)}>{statusLabels[domain.status]}</Badge>
            {domain.primary ? <Badge tone="pink">Main address</Badge> : null}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {domain.source === "purchased" ? `Bought here${domain.expires_at ? ` · renews ${formatDate(domain.expires_at)}` : ""}` : "Connected"} · DNS {domain.dns_mode === "vercel" ? "managed here" : "with your provider"}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {working ? <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={checking.isLoading} onClick={() => void check(ref)}>Check now</Button> : null}
            {domain.status === "active" && !domain.primary ? <Button size="sm" variant="secondary" loading={updating.isLoading} onClick={() => void update({ ...ref, primary: true })}>Make main address</Button> : null}
            {domain.source === "connected" || domain.status === "failed" ? <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setRemoving(true)}>{domain.status === "failed" ? "Dismiss" : "Disconnect"}</Button> : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {failed ? <Notice tone="red">{errorMessage(failed)}</Notice> : null}
        {domain.status === "purchasing" ? <Notice tone="amber">Waiting for the registrar to confirm. This usually takes a few seconds; the amount is held, not taken, until it does.</Notice> : null}
        {domain.status === "failed" ? <Notice tone="red" title="Not bought">Nothing was taken from your wallet. {domain.last_error ? `(${domain.last_error})` : ""}</Notice> : null}
        {domain.status === "suspended" ? <Notice tone="red" title="Suspended by Udozo">Your store is not served on it. Contact support.</Notice> : null}
        {domain.status === "expired" ? <Notice tone="red" title="Expired">Your store and email on it have stopped. Renew it now to get them back.</Notice> : null}
        {domain.renewal_error === "insufficient_funds" ? <Notice tone="red" title="Renewal waiting for funds">Top up your wallet: it is renewed automatically once there is enough, before it expires.</Notice> : null}
        {domain.renewal_error === "renewal_pending" ? <Notice tone="amber">A renewal is being confirmed. Nothing more is taken for it.</Notice> : null}

        {domain.status === "pending" && domain.dns_mode === "external" && domain.instructions.length ? (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-ink">Set these records at your DNS host</h4>
            <RecordsToSet records={domain.instructions} />
            <p className="text-sm text-muted">Changes can take up to 48 hours to spread; we check automatically and email you when your store is live on it. HTTPS is set up for you.</p>
          </section>
        ) : null}
        {domain.dns_mode === "external" && domain.nameservers && working && canManage ? (
          <section className="space-y-2 rounded-xl bg-canvas p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink"><ServerCog className="size-4" aria-hidden /> Or manage its DNS here</h4>
            <p className="text-sm text-muted">Move its nameservers to Udozo to edit records here and set up email in one click. We copy your existing records (email above all) first, so nothing stops working.</p>
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>Move DNS to Udozo</Button>
          </section>
        ) : null}

        {domain.dns_mode === "vercel" && working && canManage ? <DnsRecords store={store} domain={domain} /> : null}
        {working && canManage ? <EmailSetup store={store} domain={domain} /> : null}

        {domain.source === "purchased" && working && canManage ? (
          <section className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="flex items-center gap-3 text-sm font-medium text-ink">
              <Toggle label={`Renew ${domain.name} automatically`} checked={Boolean(domain.auto_renew)} disabled={updating.isLoading} onChange={auto_renew => void update({ ...ref, auto_renew })} />
              Renew automatically from my wallet
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" loading={renewing.isLoading} onClick={() => void renew(ref)}>Renew now</Button>
              {owner ? <Button size="sm" variant="ghost" loading={transferState.isLoading} onClick={() => void transfer(ref)}>Get transfer code</Button> : null}
            </div>
            {transferState.data ? (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-sm">
                Transfer code: <span className="break-all font-mono font-semibold text-ink">{transferState.data.code}</span>
                <CopyButton value={transferState.data.code} />
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      <ActionDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={domain.status === "failed" ? `Dismiss ${domain.name}?` : `Disconnect ${domain.name}?`}
        description={domain.status === "failed" ? "It is removed from this list." : "Your store stops being served on it. The domain stays yours at your registrar."}
        confirmLabel={domain.status === "failed" ? "Dismiss" : "Disconnect"}
        tone="danger"
        requireReason={false}
        onConfirm={() => remove(ref).unwrap().then(() => onRemoved?.())}
      />
      {importing ? <ImportDialog store={store} domain={domain} onClose={() => setImporting(false)} /> : null}
    </Card>
  );
}

const recordTypes: DnsRecordType[] = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA"];

function DnsRecords({ store, domain }: { store: string; domain: StoreDomain }) {
  const ref = { store, id: domain.id };
  const records = useDomainRecordsQuery(ref);
  const [add, adding] = useAddDomainRecordMutation();
  const [remove, removing] = useDeleteDomainRecordMutation();
  const [draft, setDraft] = useState<{ name: string; type: DnsRecordType; value: string; priority: string }>({ name: "", type: "A", value: "", priority: "10" });
  return (
    <section className="space-y-3">
      <h4 className="text-sm font-semibold text-ink">DNS records</h4>
      {records.data ? (
        records.data.data.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {records.data.data.map(record => (
              <li key={record.id} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[4.5rem_8rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                <span className="font-semibold text-ink">{record.type}{record.priority != null ? ` ${record.priority}` : ""}</span>
                <span className="break-all font-mono text-xs text-muted">{record.name || "@"}</span>
                <span className="break-all font-mono text-xs text-ink">{record.value}</span>
                {record.protected ? (
                  <Badge tone="blue" dot={false}>Kept by Udozo</Badge>
                ) : (
                  <Button size="sm" variant="ghost" aria-label={`Delete ${record.type} ${record.name || "@"}`} loading={removing.isLoading && removing.originalArgs?.record === record.id} onClick={() => void remove({ ...ref, record: record.id })}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No records yet. Your store and www need none: they are served automatically.</p>
        )
      ) : records.error ? (
        <Notice tone="red">{errorMessage(records.error)}</Notice>
      ) : (
        <p className="text-sm text-muted">Loading records…</p>
      )}
      <form
        className="grid gap-3 rounded-xl bg-canvas p-3 sm:grid-cols-[8rem_7rem_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void add({ ...ref, name: draft.name, type: draft.type, value: draft.value, ...(draft.type === "MX" ? { priority: Number(draft.priority) || 0 } : {}) })
            .unwrap()
            .then(() => setDraft(current => ({ ...current, name: "", value: "" })))
            .catch(() => undefined);
        }}
      >
        <Field label="Name" htmlFor={`record-name-${domain.id}`}>
          <Input id={`record-name-${domain.id}`} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="blog" />
        </Field>
        <Field label="Type" htmlFor={`record-type-${domain.id}`}>
          <Select id={`record-type-${domain.id}`} value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as DnsRecordType })}>
            {recordTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5rem]">
          <Field label="Value" htmlFor={`record-value-${domain.id}`}>
            <Input id={`record-value-${domain.id}`} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} />
          </Field>
          {draft.type === "MX" ? (
            <Field label="Priority" htmlFor={`record-priority-${domain.id}`}>
              <Input id={`record-priority-${domain.id}`} inputMode="numeric" value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })} />
            </Field>
          ) : null}
        </div>
        <Button type="submit" size="sm" loading={adding.isLoading} disabled={!draft.value.trim()}>Add</Button>
      </form>
      {adding.error || removing.error ? <Notice tone="red">{errorMessage(adding.error ?? removing.error)}</Notice> : null}
    </section>
  );
}

function EmailSetup({ store, domain }: { store: string; domain: StoreDomain }) {
  const ref = { store, id: domain.id };
  const [provider, setProvider] = useState<MailProvider | "">(domain.mail_provider ?? "");
  const [verification, setVerification] = useState("");
  const [setMail, mailState] = useSetMailProviderMutation();
  const [result, setResult] = useState<MailSetup | null>(null);
  const [enableSending, sendingState] = useEnableEmailSendingMutation();
  const sending = domain.email_sending;
  return (
    <section className="space-y-4 border-t border-line pt-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink"><Mail className="size-4" aria-hidden /> Email</h4>
      <div className="space-y-3">
        <p className="text-sm text-muted">Use your own mailboxes on this domain (for example hello@{domain.name}): sign up with a provider, then choose it here and we set its records{domain.dns_mode === "vercel" ? " for you" : " for you to add"}.</p>
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
          <Field label="Mailbox provider" htmlFor={`mail-${domain.id}`}>
            <Select id={`mail-${domain.id}`} value={provider} onChange={event => setProvider(event.target.value as MailProvider | "")}>
              <option value="">None</option>
              {(Object.keys(mailNames) as MailProvider[]).map(key => <option key={key} value={key}>{mailNames[key]}</option>)}
            </Select>
          </Field>
          <Field label="Verification value (optional)" htmlFor={`mail-verify-${domain.id}`} hint="The TXT value your provider shows to prove the domain is yours.">
            <Input id={`mail-verify-${domain.id}`} value={verification} onChange={event => setVerification(event.target.value)} placeholder={provider === "microsoft" ? "MS=ms12345678" : provider === "zoho" ? "zoho-verification=…" : "google-site-verification=…"} disabled={!provider} />
          </Field>
          <Button
            size="sm"
            loading={mailState.isLoading}
            disabled={(provider || null) === domain.mail_provider && !verification.trim()}
            onClick={() => void setMail({ ...ref, provider: provider || null, ...(verification.trim() ? { verification: verification.trim() } : {}) }).unwrap().then(setResult).catch(() => undefined)}
          >
            Save
          </Button>
        </div>
        {mailState.error ? <Notice tone="red">{errorMessage(mailState.error)}</Notice> : null}
        {result && result.records.length ? (
          result.written ? (
            <Notice tone="green">{result.provider_name}’s records are set. Mail for {domain.name} now goes to {result.provider_name}.</Notice>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">Add these records at your DNS host:</p>
              <RecordsToSet records={result.records} />
            </div>
          )
        ) : null}
      </div>
      <div className="space-y-3 rounded-xl bg-canvas p-4">
        <p className="text-sm font-semibold text-ink">Order emails from your domain</p>
        <p className="text-sm text-muted">Codes, receipts and notices to your customers come from orders@{domain.name} instead of Udozo’s address.</p>
        {sending ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <StatusBadge status={sending.status === "verified" ? "active" : "pending"} label={sending.status === "verified" ? "Sending from your domain" : "Waiting for the records"} />
            </p>
            {sending.status !== "verified" ? (
              domain.dns_mode === "vercel" ? (
                <p className="text-sm text-muted">The records are set; verification usually takes a few minutes. Use Check now to refresh.</p>
              ) : (
                <RecordsToSet records={sending.records} />
              )
            ) : null}
          </>
        ) : (
          <Button size="sm" variant="secondary" loading={sendingState.isLoading} disabled={domain.status !== "active"} onClick={() => void enableSending(ref)}>
            Send order emails from {domain.name}
          </Button>
        )}
        {sendingState.error ? <Notice tone="red">{errorMessage(sendingState.error)}</Notice> : null}
      </div>
    </section>
  );
}

/** Copy the domain's records to Udozo's DNS, then move the nameservers. */
function ImportDialog({ store, domain, onClose }: { store: string; domain: StoreDomain; onClose: () => void }) {
  const ref = { store, id: domain.id };
  const [load, preview] = useLazyDomainImportPreviewQuery();
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [save, saving] = useImportDomainRecordsMutation();
  const data: DnsImport | undefined = preview.data;
  useEffect(() => {
    void load({ store, id: domain.id });
  }, [load, store, domain.id]);
  const selected = chosen ?? new Set(data?.records.map((_, index) => index) ?? []);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Move ${domain.name}’s DNS to Udozo`}
      description="1. Copy the records you use (email above all). 2. Set the nameservers below at your registrar. We check automatically and switch to managing it here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{saving.data ? "Done" : "Cancel"}</Button>
          {!saving.data ? (
            <Button
              loading={saving.isLoading}
              disabled={!data}
              onClick={() =>
                void save({ ...ref, records: (data?.records ?? []).filter((_, index) => selected.has(index)).map(record => ({ name: record.name, type: record.type, value: record.value, ttl: record.ttl, ...(record.priority !== null ? { priority: record.priority } : {}) })) })
              }
            >
              Copy {selected.size} {selected.size === 1 ? "record" : "records"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {preview.error ? <Notice tone="red">{errorMessage(preview.error)}</Notice> : null}
        {preview.isFetching ? <p className="text-sm text-muted">Reading {domain.name}’s records…</p> : null}
        {data && !saving.data ? (
          data.records.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {data.records.map((record, index) => (
                <li key={index} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    aria-label={`Copy ${record.type} ${record.name || "@"}`}
                    checked={selected.has(index)}
                    onChange={event => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(index);
                      else next.delete(index);
                      setChosen(next);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{record.type}{record.priority !== null ? ` ${record.priority}` : ""}</span>{" "}
                    <span className="font-mono text-xs text-muted">{record.name || "@"}</span>
                    <span className="block break-all font-mono text-xs text-ink">{record.value}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Notice tone="blue">No email or other records were found. If you use any, add them after the move.</Notice>
          )
        ) : null}
        {saving.data ? <Notice tone="green">{saving.data.created} {saving.data.created === 1 ? "record" : "records"} copied. Now set the nameservers below at your registrar.</Notice> : null}
        {saving.error ? <Notice tone="red">{errorMessage(saving.error)}</Notice> : null}
        {data?.nameservers.length ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">Nameservers</p>
            <RecordsToSet records={data.nameservers.map(value => ({ type: "NS", name: "@", value }))} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
