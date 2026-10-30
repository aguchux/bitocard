"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button, Card, CardHeader, cn, errorMessage, Field, Input, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type StoreTemplate, useCreateStoreMutation, useStoreTemplatesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { SubdomainField, useAddressReady } from "@/components/store-settings";
import { DesignPreview, resaleTemplates, resolveDesign, VariantAndTheme } from "@/components/store-templates";

const steps = ["Design and colours", "Name and address"] as const;

function Wizard({ templates }: { templates: StoreTemplate[] }) {
  const router = useRouter();
  const { membership } = useReseller();
  const [step, setStep] = useState(0);
  const shop = templates[0];
  const [design, setDesign] = useState({ template: shop.key, variant: shop.variants[0].key, theme: shop.variants[0].themes[0].key });
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [create, state] = useCreateStoreMutation();
  const ready = useAddressReady(subdomain);
  const { template, variant, theme } = resolveDesign(templates, design);
  const noCountry = !membership.reseller.country;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await create({ name: name.trim(), subdomain: subdomain.trim(), ...design })
      .unwrap()
      .catch(() => null);
    if (created) router.push(`/store/${created.id}/design`);
  };

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold", index === step ? "bg-brand-500 text-white" : index < step ? "bg-brand-50 text-brand-700" : "bg-canvas text-muted")}
          >
            <span className="grid size-5 place-items-center rounded-full bg-white/25 text-xs">{index < step ? <Check className="size-3.5" aria-hidden /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card>
          <CardHeader title={`${template.name}: choose a design and its colours`} description={template.description} />
          {!template.available && template.reason ? (
            <div className="px-5 pt-5 sm:px-6">
              <Notice tone="amber">{template.reason}</Notice>
            </div>
          ) : null}
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

      {step === 1 ? (
        <Card>
          <CardHeader title="Name and address" description="Your store starts as a draft on its udozo.com address, where you test it. It goes live on its own domain." />
          <form id="new-store" onSubmit={submit} className="space-y-5 p-5 sm:p-6">
            {noCountry ? (
              <Notice tone="amber" title="Set your business country first">
                Your store sells to shoppers of your country, in its currency.{" "}
                <AppLink href="/settings" className="font-semibold underline underline-offset-2">
                  Set it in Business settings
                </AppLink>
                .
              </Notice>
            ) : null}
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            <Field label="Store name" htmlFor="store-name" hint="Shown to your shoppers. 2 to 60 characters.">
              <Input id="store-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} required autoComplete="organization" />
            </Field>
            <SubdomainField id="store-subdomain" value={subdomain} onChange={setSubdomain} hint="Lower-case letters, numbers and single hyphens. You can change it while the store is a draft." />
            <p className="text-xs text-muted">
              What you publish on your store (its name, words, logos and images) must be yours to use and honest. Your store never claims to own, make or stock what it resells: every
              listing names its supplier.
            </p>
          </form>
        </Card>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => (step === 0 ? router.push("/store") : setStep(step - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 1 ? (
          <Button icon={<ArrowRight className="size-4" aria-hidden />} disabled={!template.available} onClick={() => setStep(step + 1)}>
            Next
          </Button>
        ) : (
          <Button type="submit" form="new-store" loading={state.isLoading} disabled={noCountry || name.trim().length < 2 || !ready}>
            Create store
          </Button>
        )}
      </div>
    </div>
  );
}

/** Stores > New store: a Resale shop's design and colours, then its name and address; its design page opens next. */
export default function NewStorePage() {
  const { membership } = useReseller();
  const templates = useStoreTemplatesQuery();
  return (
    <ShqShell section="store" current="/store" crumbs={[{ label: "Stores", href: "/store" }, { label: "New store" }]}>
      <PageHeader title="New store" description="A Resale shop for your listings: choose how it looks and its address. Setting up takes a few minutes; verification and your domain may take longer." />
      {can(membership, "admin") ? (
        <QueryView query={templates} message={error => errorMessage(error, "Could not load the store designs.")} loading={<Skeleton className="h-96 w-full" />}>
          {({ data }) => (resaleTemplates(data).length ? <Wizard templates={resaleTemplates(data)} /> : <Notice tone="amber">No store design is open to your account yet.</Notice>)}
        </QueryView>
      ) : (
        <Notice tone="blue">The owner or an admin of {membership.reseller.name} creates stores.</Notice>
      )}
    </ShqShell>
  );
}
