import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { SignUp } from "./sign-up";

export const metadata: Metadata = { title: "Create your Seller HQ account" };

/** Udozo's own documents (on udozo.com), never BitoCard's. */
const sellerTermsUrl = "https://udozo.com/legal/sellers";
const termsUrl = "https://udozo.com/legal/terms";
const privacyUrl = "https://udozo.com/legal/privacy";

export default function SignUpPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignUp sellerTermsUrl={sellerTermsUrl} termsUrl={termsUrl} privacyUrl={privacyUrl} />
      </Suspense>
    </AuthLayout>
  );
}
