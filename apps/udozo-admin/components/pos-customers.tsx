"use client";

import { useState } from "react";
import { Badge, Card, CardHeader, Input, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type AdminPosCustomerDetail, usePosCustomersQuery } from "@bitocard/api-client/admin";
import { money } from "@/components/connect";

/** A linked customer's Udozo rating in words: reviews, Anjio's band, since when, and their standing. */
export function udozoRatingWords(rating: NonNullable<AdminPosCustomerDetail["udozo_rating"]>) {
  const parts: string[] = [];
  if (rating.reviews?.positive_pct != null) parts.push(`${rating.reviews.positive_pct}% positive from ${rating.reviews.counted} reviews`);
  else if (rating.reviews) parts.push(`${rating.reviews.counted} review${rating.reviews.counted === 1 ? "" : "s"}`);
  if (rating.scores?.band) parts.push(rating.scores.band);
  parts.push(`on Udozo since ${new Date(rating.member_since).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`);
  if (!rating.in_good_standing) parts.push("Udozo account suspended");
  return parts.join(" · ");
}

/**
 * A POS shop's customers, read under its account: the shop's own records (no Udozo account needed), those linked to a
 * Udozo account marked, and what each owes the shop for goods sold on credit.
 */
export function PosCustomersCard({ account, currency }: { account: string; currency: string }) {
  const [q, setQ] = useState("");
  const [owing, setOwing] = useState(false);
  const query = usePosCustomersQuery({ account, ...(q.trim() ? { q: q.trim() } : {}), ...(owing ? { owing: true } : {}), limit: 50 });
  return (
    <Card>
      <CardHeader title="Customers" description="The shop's own customers. Those marked Udozo paid through Udozo and are linked to their Udozo account." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label htmlFor="pos-customer-search" className="sr-only">
          Find a customer
        </label>
        <Input id="pos-customer-search" value={q} onChange={event => setQ(event.target.value)} placeholder="Name, mobile, email or number" className="max-w-sm" />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={owing} onChange={event => setOwing(event.target.checked)} className="size-4" />
          Only those who owe the shop
        </label>
      </div>
      <QueryView query={query} loading={<Skeleton className="h-32 w-full" />}>
        {list => (
          <>
            <p className="mb-2 text-sm text-muted">
              {list.total} {list.total === 1 ? "customer" : "customers"} · {list.summary.owing} owe the shop {money(list.summary.owed, currency)}
            </p>
            {list.data.length ? (
              <ul className="grid gap-2 text-sm">
                {list.data.map(customer => (
                  <li key={customer.id}>
                    <AppLink href={`/pos/accounts/${account}/customers/${customer.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 no-underline hover:bg-canvas">
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">
                          {customer.name} {customer.udozo ? <Badge tone="blue">Udozo</Badge> : null}
                        </span>
                        <span className="block text-xs text-muted">{[customer.number, customer.phone, `${customer.sales_count} sales`].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className={customer.owed ? "font-semibold text-amber-700" : "text-muted"}>{customer.owed ? `Owes ${money(customer.owed, currency)}` : `${money(customer.spent, currency)} spent`}</span>
                    </AppLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No customers{q || owing ? " match" : " yet"}.</p>
            )}
          </>
        )}
      </QueryView>
    </Card>
  );
}
