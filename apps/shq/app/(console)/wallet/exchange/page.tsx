import { permanentRedirect } from "next/navigation";

/** Exchange moved out of Wallet into its own section; old links and bookmarks land on Trade with BitoCard. */
export default function WalletExchangeMoved() {
  permanentRedirect("/exchange");
}
