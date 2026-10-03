import type { Metadata } from "next";
import { Suspense } from "react";
import { appUrl } from "@bitocard/ui/site";
import { AuthLayout } from "@/components/auth-layout";
import { SignUp } from "./sign-up";

export const metadata: Metadata = { title: "Create your reseller account" };

export default function SignUpPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignUp termsUrl={appUrl("legals", "/documents/terms")} privacyUrl={appUrl("legals", "/documents/privacy")} />
      </Suspense>
    </AuthLayout>
  );
}
