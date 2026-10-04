"use client";

import { useState } from "react";
import { Globe2, Pencil } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, ErrorState, errorMessage, Field, Notice, Select, Skeleton, Toggle } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type IntegrationApproval, type IntegrationOffer, useCountriesQuery, useIntegrationOffersQuery, useSetIntegrationOfferMutation } from "@bitocard/api-client/admin";

const kindLabels = { supplier: "Supplier", payment_gateway: "Payment gateway" } as const;

function where(offer: IntegrationOffer) {
  if (offer.global) return "All countries";
  return offer.countries.length ? offer.countries.join(", ") : "Not offered";
}

function OfferDialog({ offer, onClose }: { offer: IntegrationOffer; onClose: () => void }) {
  const countries = useCountriesQuery();
  const [save] = useSetIntegrationOfferMutation();
  const [global, setGlobal] = useState(offer.global);
  const [selected, setSelected] = useState<string[]>(offer.countries);
  const [approval, setApproval] = useState<IntegrationApproval>(offer.approval);
  const toggle = (code: string, on: boolean) => setSelected(current => (on ? [...current, code] : current.filter(item => item !== code)));

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Offer ${offer.name} to resellers`}
      description="Resellers with own integrations switched on (and a plan that includes them) can connect their own account where it is offered. Changes are recorded in the activity log."
      confirmLabel="Save"
      requireReason={false}
      onConfirm={() => save({ id: offer.integration_id, global, countries: global ? [] : selected, approval }).unwrap()}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink">All countries</p>
          <p className="text-xs text-muted">Offered to resellers everywhere, including countries added later.</p>
        </div>
        <Toggle label="All countries" checked={global} onChange={setGlobal} />
      </div>
      {!global ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Countries</legend>
          {countries.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : countries.error ? (
            <Notice tone="red">{errorMessage(countries.error)}</Notice>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {countries.data?.data.map(country => (
                <label key={country.code} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <input type="checkbox" className="size-4 accent-brand-500" checked={selected.includes(country.code)} onChange={event => toggle(country.code, event.target.checked)} />
                  {country.name} ({country.code})
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted">None selected: not offered anywhere.</p>
        </fieldset>
      ) : null}
      <Field label="Live connections" htmlFor="offer-approval" hint="Review is recommended for payment gateways and for the first resellers on any integration.">
        <Select id="offer-approval" value={approval} onChange={event => setApproval(event.target.value as IntegrationApproval)}>
          <option value="review">Reviewed by an admin first</option>
          <option value="automatic">Active once the credentials check out</option>
        </Select>
      </Field>
    </ActionDialog>
  );
}

/** Which integrations resellers may connect their own accounts to, and where. Super admins edit; others read. */
export function ResellerAvailability({ editable }: { editable: boolean }) {
  const { data, error, isLoading, refetch } = useIntegrationOffersQuery();
  const [editing, setEditing] = useState<string | null>(null);
  const current = data?.data.find(item => item.integration_id === editing) ?? null;

  if (error) {
    return (
      <Card>
        <ErrorState message={errorMessage(error)} onRetry={refetch} />
      </Card>
    );
  }
  if (isLoading || !data) return <Skeleton className="h-56 w-full" />;
  return (
    <>
      <Notice tone="blue">
        Resellers connect their own accounts only to integrations offered in their country, when own integrations are switched on for them and their plan includes them.{" "}
        <AppLink href="/resellers/connections" className="font-semibold underline">
          Review connections
        </AppLink>
      </Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.data.map(offer => (
          <Card key={offer.integration_id} className="flex flex-col">
            <CardHeader
              title={offer.name}
              description={kindLabels[offer.kind]}
              actions={
                <>
                  <Badge tone={offer.offered ? "green" : "grey"}>{offer.offered ? "Offered" : "Not offered"}</Badge>
                  {editable ? (
                    <Button variant="secondary" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(offer.integration_id)} aria-label={`Edit where ${offer.name} is offered`}>
                      Edit
                    </Button>
                  ) : null}
                </>
              }
            />
            <dl className="grid gap-2 px-5 pb-5 text-sm sm:px-6">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">Where</dt>
                <dd className="inline-flex items-center gap-1.5 font-medium text-ink">
                  {offer.global ? <Globe2 className="size-4" aria-hidden /> : null}
                  {where(offer)}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">Live connections</dt>
                <dd className="font-medium text-ink">{offer.approval === "review" ? "Reviewed first" : "Automatic"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">Resellers connected</dt>
                <dd className="font-medium text-ink">
                  {`${offer.connections.active} active · ${offer.connections.pending_review} waiting · ${offer.connections.suspended} suspended`}
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>
      {current ? <OfferDialog key={current.integration_id} offer={current} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
