"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  ErrorState,
  errorMessage,
  Field,
  formatDate,
  formatRelative,
  humanise,
  Input,
  Notice,
  PageHeader,
  Select,
  type Column,
} from "@bitocard/admin-ui";
import {
  type Invitation,
  type StaffRole,
  staffRoles,
  type TeamMember,
  useCancelInvitationMutation,
  useChangeMemberRoleMutation,
  useInviteMemberMutation,
  useRemoveMemberMutation,
  useTeamQuery,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const roleHelp: Record<StaffRole, string> = {
  admin: "Manages the team, store, settings and API keys.",
  developer: "Manages API keys and webhooks.",
  finance: "Works with the wallet, top-ups and withdrawals.",
  support: "Looks after orders and customers.",
};

function RoleSelect({ id, value, onChange }: { id: string; value: StaffRole; onChange: (role: StaffRole) => void }) {
  return (
    <Field label="Role" htmlFor={id} hint={roleHelp[value]}>
      <Select id={id} value={value} onChange={event => onChange(event.target.value as StaffRole)}>
        {staffRoles.map(role => (
          <option key={role} value={role}>
            {humanise(role)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const [invite] = useInviteMemberMutation();
  const close = () => {
    setEmail("");
    setRole("support");
    onClose();
  };
  return (
    <ActionDialog
      open={open}
      onClose={close}
      title="Invite a team member"
      description="We email them a link that is valid for 7 days. A new invitation to the same address replaces the old one."
      confirmLabel="Send invitation"
      requireReason={false}
      onConfirm={async () => {
        const address = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("Enter a valid email address.");
        await invite({ email: address, role }).unwrap();
      }}
    >
      <Field label="Email address" htmlFor="invite-email">
        <Input id="invite-email" type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} required />
      </Field>
      <RoleSelect id="invite-role" value={role} onChange={setRole} />
    </ActionDialog>
  );
}

/** Members and pending invitations. Everyone can see the team; the owner and admins manage it. */
export default function TeamPage() {
  const { user, membership } = useReseller();
  const manage = can(membership, "admin");
  const { data, error, isLoading, isFetching, refetch } = useTeamQuery();
  const [inviting, setInviting] = useState(false);
  const [changing, setChanging] = useState<{ member: TeamMember; role: StaffRole } | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [cancelling, setCancelling] = useState<Invitation | null>(null);
  const [changeRole] = useChangeMemberRoleMutation();
  const [removeMember] = useRemoveMemberMutation();
  const [cancelInvitation] = useCancelInvitationMutation();

  // The owner cannot be changed, and nobody changes or removes themselves here (so an admin cannot lock themselves out).
  const editable = (member: TeamMember) => manage && member.role !== "owner" && member.user_id !== user.id;

  const memberColumns: Array<Column<TeamMember>> = [
    {
      key: "name",
      header: "Name",
      cell: member => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">
            {member.name}
            {member.user_id === user.id ? <span className="ml-1.5 text-xs font-medium text-muted">(you)</span> : null}
          </span>
          <span className="block truncate text-xs font-normal text-muted">{member.email}</span>
        </span>
      ),
    },
    { key: "role", header: "Role", cell: member => <Badge tone={member.role === "owner" ? "pink" : "grey"} dot={false}>{humanise(member.role)}</Badge> },
    { key: "joined", header: "Joined", cell: member => formatDate(member.joined_at), hideOnMobile: true },
    ...(manage
      ? [
          {
            key: "actions",
            header: "Actions",
            align: "right" as const,
            cell: (member: TeamMember) =>
              editable(member) ? (
                <span className="inline-flex flex-wrap justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setChanging({ member, role: member.role as StaffRole })}>
                    Change role
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-700" onClick={() => setRemoving(member)}>
                    Remove
                  </Button>
                </span>
              ) : (
                <span className="text-xs text-muted">—</span>
              ),
          },
        ]
      : []),
  ];

  const invitationColumns: Array<Column<Invitation>> = [
    { key: "email", header: "Email", cell: invitation => <span className="block truncate">{invitation.email}</span> },
    { key: "role", header: "Role", cell: invitation => humanise(invitation.role) },
    { key: "expires", header: "Expires", cell: invitation => formatRelative(invitation.expires_at) },
    ...(manage
      ? [
          {
            key: "actions",
            header: "Actions",
            align: "right" as const,
            cell: (invitation: Invitation) => (
              <Button size="sm" variant="ghost" onClick={() => setCancelling(invitation)}>
                Cancel
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <ShqShell
      section="team"
      current="/team"
      crumbs={[{ label: "Team" }]}
      actions={
        manage ? (
          <Button size="sm" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setInviting(true)}>
            Invite
          </Button>
        ) : null
      }
    >
      <PageHeader title="Team" description={`The people who can work on ${membership.reseller.name}.`} />
      {!manage ? <Notice tone="grey">Only the owner or an admin can invite people or change roles.</Notice> : null}
      {error ? (
        <Card>
          <ErrorState message={errorMessage(error, "Could not load your team.")} onRetry={refetch} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Members" description="The owner always has full access and cannot be changed or removed." />
            <div className="mt-4">
              <DataTable columns={memberColumns} rows={data?.members} rowKey={member => member.user_id} loading={isLoading || isFetching} empty="No members yet." caption="Team members" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Pending invitations" description="Invitations not yet accepted. Each link works for 7 days." />
            <div className="mt-4">
              <DataTable
                columns={invitationColumns}
                rows={data?.invitations}
                rowKey={invitation => invitation.id}
                loading={isLoading}
                empty="No pending invitations."
                caption="Pending invitations"
              />
            </div>
          </Card>
        </>
      )}

      <InviteDialog open={inviting} onClose={() => setInviting(false)} />

      <ActionDialog
        open={Boolean(changing)}
        onClose={() => setChanging(null)}
        title={changing ? `Change ${changing.member.name}'s role` : "Change role"}
        description="The new role applies straight away."
        confirmLabel="Change role"
        requireReason={false}
        onConfirm={() => (changing ? changeRole({ userId: changing.member.user_id, role: changing.role }).unwrap() : Promise.resolve())}
      >
        {changing ? <RoleSelect id="change-role" value={changing.role} onChange={role => setChanging({ ...changing, role })} /> : null}
      </ActionDialog>

      <ActionDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : "Remove member"}
        description="They lose access at once. You can invite them again later."
        confirmLabel="Remove"
        tone="danger"
        requireReason={false}
        onConfirm={() => (removing ? removeMember(removing.user_id).unwrap() : Promise.resolve())}
      />

      <ActionDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this invitation?"
        description={cancelling ? `The link sent to ${cancelling.email} will stop working.` : undefined}
        confirmLabel="Cancel invitation"
        tone="danger"
        requireReason={false}
        onConfirm={() => (cancelling ? cancelInvitation(cancelling.id).unwrap() : Promise.resolve())}
      />
    </ShqShell>
  );
}
