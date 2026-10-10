import { BadgeCheck, Printer, MessageSquare, PhoneIncoming, PhoneOutgoing, Send, Siren, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import { type ProductFeature, productFeatureLabels } from "@bitocard/api-client/storefront";

/** One icon per product feature (virtual numbers' calls and SMS). */
export const featureIcon: Record<ProductFeature, LucideIcon> = {
  calls_in: PhoneIncoming,
  calls_out: PhoneOutgoing,
  sms_in: MessageSquare,
  sms_out: Send,
  sms_people: UsersRound,
  app_codes: BadgeCheck,
  emergency: Siren,
  caller_name: UserRound,
  fax: Printer,
};

/** Features shoppers filter numbers by, in this order. */
export const filterFeatures: ProductFeature[] = ["sms_in", "app_codes", "calls_out", "sms_out"];

export const isFeature = (value: string): value is ProductFeature => value in productFeatureLabels;

/**
 * What a product can do, as labelled icons. `compact` (cards): icons only, each named for screen readers and on hover;
 * otherwise (the product page) icon and label.
 */
export function FeatureIcons({ features, compact = false }: { features: ProductFeature[]; compact?: boolean }) {
  const known = features.filter(isFeature);
  if (known.length === 0) return null;
  return (
    <ul aria-label="What it can do" className={compact ? "flex flex-wrap gap-1.5" : "grid gap-2 sm:grid-cols-2"}>
      {known.map(feature => {
        const Icon = featureIcon[feature];
        const label = productFeatureLabels[feature];
        return compact ? (
          <li key={feature} title={label} className="relative grid size-8 place-items-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-100">
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </li>
        ) : (
          <li key={feature} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-sm font-semibold text-[#070f4c]">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700">
              <Icon className="size-[18px]" aria-hidden="true" />
            </span>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
