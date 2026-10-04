"use client";

import { PageHeader } from "@bitocard/admin-ui";
import { AppLink, NotificationsInbox } from "@bitocard/admin-ui/shell";
import { ShqShell } from "@/components/shq-shell";

/** Your notifications for the reseller account you are using, by your role, plus your own security notices. */
export default function NotificationsPage() {
  return (
    <ShqShell section="home" current="/notifications" crumbs={[{ label: "Home", href: "/" }, { label: "Notifications" }]}>
      <PageHeader
        title="Notifications"
        description="What needs your attention in this account, for your role, and notices about your own sign-in. Sandbox notifications are labelled."
        actions={
          <AppLink href="/settings/notifications" className="inline-flex min-h-9 items-center rounded-xl border border-brand-500 bg-white px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
            Push settings
          </AppLink>
        }
      />
      <NotificationsInbox realm="reseller" />
    </ShqShell>
  );
}
