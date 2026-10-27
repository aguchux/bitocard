import type { CSSProperties } from "react";
import { dollar } from "@/lib/spin";
import styles from "./spin.module.css";

/** A small dollar token (decorative: the amount is always written beside it). */
export function DollarToken({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span aria-hidden="true" className={`${styles.coin} ${size === "sm" ? "size-6 text-[11px]" : "size-10 text-sm"}`} style={{ "--coin": dollar.colour } as CSSProperties}>
      {dollar.glyph}
    </span>
  );
}
