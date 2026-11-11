"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { accessText, discountText, levelText, type PermissionLevel, type PermissionSet, type PosInviteSent, type PosRoles, type PosRoleView, type PosStaffMember, staffStatusText } from "@/lib/pos";
import { deleteRole, inviteStaff, resendInvite, saveRole, type SendVia, setStaffStatus, type StaffFields, updateStaff } from "@/lib/staff-actions";

export type TillChoice = { id: string; name: string; shop: string };
/** A role offered in the invite (managers: the cashier role only). */
export type RoleChoice = { id: string; name: string; description: string | null };

const field = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-4 text-base";
const primary = "inline-flex h-12 items-center justify-center rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700 disabled:cursor-not-allowed disabled:opacity-50";
const quiet = "inline-flex h-10 items-center justify-center rounded-xl border border-pos-line bg-white px-3 text-sm font-semibold text-pos-ink hover:bg-pos-50 disabled:opacity-50";
const dialogClass = "m-auto w-[min(100%-2rem,34rem)] rounded-[20px] p-0 backdrop:bg-black/50";

const sendVias: Array<{ value: SendVia; label: string; hint: string }> = [
  { value: "whatsapp", label: "WhatsApp", hint: "You send it from your phone." },
  { value: "sms", label: "SMS", hint: "Udozo texts it to them." },
  { value: "link", label: "Copy the link", hint: "Send it any way you like." },
];

const statusTone: Record<PosStaffMember["status"], string> = {
  active: "bg-pos-50 text-pos-700",
  invited: "bg-pos-warn-bg text-pos-warn",
  suspended: "bg-pos-page text-pos-ink-2",
  removed: "bg-pos-page text-pos-muted",
};

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl bg-pos-warn-bg p-3 text-sm font-semibold text-pos-warn">
      {message}
    </p>
  ) : null;
}

