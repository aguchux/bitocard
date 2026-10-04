"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { PushSettings } from "@bitocard/admin-ui/shell";
import { ShqShell } from "@/components/shq-shell";
import { useReseller } from "@/components/reseller";

/** Push notifications to your own devices, and which notifications are pushed. Per person, not per account. */
export default function NotificationSettingsPage() {
  const { user } = useReseller();
  return (
    <ShqShell section="settings" current="/settings/notifications" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Notifications" }]}>
      <PageHeader title="Notifications" description="Your own settings: they apply to every reseller account you belong to." />
      <PushSettings realm="reseller" userId={user.id} />
    </ShqShell>
  );
}
