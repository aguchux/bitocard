import type { Metadata } from "next";
import { AcceptInviteForm } from "@/components/staff-auth";

export const metadata: Metadata = { title: "Your invite", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** A staff invite (`/invite#t=…`, the token kept out of the address the server sees): the role, then their own PIN. */
export default function InvitePage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <AcceptInviteForm />
    </div>
  );
}