/** What to do with an invite once made: open WhatsApp, copy the link, or that the text went. */
export function InviteSent({ name, invite, onDone }: { name: string; invite: PosInviteSent; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="sent" role="status" className="grid gap-3 rounded-[20px] border-2 border-pos-600 bg-white p-5">
      <h2 id="sent" className="font-display text-xl font-bold text-pos-ink">
        Invite ready for {name}
      </h2>
      <p className="text-pos-ink-2">
        {invite.sent_via === "sms" && invite.sent ? "Udozo texted them the link." : invite.sent_via === "sms" ? "The text could not be sent: send the link another way." : "Send them the link."} It works for 48 hours. They’ll show as Invite pending until they set their PIN.
      </p>
      {invite.shop_code ? (
        <p className="text-pos-ink-2">
          Shop code for the till: <strong className="font-display tracking-wider text-pos-ink">{invite.shop_code}</strong>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <a href={invite.whatsapp_url} target="_blank" rel="noopener" className={primary}>
          Send on WhatsApp
        </a>
        <button
          type="button"
          className={quiet}
          onClick={() => {
            void navigator.clipboard?.writeText(invite.url).then(() => setCopied(true));
          }}
        >
          {copied ? "Link copied" : "Copy invite link"}
        </button>
        <button type="button" className={quiet} onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  );
}

/** Choosing where someone may work: every till, or some of them. */
function TillPicker({ tills, all, chosen, onAll, onChosen }: { tills: TillChoice[]; all: boolean; chosen: string[]; onAll: (all: boolean) => void; onChosen: (ids: string[]) => void }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-semibold text-pos-ink-2">Where they can work</legend>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={event => onAll(event.target.checked)} className="size-5" />
        Every till
      </label>
      {!all
        ? tills.map(till => (
            <label key={till.id} className="flex items-center gap-2">
              <input type="checkbox" checked={chosen.includes(till.id)} onChange={event => onChosen(event.target.checked ? [...chosen, till.id] : chosen.filter(id => id !== till.id))} className="size-5" />
              {till.shop} · {till.name}
            </label>
          ))
        : null}
    </fieldset>
  );
}

/** Inviting a member of staff: name, phone, role, tills, then how the invite goes. */
export function InviteStaff({ roles, tills }: { roles: RoleChoice[]; tills: TillChoice[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<StaffFields>({ first_name: "", last_name: "", phone: "", role: roles[0]?.id ?? "cashier", all_tills: tills.length <= 1, till_ids: tills.length === 1 ? [tills[0]!.id] : [] });
  const [via, setVia] = useState<SendVia>("whatsapp");
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<{ name: string; invite: PosInviteSent } | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<StaffFields>) => setFields(current => ({ ...current, ...patch }));
  return (
    <>
      <button type="button" className={primary} onClick={() => {
          setMessage(null);
          dialog.current?.showModal();
        }}>
        Invite staff
      </button>
      {sent ? <InviteSent name={sent.name} invite={sent.invite} onDone={() => setSent(null)} /> : null}
      <dialog ref={dialog} aria-labelledby="invite-title" className={dialogClass}>
        <form
          className="grid gap-3 p-5"
          onSubmit={event => {
            event.preventDefault();
            start(async () => {
              const result = await inviteStaff(fields, via);
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              dialog.current?.close();
              setSent({ name: result.data.first_name, invite: result.data.invite });
              setFields(current => ({ ...current, first_name: "", last_name: "", phone: "" }));
              router.refresh();
            });
          }}
        >
          <h2 id="invite-title" className="font-display text-xl font-bold text-pos-ink">
            Invite staff
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-pos-ink-2">
              First name
              <input value={fields.first_name} onChange={event => set({ first_name: event.target.value })} required maxLength={60} className={field} />
            </label>
            <label className="text-sm font-semibold text-pos-ink-2">
              Last name
              <input value={fields.last_name} onChange={event => set({ last_name: event.target.value })} required maxLength={60} className={field} />
            </label>
          </div>
          <label className="text-sm font-semibold text-pos-ink-2">
            Phone number (WhatsApp or SMS)
            <input type="tel" inputMode="tel" value={fields.phone} onChange={event => set({ phone: event.target.value })} required maxLength={20} className={field} />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-pos-ink-2">Role</legend>
            {roles.map(role => (
              <label key={role.id} className={`flex items-start gap-3 rounded-xl border p-3 ${fields.role === role.id ? "border-2 border-pos-600 bg-pos-50" : "border-pos-line"}`}>
                <input type="radio" name="role" value={role.id} checked={fields.role === role.id} onChange={() => set({ role: role.id })} className="mt-1 size-5" />
                <span>
                  <span className="block font-semibold text-pos-ink">{role.name}</span>
                  {role.description ? <span className="block text-sm text-pos-ink-2">{role.description}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
          {tills.length > 1 ? <TillPicker tills={tills} all={Boolean(fields.all_tills)} chosen={fields.till_ids ?? []} onAll={all => set({ all_tills: all })} onChosen={ids => set({ till_ids: ids })} /> : null}
          <fieldset className="grid gap-1">
            <legend className="text-sm font-semibold text-pos-ink-2">Send the invite by</legend>
            {sendVias.map(item => (
              <label key={item.value} className="flex items-center gap-2">
                <input type="radio" name="via" value={item.value} checked={via === item.value} onChange={() => setVia(item.value)} className="size-5" />
                {item.label} <span className="text-sm text-pos-muted">· {item.hint}</span>
              </label>
            ))}
          </fieldset>
          <Problem message={message} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="h-12 rounded-xl border border-pos-line font-bold">
              Cancel
            </button>
            <button type="submit" disabled={pending} className={primary}>
              {pending ? "Sending…" : "Send invite"}
            </button>
          </div>
          <p className="text-sm text-pos-muted">They get a link to set their own 4-digit PIN. The invite expires in 48 hours.</p>
        </form>
      </dialog>
    </>
  );
}

/** One member of staff's row actions: new invite or PIN, role and tills, suspend or restore, remove. */
export function StaffActions({ member, roles, tills }: { member: PosStaffMember; roles: RoleChoice[]; tills: TillChoice[] }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState(member.role.id);
  const [all, setAll] = useState(member.all_tills);
  const [chosen, setChosen] = useState(member.tills.map(till => till.id));
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<PosInviteSent | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message ?? "That did not work.");
      else {
        setMessage(null);
        router.refresh();
      }
    });

  const resend = async () => {
    if (member.status === "active" && !(await confirm({ title: `New PIN for ${member.first_name}?`, body: <p>Their PIN stops working and they are signed out of every till. They set a new one from the invite.</p>, action: "Send a new invite" }))) return;
    start(async () => {
      const result = await resendInvite(member.id, "whatsapp");
      if (!result.ok) setMessage(result.message);
      else {
        setSent(result.data.invite);
        router.refresh();
      }
    });
  };
  const status = async (action: "suspend" | "restore" | "remove") => {
    if (action !== "restore") {
      const ok = await confirm({
        title: action === "suspend" ? `Suspend ${member.name}?` : `Remove ${member.name}?`,
        body: <p>{action === "suspend" ? "They are signed out of every till at once and cannot sign in until you restore them." : "They are signed out of every till at once. Their past sales stay on your reports under their name."}</p>,
        action: action === "suspend" ? "Suspend" : "Remove",
        tone: "danger",
      });
      if (!ok) return;
    }
    run(() => setStaffStatus(member.id, action));
  };

  return (
    <div className="flex flex-wrap gap-2">
      {member.status !== "suspended" ? (
        <button type="button" className={quiet} disabled={pending} onClick={resend}>
          {member.status === "invited" ? "Resend" : "Reset PIN"}
          <span className="sr-only"> for {member.name}</span>
        </button>
      ) : null}
      <button type="button" className={quiet} disabled={pending} onClick={() => dialog.current?.showModal()}>
        Edit<span className="sr-only"> {member.name}</span>
      </button>
      {member.status === "suspended" ? (
        <button type="button" className={quiet} disabled={pending} onClick={() => status("restore")}>
          Restore<span className="sr-only"> {member.name}</span>
        </button>
      ) : (
        <button type="button" className={quiet} disabled={pending} onClick={() => status("suspend")}>
          Suspend<span className="sr-only"> {member.name}</span>
        </button>
      )}
      <button type="button" className={`${quiet} text-pos-error`} disabled={pending} onClick={() => status("remove")}>
        Remove<span className="sr-only"> {member.name}</span>
      </button>
      {message ? (
        <p role="alert" className="w-full text-sm font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
      {sent ? (
        <div className="w-full">
          <InviteSent name={member.first_name} invite={sent} onDone={() => setSent(null)} />
        </div>
      ) : null}
      <dialog ref={dialog} aria-labelledby={`edit-${member.id}`} className={dialogClass}>
        <form
          className="grid gap-3 p-5"
          onSubmit={event => {
            event.preventDefault();
            start(async () => {
              const result = await updateStaff(member.id, { role, all_tills: all, till_ids: chosen });
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              dialog.current?.close();
              router.refresh();
            });
          }}
        >
          <h2 id={`edit-${member.id}`} className="font-display text-xl font-bold text-pos-ink">
            {member.name}
          </h2>
          <label className="text-sm font-semibold text-pos-ink-2">
            Role
            <select value={role} onChange={event => setRole(event.target.value)} className={field}>
              {roles.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {tills.length > 1 ? <TillPicker tills={tills} all={all} chosen={chosen} onAll={setAll} onChosen={setChosen} /> : null}
          <p className="text-sm text-pos-muted">A new role or fewer tills signs them out, so their next sign-in has it.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="h-12 rounded-xl border border-pos-line font-bold">
              Cancel
            </button>
            <button type="submit" disabled={pending} className={primary}>
              Save
            </button>
          </div>
        </form>
      </dialog>
      {confirmDialog}
    </div>
  );
}

/** The staff, as the design's table: name and contact, role, where they work, status, last active, actions. */
export function StaffTable({ staff, roles, tills }: { staff: PosStaffMember[]; roles: RoleChoice[]; tills: TillChoice[] }) {
  if (!staff.length) return <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">Nobody yet. Invite your first cashier.</p>;
  return (
    <ul className="grid gap-2">
      {staff.map(member => (
        <li key={member.id} className="grid gap-3 rounded-[20px] bg-white p-4 md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pos-50 font-bold text-pos-700">
              {member.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-pos-ink">{member.name}</span>
              <span className="block truncate text-sm text-pos-muted">
                {member.phone_hint}
                {member.last_active_at ? ` · last active ${new Date(member.last_active_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
            </span>
          </div>
          <span className="text-sm">
            <span className="font-semibold text-pos-ink">{member.role.name}</span>
            <span className="block text-pos-muted">{accessText(member)}</span>
          </span>
          <span>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusTone[member.status]}`}>{member.locked_until ? "Locked for a while" : staffStatusText[member.status]}</span>
          </span>
          <StaffActions member={member} roles={roles} tills={tills} />
        </li>
      ))}
    </ul>
  );
}

/** The permissions of every role side by side, the owner first; custom roles with Edit and Delete. */
export function RolesMatrix({ roles }: { roles: PosRoles }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState<PosRoleView | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, start] = useTransition();
  const cell = (level: PermissionLevel | "owner") =>
    level === "owner" || level === "yes" ? (
      <span aria-label="Allowed" className="inline-flex size-7 items-center justify-center rounded-full bg-pos-50 font-bold text-pos-700">
        ✓
      </span>
    ) : level === "no" ? (
      <span aria-label="Not allowed" className="font-semibold text-pos-muted">
        —
      </span>
    ) : (
      <span className="rounded-md bg-pos-warn-bg px-2 py-1 text-xs font-semibold text-pos-warn">{levelText(level)}</span>
    );
  const remove = async (role: PosRoleView) => {
    if (!(await confirm({ title: `Delete ${role.name}?`, body: <p>Nobody may have this role when it is deleted.</p>, action: "Delete role", tone: "danger" }))) return;
    start(async () => {
      const result = await deleteRole(role.id);
      if (!result.ok) setMessage(result.message);
      else router.refresh();
    });
  };
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-[20px] bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="p-3">
                Permission
              </th>
              <th scope="col" className="p-3 text-center">
                Owner
              </th>
              {roles.data.map(role => (
                <th key={role.id} scope="col" className="p-3 text-center">
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.permissions.map(group => (
              <RoleGroup key={group.group} group={group} roles={roles.data} cell={cell} />
            ))}
            <tr className="border-t border-pos-line">
              <th scope="row" className="p-3 font-normal">
                Most discount without a manager
              </th>
              <td className="p-3 text-center">Any amount</td>
              {roles.data.map(role => (
                <td key={role.id} className="p-3 text-center">
                  {discountText(role.discount_limit_bps)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-pos-line bg-pos-page">
              <th scope="row" className="p-3 font-normal">
                Udozo account: listings, wallet, payouts, plan
              </th>
              <td className="p-3 text-center">
                <span className="rounded-md bg-pos-night px-2 py-1 text-xs font-bold text-white">Owner</span>
              </td>
              {roles.data.map(role => (
                <td key={role.id} className="p-3 text-center">
                  {cell("no")}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-pos-muted">The Udozo account row stays with you and can’t be given to staff.</p>
      <ul className="flex flex-wrap gap-2">
        {roles.data
          .filter(role => !role.system)
          .map(role => (
            <li key={role.id} className="flex items-center gap-2 rounded-xl border border-pos-line bg-white px-3 py-2 text-sm">
              <span className="font-semibold">{role.name}</span>
              <span className="text-pos-muted">· {role.staff} staff</span>
              <button type="button" className="font-semibold text-pos-700" onClick={() => setEditing(role)}>
                Edit<span className="sr-only"> {role.name}</span>
              </button>
              <button type="button" className="font-semibold text-pos-error" onClick={() => remove(role)}>
                Delete<span className="sr-only"> {role.name}</span>
              </button>
            </li>
          ))}
      </ul>
      <Problem message={message} />
      <button type="button" className={`${primary} w-fit`} onClick={() => setEditing("new")}>
        Create custom role
      </button>
      {editing ? <RoleEditor key={editing === "new" ? "new" : editing.id} roles={roles} role={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {confirmDialog}
    </div>
  );
}

function RoleGroup({ group, roles, cell }: { group: PosRoles["permissions"][number]; roles: PosRoleView[]; cell: (level: PermissionLevel | "owner") => React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-pos-line bg-pos-page">
        <th colSpan={roles.length + 2} scope="colgroup" className="p-3 text-xs font-bold tracking-wider text-pos-ink-2 uppercase">
          {group.group}
        </th>
      </tr>
      {group.items.map(item => (
        <tr key={item.key} className="border-t border-pos-line">
          <th scope="row" className="p-3 font-normal">
            {item.label}
          </th>
          <td className="p-3 text-center">{cell("owner")}</td>
          {roles.map(role => (
            <td key={role.id} className="p-3 text-center">
              {cell(role.permissions[item.key])}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** What each permission may be set to in a custom role (refunds and stock may need approval; staff, cashiers only). */
const choicesFor = (key: string): PermissionLevel[] => (key === "staff" ? ["no", "cashiers"] : key === "refund" || key === "stock_adjust" ? ["no", "approval", "yes"] : ["no", "yes"]);

/** Making or changing a custom role: its name, what each permission is, and its discount limit. */
function RoleEditor({ roles, role, onClose }: { roles: PosRoles; role: PosRoleView | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<Partial<PermissionSet>>(role?.permissions ?? {});
  const [limit, setLimit] = useState(role ? (role.discount_limit_bps === null ? "" : String(role.discount_limit_bps / 100)) : "0");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 rounded-[20px] border-2 border-pos-600 bg-white p-5"
      onSubmit={event => {
        event.preventDefault();
        const percent = limit.trim() === "" ? null : Number(limit);
        if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
          setMessage("A discount limit is 0% to 100%, or empty for any amount.");
          return;
        }
        start(async () => {
          const result = await saveRole(role?.id ?? null, { name, description, permissions, discount_limit_bps: percent === null ? null : Math.round(percent * 100) });
          if (!result.ok) {
            setMessage(result.message);
            return;
          }
          onClose();
          router.refresh();
        });
      }}
    >
      <h3 className="font-display text-lg font-bold text-pos-ink">{role ? `Change ${role.name}` : "New role"}</h3>
      <label className="text-sm font-semibold text-pos-ink-2">
        Name
        <input value={name} onChange={event => setName(event.target.value)} required maxLength={40} className={field} />
      </label>
      <label className="text-sm font-semibold text-pos-ink-2">
        What it is for (optional)
        <input value={description} onChange={event => setDescription(event.target.value)} maxLength={200} className={field} />
      </label>
      {roles.permissions.map(group => (
        <fieldset key={group.group} className="grid gap-2">
          <legend className="text-xs font-bold tracking-wider text-pos-ink-2 uppercase">{group.group}</legend>
          {group.items.map(item => (
            <label key={item.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{item.label}</span>
              <select value={permissions[item.key] ?? "no"} onChange={event => setPermissions(current => ({ ...current, [item.key]: event.target.value as PermissionLevel }))} className="h-10 rounded-lg border border-pos-line bg-white px-2" aria-label={item.label}>
                {choicesFor(item.key).map(level => (
                  <option key={level} value={level}>
                    {levelText(level)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      ))}
      <label className="text-sm font-semibold text-pos-ink-2">
        Most discount without a manager (%, empty for any amount)
        <input inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value.replace(/[^\d.]/g, ""))} className={field} />
      </label>
      <Problem message={message} />
      <div className="flex gap-2">
        <button type="button" className={quiet} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save role"}
        </button>
      </div>
    </form>
  );
}
