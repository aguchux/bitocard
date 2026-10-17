import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { AccountScreen, ComingSoon } from "@/components/app/account-menu";

export const metadata: Metadata = { title: "Notifications" };

/** Notification settings are not built yet for customers: the screen says so and where updates are meanwhile. */
export default function NotificationsPage() {
  return (
    <AccountScreen title="Notifications">
      <ComingSoon icon={Bell} title="Choose the updates you get">
        <p>Soon you will be able to choose which updates you get, and turn on alerts on this device.</p>
        <p>Until then, each order&apos;s page shows how it is going, and your codes are sent by email.</p>
      </ComingSoon>
    </AccountScreen>
  );
}
