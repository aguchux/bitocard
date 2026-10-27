import { formatFace, type StoreCryptoWallets, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { cryptoSections } from "./sub-menus";
import type { MoneyLinks } from "@bitocard/crypto-ui/money-views";
import { CryptoGate as SharedGate } from "@bitocard/crypto-ui/wallet-views";
import { CryptoDeclaration as SharedDeclaration, TradeRow as SharedTradeRow } from "@bitocard/crypto-ui/trade-views";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { declareCrypto } from "@/lib/crypto-actions";

export const card = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

const chosen = (asset: string, chain?: string) => `?${new URLSearchParams({ asset, ...(chain ? { chain } : {}) })}`;

/** The Crypto tab's money pages, for the shared deposit, withdrawal and cash-out views (`@bitocard/crypto-ui`). */
export const moneyLinks: MoneyLinks = {
  deposit: (asset, chain) => `/account/crypto/deposit${chosen(asset, chain)}`,
  withdraw: (asset, chain) => `/account/crypto/withdraw${chosen(asset, chain)}`,
  withdrawal: id => `/account/crypto/withdrawals/${id}`,
  verification: "/account/verification",
};

/**
 * The crypto section's places (`cryptoSections`), as underlined tabs under the page title on phones and tablets (they
 * slide sideways inside their own row, never the page); desktops have the sub rail beside the app's rail instead
 * (`SubRail`).
 */
export function CryptoNav({ current }: { current: string }) {
  return <UnderlineTabs label="Crypto" tabs={cryptoSections.map(({ href, label }) => ({ href, label }))} current={current} className="lg:hidden" />;
}

export { CoinBadge, coinMark } from "@bitocard/crypto-ui/coins";
export { CoinPicker } from "@bitocard/crypto-ui/wallet-views";
export { canWithdraw, hasP2pMoney, heldAssets, tradableAssets, withdrawableAssets, withdrawalStatus } from "@bitocard/crypto-ui/wallets";

/** Why the customer cannot use this part of crypto yet (`@bitocard/crypto-ui`), with the store's identity check page. */
export function CryptoGate({ wallets, p2p = false, withdraw = false }: { wallets: StoreCryptoWallets | null; p2p?: boolean; withdraw?: boolean }) {
  return (
    <SharedGate
      wallets={wallets}
      p2p={p2p}
      withdraw={withdraw}
      verifyHref="/account/verification"
      declaration={wallets?.declaration ? <CryptoDeclaration version={wallets.declaration.version} /> : null}
    />
  );
}

/** The declaration every account makes before trading (`@bitocard/crypto-ui`), recorded by the store's action. */
export function CryptoDeclaration({ version }: { version: string }) {
  return <SharedDeclaration version={version} action={declareCrypto} />;
}

export const perCoin = (price: number, currency: string, asset: string) => `${formatFace(price, currency)} / ${asset}`;
export const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** A trade as a list row (`@bitocard/crypto-ui`), linking to its receipt on the Crypto tab. */
export function TradeRow({ trade }: { trade: StoreP2pTrade }) {
  return <SharedTradeRow trade={trade} href={`/account/crypto/trades/${trade.id}`} />;
}
