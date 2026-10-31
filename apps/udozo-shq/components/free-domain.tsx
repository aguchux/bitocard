"use client";

import { usePaidPlans } from "@/components/paid-plans";
import { useState, type FormEvent } from "react";
import { Gift, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, errorMessage, formatMoney, Input, Notice, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type DomainContact, type DomainOffer, type FreeDomain, type StoreDomain, useClaimFreeDomainMutation, useFreeDomainQuery, useLazySearchDomainsQuery } from "@bitocard/api-client/reseller";
import { blankContact, cleanContact, ContactFields, contactComplete } from "./domains";

/** Where the store's free domain stands, in words: `none` (no Premium), `used`, `unpaid` (nothing collected) or `ready`. */
export function freeDomainState(free: FreeDomain): "none" | "used" | "unpaid" | "ready" {
  if (free.available) return "ready";
  if (free.allowance === 0) return "none";
  if (free.allowance !== null && free.used >= free.allowance) return "used";
  return "unpaid";
}

/** The registrant's details, then the free domain is bought: nothing is taken from the wallet. */
function ClaimDialog({ store, offer, defaults, onClose, onClaimed }: { store: string; offer: DomainOffer; defaults: Partial<DomainContact>; onClose: () => void; onClaimed?: (domain: StoreDomain) => void }) {
  const [contact, setContact] = useState<DomainContact>(() => blankContact(defaults));
  const [claim, state] = useClaimFreeDomainMutation();
  const code = (state.error as { code?: string } | undefined)?.code;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Get ${offer.domain} free`}
      description="Included with this store's Premium plan: nothing is taken from your wallet. It renews free while the store keeps Premium."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={state.isLoading}
            disabled={!contactComplete(contact)}
            onClick={() =>
              void claim({ store, domain: offer.domain, contact: cleanContact(contact) })
                .unwrap()
                .then(domain => {
                  onClose();
                  onClaimed?.(domain);
                })
                .catch(() => undefined)
            }
          >
            Get it free
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ContactFields contact={contact} onChange={setContact} />
        {state.error ? (
          <Notice tone="red" title={code === "domain_not_covered" ? "Not covered by your Premium" : code === "free_domain_unavailable" ? "No free domain left" : undefined}>
            {errorMessage(state.error)}
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Premium's free domain for one store (Udozo): what it is owed and, while one is left, a search to choose it. Without
 * Premium it says how to get one; a store whose Premium collected nothing (given by Udozo, not billed) has none to spend.
 */
export function FreeDomainCard(props: { store: string; live: boolean; contactDefaults: Partial<DomainContact>; canManage: boolean; onClaimed?: (domain: StoreDomain) => void }) {
  // Without paid plans there is no Premium to include a domain.
  return usePaidPlans() ? <PremiumDomain {...props} /> : null;
}

function PremiumDomain({ store, live, contactDefaults, canManage, onClaimed }: { store: string; live: boolean; contactDefaults: Partial<DomainContact>; canManage: boolean; onClaimed?: (domain: StoreDomain) => void }) {
  const free = useFreeDomainQuery(store);
  const [query, setQuery] = useState("");
  const [search, results] = useLazySearchDomainsQuery();
  const [chosen, setChosen] = useState<DomainOffer | null>(null);
  const state = free.data ? freeDomainState(free.data) : null;
  const covers = free.data && free.data.covers_up_to.amount > 0 ? formatMoney(free.data.covers_up_to.amount, free.data.covers_up_to.currency) : null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Gift className="size-5 text-brand-600" aria-hidden /> Free domain with Premium
          </span>
        }
        description="Premium includes a domain for the store, paid for by its first month (and the setup fee paid with it). It renews free while the store keeps Premium."
        actions={state === "ready" ? <Badge tone="green">1 to claim</Badge> : state === "used" ? <Badge tone="grey">Claimed</Badge> : null}
      />
      <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
        {free.isLoading ? <Skeleton className="h-16 w-full" /> : null}
        {free.error ? <Notice tone="red">{errorMessage(free.error, "Could not check the store's free domain.")}</Notice> : null}
        {state === "none" ? (
          <Notice tone="blue">
            Take Premium for this store and a domain is included.{" "}
            <AppLink href={`/settings/plan?store=${store}`} className="font-semibold text-brand-600 hover:underline">
              See Premium
            </AppLink>
          </Notice>
        ) : null}
        {state === "used" ? <Notice tone="grey">This store has had its free domain. Further domains are bought from your wallet, or connected.</Notice> : null}
        {state === "unpaid" ? (
          <Notice tone="amber">
            This store&apos;s Premium has not collected a payment yet, so there is nothing to pay for a free domain. It is covered once a paid Premium month starts.{" "}
            <AppLink href={`/settings/plan?store=${store}`} className="font-semibold text-brand-600 hover:underline">
              Plans
            </AppLink>
          </Notice>
        ) : null}
        {state === "ready" ? (
          <>
            <p className="text-sm text-muted">{covers ? `Choose a domain costing up to ${covers}, what this store's Premium collected.` : "Choose your domain."}</p>
            {!live ? <Notice tone="amber">Domains are bought live. Switch to live to claim it.</Notice> : null}
            {canManage ? (
              <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  if (query.trim().length >= 2) void search({ store, q: query.trim() });
                }}
              >
                <div className="min-w-0 flex-1">
                  <label htmlFor="free-domain-search" className="sr-only">
                    Domain name
                  </label>
                  <Input id="free-domain-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="yourstore" autoComplete="off" />
                </div>
                <Button type="submit" variant="secondary" icon={<Search className="size-4" aria-hidden />} loading={results.isFetching} disabled={query.trim().length < 2}>
                  Search
                </Button>
              </form>
            ) : (
              <Notice tone="blue">The owner or an admin claims the store&apos;s free domain.</Notice>
            )}
            {results.error ? <Notice tone="red">{errorMessage(results.error)}</Notice> : null}
            {results.data ? (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {results.data.data.map(offer => (
                  <li key={offer.domain} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="break-all font-semibold text-ink">{offer.domain}</span>
                    {offer.available ? (
                      <Button size="sm" onClick={() => setChosen(offer)} disabled={!live}>
                        Choose
                      </Button>
                    ) : (
                      <Badge tone="grey">Taken</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
      {chosen ? <ClaimDialog store={store} offer={chosen} defaults={contactDefaults} onClose={() => setChosen(null)} onClaimed={onClaimed} /> : null}
    </Card>
  );
}
