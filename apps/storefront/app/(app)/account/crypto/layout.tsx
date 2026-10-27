import { CryptoActionsProvider } from "@bitocard/crypto-ui/forms";
import { changeAd, chooseNickname, confirmTrade, postAd, repriceAd, takeAd } from "@/lib/crypto-actions";

/** The Crypto tab: its shared trading forms (`@bitocard/crypto-ui`) act through the store's own server actions. */
export default function CryptoLayout({ children }: { children: React.ReactNode }) {
  return (
    <CryptoActionsProvider actions={{ takeAd, confirmTrade, postAd, repriceAd, changeAd, chooseNickname }} links={{ postAd: "/account/crypto/ads/post", wallet: "/account/wallet" }}>
      {children}
    </CryptoActionsProvider>
  );
}
