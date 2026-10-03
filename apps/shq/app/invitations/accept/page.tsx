import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { AcceptInvitation } from "../accept-invitation";

export const metadata: Metadata = { title: "Accept invitation" };

/** Where invitation emails link to: `/invitations/accept?token=…` on the dashboard address. */
export default function AcceptInvitationPage() {
  return (
    <AuthLayout>
      <Suspense>
        <AcceptInvitation />
      </Suspense>
    </AuthLayout>
  );
}
