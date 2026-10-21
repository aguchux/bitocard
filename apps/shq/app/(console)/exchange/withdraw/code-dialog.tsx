"use client";

import { useEffect, useState } from "react";
import { Button, CodeInput, Dialog, errorMessage, Notice, resendWait } from "@bitocard/admin-ui";
import { type CoinWithdrawal, useCancelCoinWithdrawalMutation, useConfirmCoinWithdrawalMutation, useResendCoinWithdrawalCodeMutation } from "@bitocard/api-client/reseller";
import { coinAmount } from "../shared";
import { shortHash } from "../coin-parts";
import { reviewText } from "./amounts";

/**
 * The emailed 6-digit code for a withdrawal. Confirm sends it (never on the sixth digit by itself, so a typo is not
 * spent as an attempt); Resend works once a minute; Cancel gives the coins back. Keyed by the withdrawal, so each
 * one opens fresh.
 */
export function CodeDialog({ withdrawal, onClose }: { withdrawal: CoinWithdrawal | null; onClose: () => void }) {
  const [code, setCode] = useState("");
  // The countdown starts when the latest code was emailed (the API's `code_sent_at`), not when the withdrawal was asked for.
  const [sentAt, setSentAt] = useState<string | null>(withdrawal?.code_sent_at ?? withdrawal?.created_at ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, confirmState] = useConfirmCoinWithdrawalMutation();
  const [resend, resendState] = useResendCoinWithdrawalCodeMutation();
  const [cancel, cancelState] = useCancelCoinWithdrawalMutation();
  const [done, setDone] = useState<CoinWithdrawal | null>(null);
  const open = Boolean(withdrawal);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!withdrawal)
    return (
      <Dialog open={false} onClose={onClose} title="Confirm withdrawal">
        {null}
      </Dialog>
    );
  const wait = resendWait(sentAt, now);
  const error = confirmState.error ?? resendState.error ?? cancelState.error;
  const busy = confirmState.isLoading || resendState.isLoading || cancelState.isLoading;

  if (done) {
    return (
      <Dialog open onClose={onClose} title={done.status === "cancelled" ? "Withdrawal cancelled" : "Withdrawal confirmed"} footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm text-ink">
          {done.status === "cancelled"
            ? `${coinAmount(done.total)} ${done.asset} is back in your coin wallet.`
            : done.status === "review"
              ? `BitoCard reviews this withdrawal before it is sent, because ${reviewText[done.review_reason ?? ""] ?? "it needs a check"}. You will be told when it is decided.`
              : `${coinAmount(done.amount)} ${done.asset} is on its way to ${shortHash(done.address)} on ${done.network}.`}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enter the emailed code"
      description={`We emailed a 6-digit code to you for ${withdrawal.number}: ${coinAmount(withdrawal.amount)} ${withdrawal.asset} on ${withdrawal.network}. It works for 30 minutes.`}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            loading={cancelState.isLoading}
            onClick={() =>
              void cancel(withdrawal.id)
                .unwrap()
                .then(setDone)
                .catch(() => undefined)
            }
          >
            Cancel withdrawal
          </Button>
          <Button
            disabled={code.length !== 6 || busy}
            loading={confirmState.isLoading}
            onClick={() =>
              void confirm({ id: withdrawal.id, code })
                .unwrap()
                .then(setDone)
                .catch(() => undefined)
            }
          >
            Confirm
          </Button>
        </>
      }
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (code.length === 6 && !busy)
            void confirm({ id: withdrawal.id, code })
              .unwrap()
              .then(setDone)
              .catch(() => undefined);
        }}
      >
        <CodeInput value={code} onChange={setCode} label="Withdrawal code" autoFocus invalid={Boolean(confirmState.error)} disabled={busy} />
        <p className="mt-3 break-all text-sm text-muted">
          To {withdrawal.address}. Total {coinAmount(withdrawal.total)} {withdrawal.asset} including the {coinAmount(withdrawal.fee)} {withdrawal.asset} network fee.
        </p>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            disabled={wait > 0 || busy}
            loading={resendState.isLoading}
            onClick={() =>
              void resend(withdrawal.id)
                .unwrap()
                .then(updated => {
                  setSentAt(updated.code_sent_at ?? new Date().toISOString());
                  setCode("");
                })
                .catch(() => undefined)
            }
          >
            {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          </Button>
          {resendState.isSuccess && !resendState.error ? (
            <span role="status" className="ml-3 text-sm font-semibold text-mint-700">
              A new code is on its way.
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="mt-4">
            <Notice tone="red">{errorMessage(error)}</Notice>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
