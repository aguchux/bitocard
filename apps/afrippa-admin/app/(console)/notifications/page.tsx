"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { NotificationsInbox, PushSettings, useAdmin } from "@bitocard/admin-ui/shell";
import { AfrippaShell } from "@/components/shell";

/**
 * The admin's own notifications, by role: appeals, reports, traders' tickets and chats, and the crypto alerts, with push
 * to this browser (Afrippa's own push key; Afrippa's notices only).
 */
export default function NotificationsPage() {
  const admin = useAdmin();
  return (
    <AfrippaShell section="home" current="/notifications" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Notifications" }]}>
      <PageHeader title="Notifications" description="What needs attention for your roles: appeals to decide, reports, traders waiting for help, and withdrawals, deposits and custody." />
      <NotificationsInbox realm="admin" />
      <PushSettings realm="admin" userId={admin.id} />
    </AfrippaShell>
  );
}
