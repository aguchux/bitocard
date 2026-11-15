import type { StoreAirtimeNetwork } from "@bitocard/api-client/storefront";

/** Each network's own icon, where BitoCard has one (`public/brand-icons`); else its initials. */
const icons: Record<string, string> = { mtn: "/brand-icons/mtn.svg", airtel: "/brand-icons/airtel.svg", glo: "/brand-icons/glo.svg" };
export const networkIcon = (network: string) => icons[network] ?? null;

/** What a seller gets (rounded down) and a buyer pays (rounded up) for an amount, in minor units, as the API works it out. */
export const sellerGets = (amount: number, bps: number) => Math.floor((amount * bps) / 10_000);
export const buyerPays = (amount: number, bps: number) => Math.ceil((amount * bps) / 10_000);

/** The network a link asked for, if the pool has it; else the first open one. */
export function chosenNetwork(networks: StoreAirtimeNetwork[], asked: string | undefined) {
  return networks.find(item => item.network === asked) ?? networks.find(item => item.open) ?? networks[0] ?? null;
}

/** Naira typed as "2,000" or "2000" in kobo; null when it is not a whole positive amount. */
export function nairaToMinor(text: string) {
  const value = Number(text.replace(/[,\s₦]/g, ""));
  return Number.isInteger(value) && value > 0 ? value * 100 : null;
}

/** How long is left of a trade's hour, in words ("23 minutes left"), or null once it has passed. */
export function timeLeft(expiresAt: string, now = Date.now()) {
  const minutes = Math.ceil((new Date(expiresAt).getTime() - now) / 60_000);
  if (minutes <= 0) return null;
  return minutes === 1 ? "1 minute left" : `${minutes} minutes left`;
}
