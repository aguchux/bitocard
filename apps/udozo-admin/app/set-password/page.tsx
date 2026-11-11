import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth-layout";
import { SetPassword } from "./set-password";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

/** Where the emailed set-password links (from the sign-in page: a first visit, or Forgot password) land. Outside the console gate. */
export default function SetPasswordPage() {
  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <SetPassword />
      </div>
    </AuthLayout>
  );
}
