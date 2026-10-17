import type { CSSProperties } from "react";
import { coinFor } from "@/lib/spin";
import styles from "./spin.module.css";

/** A coin as a small token in its own colour with its mark (decorative: the coin's name is always written beside it). */
export function CoinToken({ asset, size = "md" }: { asset: string; size?: "sm" | "md" }) {
  const coin = coinFor(asset);
  return (
    <span
      aria-hidden="true"
      className={`${styles.coin} ${coin.dark ? styles.coinDark : ""} ${size === "sm" ? "size-6 text-[11px]" : "size-10 text-sm"}`}
      style={{ "--coin": coin.colour } as CSSProperties}
    >
      {coin.glyph}
    </span>
  );
}
