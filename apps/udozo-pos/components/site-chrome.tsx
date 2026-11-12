import Image from "next/image";
import Link from "next/link";
import { udozoUrl } from "@/lib/site";

/** Udozo's own mark, as udozo.com shows it: blue on light backgrounds, white on the POS's dark green. */
export function UdozoMark({ tone = "dark", className = "h-9 w-9" }: { tone?: "dark" | "light"; className?: string }) {
  return <Image src={tone === "dark" ? "/udozo-mark-light.png" : "/udozo-mark.png"} alt="" width={512} height={512} className={className} priority />;
}

/** Udozo POS's lockup: Udozo's mark, and the name beside it. */
export function PosMark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className="flex items-center gap-2.5">
      <UdozoMark tone={tone} />
      <span className={`font-display text-[19px] font-bold ${tone === "dark" ? "text-white" : "text-pos-ink"}`}>Udozo POS</span>
    </span>
  );
}

/**
 * The public site's header, on the POS's dark green: the mark, the site's own pages (none of udozo.com's marketplace
 * navigation), then Sign in and Start free, or Open POS for a signed-in owner.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="bg-pos-night text-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
        <Link href="/" className="mr-auto rounded-lg text-white no-underline" aria-label="Udozo POS home">
          <PosMark />
        </Link>
        <nav aria-label="Site" className="order-3 flex w-full flex-wrap gap-x-5 gap-y-1 text-[15px] sm:order-none sm:w-auto">
          <Link href="/features" className="text-pos-night-text no-underline hover:text-white">
            Features
          </Link>
          <Link href="/pricing" className="text-pos-night-text no-underline hover:text-white">
            Pricing
          </Link>
          <Link href="/download" className="text-pos-night-text no-underline hover:text-white">
            Apps
          </Link>
          <Link href="/faq" className="text-pos-night-text no-underline hover:text-white">
            Questions
          </Link>
          <a href={udozoUrl("/")} className="text-pos-night-text no-underline hover:text-white">
            udozo.com
          </a>
        </nav>
        {signedIn ? (
          <Link href="/app" className="flex h-11 items-center rounded-[10px] bg-pos-500 px-4 text-sm font-bold text-white no-underline hover:bg-pos-600">
            Open POS
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/signin" className="flex h-11 items-center rounded-[10px] border border-pos-night-line px-4 text-sm font-semibold text-white no-underline hover:bg-pos-night-2">
              Sign in
            </Link>
            <Link href="/signup" className="flex h-11 items-center rounded-[10px] bg-pos-500 px-4 text-sm font-bold text-white no-underline hover:bg-pos-600">
              Start free
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-pos-line bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-pos-muted sm:px-6">
        <span>
          Udozo POS is part of{" "}
          <a href={udozoUrl("/")} className="font-semibold text-pos-700">
            udozo.com
          </a>
          . © {new Date().getFullYear()} Udozo · A Golojan Ltd venture
        </span>
        <nav aria-label="Legal and help" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/features" className="text-pos-muted hover:text-pos-700">
            Features
          </Link>
          <Link href="/pricing" className="text-pos-muted hover:text-pos-700">
            Pricing
          </Link>
          <Link href="/download" className="text-pos-muted hover:text-pos-700">
            Apps
          </Link>
          <Link href="/faq" className="text-pos-muted hover:text-pos-700">
            Questions
          </Link>
          <a href={udozoUrl("/help/contact")} className="text-pos-muted hover:text-pos-700">
            Contact
          </a>
          <a href={udozoUrl("/legal/terms")} className="text-pos-muted hover:text-pos-700">
            Terms
          </a>
          <a href={udozoUrl("/legal/privacy")} className="text-pos-muted hover:text-pos-700">
            Privacy
          </a>
        </nav>
      </div>
    </footer>
  );
}
