import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: "Accept invitation" };

/** The same as `/invitations/accept` (the address invitation emails use), for shorter links. */
export default function InvitationsPage() {
  return (
    <AuthLayout>
      <Suspense>
        <AcceptInvitation />
      </Suspense>
    </AuthLayout>
  );
}
