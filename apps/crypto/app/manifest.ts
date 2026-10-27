import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";

/** Installable as an app (standalone); visitors are asked only where an admin allows it (`crypto_install_prompt`). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BitoCard Crypto – Buy and sell crypto with people",
    short_name: "BitoCard Crypto",
    description: "Buy and sell USDT, BTC and more with other people, paid instantly from BitoCard wallets.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    categories: ["finance"],
    background_color: colors.page,
    theme_color: colors.navy900,
    icons: [...manifestIcons],
  };
}
