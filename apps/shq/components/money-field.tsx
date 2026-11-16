"use client";

import { forwardRef, type ComponentProps } from "react";
import { MoneyInput } from "@bitocard/ui/money-input";

/** The console's field style (`Input` in `@bitocard/admin-ui`), so a money field looks like every other field. */
export const moneyFieldClass =
  "w-full min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas";

/**
 * Where a reseller types an amount of money: the currency's sign inside on the left ("₦", "GH₵", "KSh", "$"), digits
 * and one decimal point only, commas between thousands as it is typed. Read what was typed with `parseMoney`.
 */
export const MoneyField = forwardRef<HTMLInputElement, ComponentProps<typeof MoneyInput>>(function MoneyField({ className = "", ...props }, ref) {
  return <MoneyInput ref={ref} className={`${moneyFieldClass} ${className}`} {...props} />;
});
