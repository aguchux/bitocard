import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountForm } from "@/components/account/delete-account";
import { PageTitle } from "@/components/account/nav";
import { requireCustomer } from "@/lib/account";
import type { DeletionCheck } from "@/lib/account-actions";
import { deletionKeeps, deletionRemoves, deletionScreen } from "@/lib/account-deletion";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Delete your account", robots: { index: false } };

/** Deleting the signed-in account: what goes, what stays, what stands in the way, then DELETE typed to confirm. */
export default async function DeleteAccountPage() {
  await requireCustomer(deletionScreen);
  const check = await customerApi<DeletionCheck>("GET", "/v1/store/account/delete");
  return (
    <div className="grid max-w-2xl gap-5">
      <PageTitle title="Delete your account" post={false} />
      <section className="grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
        <p className="text-navy-700">Deleting your account happens at once and cannot be undone. You can sign up again later, as a new account.</p>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-navy-700">
          {deletionRemoves.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-sm text-navy-600">{deletionKeeps}</p>
      </section>
      <section aria-labelledby="confirm-title" className="grid gap-3 rounded-2xl border border-red-200 bg-white p-4 sm:p-5">
        <h2 id="confirm-title" className="font-bold text-red-800">
          Delete my account
        </h2>
        {!check.ok ? (
          <p className="text-sm text-navy-700">{check.message}</p>
        ) : check.data.can_delete ? (
          <DeleteAccountForm passwordRequired={check.data.password_required} />
        ) : (
          <>
            <p className="text-sm text-navy-700">Not yet:</p>
            <ul className="grid list-disc gap-1 pl-5 text-sm text-navy-700">
              {check.data.blockers.map(item => (
                <li key={item.code}>{item.message}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <Link href="/account/profile" className="w-fit font-semibold text-brand-700 hover:underline">
        Back to your profile
      </Link>
    </div>
  );
}
