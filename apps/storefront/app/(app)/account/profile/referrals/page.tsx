import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { AccountScreen, ComingSoon } from "@/components/app/account-menu";

export const metadata: Metadata = { title: "Referrals" };

/** Referrals are not built yet: the screen says so. */
export default function ReferralsPage() {
  return (
    <AccountScreen title="Referrals">
      <ComingSoon icon={Gift} title="Invite your friends">
        <p>Soon you will be able to invite friends to the store from here.</p>
        <p>We will let you know when it is ready.</p>
      </ComingSoon>
    </AccountScreen>
  );
}
