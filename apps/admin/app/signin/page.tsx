import type { Metadata } from "next";
import { Suspense } from "react";
import { Database, ShieldCheck, Users } from "lucide-react";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sign in" };

const features = [
  { icon: ShieldCheck, label: "Secure platform access" },
  { icon: Database, label: "Supplier operations" },
  { icon: Users, label: "Reseller network controls" },
];

export default function SignInPage() {
  return (
    <main className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <section
        aria-label="BitoCard admin workspace"
        className="relative isolate hidden overflow-hidden bg-navy-950 px-12 py-14 text-white lg:flex lg:flex-col xl:px-20"
      >
        {/* Brand glow: soft navy-to-pink waves, drawn with gradients (no images). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,#0b1a6e_0%,transparent_60%)]" />
          <div className="absolute -bottom-1/3 -left-1/4 h-[80%] w-[90%] rounded-[50%] bg-[radial-gradient(closest-side,#ff2382_0%,#c0156b_35%,transparent_75%)] opacity-70 blur-2xl" />
          <div className="absolute -right-1/4 bottom-[-10%] h-[65%] w-[110%] rotate-[-12deg] rounded-[50%] bg-[radial-gradient(closest-side,#7c3aed_0%,#3b2bd6_40%,transparent_75%)] opacity-60 blur-2xl" />
          <div className="absolute right-[-15%] bottom-[22%] h-[30%] w-[80%] rotate-[-18deg] rounded-[50%] border-t-2 border-brand-500/60 blur-[1px]" />
        </div>

        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bitocard-logo.png" alt="" className="size-14 rounded-2xl" />
          <span className="text-2xl font-extrabold tracking-[0.25em]">BITOCARD</span>
        </div>

        <div className="mt-20 max-w-xl">
          <h1 className="text-7xl font-extrabold leading-[0.95] tracking-tight xl:text-8xl">
            Admin
            <br />
            <span className="text-brand-500">workspace</span>
          </h1>
          <p className="mt-6 text-2xl leading-snug text-white/75">Sign in to manage products, resellers and platform operations.</p>
          <ul className="mt-12 space-y-5">
            {features.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-5 text-xl font-medium">
                <span className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/10 backdrop-blur">
                  <Icon className="size-6 text-brand-200" aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col items-center justify-center bg-white px-6 py-12 sm:px-12">
        <Suspense>
          <SignIn />
        </Suspense>
      </section>
    </main>
  );
}
