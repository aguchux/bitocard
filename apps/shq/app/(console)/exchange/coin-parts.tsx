"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import { Field, Notice, Select, StatusBadge } from "@bitocard/admin-ui";
import type { CoinDepositStatus, CoinWithdrawalStatus, ResellerCoins } from "@bitocard/api-client/reseller";

/** Who may show deposit addresses and ask for, confirm or cancel withdrawals: the API's `@Roles('admin', 'finance')`. */
export const coinRoles = ["admin", "finance"] as const;

/** The plan page, where Premium is chosen. */
export const planHref = "/settings/plan";

/** Shown instead of the deposit screen while the plan does not include depositing coins on chain. */
export function PremiumNotice() {
  return (
    <Notice tone="blue" title="Deposits are part of the Premium plan">
      Depositing coins on chain is part of the Premium plan. Withdrawing the coins you hold is open on every plan.{" "}
      <Link href={planHref} className="font-semibold text-brand-600 underline-offset-2 hover:underline">
        See plans
      </Link>
    </Notice>
  );
}

/** The coins that can be chosen: switched on, or still holding a balance to take out. */
export const choosableCoins = (coins: ResellerCoins, purpose: "deposit" | "withdraw") => coins.assets.filter(asset => asset.enabled || (purpose === "withdraw" && Number(asset.available) > 0));

/** The coin in the address (`?asset=`), else the first one offered. */
export function useChosenAsset(coins: ResellerCoins["assets"]) {
  const search = useSearchParams();
  const asked = search.get("asset")?.toUpperCase();
  return coins.find(coin => coin.asset === asked)?.asset ?? coins[0]?.asset ?? null;
}

/** Picks the coin, kept in `?asset=` so the page can be linked to from the Coins page. */
export function CoinSelect({ coins, value, path }: { coins: ResellerCoins["assets"]; value: string; path: string }) {
  const id = useId();
  const router = useRouter();
  return (
    <Field label="Coin" htmlFor={id}>
      <Select
        id={id}
        value={value}
        onChange={event =>
          router.replace(`${path}?asset=${event.target.value}`, {
            scroll: false,
          })
        }
      >
        {coins.map(coin => (
          <option key={coin.asset} value={coin.asset}>
            {coin.name} ({coin.asset})
          </option>
        ))}
      </Select>
    </Field>
  );
}

const depositLabels: Record<CoinDepositStatus, [string, string]> = {
  pending: ["pending", "Confirming"],
  credited: ["completed", "Credited"],
  ignored: ["disabled", "Not credited"],
  failed: ["failed", "Failed"],
};
export const DepositStatus = ({ status }: { status: CoinDepositStatus }) => <StatusBadge status={depositLabels[status][0]} label={depositLabels[status][1]} />;

const withdrawalLabels: Record<CoinWithdrawalStatus, [string, string]> = {
  awaiting_code: ["pending", "Waiting for code"],
  review: ["in_review", "BitoCard reviewing"],
  queued: ["processing", "Queued"],
  submitting: ["processing", "Sending"],
  broadcast: ["processing", "Sent, confirming"],
  completed: ["completed", "Completed"],
  failed: ["failed", "Failed"],
  rejected: ["rejected", "Rejected"],
  cancelled: ["cancelled", "Cancelled"],
};
export const WithdrawalStatus = ({ status }: { status: CoinWithdrawalStatus }) => <StatusBadge status={withdrawalLabels[status][0]} label={withdrawalLabels[status][1]} />;

/** Still moving: worth checking again. */
export const withdrawalInProgress = (status: CoinWithdrawalStatus) => ["awaiting_code", "review", "queued", "submitting", "broadcast"].includes(status);

/** A long hash or address shortened for tables ("0x12ab…9f0c"); the full value stays in the title. */
export const shortHash = (value: string) => (value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value);

