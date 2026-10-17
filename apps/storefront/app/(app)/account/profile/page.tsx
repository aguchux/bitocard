import type { Metadata } from "next";
import { FileText, LogOut, Store } from "lucide-react";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl } from "@bitocard/ui/site";
import { AccountList, AccountRow } from "@/components/app/account-menu";
import { accountSections } from "@/components/app/account-sections";
import { ProfileCard } from "@/components/app/profile-card";
import { signOut } from "@/lib/account-actions";
import { currentCustomer } from "@/lib/customer";

export const metadata: Metadata = { title: "Account" };

/**
 * The Account tab: who the customer is, then a menu of its screens (Profile, Security, Identity check, and Referrals
 * and Notifications marked Soon), each its own route with the pills on top; then the full store, the legal documents
 * and signing out.
 */
export default async function ProfilePage() {
  const customer = (await currentCustomer())!;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="sr-only">Account</h1>
      <ProfileCard name={customer.name} email={customer.email} />

      <AccountList label="Settings">
        {accountSections.map(section => {
          // An older account still has to choose its country (its wallet waits for it).
          const choose = section.key === "profile" && !customer.country;
          return <AccountRow key={section.key} href={choose ? `${section.href}#country` : section.href} icon={section.icon} label={section.label} note={choose ? "Choose your country to use your wallet" : section.note} soon={section.soon} attention={choose} />;
        })}
      </AccountList>

      <AccountList label="More">
        <AccountRow href="/" icon={Store} label="Shop the full store" />
        {legalDocuments.map(doc => (
          <AccountRow key={doc.href} href={appUrl("legals", doc.href)} icon={FileText} label={doc.short} external />
        ))}
      </AccountList>

      <form action={signOut}>
        <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-navy-900 ring-1 ring-slate-200 hover:ring-slate-300">
          <LogOut className="size-5" aria-hidden="true" /> Sign out
        </button>
      </form>
    </div>
  );
}
