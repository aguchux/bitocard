import type { ReactNode } from "react";
import { Code2, Store, Wallet } from "lucide-react";

const features = [
  { icon: Store, label: "Your branded store" },
  { icon: Wallet, label: "Wallet, orders and earnings" },
  { icon: Code2, label: "API keys and webhooks" },
];

/** Sign-in and password pages: the SHQ brand panel on large screens, the form on the right (alone on phones). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Sized to the screen and never taller: it sticks while the form side scrolls on short windows. */}
      <section
        aria-label="BitoCard Seller Head Quarters"
        className="relative isolate hidden overflow-hidden bg-navy-950 px-10 py-10 text-white lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col xl:px-14"
      >
        {/* Brand glow: soft navy-to-pink waves, drawn with gradients (no images). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,#0b1a6e_0%,transparent_60%)]" />
          <div className="absolute -bottom-1/3 -left-1/4 h-[80%] w-[90%] rounded-[50%] bg-[radial-gradient(closest-side,#ff2382_0%,#c0156b_35%,transparent_75%)] opacity-70 blur-2xl" />
          <div className="absolute -right-1/4 bottom-[-10%] h-[65%] w-[110%] rotate-[-12deg] rounded-[50%] bg-[radial-gradient(closest-side,#7c3aed_0%,#3b2bd6_40%,transparent_75%)] opacity-60 blur-2xl" />
        </div>

        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
          <img src="/bitocard-logo-light.png" alt="" className="size-10" />
          <span className="text-lg font-extrabold tracking-[0.25em]">BITOCARD</span>
        </div>

        <div className="my-auto max-w-md py-8">
          <h1 className="text-5xl leading-[0.95] font-extrabold tracking-tight xl:text-6xl">
            Seller
            <br />
            <span className="text-brand-500">Head Quarters</span>
          </h1>
          <p className="mt-4 text-lg leading-snug text-white/75">Everything you need to run your reseller business, in one place.</p>
          <ul className="mt-8 space-y-3">
            {features.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-base font-medium">
                <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/10 backdrop-blur">
                  <Icon className="size-5 text-brand-200" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/50">A Golojan Ltd venture</p>
      </section>

      <section className="flex flex-col items-center justify-center bg-white px-6 py-10 sm:px-12">{children}</section>
    </main>
  );
}
