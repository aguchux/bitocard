"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, CreditCard, ExternalLink, Globe, ShieldCheck, Store as StoreIcon, XCircle } from "lucide-react";
import {
  ActionDialog,
  Button,
  Card,
  CardHeader,
  EmptyState,
  errorMessage,
  Field,
  formatDateTime,
  ImageField,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  QueryView,
  Select,
  Skeleton,
  StatusBadge,
  Toggle,
} from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  type Store,
  type StoreInput,
  useCreateStoreMutation,
  usePublishStoreMutation,
  useStoresQuery,
  useSubdomainCheckQuery,
  useUnpublishStoreMutation,
  useUpdateStoreMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const hex = /^#[0-9a-fA-F]{6}$/;
const defaultPrimary = "#070f4c";
const defaultAccent = "#ff2382";

/** The value, once it has stopped changing for `delay` milliseconds. */
function useDebounced<T>(value: T, delay = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** The store address, with a live check that it is free. `current` is the store's own address (always fine). */
function SubdomainField({ id, value, onChange, current, disabled, hint }: { id: string; value: string; onChange: (value: string) => void; current?: string; disabled?: boolean; hint?: string }) {
  const wanted = value.trim().toLowerCase();
  const settled = useDebounced(wanted);
  const unchanged = wanted === current;
  const check = useSubdomainCheckQuery(settled, { skip: disabled || unchanged || settled.length < 3 });
  const pending = !unchanged && wanted.length >= 3 && (settled !== wanted || check.isFetching);

  let status: React.ReactNode = null;
  if (disabled || !wanted || unchanged) status = null;
  else if (wanted.length < 3) status = <span className="text-muted">Use at least 3 characters.</span>;
  else if (pending) status = <span className="text-muted">Checking…</span>;
  else if (check.error) status = <span className="text-red-700">{errorMessage(check.error, "Could not check this address.")}</span>;
  else if (check.data?.available)
    status = (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="size-4" aria-hidden /> {check.data.subdomain}.bitocard.com is free.
      </span>
    );
  else if (check.data)
    status = (
      <span className="inline-flex items-center gap-1 text-red-700">
        <XCircle className="size-4" aria-hidden /> {check.data.reason ?? "This address cannot be used."}
      </span>
    );

  return (
    <Field label="Store address" htmlFor={id} hint={hint}>
      <div className="flex min-w-0 items-stretch">
        <Input
          id={id}
          value={value}
          onChange={event => onChange(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          maxLength={30}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="min-w-0 rounded-r-none"
          aria-describedby={`${id}-status`}
        />
        <span className="inline-flex shrink-0 items-center rounded-r-lg border border-l-0 border-line bg-canvas px-3 text-sm text-muted">.bitocard.com</span>
      </div>
      <p id={`${id}-status`} aria-live="polite" className="min-h-5 text-sm">
        {status}
      </p>
    </Field>
  );
}

/** Whether the address in the field can be saved (unchanged, or checked and free). */
function useAddressReady(value: string, current?: string) {
  const wanted = value.trim().toLowerCase();
  const settled = useDebounced(wanted);
  const unchanged = wanted === current;
  const check = useSubdomainCheckQuery(settled, { skip: unchanged || settled.length < 3 });
  return unchanged || (settled === wanted && !check.isFetching && Boolean(check.data?.available));
}

function CreateStore() {
  const { membership } = useReseller();
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [create, state] = useCreateStoreMutation();
  const ready = useAddressReady(subdomain);
  const noCountry = !membership.reseller.country;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await create({ name: name.trim(), subdomain: subdomain.trim() })
      .unwrap()
      .catch(() => undefined);
  };

  return (
    <Card>
      <CardHeader title="Create your store" description="Your store starts as a draft on a BitoCard address. You can change the name and branding at any time." />
      <form onSubmit={submit} className="space-y-5 p-5 sm:p-6">
        {noCountry ? (
          <Notice tone="amber" title="Set your business country first">
            Your store sells in your country&apos;s currency. <AppLink href="/settings" className="font-semibold underline underline-offset-2">Set it in Business settings</AppLink>.
          </Notice>
        ) : null}
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Store name" htmlFor="store-name" hint="Shown to your customers. 2 to 60 characters.">
          <Input id="store-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} required autoComplete="organization" />
        </Field>
        <SubdomainField id="store-subdomain" value={subdomain} onChange={setSubdomain} hint="Lower-case letters, numbers and single hyphens. You can change it while the store is a draft." />
        <Button type="submit" loading={state.isLoading} disabled={noCountry || name.trim().length < 2 || !ready}>
          Create store
        </Button>
      </form>
    </Card>
  );
}

function ColourField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const valid = hex.test(value);
  return (
    <Field label={label} htmlFor={id} error={value && !valid ? "Use a hex colour like #070f4c." : undefined}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : "#000000"}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1 disabled:cursor-not-allowed"
        />
        <Input id={id} value={value} onChange={event => onChange(event.target.value.trim())} maxLength={7} disabled={disabled} spellCheck={false} className="min-w-0 font-mono" />
      </div>
    </Field>
  );
}

