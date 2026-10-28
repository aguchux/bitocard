"use client";

import { AppLink } from "@bitocard/admin-ui/shell";

/** Whose coins an on-chain deposit or withdrawal is. */
export function CoinOwnerLink({ customer }: { customer: { id: string; email: string } }) {
  return (
    <AppLink href={`/crypto/customers/${customer.id}`} className="text-brand-600 hover:underline">
      {customer.email}
    </AppLink>
  );
}
