"use client";

import { useState } from "react";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { ActionDialog, Button, formatDate, humanise, Notice } from "@bitocard/admin-ui";
import { type ResellerDetail, useMarkResellerTestAccountMutation, useUnmarkResellerTestAccountMutation } from "@bitocard/api-client/admin";

/**
 * The reseller's identity check at the top of their page. Every real reseller passes it before going live: the only
 * exception is a test account, which operations mark (with a reason, audited). A test account can be activated
 * without the check but never moves money out. The sandbox needs no check at all.
 */
export function TestAccount({ reseller, operator, latestCheck }: { reseller: ResellerDetail; operator: boolean; latestCheck?: string | null }) {
  const [open, setOpen] = useState<"mark" | "unmark" | null>(null);
  const [activateNow, setActivateNow] = useState(true);
  const [mark] = useMarkResellerTestAccountMutation();
  const [unmark] = useUnmarkResellerTestAccountMutation();
  const verified = Boolean(reseller.verified_at);
  const test = reseller.test_account ?? null;

  return (
    <>
      {test ? (
        <Notice
          tone="blue"
          title="Test account"
          action={
            operator ? (
              <Button variant="secondary" size="sm" icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => setOpen("unmark")}>
                Not a test account
              </Button>
            ) : null
          }
        >
          {test.marked_by ? `${test.marked_by.name} marked` : "An admin marked"} this a test account on {formatDate(test.marked_at)}
          {test.reason ? `: “${test.reason}”.` : "."} It can be activated without the identity check, but never withdraws money, gets the startup allowance or a bank account number
          {verified ? "." : " until the owner passes the check."}
        </Notice>
      ) : !verified && reseller.status !== "active" ? (
        <Notice
          tone="amber"
          title="Identity not verified"
          action={
            operator ? (
              <Button variant="secondary" size="sm" icon={<FlaskConical className="size-4" aria-hidden />} onClick={() => setOpen("mark")}>
                Mark as test account
              </Button>
            ) : null
          }
        >
          The owner has not passed the identity check, so this reseller cannot go live yet. The sandbox needs no check.
          {latestCheck ? ` Latest check: ${humanise(latestCheck)}.` : " No check started."}
        </Notice>
      ) : null}

      <ActionDialog
        open={open === "mark"}
        onClose={() => setOpen(null)}
        title={`Mark ${reseller.name} as a test account?`}
        description="Only for BitoCard's own and partners' testing accounts: every real reseller passes the identity check before going live. A test account can be activated without it (live orders, top-ups and live API keys) but never withdraws money, gets the startup allowance or a bank account number. Your reason is kept in the audit log."
        confirmLabel="Mark as test account"
        onConfirm={reason => mark({ id: reseller.id, reason, activate: reseller.status === "pending" && activateNow }).unwrap()}
      >
        {reseller.status === "pending" ? (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={activateNow} onChange={event => setActivateNow(event.target.checked)} />
            <span>
              <span className="block font-semibold text-ink">Activate it now</span>
              <span className="block text-muted">Otherwise use Activate when you are ready.</span>
            </span>
          </label>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={open === "unmark"}
        onClose={() => setOpen(null)}
        title="No longer a test account?"
        description={
          reseller.status === "active" && !verified
            ? "They go back to pending and stop selling live until the owner passes the identity check."
            : "They are treated like any other reseller from now on."
        }
        confirmLabel="Not a test account"
        tone="danger"
        onConfirm={reason => unmark({ id: reseller.id, reason }).unwrap()}
      />
    </>
  );
}
