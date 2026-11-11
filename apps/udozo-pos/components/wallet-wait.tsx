"use client";

/* eslint-disable @next/next/no-img-element -- the QR code is drawn in the browser as a data address. */
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import {
  money,
  type PosSale,
  type PosWalletRequest,
  timeLeft,
  walletOutcome,
} from "@/lib/pos";
import { cancelWallet, walletStatus } from "@/lib/pos-actions";

export type WaitingRequest = PosWalletRequest & {
  token: string;
  pay_url: string;
};

/**
 * Waiting for the buyer to pay from their Udozo wallet: the QR code their phone's camera opens on udozo.com (or, asked by
 * their mobile number, a note that it is on their phone), the time left, and Cancel. The till asks every 2 seconds;
 * paid, the sale is made and handed back; declined, expired or cancelled, it says so.
 */
export function WalletWait({
  request,
  onPaid,
  onClosed,
}: {
  request: WaitingRequest;
  onPaid: (sale: PosSale) => void;
  onClosed: (message: string) => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (request.for_buyer) return;
    let alive = true;
    void QRCode.toDataURL(request.pay_url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    }).then((url) => {
      if (alive) setQr(url);
    });
    return () => {
      alive = false;
    };
  }, [request.pay_url, request.for_buyer]);

  useEffect(() => {
    let stopped = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = async () => {
      if (stopped) return;
      const result = await walletStatus(request.id);
      if (stopped) return;
      if (result.ok) {
        if (result.data.status === "paid" && result.data.sale)
          return onPaid(result.data.sale);
        const outcome = walletOutcome(result.data.status);
        if (outcome) return onClosed(outcome);
      }
      setTimeout(poll, 2000);
    };
    const first = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(tick);
      clearTimeout(first);
    };
  }, [request.id, onPaid, onClosed]);

  const cancel = async () => {
    setBusy(true);
    await cancelWallet(request.id);
    onClosed("The request was cancelled.");
  };

  return (
    <div className="grid gap-3 text-center" role="status">
      <p className="font-semibold text-pos-ink">
        Waiting for {money(request.amount, request.currency)} from the
        buyer&apos;s Udozo wallet
      </p>
      {request.for_buyer ? (
        <p className="rounded-xl bg-pos-50 p-4 text-pos-ink-2">
          It is on the buyer&apos;s phone: they open the notice from Udozo and
          press Pay.
        </p>
      ) : (
        <>
          <span className="mx-auto block size-60 rounded-xl bg-white p-2 ring-1 ring-pos-line">
            {qr ? (
              <img
                src={qr}
                alt={`QR code to pay ${money(request.amount, request.currency)} on udozo.com`}
                className="size-full"
              />
            ) : null}
          </span>
          <p className="text-sm text-pos-ink-2">
            The buyer scans it with their phone&apos;s camera, signs in to Udozo
            and presses Pay.
          </p>
        </>
      )}
      <p className="text-sm text-pos-muted">
        {request.number} · {timeLeft(request.expires_at, now)} left
      </p>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="h-12 rounded-xl border border-pos-line font-bold disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
