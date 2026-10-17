"use client";

import { AppLink } from "@bitocard/admin-ui/shell";

/** Whose coins an on-chain deposit or withdrawal is: a store customer, or a Premium reseller's own coin wallet. */
export function CoinOwnerLink({ customer, reseller }: { customer: { id: string; email: string } | null; reseller: { id: string; name: string } | null }) {
  if (reseller) {
    return (
      <AppLink href={`/resellers/${reseller.id}`} className="text-brand-600 hover:underline">
        {reseller.name} <span className="text-xs text-muted">(reseller)</span>
      </AppLink>
    );
  }
  if (!customer) return <span className="text-muted">—</span>;
  return (
    <AppLink href={`/crypto/customers/${customer.id}`} className="text-brand-600 hover:underline">
      {customer.email}
    </AppLink>
  );
}
