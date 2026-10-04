"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { AdminShell, NotificationsInbox, PushSettings, useAdmin } from "@bitocard/admin-ui/shell";

/** The admin's own notifications, by admin role. */
export default function NotificationsPage() {
  const admin = useAdmin();
  return (
    <AdminShell section="home" current="/notifications" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Notifications" }]}>
      <PageHeader title="Notifications" description="What needs attention for your admin roles: reviews, the exception queue, failed withdrawals and paused conversions." />
      <NotificationsInbox realm="admin" />
      <PushSettings realm="admin" userId={admin.id} />
    </AdminShell>
  );
}
