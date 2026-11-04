"use client";

import { usePaidPlans } from "@/components/paid-plans";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, CreditCard, ExternalLink, Globe, Stamp, XCircle } from "lucide-react";
import {
  ActionDialog,
  Button,
  Card,
  CardHeader,
  errorMessage,
  Field,
  formatDateTime,
  ImageField,
  Input,
  KeyValue,
  Notice,
  StatusBadge,
} from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  type Store,
  type StoreInput,
  usePublishStoreMutation,
  useSetupFeeQuery,
  useStoreDomainsQuery,
  useSubdomainCheckQuery,
  useUnpublishStoreMutation,
  useUpdateStoreMutation,
  watermarkTextMax,
  watermarkTextProblem,
} from "@bitocard/api-client/reseller";
import { useReseller } from "@/components/reseller";

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
export function SubdomainField({ id, value, onChange, current, disabled, hint }: { id: string; value: string; onChange: (value: string) => void; current?: string; disabled?: boolean; hint?: string }) {
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
        <CheckCircle2 className="size-4" aria-hidden /> {check.data.subdomain}.udozo.com is free.
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
        <span className="inline-flex shrink-0 items-center rounded-r-lg border border-l-0 border-line bg-canvas px-3 text-sm text-muted">.udozo.com</span>
      </div>
      <p id={`${id}-status`} aria-live="polite" className="min-h-5 text-sm">
        {status}
      </p>
    </Field>
  );
}

/** Whether the address in the field can be saved (unchanged, or checked and free). */
export function useAddressReady(value: string, current?: string) {
  const wanted = value.trim().toLowerCase();
  const settled = useDebounced(wanted);
  const unchanged = wanted === current;
  const check = useSubdomainCheckQuery(settled, { skip: unchanged || settled.length < 3 });
  return unchanged || (settled === wanted && !check.isFetching && Boolean(check.data?.available));
}

export function ColourField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
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

/** The code of an API refusal, if it has one. */
export const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : null;
};

/**
 * Taking a store live (Udozo's rules, docs/UDOZO_SPINOFF_PLAN.md step 3): its udozo.com address is the sandbox, and live
 * payments need the store's own active domain (`domain_required`), the seller's one-time setup fee paid
 * (`setup_fee_unpaid`) and a verified business. What is missing is shown with a link to fix it, before and after asking.
 */
