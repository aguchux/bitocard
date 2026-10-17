import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { accountCard, AccountScreen } from "@/components/app/account-menu";
import { PasswordForm } from "@/components/store/account-forms";
import { signOut } from "@/lib/account-actions";

export const metadata: Metadata = { title: "Security" };

/** Security: changing the password (the current one is asked first) and signing out of this device. */
export default function SecurityPage() {
  return (
    <AccountScreen title="Security" lead="Keep your account safe: use a password you use nowhere else.">
      <section aria-labelledby="password" className={accountCard}>
        <h2 id="password" className="mb-4 text-lg font-bold">
          Change your password
        </h2>
        <div className="max-w-md">
          <PasswordForm />
        </div>
      </section>

      <section aria-labelledby="sign-out" className={`${accountCard} flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0">
          <h2 id="sign-out" className="text-lg font-bold">
            Sign out
          </h2>
          <p className="text-sm text-slate-500">Sign out of your account on this device.</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 font-semibold text-navy-900 ring-1 ring-slate-200 hover:ring-slate-300">
            <LogOut className="size-5" aria-hidden="true" /> Sign out
          </button>
        </form>
      </section>
    </AccountScreen>
  );
}
