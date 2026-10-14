import type { Metadata } from "next";
import type { StoreSpinRewards } from "@bitocard/api-client/storefront";
import { appUrl } from "@bitocard/ui/site";
import { card, CryptoNav } from "@/components/app/crypto";
import { SpinWheel } from "@/components/app/spin-wheel";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Spin and win" };

/**
 * Spin and win: a BitoCard promotion paying each customer $1 in crypto, once, over 50 to 100 spins of the wheel (up to
 * five a day). The server decides every spin and pays it into the customer's crypto wallet at once; the wheel shows it.
 */
export default async function SpinPage() {
  const rewards = await customerApi<StoreSpinRewards>("GET", "/v1/store/spins");
  const test = rewards.ok && rewards.data.mode === "test";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">Spin and win{test ? " (test)" : ""}</h1>
        <p className="text-sm text-slate-600">Collect $1 in crypto, a few cents a spin, paid straight into your crypto wallet.</p>
      </div>
      <CryptoNav current="/account/crypto/spin" />

      {rewards.ok ? <SpinWheel initial={rewards.data} /> : <p className={card}>The wheel cannot be shown right now. Try again shortly.</p>}

      <section aria-labelledby="how" className={card}>
        <h2 id="how" className="text-lg font-bold">
          How it works
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Spin and win is a BitoCard promotion: $1 for each person, once, across every store.</li>
          <li>Your $1 is shared over 50 to 100 spins, set when you first spin. Each spin wins between $0.01 and $0.10, in USDT, USDC or BNB, and together they add up to exactly $1.</li>
          <li>You can spin up to 5 times a day. What you win goes into your crypto wallet straight away.</li>
          {test ? <li>This is a test store: it pays test crypto, which has no value.</li> : <li>Test stores pay test crypto, which has no value.</li>}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          <a href={appUrl("legals", "/documents/terms")} className="font-semibold text-[#2477ff] hover:underline">
            Terms apply
          </a>
        </p>
      </section>
    </div>
  );
}
