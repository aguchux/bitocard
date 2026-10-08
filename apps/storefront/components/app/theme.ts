/**
 * The customer account app's tints per menu group: the entry card, its icon tile, the icon and the chevron, plus a short
 * subtitle (as in the approved mockups: gift cards pink, mobile blue, data and bills green).
 */
export type GroupTint = { card: string; tile: string; ink: string; chevron: string; subtitle: string };

const tints: Record<string, GroupTint> = {
  "gift-cards": { card: "bg-pink-50", tile: "bg-pink-100", ink: "text-[#ff2382]", chevron: "bg-pink-100 text-[#ff2382]", subtitle: "Popular brands" },
  mobile: { card: "bg-blue-50", tile: "bg-blue-100", ink: "text-[#2477ff]", chevron: "bg-blue-100 text-[#2477ff]", subtitle: "Airtime and data" },
  bills: { card: "bg-emerald-50", tile: "bg-emerald-100", ink: "text-emerald-600", chevron: "bg-emerald-100 text-emerald-600", subtitle: "Electricity and TV" },
  esims: { card: "bg-violet-50", tile: "bg-violet-100", ink: "text-violet-600", chevron: "bg-violet-100 text-violet-600", subtitle: "Travel data" },
  software: { card: "bg-amber-50", tile: "bg-amber-100", ink: "text-amber-600", chevron: "bg-amber-100 text-amber-600", subtitle: "Licences and keys" },
  "virtual-cards": { card: "bg-sky-50", tile: "bg-sky-100", ink: "text-sky-600", chevron: "bg-sky-100 text-sky-600", subtitle: "Pay online" },
};

const fallback: GroupTint = { card: "bg-slate-50", tile: "bg-slate-100", ink: "text-slate-600", chevron: "bg-slate-100 text-slate-600", subtitle: "Browse" };

export const groupTint = (key: string) => tints[key] ?? fallback;
