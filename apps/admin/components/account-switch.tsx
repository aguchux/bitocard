"use client";

import { useState } from "react";
import { ShoppingBag, Store } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, Field, Input, Notice, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { useCustomerResellerPreviewQuery, useMakeCustomerResellerMutation, useMakeResellerCustomerMutation, useResellerCustomerPreviewQuery } from "@bitocard/api-client/admin";

/**
 * A reseller's page: for people who signed up as resellers but only meant to buy. Their owner gets a bitocard.com
 * customer account with the same email and password, and the reseller account can be suspended at the same time.
 */
export function MakeCustomerCard({ resellerId, canChange }: { resellerId: string; canChange: boolean }) {
  const preview = useResellerCustomerPreviewQuery(resellerId);
  const [make] = useMakeResellerCustomerMutation();
  const [open, setOpen] = useState(false);
  const [suspend, setSuspend] = useState(true);
  const data = preview.data;
  const canSuspend = data ? !data.holds_money && data.reseller_status !== "suspended" : false;

  return (
    <Card>
      <CardHeader title="Customer account" description="Signed up as a reseller but only meant to buy? Make the owner a bitocard.com customer." />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {!data ? (
          <Skeleton className="h-16 w-full" />
        ) : !data.owner ? (
          <p className="text-sm text-muted">This reseller has no owner.</p>
        ) : (
          <>
            {data.existing_customer_id ? (
              <p className="text-sm">
                {data.owner.email} is already a bitocard.com customer.{" "}
                <AppLink href={`/storefront/customers/${data.existing_customer_id}`} className="font-semibold text-brand-600 hover:underline">
                  Open their customer account
                </AppLink>
              </p>
            ) : (
              <p className="text-sm text-muted">
                {data.owner.name} ({data.owner.email}) gets a customer account with the same email{data.owner.has_password ? " and password" : ""}.
              </p>
            )}
            {canChange ? (
              <Button variant="secondary" icon={<ShoppingBag className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
                {data.existing_customer_id ? "Close as a reseller" : "Make a customer"}
              </Button>
            ) : null}
          </>
        )}
      </div>
      {data?.owner ? (
        <ActionDialog
          open={open}
          onClose={() => setOpen(false)}
          title={`Make ${data.owner.name} a customer?`}
          description={
            data.existing_customer_id
              ? "They already have a bitocard.com customer account. Your reason is kept in the audit log."
              : "They get a bitocard.com customer account with the same email and password, and are emailed how to sign in. Nothing is deleted. Your reason is kept in the audit log."
          }
          confirmLabel={data.existing_customer_id ? "Confirm" : "Make a customer"}
          onConfirm={reason => make({ id: resellerId, reason, suspend_reseller: canSuspend && suspend }).unwrap()}
        >
          {canSuspend ? (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={suspend} onChange={event => setSuspend(event.target.checked)} />
              <span>
                <span className="block font-semibold text-ink">Also suspend the reseller account</span>
                <span className="block text-muted">Its store and API keys stop. You can unsuspend it later.</span>
              </span>
            </label>
          ) : data.holds_money ? (
            <Notice tone="amber" title="The reseller account stays open">
              BitoCard holds money for this reseller, so it cannot be suspended here. Pay it out or move it first.
            </Notice>
          ) : null}
        </ActionDialog>
      ) : null}
    </Card>
  );
}

/**
 * A bitocard.com customer's page: for people who signed up as customers but want to sell. They get a new, pending
 * reseller account on Seller HQ with the same email and password; their customer account stays.
 */
export function MakeResellerCard({ customerId, canChange }: { customerId: string; canChange: boolean }) {
  const preview = useCustomerResellerPreviewQuery(customerId);
  const [make] = useMakeCustomerResellerMutation();
  const [open, setOpen] = useState(false);
  const [business, setBusiness] = useState("");
  const data = preview.data;
  const blocked = data ? !data.customer.country ? "They have not chosen their country yet." : !data.country_open ? `Reseller sign-up is not open in ${data.country_name ?? data.customer.country}.` : null : null;

  return (
    <Card>
      <CardHeader title="Reseller account" description="Want to sell rather than buy? Give them a reseller account on Seller HQ." />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {!data ? (
          <Skeleton className="h-16 w-full" />
        ) : data.existing_reseller_id ? (
          <p className="text-sm">
            {data.customer.email} already owns a reseller account.{" "}
            <AppLink href={`/resellers/${data.existing_reseller_id}`} className="font-semibold text-brand-600 hover:underline">
              Open the reseller
            </AppLink>
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {data.customer.name} gets a pending reseller account with the same email{data.seller_hq_person ? " (they already sign in to Seller HQ with it)" : " and password"}. They finish the identity check
              before selling live, and stay a customer.
            </p>
            {blocked ? <p className="text-sm text-muted">{blocked}</p> : null}
            {canChange ? (
              <Button variant="secondary" icon={<Store className="size-4" aria-hidden />} disabled={Boolean(blocked)} onClick={() => setOpen(true)}>
                Make a reseller
              </Button>
            ) : null}
          </>
        )}
      </div>
      {data && !data.existing_reseller_id ? (
        <ActionDialog
          open={open}
          onClose={() => setOpen(false)}
          title={`Make ${data.customer.name} a reseller?`}
          description="They are emailed how to sign in to Seller HQ. Your reason is kept in the audit log."
          confirmLabel="Make a reseller"
          onConfirm={async reason => {
            if (business.trim().length < 2) throw new Error("Enter the business name.");
            await make({ id: customerId, business_name: business.trim(), reason }).unwrap();
            setBusiness("");
          }}
        >
          <Field label="Business name" htmlFor="make-reseller-business">
            <Input id="make-reseller-business" value={business} maxLength={120} onChange={event => setBusiness(event.target.value)} placeholder={data.customer.name} />
          </Field>
        </ActionDialog>
      ) : null}
    </Card>
  );
}
