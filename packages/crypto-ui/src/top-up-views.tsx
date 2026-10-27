import { Clock } from "lucide-react";
import { formatFace, type StoreWalletTopUp } from "@bitocard/api-client/storefront";
import { cancelErrorText } from "./top-up-actions";
import type { CustomerCall } from "./trade-actions";

type FormAction = (form: FormData) => Promise<void>;

/** Gives up on a payment page: the top-up is closed and its notice goes. */
function CancelPayment({ id, back, action }: { id: string; back: string; action: FormAction }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="min-h-10 rounded-xl bg-white px-3 font-semibold text-amber-900 ring-1 ring-amber-200 hover:ring-amber-300">
        Cancel payment
      </button>
    </form>
  );
}

/**
 * A top-up just made (back from the payment page, or in the sandbox): where it stands. While it waits, the customer can
 * go back to the payment page or cancel it; unpaid, it also closes by itself after the payment timeout. `cancel` and
 * `simulate` are the app's server actions; `back` the wallet tab it returns to.
 */
export async function TopUpStatus({ api, id, back, cancelError, cancel, simulate }: { api: CustomerCall; id: string; back: string; cancelError?: string; cancel: FormAction; simulate: FormAction }) {
  const result = await api<StoreWalletTopUp>("GET", `/v1/store/wallet/top-ups/${encodeURIComponent(id)}`);
  if (!result.ok) return null;
  const topUp = result.data;
  const money = formatFace(topUp.amount, topUp.currency);
  if (topUp.status === "succeeded") {
    return (
      <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
        {money} has been added to your wallet.
      </p>
    );
  }
  if (topUp.status === "failed") {
    return (
      <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
        Your top-up of {money} did not go through. {topUp.failure_reason ?? ""}
      </p>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
      <p className="flex items-center gap-2 font-semibold">
        <Clock className="size-4" aria-hidden="true" /> Waiting for your payment of {money} to be confirmed.
      </p>
      {cancelError ? (
        <p className="text-red-800" role="alert">
          {cancelErrorText(cancelError)}
        </p>
      ) : null}
      {topUp.mode === "test" ? (
        <div className="flex flex-wrap gap-2">
          {(["succeeded", "failed"] as const).map(outcome => (
            <form key={outcome} action={simulate}>
              <input type="hidden" name="id" value={topUp.id} />
              <input type="hidden" name="outcome" value={outcome} />
              <button type="submit" className="min-h-10 rounded-xl bg-white px-3 font-semibold ring-1 ring-amber-200 hover:ring-amber-300">
                {outcome === "succeeded" ? "Simulate paid" : "Simulate failed"}
              </button>
            </form>
          ))}
          <CancelPayment id={topUp.id} back={back} action={cancel} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {topUp.checkout_url ? (
            <a href={topUp.checkout_url} className="font-semibold underline">
              Back to the payment page
            </a>
          ) : null}
          <CancelPayment id={topUp.id} back={back} action={cancel} />
        </div>
      )}
    </div>
  );
}
