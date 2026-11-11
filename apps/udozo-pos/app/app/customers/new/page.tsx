import type { Metadata } from "next";
import Link from "next/link";
import { CustomerForm } from "@/components/customer-forms";
import { currentOwner } from "@/lib/pos-data";

export const metadata: Metadata = {
  title: "Add a customer",
  robots: { index: false, follow: false },
};

/** Adding one of the shop's own customers: no Udozo account needed. */
export default async function NewCustomerPage() {
  const owner = await currentOwner();
  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <Link href="/app/customers" className="text-sm font-semibold">
          ← Customers
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">
          Add a customer
        </h1>
      </div>
      <CustomerForm
        customer={null}
        currency={owner.ok ? owner.data.currency : "NGN"}
      />
    </div>
  );
}
