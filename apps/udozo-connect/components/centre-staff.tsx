"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { addMember, changeMemberRole, removeMember } from "@/lib/centre-actions";
import { type Centre, isOwner, type Member, roleHints, roleWords } from "@/lib/centres";
import { useConfirm } from "./confirm-dialog";
import { danger, input, label, Panel, primary, Problem } from "./centre-ui";

/** Who works at the centre. The owner adds people by their Udozo account's email, changes their role and removes them; anyone else can leave. */
export function CentreStaff({ centre, members, me }: { centre: Pick<Centre, "id" | "name" | "role" | "status">; members: Member[]; me: string }) {
  const router = useRouter();
  const ids = useId();
  const [people, setPeople] = useState(members);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("staff");
  const [problem, setProblem] = useState<{ message: string; param: string | null } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const owner = isOwner(centre.role);
  const closed = centre.status === "closed";

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await addMember(centre.id, email, role);
      if (result.ok) {
        setPeople(result.data.data);
        setAdded(`${email.trim()} can now sign in to work at ${centre.name}.`);
        setEmail("");
        setProblem(null);
      } else {
        setAdded(null);
        setProblem({ message: result.message, param: result.param });
      }
    });
  };

  const change = (member: Member, next: "manager" | "staff") =>
    start(async () => {
      const result = await changeMemberRole(centre.id, member.id, next);
      if (result.ok) {
        setPeople(result.data.data);
        setProblem(null);
      } else setProblem({ message: result.message, param: null });
    });

  const remove = async (member: Member) => {
    const leaving = member.email.toLowerCase() === me.toLowerCase();
    const answer = await confirm(
      leaving
        ? { title: `Leave ${centre.name}?`, body: "You will no longer see or work at this centre. Its owner can add you again.", action: "Leave centre", tone: "danger" }
        : { title: `Remove ${member.name}?`, body: "They can no longer sign in to work at this centre. You can add them again later.", action: "Remove", tone: "danger" },
    );
    if (!answer) return;
    start(async () => {
      const result = await removeMember(centre.id, member.id);
      if (!result.ok) return setProblem({ message: result.message, param: null });
      if (leaving) {
        router.push("/centre");
        return;
      }
      setPeople(result.data.data);
      setProblem(null);
    });
  };

  return (
    <div className="grid gap-5">
      {dialog}
      <Problem message={problem?.message ?? null} />
      <Panel title="People at this centre">
        <ul className="divide-y divide-slate-100">
          {people.map(member => {
            const self = member.email.toLowerCase() === me.toLowerCase();
            return (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <strong className="block truncate text-navy-900">
                    {member.name}
                    {self ? " (you)" : ""}
                  </strong>
                  <span className="block truncate text-sm text-slate-600">{member.email}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {owner && member.role !== "owner" && !closed ? (
                    <select
                      aria-label={`${member.name}'s role`}
                      className="min-h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-navy-900"
                      value={member.role}
                      disabled={busy}
                      onChange={event => change(member, event.target.value as "manager" | "staff")}
                    >
                      <option value="manager">Manager</option>
                      <option value="staff">Staff</option>
                    </select>
                  ) : (
                    <span className="rounded-full bg-navy-100 px-3 py-1 text-sm font-semibold text-navy-900">{roleWords[member.role]}</span>
                  )}
                  {member.role !== "owner" && (owner || self) ? (
                    <button type="button" className={`${danger} min-h-10 px-3 text-sm`} disabled={busy} onClick={() => remove(member)}>
                      {self ? "Leave" : "Remove"}
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      {owner && !closed ? (
        <Panel title="Add someone">
          <p className="text-sm">They need a Udozo account with a confirmed mobile number. They sign in here with it.</p>
          <form onSubmit={add} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className={label} htmlFor={`${ids}-email`}>
              Their Udozo account&apos;s email
              <input
                id={`${ids}-email`}
                type="email"
                required
                className={input}
                value={email}
                onChange={event => setEmail(event.target.value)}
                autoComplete="off"
                aria-invalid={problem?.param === "email" ? true : undefined}
              />
            </label>
            <label className={label} htmlFor={`${ids}-role`}>
              Role
              <select id={`${ids}-role`} className={input} value={role} onChange={event => setRole(event.target.value as "manager" | "staff")}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </label>
            <p className="text-sm text-slate-600 sm:col-span-2">{roleHints[role]}</p>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button type="submit" className={primary} disabled={busy || !email.trim()}>
                Add
              </button>
              {added ? (
                <span className="text-sm font-semibold text-emerald-700" role="status">
                  {added}
                </span>
              ) : null}
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
