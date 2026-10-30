import Link from "next/link";
import { brand, appUrl } from "@bitocard/ui/site";

const customerDocuments = ["/documents/shop-terms", "/documents/terms", "/documents/privacy", "/documents/cookies", "/documents/notice"] as const;
const labels: Record<(typeof customerDocuments)[number], string> = {
  "/documents/shop-terms": "Shop terms",
  "/documents/terms": "Terms of use",
  "/documents/privacy": "Privacy",
  "/documents/cookies": "Cookies",
  "/documents/notice": "Legal notice",
};

/** The Shop's footer: the Safe Trade Guide, BitoCard's own store, and the legal documents. */
export function ShopFooter({ country }: { country?: { code: string; name: string } | null }) {
  return (
    <footer className="mt-12 border-t border-navy-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 sm:px-6 lg:px-8 py-8 text-sm text-navy-600 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1.5">
          <strong className="text-navy-900">BitoCard Shop{country ? ` ${country.name}` : ""}</strong>
          <p className="max-w-sm">Buy and sell near you. Safe pay holds the money until you have the item.</p>
        </div>
        <nav aria-label="Shop links" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/safe-trade" className="font-semibold text-navy-900 hover:underline">
            Safe Trade Guide
          </Link>
          <a href={appUrl("storefront")} className="hover:underline">
            Gift cards and airtime
          </a>
          {customerDocuments.map(href => (
            <a key={href} href={appUrl("legals", href)} className="hover:underline">
              {labels[href]}
            </a>
          ))}
        </nav>
      </div>
      <p className="border-t border-navy-100 py-4 text-center text-xs text-navy-500">
        © {new Date().getFullYear()} BitoCard Shop · {brand.credit}
      </p>
    </footer>
  );
}
