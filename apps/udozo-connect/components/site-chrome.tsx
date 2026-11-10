import Link from "next/link";
import { signOut } from "@/lib/actions";
import type { Centre, List } from "@/lib/centres";
import { currentCustomer, customerApi } from "@/lib/session";
import { signInPath, udozoUrl } from "@/lib/site";

/** "Udozo Connect": Udozo's mark beside the name. */
export function Lockup() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2 text-navy-900">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark, already sized */}
      <img src="/udozo-mark.png" alt="" width={32} height={32} className="size-8 shrink-0" />
      <span className="truncate text-lg font-extrabold tracking-tight">
        Udozo <span className="text-brand-500">Connect</span>
      </span>
    </Link>
  );
}

export async function SiteHeader() {
  const customer = await currentCustomer();
  // Only people who work at a centre get its link (never failing the page while the API cannot answer).
  const centres = customer ? await customerApi<List<Centre>>("GET", "/v1/connect/centres/mine") : null;
  const works = Boolean(centres?.ok && centres.data.data.length);
  return (
    <header className="border-b border-slate-100 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Lockup />
        {customer ? (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {works ? (
              <Link href="/centre" className="min-h-10 rounded-xl bg-navy-900 px-3 py-2 font-semibold text-white hover:bg-navy-800">
                My centre
              </Link>
            ) : null}
            <span className="hidden truncate font-semibold text-slate-700 sm:inline">{customer.first_name || customer.name}</span>
            <form action={signOut}>
              <button type="submit" className="min-h-10 rounded-xl border border-slate-200 px-3 font-semibold text-navy-900 hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <a href={signInPath("/apply")} className="min-h-10 shrink-0 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800">
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-slate-100 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>Udozo Connect · A Golojan Ltd venture</p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
          <a href={udozoUrl("/legal/terms")} className="hover:text-navy-900 hover:underline">
            Terms
          </a>
          <a href={udozoUrl("/legal/privacy")} className="hover:text-navy-900 hover:underline">
            Privacy
          </a>
          <a href={udozoUrl("/legal/connect-centres")} className="hover:text-navy-900 hover:underline">
            Connect Centre agreement
          </a>
        </nav>
      </div>
    </footer>
  );
}
