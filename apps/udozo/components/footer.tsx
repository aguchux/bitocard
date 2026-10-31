import Link from "next/link";

/** Udozo's footer: Start selling (the sellers' landing page), the Safe Trade Guide, Udozo's own legal documents (on udozo.com, `/legal`) and the credit. */
export function SiteFooter({ country }: { country?: { code: string; name: string } | null }) {
  return (
    <footer className="mt-12 border-t border-navy-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-8 text-sm text-navy-600 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
        <div className="grid gap-1.5">
          <strong className="text-navy-900">Udozo{country ? ` ${country.name}` : ""}</strong>
          <p className="max-w-sm">Buy and sell near you. Safe pay holds the money until you have the item.</p>
        </div>
        <nav aria-label="Udozo links" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/start-here" className="font-semibold text-brand-600 hover:underline">
            Start selling
          </Link>
          <Link href="/safe-trade" className="font-semibold text-navy-900 hover:underline">
            Safe Trade Guide
          </Link>
          <Link href="/safe-trade#safe-pay" className="hover:underline">
            Safe pay
          </Link>
          <Link href="/legal/terms" className="hover:underline">
            Terms of use
          </Link>
          <Link href="/legal/safe-pay" className="hover:underline">
            Safe pay rules
          </Link>
          <Link href="/legal/sellers" className="hover:underline">
            Seller terms
          </Link>
          <Link href="/legal/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/legal/cookies" className="hover:underline">
            Cookies
          </Link>
        </nav>
      </div>
      <p className="border-t border-navy-100 py-4 text-center text-xs text-navy-500">© {new Date().getFullYear()} Udozo</p>
    </footer>
  );
}
