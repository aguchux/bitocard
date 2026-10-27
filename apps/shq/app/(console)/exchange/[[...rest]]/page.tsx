import { permanentRedirect } from "next/navigation";

/** The exchange left SHQ with crypto (docs/CRYPTO_SPINOFF_PLAN.md): old links and bookmarks land on the wallet. */
export default function ExchangeGone() {
  permanentRedirect("/wallet");
}
