import type { ComponentType, ReactNode } from 'react';
import { Check } from 'lucide-react';

export type UdozoAuthFeature = { icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; label: string };

export type UdozoAuthLayoutProps = {
  /** The app's own lockup (its `UdozoWordmark`), shown in the top bar at every width. */
  brand: ReactNode;
  /** What this console is, in the pill beside the lockup and the panel's heading ("Seller HQ", "Admin"). */
  product: string;
  /** The panel's heading under the product name. */
  title: string;
  /** One or two sentences under it. */
  lead: string;
  features: UdozoAuthFeature[];
  /** A link on the right of the top bar (Udozo's site, Help). */
  aside?: ReactNode;
  children: ReactNode;
};

/**
 * Udozo's sign-in, sign-up and password pages, for Seller HQ and admin.udozo.com, deliberately unlike BitoCard's
 * navy split screen: a light page with the logo's rings, a top bar with the lockup at every width, and one rounded
 * card holding the form, with Udozo's blue panel (its disc drawn as concentric rings) on its right from `lg`. On
 * phones the card is the form alone. Colours come from the console theme (`navy-900` is the logo's blue), so it follows
 * the theme admins publish.
 */
export function UdozoAuthLayout({ brand, product, title, lead, features, aside, children }: UdozoAuthLayoutProps) {
  return (
    <div data-auth="udozo" className="relative isolate flex min-h-svh flex-col overflow-x-clip bg-canvas text-ink">
      {/* The logo's disc, echoed as faint rings in the page's corners (drawn, no images). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 size-[34rem] rounded-full border-[3.5rem] border-brand-500/[0.06]" />
        <div className="absolute -top-16 -left-16 size-[18rem] rounded-full border-[1.5rem] border-brand-500/[0.05]" />
        <div className="absolute -right-48 -bottom-48 size-[40rem] rounded-full border-[4rem] border-brand-500/[0.05]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(16_33_46/0.07)_1px,transparent_0)] [background-size:22px_22px]" />
      </div>

      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {brand}
          <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2.5 py-1 text-xs font-bold tracking-wide text-brand-700 uppercase">{product}</span>
        </div>
        {aside ? <div className="shrink-0 text-sm">{aside}</div> : null}
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-8">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-white shadow-[0_24px_60px_-28px_rgb(16_33_46/0.35)] lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          <section className="flex justify-center px-5 py-8 sm:px-10 sm:py-12">{children}</section>

          <aside aria-label={`Udozo ${product}`} className="relative isolate hidden overflow-hidden bg-navy-900 p-10 text-white lg:flex lg:flex-col">
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              <div className="absolute -top-24 -right-24 size-80 rounded-full border-[2.5rem] border-white/10" />
              <div className="absolute -top-6 -right-6 size-40 rounded-full border-[1.25rem] border-white/10" />
              <div className="absolute -bottom-32 -left-20 size-96 rounded-full bg-white/[0.06]" />
            </div>
            <p className="text-sm font-semibold tracking-wide text-white/70 uppercase">Udozo {product}</p>
            <p className="mt-3 text-3xl leading-tight font-extrabold tracking-tight text-balance">{title}</p>
            <p className="mt-3 leading-relaxed text-white/80">{lead}</p>
            <ul className="mt-8 space-y-3">
              {features.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 font-medium">
                  <Icon className="size-5 shrink-0 text-white" aria-hidden />
                  <span className="min-w-0 flex-1">{label}</span>
                  <Check className="size-4 shrink-0 text-white/60" aria-hidden />
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-10 text-xs text-white/60">A Golojan Ltd venture</p>
          </aside>
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-xs text-muted lg:hidden">A Golojan Ltd venture</footer>
    </div>
  );
}
