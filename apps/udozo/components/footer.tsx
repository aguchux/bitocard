import Link from "next/link";
import { CookieSettingsButton } from "@/components/cookie-consent";
import { connectUrl } from "@/lib/connect";
import { registeredCompany } from "@/lib/legal";

/**
 * Udozo's footer: Start selling (the sellers' landing page), Udozo on WhatsApp and Post a request where the market has
 * them, the Safe Trade Guide, the FAQs, Contact us and About us, Udozo's own legal documents (on udozo.com, `/legal`), and
 * the credit naming the company that owns Udozo by its registered name (payment partners check it against the website).
 */
export function SiteFooter({ country, whatsapp, wanted }: { country?: { code: string; name: string } | null; whatsapp?: string | null; wanted?: string | null }) {
  return (
    <footer className="mt-12 border-t border-navy-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-8 text-sm text-navy-600 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
        <div className="grid gap-1.5">
          <strong className="text-navy-900">Udozo{country ? ` ${country.name}` : ""}</strong>
          <p className="max-w-sm">Buy and sell near you. UdozoPay holds the money until you have the item.</p>
        </div>
        <nav aria-label="Udozo links" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/start-here" className="font-semibold text-brand-600 hover:underline">
            Start selling
          </Link>
          {wanted ? (
            <Link href={wanted} className="font-semibold text-navy-900 hover:underline">
              Post a request
            </Link>
          ) : null}
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noopener" className="font-semibold text-mint-700 hover:underline">
              Udozo on WhatsApp
            </a>
          ) : null}
          <Link href={country ? `/${country.code.toLowerCase()}/connect-centres` : "/connect-centres"} className="hover:underline">
            Connect Centres
          </Link>
          {country ? (
            <Link href={`/${country.code.toLowerCase()}/auctions`} className="hover:underline">
              Udozo auctions
            </Link>
          ) : null}
          <a href={connectUrl} className="font-semibold text-navy-900 hover:underline">
            Become a Connect Centre
          </a>
          <Link href="/safe-trade" className="font-semibold text-navy-900 hover:underline">
            Safe Trade Guide
          </Link>
          <Link href="/safe-trade#udozopay" className="hover:underline">
            UdozoPay
          </Link>
          <Link href="/help/faqs" className="hover:underline">
            FAQs
          </Link>
          <Link href="/help/contact" className="hover:underline">
            Contact us
          </Link>
          <Link href="/about" className="hover:underline">
            About us
          </Link>
          <Link href="/legal/terms" className="hover:underline">
            Terms of use
          </Link>
          <Link href="/legal/udozopay" className="hover:underline">
            UdozoPay rules
          </Link>
          <Link href="/legal/sellers" className="hover:underline">
            Seller terms
          </Link>
          <Link href="/legal/connect-centres" className="hover:underline">
            Connect Centre agreement
          </Link>
          <Link href="/legal/auctions" className="hover:underline">
            Udozo auctions terms
          </Link>
          <Link href="/legal/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/legal/cookies" className="hover:underline">
            Cookies
          </Link>
          <CookieSettingsButton />
        </nav>
      </div>
      <OwnerLine />
    </footer>
  );
}

/** The credit: Udozo is owned and operated by its registered company, named exactly as registered. */
export function OwnerLine() {
  return (
    <p className="border-t border-navy-100 px-4 py-4 text-center text-xs text-navy-500">
      © {new Date().getFullYear()} {registeredCompany.name}. Udozo is owned and operated by {registeredCompany.name} ({registeredCompany.number}), a company registered in
      Nigeria.
    </p>
  );
}
