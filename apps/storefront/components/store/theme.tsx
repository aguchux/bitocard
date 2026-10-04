import { CreditCard, Gift, Globe, Laptop, Lock, Phone, ReceiptText, Shield, Signal, Smartphone, Tv, Wifi, Zap, Headphones, type LucideIcon } from "lucide-react";
import type { ProductCategory, TrustIcon } from "@bitocard/api-client/storefront";

/** Each category's icon and colours (tile background, icon colour, card gradient when a brand has no art). */
export const categoryTheme: Record<ProductCategory, { icon: LucideIcon; tile: string; ink: string; card: string }> = {
  gift_cards: { icon: Gift, tile: "bg-pink-50", ink: "text-pink-600", card: "from-pink-500 to-rose-600" },
  airtime: { icon: Smartphone, tile: "bg-blue-50", ink: "text-blue-600", card: "from-blue-500 to-indigo-600" },
  data: { icon: Wifi, tile: "bg-emerald-50", ink: "text-emerald-600", card: "from-emerald-500 to-teal-600" },
  bills: { icon: Zap, tile: "bg-amber-50", ink: "text-amber-600", card: "from-amber-400 to-orange-500" },
  pay_tv: { icon: Tv, tile: "bg-violet-50", ink: "text-violet-600", card: "from-violet-500 to-purple-700" },
  esim: { icon: Signal, tile: "bg-fuchsia-50", ink: "text-fuchsia-600", card: "from-fuchsia-500 to-pink-600" },
  software: { icon: Laptop, tile: "bg-orange-50", ink: "text-orange-600", card: "from-orange-400 to-amber-600" },
  virtual_numbers: { icon: Phone, tile: "bg-indigo-50", ink: "text-indigo-600", card: "from-indigo-500 to-blue-700" },
  virtual_cards: { icon: CreditCard, tile: "bg-sky-50", ink: "text-sky-600", card: "from-sky-500 to-cyan-600" },
};

/** The menu groups' icons (the hero chips). */
export const groupIcon: Record<string, LucideIcon> = {
  "gift-cards": Gift,
  mobile: Smartphone,
  bills: ReceiptText,
  esims: Signal,
  software: Laptop,
  "virtual-cards": CreditCard,
};

export const groupInk: Record<string, string> = {
  "gift-cards": "text-pink-500",
  mobile: "text-sky-400",
  bills: "text-emerald-400",
  esims: "text-fuchsia-400",
  software: "text-amber-400",
  "virtual-cards": "text-cyan-400",
};

export const trustIcon: Record<TrustIcon, LucideIcon> = { lock: Lock, bolt: Zap, card: CreditCard, globe: Globe, shield: Shield, support: Headphones };
