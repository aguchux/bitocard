import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { publicPageMetadata } from "@/lib/seo";
import { SignIn } from "./sign-in";

export const metadata: Metadata = publicPageMetadata({
  path: "/signin",
  title: "Sign in to your reseller account",
  description: "Sign in to BitoCard SHQ, Seller Head Quarters, to run your store: orders, catalogue and prices, wallet and withdrawals, API keys and team.",
});

export default function SignInPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignIn />
      </Suspense>
    </AuthLayout>
  );
}
