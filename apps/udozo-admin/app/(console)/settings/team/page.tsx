"use client";

import { useId, useState } from "react";
import { UserPlus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, DataTable, Dialog, errorMessage, Field, formatRelative, Input, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminLinkSent,
  type AdminMember,
  type AdminRole,
  useAdminTeamQuery,
  useInviteAdminMutation,
  useResetAdminAuthenticatorMutation,
  useRestoreAdminMutation,
  useSendAdminPasswordLinkMutation,
  useSetAdminRolesMutation,
  useSuspendAdminMutation,
} from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { linkNotice, roleInfo } from "@/components/team";

function RolePicker({ value, onChange, roles }: { value: AdminRole[]; onChange: (roles: AdminRole[]) => void; roles: AdminRole[] }) {
  const id = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold text-ink">Roles</legend>
      {roles.map(role => (
        <label key={role} htmlFor={`${id}-${role}`} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
          <input
            id={`${id}-${role}`}
            type="checkbox"
            className="mt-1 size-4"
            checked={value.includes(role)}
            onChange={event => onChange(event.target.checked ? [...value, role] : value.filter(item => item !== role))}
          />
          <span>
            <span className="block text-sm font-semibold text-ink">{roleInfo[role].label}</span>
            <span className="block text-xs text-muted">{roleInfo[role].description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function InviteDialog({ open, onClose, roles, domains, onSent }: { open: boolean; onClose: () => void; roles: AdminRole[]; domains: string[]; onSent: (sent: AdminLinkSent, email: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [chosen, setChosen] = useState<AdminRole[]>(["support"]);
  const [invite, state] = useInviteAdminMutation();
  const close = () => {
    setName("");
    setEmail("");
    setChosen(["support"]);
    state.reset();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Invite to the team"
      description="They get an email with a link to set their password, then set up their authenticator app at their first sign-in."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={state.isLoading}>
            Cancel
          </Button>
          <Button
            loading={state.isLoading}
            disabled={name.trim().length < 2 || !email.trim() || chosen.length === 0}
            onClick={async () => {
              const made = await invite({ name: name.trim(), email: email.trim(), roles: chosen })
                .unwrap()
                .catch(() => null);
              if (!made) return;
              onSent(made.email_sent, made.email);
              close();
            }}
          >
            Send invitation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Name" htmlFor="invite-name">
          <Input id="invite-name" value={name} maxLength={100} onChange={event => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="Work email" htmlFor="invite-email" hint={domains.length ? `An address on ${domains.join(" or ")}.` : undefined}>
          <Input id="invite-email" type="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} />
        </Field>
        <RolePicker value={chosen} onChange={setChosen} roles={roles} />
      </div>
    </Dialog>
  );
}

function RolesDialog({ member, onClose, roles }: { member: AdminMember | null; onClose: () => void; roles: AdminRole[] }) {
  const [chosen, setChosen] = useState<AdminRole[]>(member?.roles ?? []);
  const [save, state] = useSetAdminRolesMutation();
  const close = () => {
    state.reset();
    onClose();
  };
  return (
    <Dialog
      open={Boolean(member)}
      onClose={close}
      title={`${member?.name ?? ""}'s roles`}
      description="They see the new roles the next time a page loads."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={state.isLoading}>
            Cancel
          </Button>
          <Button
            loading={state.isLoading}
            disabled={chosen.length === 0}
            onClick={async () => {
              if (!member) return;
              const saved = await save({ id: member.id, roles: chosen })
                .unwrap()
                .catch(() => null);
              if (saved) close();
            }}
          >
            Save roles
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <RolePicker value={chosen} onChange={setChosen} roles={roles} />
      </div>
    </Dialog>
  );
}

type Pending = { kind: "suspend" | "restore" | "authenticator"; member: AdminMember } | null;

/**
 * Settings > Team (super admins): everyone who can sign in to the admin app, inviting staff with roles, and changing
 * their roles, sending a new set-password link, resetting a lost authenticator, suspending and restoring. Each change
 * asks for the authenticator code (step-up). Nobody is deleted: suspending ends their access and keeps their history.
 */
export default function TeamPage() {
  const admin = useAdmin();
  const allowed = can(admin);
  const team = useAdminTeamQuery(undefined, { skip: !allowed });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<AdminMember | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ tone: "green" | "amber" | "red"; text: string } | null>(null);
  const [sendLink, linkState] = useSendAdminPasswordLinkMutation();
  const [suspend] = useSuspendAdminMutation();
  const [restore] = useRestoreAdminMutation();
  const [resetAuthenticator] = useResetAdminAuthenticatorMutation();
  const roles = team.data?.roles ?? (Object.keys(roleInfo) as AdminRole[]);

  const status = (member: AdminMember) =>
    member.status === "disabled" ? <Badge tone="red">Suspended</Badge> : !member.password_set ? <Badge tone="amber">Invited</Badge> : <Badge tone="green">Active</Badge>;

  return (
    <UdozoShell section="settings" current="/settings/team" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Team" }]}>
      <PageHeader
        title="Team"
        description="Everyone who can sign in to Udozo's admin, and what each can do. Invite staff by email; they choose a password and set up their authenticator app."
        actions={
          allowed ? (
            <Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setInviting(true)}>
              Invite to the team
            </Button>
          ) : null
        }
      />
      {!allowed ? (
        <Notice tone="amber">Only super admins manage the team.</Notice>
      ) : (
        <>
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          {linkState.error ? <Notice tone="red">{errorMessage(linkState.error)}</Notice> : null}
          <QueryView query={team} loading={<Skeleton className="h-48 w-full" />}>
            {data => (
              <Card>
                <DataTable
                  caption="Team"
                  rows={data.data}
                  rowKey={member => member.id}
                  empty="Nobody yet."
                  columns={[
                    {
                      key: "who",
                      header: "Name",
                      cell: member => (
                        <span className="block min-w-0">
                          <span className="block font-semibold text-ink">
                            {member.name}
                            {member.id === admin?.id ? <span className="ml-2 text-xs font-normal text-muted">(you)</span> : null}
                          </span>
                          <span className="block text-sm break-all text-muted">{member.email}</span>
                        </span>
                      ),
                    },
                    {
                      key: "roles",
                      header: "Roles",
                      cell: member => (
                        <span className="flex flex-wrap gap-1.5">
                          {member.roles.map(role => (
                            <Badge key={role} tone={role === "super_admin" ? "blue" : "grey"} dot={false}>
                              {roleInfo[role]?.label ?? role}
                            </Badge>
                          ))}
                        </span>
                      ),
                    },
                    { key: "status", header: "Status", cell: status },
                    { key: "authenticator", header: "Authenticator", hideOnMobile: true, cell: member => (member.authenticator ? "Set up" : "Not yet") },
                    { key: "seen", header: "Last signed in", hideOnMobile: true, cell: member => (member.last_sign_in_at ? formatRelative(member.last_sign_in_at) : "Never") },
                    {
                      key: "actions",
                      header: "",
                      align: "right",
                      cell: member => {
                        const self = member.id === admin?.id;
                        return (
                          <span className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEditing(member)}>
                              Roles
                            </Button>
                            {member.status === "active" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={linkState.isLoading && linkState.originalArgs === member.id}
                                onClick={async () => {
                                  const done = await sendLink(member.id)
                                    .unwrap()
                                    .catch(() => null);
                                  if (done) setNotice(linkNotice(done.email_sent, done.email));
                                }}
                              >
                                {member.password_set ? "Password link" : "Resend invitation"}
                              </Button>
                            ) : null}
                            {!self && member.authenticator ? (
                              <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "authenticator", member })}>
                                Reset authenticator
                              </Button>
                            ) : null}
                            {!self ? (
                              member.status === "active" ? (
                                <Button size="sm" variant="danger" onClick={() => setPending({ kind: "suspend", member })}>
                                  Suspend
                                </Button>
                              ) : (
                                <Button size="sm" onClick={() => setPending({ kind: "restore", member })}>
                                  Restore
                                </Button>
                              )
                            ) : null}
                          </span>
                        );
                      },
                    },
                  ]}
                />
              </Card>
            )}
          </QueryView>
          <InviteDialog open={inviting} onClose={() => setInviting(false)} roles={roles} domains={team.data?.domains ?? []} onSent={(sent, email) => setNotice(linkNotice(sent, email))} />
          {editing ? <RolesDialog key={editing.id} member={editing} onClose={() => setEditing(null)} roles={roles} /> : null}
          <ActionDialog
            open={pending?.kind === "suspend"}
            onClose={() => setPending(null)}
            title={`Suspend ${pending?.member.name ?? ""}?`}
            description="They are signed out at once and cannot sign in until you restore them. Their history stays."
            confirmLabel="Suspend"
            tone="danger"
            onConfirm={async reason => pending && suspend({ id: pending.member.id, reason }).unwrap()}
          />
          <ActionDialog
            open={pending?.kind === "restore"}
            onClose={() => setPending(null)}
            title={`Restore ${pending?.member.name ?? ""}?`}
            description="They can sign in again with their password and authenticator, with the roles they had."
            confirmLabel="Restore"
            onConfirm={async reason => pending && restore({ id: pending.member.id, reason }).unwrap()}
          />
          <ActionDialog
            open={pending?.kind === "authenticator"}
            onClose={() => setPending(null)}
            title={`Reset ${pending?.member.name ?? ""}'s authenticator?`}
            description="For a lost phone: their authenticator is removed and they are signed out. They set up a new one at their next sign-in."
            confirmLabel="Reset authenticator"
            tone="danger"
            onConfirm={async reason => pending && resetAuthenticator({ id: pending.member.id, reason }).unwrap()}
          />
        </>
      )}
    </UdozoShell>
  );
}
