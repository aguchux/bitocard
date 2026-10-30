"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Search } from "lucide-react";
import { Button, Card, CardHeader, cn, errorMessage, Field, Input, Notice, PageHeader, QueryView, Skeleton, useDebouncedValue } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { appUrl } from "@bitocard/ui/site";
import { type StoreTemplate, useCatalogueProductsInfiniteQuery, useCreateStoreMutation, useStoreTemplatesQuery } from "@bitocard/api-client/reseller";
import type { StoreTemplateKey } from "@bitocard/api-client/storefront";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { SubdomainField, useAddressReady } from "@/components/store-settings";
import { DesignPreview, resolveDesign, TemplateCards, VariantAndTheme } from "@/components/store-templates";

const steps = ["Template", "Design and colours", "Name and address"] as const;

/** A single product store's product: one the reseller has listed in their catalogue. */
function FocusPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const products = useCatalogueProductsInfiniteQuery({ listed: true, ...(q.length >= 2 ? { q } : {}) });
  const rows = products.data?.pages.flatMap(page => page.data) ?? [];
  return (
    <div className="space-y-2">
      <Field label="The product this store sells" htmlFor="focus-search" hint="One of the products you list in your catalogue.">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input id="focus-search" type="search" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Search your listed products" />
        </div>
      </Field>
      {products.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length ? (
        <ul role="radiogroup" aria-label="Product" className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
          {rows.slice(0, 50).map(product => (
            <li key={product.id}>
              <button
                type="button"
                role="radio"
                aria-checked={product.key === value}
                onClick={() => onChange(product.key)}
                className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm", product.key === value ? "bg-brand-50 font-semibold text-brand-700" : "hover:bg-canvas")}
              >
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                {product.key === value ? <Check className="size-4 shrink-0" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Notice tone="amber">
          No listed products match. List the product first in <AppLink href="/catalogue" className="font-semibold underline">Catalogue</AppLink>.
        </Notice>
      )}
    </div>
  );
}

function Wizard({ templates }: { templates: StoreTemplate[] }) {
  const router = useRouter();
  const { membership } = useReseller();
  const [step, setStep] = useState(0);
  const firstOpen = templates.find(item => item.available && !item.resale) ?? templates[0];
  const [design, setDesign] = useState({ template: firstOpen.key, variant: firstOpen.variants[0].key, theme: firstOpen.variants[0].themes[0].key });
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [focus, setFocus] = useState("");
  const [create, state] = useCreateStoreMutation();
  const ready = useAddressReady(subdomain);
  const { template, variant, theme } = resolveDesign(templates, design);
  const noCountry = !membership.reseller.country;

  const chooseTemplate = (key: StoreTemplateKey) => {
    const next = templates.find(item => item.key === key);
    if (next) setDesign({ template: key, variant: next.variants[0].key, theme: next.variants[0].themes[0].key });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await create({ name: name.trim(), subdomain: subdomain.trim(), ...design, ...(template.single_product ? { focus } : {}) })
      .unwrap()
      .catch(() => null);
    if (created) router.push(`/store/${created.id}/design`);
  };

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined} className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold", index === step ? "bg-brand-500 text-white" : index < step ? "bg-brand-50 text-brand-700" : "bg-canvas text-muted")}>
            <span className="grid size-5 place-items-center rounded-full bg-white/25 text-xs">{index < step ? <Check className="size-3.5" aria-hidden /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card>
          <CardHeader title="Choose a template" description="What the store sells and how its home page starts. You can change everything later." />
          <div className="p-5 sm:p-6">
            <TemplateCards templates={templates} value={design.template} onChange={chooseTemplate} />
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader title={`${template.name}: choose a design and its colours`} description={template.description} />
          <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <VariantAndTheme template={template} variant={design.variant} theme={design.theme} onChange={next => setDesign({ ...design, ...next })} />
            {variant && theme ? (
              <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
                <p className="text-sm font-semibold text-ink">Preview</p>
                <DesignPreview style={variant.style} colors={theme.colors} className="h-64 w-full" />
                <p className="text-xs text-muted">{`${variant.name} in ${theme.name}. You can adjust its colours and home page after creating the store.`}</p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader title="Name and address" description="Your store starts as a draft on a BitoCard address; publish it when it is ready." />
          <form id="new-store" onSubmit={submit} className="space-y-5 p-5 sm:p-6">
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
            {template.single_product ? <FocusPicker value={focus} onChange={setFocus} /> : null}
            <p className="text-xs text-muted">
              What you publish on your store (its name, words, logos and images) must be yours to use and honest, as the{" "}
              <a href={appUrl("legals", "/documents/reseller-terms#content")} target="_blank" rel="noopener" className="font-semibold text-brand-600 hover:underline">reseller terms</a> set out.
            </p>
          </form>
        </Card>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => (step === 0 ? router.push("/store") : setStep(step - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 2 ? (
          <Button icon={<ArrowRight className="size-4" aria-hidden />} disabled={step === 0 && !template.available} onClick={() => setStep(step + 1)}>
            Next
          </Button>
        ) : (
          <Button type="submit" form="new-store" loading={state.isLoading} disabled={noCountry || name.trim().length < 2 || !ready || (template.single_product && !focus)}>
            Create store
          </Button>
        )}
      </div>
    </div>
  );
}

/** Store > New store: template, design and colours, then name and address; the store's design page opens next. */
export default function NewStorePage() {
  const { membership } = useReseller();
  const templates = useStoreTemplatesQuery();
  return (
    <ShqShell section="store" current="/store" crumbs={[{ label: "Store", href: "/store" }, { label: "New store" }]}>
      <PageHeader title="New store" description="Pick what it sells and how it looks. Setting up takes a few minutes; verification and funding may take longer." />
      {can(membership, "admin") ? (
        <QueryView query={templates} message={error => errorMessage(error, "Could not load the templates.")} loading={<Skeleton className="h-96 w-full" />}>
          {({ data }) => <Wizard templates={data} />}
        </QueryView>
      ) : (
        <Notice tone="blue">The owner or an admin of {membership.reseller.name} creates stores.</Notice>
      )}
    </ShqShell>
  );
}