/**
 * Customer checkout on the store: the sandbox (simulated payments and orders, to try the store) until the reseller
 * switches it live, which needs a verified business. Live orders' cost comes from what the customer paid through
 * BitoCard's gateways, or from the wallet when they pay into the reseller's own gateway (Integrations).
 */
function StoreCheckout({ store, canManage }: { store: Store; canManage: boolean }) {
  const { membership } = useReseller();
  const [update, state] = useUpdateStoreMutation();
  const [confirmLive, setConfirmLive] = useState(false);
  const live = store.checkout_mode === "live";
  const verified = membership.reseller.status === "active";
  const setMode = (checkout_mode: "test" | "live") => update({ id: store.id, checkout_mode }).unwrap();
  return (
    <Card>
      <CardHeader
        title="Customer checkout"
        description={live ? "Customers pay and receive real products." : "Test checkout: orders are simulated and no money is taken."}
        actions={
          canManage ? (
            live ? (
              <Button size="sm" variant="secondary" loading={state.isLoading} onClick={() => setMode("test").catch(() => null)}>
                Switch to test
              </Button>
            ) : (
              <Button size="sm" loading={state.isLoading} disabled={!verified} onClick={() => setConfirmLive(true)}>
                Go live
              </Button>
            )
          ) : null
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
          <p className="text-sm text-muted">
            {live
              ? "Customers pay through the payment methods BitoCard offers in your country, or your own payment gateway where you connected one (Integrations). Through your own gateway, the order’s cost and BitoCard’s fee come from your wallet, so keep it topped up."
              : "Your store shows a test banner, and customers can place simulated orders to try it. Nothing is charged and the codes are not real."}
          </p>
        </div>
        {!live && !verified ? <Notice tone="grey">Your store can take real payments once your business is verified (Settings &gt; Verification).</Notice> : null}
      </div>
      <ActionDialog
        open={confirmLive}
        onClose={() => setConfirmLive(false)}
        title="Take real payments?"
        description="Customers will pay real money and receive real products. BitoCard sells and delivers each order under your store's name."
        confirmLabel="Go live"
        requireReason={false}
        onConfirm={() => setMode("live")}
      />
    </Card>
  );
}

/**
 * Whether the store's customers are asked for BitoCard's identity check where the market requires one (the default).
 * Off for everyone here, or for one customer on the Customers page; never marks anyone as checked.
 */
function StoreIdentityChecks({ store, canManage }: { store: Store; canManage: boolean }) {
  const [update, state] = useUpdateStoreMutation();
  return (
    <Card>
      <CardHeader
        title="Customer identity checks"
        description={store.customer_verification ? "Customers are asked where BitoCard requires a check." : "Your customers are never asked."}
        actions={
          <span className="flex items-center gap-2 text-sm font-medium">
            {store.customer_verification ? "On" : "Off"}
            <Toggle
              label="Ask customers for the identity check"
              checked={store.customer_verification}
              disabled={!canManage || state.isLoading}
              onChange={customer_verification => update({ id: store.id, customer_verification })}
            />
          </span>
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
          <p className="text-sm text-muted">
            BitoCard asks customers to verify their identity before buying some products in some countries (gift cards, for example). Turn it off and none of your customers are
            asked: you take responsibility for knowing them. You can also turn it off for one customer on the{" "}
            <AppLink href="/store/customers" className="font-semibold text-brand-600 hover:underline">
              Customers
            </AppLink>{" "}
            page. Turning it off never marks a customer as checked.
          </p>
        </div>
      </div>
    </Card>
  );
}

function StoreDetails({ store, canManage }: { store: Store; canManage: boolean }) {
  const [name, setName] = useState(store.name);
  const [subdomain, setSubdomain] = useState(store.subdomain);
  const [logo, setLogo] = useState(store.branding.logo_url ?? "");
  const [primary, setPrimary] = useState(store.branding.primary_color ?? defaultPrimary);
  const [accent, setAccent] = useState(store.branding.accent_color ?? defaultAccent);
  const [desktopNav, setDesktopNav] = useState<"" | "rail" | "bottom">(store.desktop_nav ?? "");
  const [saved, setSaved] = useState(false);
  const [update, updateState] = useUpdateStoreMutation();
  const [publish, publishState] = usePublishStoreMutation();
  const [unpublish] = useUnpublishStoreMutation();
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const draft = store.status === "draft";
  const addressReady = useAddressReady(subdomain, store.subdomain);

  const changes: StoreInput = {};
  if (name.trim() !== store.name) changes.name = name.trim();
  if (draft && subdomain.trim() !== store.subdomain) changes.subdomain = subdomain.trim();
  if ((logo.trim() || null) !== store.branding.logo_url) changes.logo_url = logo.trim() || null;
  if (primary !== (store.branding.primary_color ?? defaultPrimary)) changes.primary_color = primary;
  if (accent !== (store.branding.accent_color ?? defaultAccent)) changes.accent_color = accent;
  if ((desktopNav || null) !== store.desktop_nav) changes.desktop_nav = desktopNav || null;
  const dirty = Object.keys(changes).length > 0;
  const valid = name.trim().length >= 2 && hex.test(primary) && hex.test(accent) && (!logo.trim() || logo.trim().startsWith("https://")) && addressReady;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const done = await update({ id: store.id, ...changes })
      .unwrap()
      .catch(() => null);
    if (done) setSaved(true);
  };

  const address = (
    <span className="inline-flex min-w-0 items-center gap-1.5 break-all">
      <Globe className="size-4 shrink-0 text-subtle" aria-hidden />
      {store.status === "published" ? (
        <a href={store.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
          {store.url.replace("https://", "")}
          <ExternalLink className="ml-1 inline size-3.5" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span>{store.url.replace("https://", "")}</span>
      )}
    </span>
  );

  return (
    <>
      <Card>
        <CardHeader
          title={store.name}
          description={address}
          actions={
            <>
              <StatusBadge status={store.status} />
              {canManage && store.status === "draft" ? (
                <Button size="sm" loading={publishState.isLoading} onClick={() => publish(store.id)}>
                  Publish
                </Button>
              ) : null}
              {canManage && store.status === "published" ? (
                <Button size="sm" variant="secondary" onClick={() => setConfirmUnpublish(true)}>
                  Unpublish
                </Button>
              ) : null}
            </>
          }
        />
        <div className="space-y-4 p-5 sm:p-6">
          {publishState.error ? <Notice tone="red">{errorMessage(publishState.error)}</Notice> : null}
          {store.status === "suspended" ? (
            <Notice tone="red" title="This store is suspended">
              Customers cannot see it. Contact support to find out why and what to do next.
            </Notice>
          ) : store.status === "draft" ? (
            <Notice tone="grey">Your store is a draft: customers cannot see it until you publish it. Publishing needs a confirmed owner email address.</Notice>
          ) : (
            <Notice tone="blue">Your store is live. Paid checkout also needs a funded wallet and a completed identity check, which can take longer than setting up the store.</Notice>
          )}
          <KeyValue
            items={[
              { label: "First published", value: formatDateTime(store.published_at) },
              { label: "Created", value: formatDateTime(store.created_at) },
              { label: "Custom domain", value: "Planned: connect your own domain later." },
            ]}
          />
        </div>
      </Card>

      <StoreCheckout store={store} canManage={canManage} />
      <StoreIdentityChecks store={store} canManage={canManage} />

      <Card>
        <CardHeader title="Name and branding" description={canManage ? "Changes show on your store straight away." : "Only the owner or an admin can change the store."} />
        <form onSubmit={save} className="space-y-5 p-5 sm:p-6">
          {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
          {saved && !dirty ? <Notice tone="green">Store saved.</Notice> : null}
          <div className="grid gap-5 lg:grid-cols-2">
            <Field label="Store name" htmlFor="edit-store-name">
              <Input id="edit-store-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} disabled={!canManage} required />
            </Field>
            <SubdomainField
              id="edit-store-subdomain"
              value={subdomain}
              onChange={setSubdomain}
              current={store.subdomain}
              disabled={!canManage || !draft}
              hint={draft ? "You can change the address while the store is a draft." : "Unpublish the store to change its address."}
            />
            <ImageField label="Logo" realm="reseller" purpose="store_logo" value={logo} onChange={setLogo} disabled={!canManage} hint="Square or wide, on a transparent or white background. Save to use it." />
            <div className="grid gap-5 sm:grid-cols-2">
              <ColourField id="edit-store-primary" label="Main colour" value={primary} onChange={setPrimary} disabled={!canManage} />
              <ColourField id="edit-store-accent" label="Accent colour" value={accent} onChange={setAccent} disabled={!canManage} />
            </div>
            <Field label="Customer app menu on desktop" htmlFor="edit-store-desktop-nav" hint="Your customers' account app. Phones and tablets always use the bottom bar.">
              <Select id="edit-store-desktop-nav" value={desktopNav} onChange={event => setDesktopNav(event.target.value as "" | "rail" | "bottom")} disabled={!canManage}>
                <option value="">Follow BitoCard</option>
                <option value="rail">Side rail</option>
                <option value="bottom">Bottom bar</option>
              </Select>
            </Field>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={updateState.isLoading} disabled={!dirty || !valid}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </Card>

      <ActionDialog
        open={confirmUnpublish}
        onClose={() => setConfirmUnpublish(false)}
        title="Unpublish your store?"
        description="Customers will no longer be able to open it. You can publish it again at any time."
        confirmLabel="Unpublish"
        tone="danger"
        requireReason={false}
        onConfirm={() => unpublish(store.id).unwrap()}
      />
    </>
  );
}

/** The reseller's hosted store (one per reseller for now): create it, brand it, publish or unpublish it. */
export default function StorePage() {
  const { membership } = useReseller();
  const canManage = can(membership, "admin");
  const stores = useStoresQuery();

  return (
    <ShqShell section="store" current="/store" crumbs={[{ label: "Store" }]}>
      <PageHeader title="Your store" description="Your branded storefront on a BitoCard address." />
      <QueryView
        query={stores}
        message={error => errorMessage(error, "Could not load your store.")}
        loading={
          <div className="space-y-6" aria-busy="true" aria-label="Loading your store">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        }
      >
        {({ data: [store] }) =>
          store ? (
            <StoreDetails key={store.id} store={store} canManage={canManage} />
          ) : canManage ? (
            <CreateStore />
          ) : (
            <Card>
              <EmptyState title="No store yet" icon={<StoreIcon className="size-6" aria-hidden />}>
                The owner or an admin of {membership.reseller.name} can create the store.
              </EmptyState>
            </Card>
          )
        }
      </QueryView>
    </ShqShell>
  );
}
