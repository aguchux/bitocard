import Link from "next/link";

export type ReviewsTab = "to_review" | "to_confirm" | "given" | "about" | "ratings";
const tabs: Array<{ key: ReviewsTab; label: string; href: string }> = [
  { key: "to_review", label: "To review", href: "/account/reviews" },
  { key: "to_confirm", label: "To confirm", href: "/account/reviews?tab=to_confirm" },
  { key: "given", label: "Your reviews", href: "/account/reviews?tab=given" },
  { key: "about", label: "About you", href: "/account/reviews?tab=about" },
  { key: "ratings", label: "Private ratings", href: "/account/ratings" },
];

/** The Reviews place's tabs: public reviews of purchases, then the private ratings of how the seller deals with buyers. */
export function ReviewsNav({ current, counts = {} }: { current: ReviewsTab; counts?: Partial<Record<ReviewsTab, number>> }) {
  return (
    <nav aria-label="Reviews">
      <ul className="flex flex-wrap gap-2">
        {tabs.map(item => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.key === current ? "page" : undefined}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold ${item.key === current ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900"}`}
            >
              {item.label}
              {counts[item.key] ? <span className={item.key === current ? "text-brand-300" : "text-brand-700"}>• {counts[item.key]}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