export function StoreLiveSwitch({ store, canManage }: { store: Store; canManage: boolean }) {
  const paidPlans = usePaidPlans();
  const { membership } = useReseller();
  const [update, state] = useUpdateStoreMutation();
  const [confirmLive, setConfirmLive] = useState(false);
  const domains = useStoreDomainsQuery(store.id);
  const setupFee = useSetupFeeQuery();
  const live = store.checkout_mode === "live";
  const verified = membership.reseller.status === "active";
  const hasDomain = domains.data ? domains.data.data.some(domain => domain.status === "active") : null;
  const feeDue = setupFee.data?.due === true;
  const refused = errorCode(state.error);
  const needsDomain = refused === "domain_required" || (!live && hasDomain === false);
  const needsFee = refused === "setup_fee_unpaid" || (!live && feeDue);
  const setMode = (checkout_mode: "test" | "live") => update({ id: store.id, checkout_mode }).unwrap();
  return (
    <Card>
      <CardHeader
        title="Live or sandbox"
        description={live ? "Live: shoppers pay real money on your own domain." : "Sandbox: test the store on its udozo.com address. Orders are simulated and no money is taken."}
        actions={
          canManage ? (
            live ? (
              <Button size="sm" variant="secondary" loading={state.isLoading} onClick={() => setMode("test").catch(() => null)}>
                Back to the sandbox
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
        {state.error && refused !== "domain_required" && refused !== "setup_fee_unpaid" ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
          <p className="text-sm text-muted">
            {live
              ? "Shoppers pay from their Udozo wallet; the money is held until they have the item, then your margin reaches your earnings. If the store loses its last domain it goes back to the sandbox."
              : "Your store shows a test banner on its udozo.com address, and shoppers can place simulated orders to try it. Nothing is charged."}
          </p>
        </div>
        {needsDomain ? (
          <Notice tone={refused === "domain_required" ? "red" : "amber"} title="Your store needs its own domain">
            A store takes live payments only on its own domain.{" "}
            <AppLink href={`/store/domains?store=${store.id}`} className="font-semibold text-brand-600 hover:underline">
              Buy or connect a domain
            </AppLink>
            {paidPlans ? (
              <>
                , or take Premium for a free one (
                <AppLink href="/settings/plan" className="font-semibold text-brand-600 hover:underline">
                  Plans
                </AppLink>
                ).
              </>
            ) : (
              "."
            )}
          </Notice>
        ) : null}
        {needsFee ? (
          <Notice tone={refused === "setup_fee_unpaid" ? "red" : "amber"} title="Pay your Seller HQ setup fee">
            It is paid once, from your wallet or with your first Premium month.{" "}
            <AppLink href="/settings/plan" className="font-semibold text-brand-600 hover:underline">
              Pay the setup fee
            </AppLink>
          </Notice>
        ) : null}
        {!live && !verified ? (
          <Notice tone="grey">
            Your store can take real payments once your business is verified (
            <AppLink href="/settings/verification" className="font-semibold text-brand-600 hover:underline">
              Settings &gt; Identity check
            </AppLink>
            ).
          </Notice>
        ) : null}
      </div>
      <ActionDialog
        open={confirmLive}
        onClose={() => setConfirmLive(false)}
        title="Take real payments?"
        description="Shoppers will pay real money on your store's own domain, and suppliers will hand over real items."
        confirmLabel="Go live"
        requireReason={false}
        onConfirm={async () => {
          // What is missing is shown on the card, with its link, so those refusals close the dialog.
          await setMode("live").catch(error => {
            if (errorCode(error) === "domain_required" || errorCode(error) === "setup_fee_unpaid") return null;
            throw error;
          });
        }}
      />
    </Card>
  );
}

/** A small preview of a listing photo with the mark: the text in the corner, and large and faint across the middle. */
function WatermarkPreview({ text }: { text: string }) {
  return (
    <figure>
      <div
        role="img"
        aria-label={`Preview of a listing photo marked “${text}”`}
        className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-lg border border-line bg-gradient-to-br from-slate-300 via-slate-200 to-amber-100"
        style={{ containerType: "inline-size" }}
      >
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap font-bold text-white" style={{ fontSize: "9cqw", opacity: 0.16, transform: "translate(-50%, -50%) rotate(-12deg)", textShadow: "0 0 1cqw rgba(0,0,0,0.6)" }}>
          {text}
        </span>
        <span aria-hidden className="pointer-events-none absolute whitespace-nowrap font-semibold text-white" style={{ fontSize: "3.5cqw", right: "2.5cqw", bottom: "2cqw", textShadow: "0 0.15cqw 0.6cqw rgba(0,0,0,0.65)" }}>
          {text}
        </span>
      </div>
      <figcaption className="mt-1 text-xs text-muted">Preview. The mark is drawn into every listing photo on your store.</figcaption>
    </figure>
  );
}

/**
 * The text drawn on the store's listing photos (docs/UDOZO_WATERMARK_PLAN.md): the store's own where Udozo allows it
 * (`watermark_allowed`), else Udozo's. Saved and cleared with the store's PATCH; the API's refusals (`text_refused`,
 * `store_watermark_unavailable`) are shown as it words them.
 */
export function StoreWatermarkCard({ store, canManage }: { store: Store; canManage: boolean }) {
  // What is saved: the store's, then each answer's (the card keeps it while the store list refreshes).
  const [current, setCurrent] = useState(store.watermark_text ?? null);
  const [text, setText] = useState(current ?? "");
  const [saved, setSaved] = useState<"saved" | "cleared" | null>(null);
  const [update, state] = useUpdateStoreMutation();
  if (!store.watermark_allowed) {
    return (
      <Card>
        <CardHeader title="Photo watermark" description="Udozo’s watermark is used on your store’s photos." />
      </Card>
    );
  }
  const problem = watermarkTextProblem(text);
  const dirty = text.trim() !== (current ?? "");
  const send = async (watermark_text: string | null) => {
    setSaved(null);
    const done = await update({ id: store.id, watermark_text })
      .unwrap()
      .catch(() => null);
    if (done) {
      setCurrent(done.watermark_text ?? null);
      setText(done.watermark_text ?? "");
      setSaved(watermark_text === null ? "cleared" : "saved");
    }
  };
  return (
    <Card>
      <CardHeader title="Photo watermark" description="Your own text on the listing photos on your store’s pages, so copies taken elsewhere still name your store. Leave it empty to use Udozo’s." />
      <form
        className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
        onSubmit={event => {
          event.preventDefault();
          void send(text.trim());
        }}
      >
        <div className="space-y-4">
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          {saved && !dirty ? <Notice tone="green">{saved === "cleared" ? "Your store uses Udozo’s watermark again." : "Watermark saved."}</Notice> : null}
          <Field label="Watermark text" htmlFor={`watermark-${store.id}`} hint="2 to 30 letters, digits, spaces and . - _ @, such as your domain." error={dirty && text.trim() && problem ? problem : undefined}>
            <Input id={`watermark-${store.id}`} value={text} maxLength={watermarkTextMax + 10} onChange={event => setText(event.target.value)} disabled={!canManage} spellCheck={false} autoComplete="off" placeholder="udozo.com" />
          </Field>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={state.isLoading} disabled={!dirty || Boolean(problem)} icon={<Stamp className="size-4" aria-hidden />}>
                Save watermark
              </Button>
              {current ? (
                <Button type="button" variant="secondary" disabled={state.isLoading} onClick={() => void send(null)}>
                  Clear
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <WatermarkPreview text={!text.trim() ? "udozo.com" : problem ? (current ?? "udozo.com") : text.trim()} />
      </form>
    </Card>
  );
}

/** One store's settings: name, address, branding, the account app's menu, publishing, and going live. */
export function StoreDetails({ store, canManage }: { store: Store; canManage: boolean }) {
  const [name, setName] = useState(store.name);
  const [subdomain, setSubdomain] = useState(store.subdomain);
  const [logo, setLogo] = useState(store.branding.logo_url ?? "");
  const [primary, setPrimary] = useState(store.branding.primary_color ?? defaultPrimary);
  const [accent, setAccent] = useState(store.branding.accent_color ?? defaultAccent);
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
            <Notice tone="grey">Your store is a draft: shoppers cannot see it until you publish it. Publishing needs a confirmed owner email address.</Notice>
          ) : (
            <Notice tone="blue">Your store is published. It takes real payments once it is live on its own domain (below).</Notice>
          )}
          <KeyValue
            items={[
              { label: "First published", value: formatDateTime(store.published_at) },
              { label: "Created", value: formatDateTime(store.created_at) },
              { label: "Own domains", value: <AppLink href={`/store/domains?store=${store.id}`} className="font-semibold text-brand-600 hover:underline">Buy or connect a domain</AppLink> },
              { label: "Sandbox address", value: `${store.subdomain}.udozo.com` },
            ]}
          />
        </div>
      </Card>

      <StoreLiveSwitch store={store} canManage={canManage} />

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

      <StoreWatermarkCard store={store} canManage={canManage} />

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
