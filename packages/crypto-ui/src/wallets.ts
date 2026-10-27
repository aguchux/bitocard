import type { StoreCryptoDeposit, StoreCryptoWallets, StoreCryptoWithdrawal, StoreCustomerPayout } from "@bitocard/api-client/storefront";

/** Coins the customer can deposit and trade now: crypto is open to them and the coin is not switched off. */
export const tradableAssets = (wallets: StoreCryptoWallets | null) => (wallets?.enabled ? wallets.assets.filter(item => item.enabled).map(item => item.asset) : []);

/** Coins the customer holds (anything available, locked, frozen or on its way out). */
export const heldAssets = (wallets: StoreCryptoWallets | null) => wallets?.assets.filter(item => Number(item.total) > 0) ?? [];

/**
 * Coins the customer can withdraw: what they hold, plus every tradable coin while crypto is open. Withdrawing needs no
 * crypto switch (switching crypto off never traps anyone's coins), only a verified, unfrozen account.
 */
export const withdrawableAssets = (wallets: StoreCryptoWallets | null) => {
  const tradable = new Set(tradableAssets(wallets));
  return wallets?.assets.filter(item => tradable.has(item.asset) || Number(item.total) > 0).map(item => item.asset) ?? [];
};

/** Whether the Withdraw button belongs on screen: verified, not frozen, and with available coins. */
export const canWithdraw = (wallets: StoreCryptoWallets | null) => Boolean(wallets && wallets.verified && !wallets.frozen && wallets.assets.some(item => Number(item.available) > 0));

/** P2P money left from selling: still to pay out, or on its way to the bank. Shown even with crypto switched off. */
export const hasP2pMoney = (wallets: StoreCryptoWallets | null) => Boolean(wallets && (wallets.cash.proceeds > 0 || wallets.cash.paying_out > 0 || (wallets.usd_cash?.proceeds ?? 0) > 0));

/** A withdrawal's status in plain words. */
export const withdrawalStatus: Record<StoreCryptoWithdrawal["status"], string> = {
  awaiting_code: "Waiting for your code",
  review: "Being checked",
  queued: "Sending",
  submitting: "Sending",
  broadcast: "On the network",
  completed: "Sent",
  failed: "Not sent",
  rejected: "Not approved",
  cancelled: "Cancelled",
};

/** What each withdrawal status means for the customer. */
export const withdrawalExplained: Partial<Record<StoreCryptoWithdrawal["status"], string>> = {
  awaiting_code: "Enter the code we emailed you to send it. It is taken out of your wallet until you confirm or cancel.",
  review: "BitoCard checks this withdrawal before it is sent. You can cancel it until then.",
  queued: "It is being sent.",
  submitting: "It is being sent.",
  broadcast: "It is on the network, waiting for confirmations.",
  completed: "It is confirmed on the network.",
  failed: "It could not be sent. The coins are back in your wallet.",
  rejected: "It was not approved. The coins are back in your wallet.",
  cancelled: "It was cancelled. The coins are back in your wallet.",
};

/** A deposit's status in plain words. */
export const depositStatus: Record<StoreCryptoDeposit["status"], string> = { pending: "Confirming", credited: "Arrived", ignored: "Too small to credit", failed: "Not found on chain" };

/** A bank payout's status in plain words. */
export const payoutStatus: Record<StoreCustomerPayout["status"], string> = { pending: "Sending", processing: "Sending", paid: "Paid", failed: "Failed" };
