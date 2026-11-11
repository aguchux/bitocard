import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignIn />
      </Suspense>
    </AuthLayout>
  );
}
