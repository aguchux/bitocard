"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ActionDialog, Button, Card, DataTable, errorMessage, Field, formatDateTime, humanise, Input, LoadMore, StatusBadge } from "@bitocard/admin-ui";
import { can, useAdmin, AppLink } from "@bitocard/admin-ui/shell";
import { useDecideVerificationMutation, useVerificationsInfiniteQuery, type Verification, type VerificationStatus } from "@bitocard/api-client/admin";

/** Who ran a check, in words: the provider's internal key ("bitocard" is Udozo Verify) is never shown. */
export const providerLabels: Record<string, string> = { bitocard: "Udozo Verify", didit: "Didit", flutterwave: "Flutterwave", sandbox: "Sandbox", test: "Sandbox" };
export const providerLabel = (provider: string) => providerLabels[provider] ?? humanise(provider);
/** A check run by Udozo Verify is decided from its case (documents, selfie and liveness), never from this list. */
export const isVerifyCheck = (check: Pick<Verification, "provider">) => check.provider === "bitocard";

/**
 * Identity checks, newest first. Udozo Verify's open each case, where they are decided with the documents; other
 * providers' checks in review are approved or declined here by operations after looking at them in the provider's
 * console. Every decision is audited.
 */
export function VerificationList({ status, subject }: { status?: VerificationStatus; subject?: "reseller" | "customer" }) {
  const admin = useAdmin();
  const query = useVerificationsInfiniteQuery({ status, subject });
  const [decide] = useDecideVerificationMutation();
  const [pending, setPending] = useState<{ check: Verification; decision: "approved" | "declined" } | null>(null);
  const [verifiedName, setVerifiedName] = useState("");
  const rows = query.data?.pages.flatMap(page => page.data);
  const operator = can(admin, "operations");

  return (
    <Card>
      <DataTable
        caption="Identity checks"
        rows={rows}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={check => check.id}
        empty={status === "in_review" ? "Nothing to review. Checks the provider cannot decide appear here." : "No identity checks yet."}
        columns={[
          {
            key: "who",
            header: "Who",
            cell: check => (
              <span>
                {check.subject === "reseller" ? (
                  <span className="font-semibold">{check.expected_name ?? "Business owner"}</span>
                ) : check.customer ? (
                  <AppLink href={`/customers/${check.customer.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {check.customer.name}
                    <span className="block text-xs font-normal text-muted">{check.customer.email}</span>
                  </AppLink>
                ) : (
                  <span className="font-semibold">{check.customer_reference ? `Their reference ${check.customer_reference}` : "Customer"}</span>
                )}
                <span className="block text-xs text-muted">
                  {check.subject === "reseller" ? "Reseller owner" : "Customer"} of{" "}
                  <AppLink href={`/resellers/${check.reseller_id}`} className="underline-offset-2 hover:underline">
                    {check.reseller_name ?? "reseller"}
                  </AppLink>
                </span>
              </span>
            ),
          },
          { key: "method", header: "Method", cell: check => `${check.method === "bvn" ? "BVN" : "ID document"} · ${providerLabel(check.provider)}`, hideOnMobile: true },
          { key: "country", header: "Country", cell: check => check.country },
          { key: "status", header: "Status", cell: check => <StatusBadge status={check.status} /> },
          { key: "reason", header: "Reason", cell: check => <span className="text-sm text-muted">{check.reason ? humanise(check.reason) : "—"}</span>, hideOnMobile: true },
          { key: "started", header: "Started", cell: check => <span className="text-muted">{formatDateTime(check.created_at)}</span>, hideOnMobile: true },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: check =>
              isVerifyCheck(check) ? (
                <AppLink href={`/verifications/verify/${check.provider_reference}`} className="text-sm font-semibold text-brand-700 hover:underline">
                  {check.status === "in_review" ? "Review case" : "Open case"}
                </AppLink>
              ) : operator && check.status === "in_review" ? (
                <span className="inline-flex gap-2">
                  <Button
                    size="sm"
                    icon={<CheckCircle2 className="size-4" aria-hidden />}
                    onClick={() => {
                      setVerifiedName(check.expected_name ?? "");
                      setPending({ check, decision: "approved" });
                    }}
                  >
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" icon={<XCircle className="size-4" aria-hidden />} onClick={() => setPending({ check, decision: "declined" })}>
                    Decline
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      <ActionDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.decision === "approved" ? "Approve this identity check?" : "Decline this identity check?"}
        description={
          pending?.decision === "approved"
            ? "Only after checking the document and face match in the provider’s console. An approved reseller owner can go live."
            : "The person can start a new check afterwards."
        }
        confirmLabel={pending?.decision === "approved" ? "Approve" : "Decline"}
        tone={pending?.decision === "declined" ? "danger" : "primary"}
        onConfirm={reason =>
          decide({
            id: pending!.check.id,
            decision: pending!.decision,
            reason,
            ...(pending!.decision === "approved" && verifiedName.trim() ? { verified_name: verifiedName.trim() } : {}),
          }).unwrap()
        }
      >
        {pending?.decision === "approved" ? (
          <Field label="Name on the document" htmlFor="verified-name" hint="As shown in the provider’s console.">
            <Input id="verified-name" value={verifiedName} onChange={event => setVerifiedName(event.target.value)} />
          </Field>
        ) : null}
      </ActionDialog>
    </Card>
  );
}
