"use client";

import { Badge, Card, CardHeader, formatDateTime, QueryView, Skeleton } from "@bitocard/admin-ui";
import { type AdminPosStaffMember, usePosAccountStaffQuery } from "@bitocard/api-client/admin";

const statusTones = { active: "green", invited: "amber", suspended: "grey", removed: "grey" } as const;
const statusWords = { active: "Active", invited: "Invite pending", suspended: "Suspended", removed: "Removed" } as const;
const actionWords: Record<string, string> = { refund: "Refund", discount: "Bigger discount", stock_adjust: "Stock change" };

/** Where a member of staff may work, in words. */
export const tillsWords = (member: Pick<AdminPosStaffMember, "all_tills" | "tills">) => (member.all_tills ? "Every till" : member.tills.map(till => till.name).join(", ") || "No till");

/**
 * A POS account's staff (milestone 5), read only: who works there, their role, tills and status, the owner's own
 * roles, the tills' linked devices, and the latest managers' approvals. Udozo never sees or keeps a PIN.
 */
export function PosStaffCard({ account }: { account: string }) {
  const query = usePosAccountStaffQuery(account);
  return (
    <Card>
      <CardHeader title="Staff and devices" description="The owner's staff sign in with the shop code and their own PIN, never a Udozo account." />
      <QueryView query={query} loading={<Skeleton className="h-24 w-full" />}>
        {data => (
          <div className="grid gap-5 text-sm">
            <section className="grid gap-2">
              <h3 className="font-semibold text-ink">
                Staff · {data.staff.used}
                {data.staff.limit !== null ? ` of ${data.staff.limit}` : ""}
              </h3>
              {data.staff.data.length ? (
                <ul className="grid gap-2">
                  {data.staff.data.map(member => (
                    <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">
                          {member.name} · {member.role.name}
                        </span>
                        <span className="block text-xs text-muted">
                          {tillsWords(member)} · {member.phone_hint} · invited by {member.invited_by}
                          {member.last_active_at ? ` · last active ${formatDateTime(member.last_active_at)}` : ""}
                        </span>
                      </span>
                      <Badge tone={member.locked_until ? "red" : statusTones[member.status]}>{member.locked_until ? "Locked" : statusWords[member.status]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No staff yet.</p>
              )}
            </section>
            {data.roles.data.some(role => !role.system) ? (
              <section className="grid gap-1">
                <h3 className="font-semibold text-ink">The owner’s own roles</h3>
                <ul className="grid gap-1">
                  {data.roles.data
                    .filter(role => !role.system)
                    .map(role => (
                      <li key={role.id} className="text-ink">
                        {role.name} · {role.staff} staff ·{" "}
                        <span className="text-muted">
                          {Object.entries(role.permissions)
                            .filter(([, level]) => level !== "no")
                            .map(([key, level]) => (level === "yes" ? key : `${key} (${level})`))
                            .join(", ") || "nothing"}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
            <section className="grid gap-2">
              <h3 className="font-semibold text-ink">Linked devices</h3>
              {data.devices.length ? (
                <ul className="grid gap-1">
                  {data.devices.map(device => (
                    <li key={device.id} className="flex flex-wrap justify-between gap-2">
                      <span className="text-ink">
                        {device.name ?? "Unnamed"} · {device.till.name}
                        {device.platform ? ` · ${device.platform}` : ""}
                      </span>
                      <span className="text-muted">{device.revoked_at ? `Unlinked ${formatDateTime(device.revoked_at)}` : device.last_seen_at ? `Last used ${formatDateTime(device.last_seen_at)}` : "Not used yet"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">None.</p>
              )}
            </section>
            {data.approvals.length ? (
              <section className="grid gap-1">
                <h3 className="font-semibold text-ink">Managers’ approvals</h3>
                <ul className="grid gap-1">
                  {data.approvals.map(row => (
                    <li key={row.id} className="text-ink">
                      {actionWords[row.action] ?? row.action}: {row.requested_by}, approved by {row.approved_by} <span className="text-muted">· {formatDateTime(row.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </QueryView>
    </Card>
  );
}
