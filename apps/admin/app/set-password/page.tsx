import type { Metadata } from "next";
import { Wordmark } from "@bitocard/admin-ui";
import { SetPassword } from "./set-password";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

/** Where the emailed set-password links (from the sign-in page: a first visit, or Forgot password) land. Outside the console gate. */
export default function SetPasswordPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-canvas px-4 py-10 sm:px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Wordmark className="text-3xl" />
        </div>
        <div className="rounded-xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <SetPassword />
        </div>
        <p className="text-center text-xs text-muted">A Golojan Ltd venture</p>
      </div>
    </main>
  );
}
