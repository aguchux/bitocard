"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { NotificationsInbox } from "@bitocard/admin-ui/shell";
import { AfrippaShell } from "@/components/shell";

/** The admin's own notifications, by role: appeals, reports, traders' tickets and chats, and the crypto alerts. */
export default function NotificationsPage() {
  return (
    <AfrippaShell section="home" current="/notifications" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Notifications" }]}>
      <PageHeader title="Notifications" description="What needs attention for your roles: appeals to decide, reports, traders waiting for help, and withdrawals, deposits and custody." />
      <NotificationsInbox realm="admin" />
    </AfrippaShell>
  );
}
