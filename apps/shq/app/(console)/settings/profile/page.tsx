"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, LogOut, Mail, Pencil, Smartphone } from "lucide-react";
import { Badge, Button, Card, CardHeader, CodeInput, errorMessage, Field, formatDate, humanise, Input, KeyValue, Notice, PageHeader } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  useAddPhoneMutation,
  useChangePasswordMutation,
  useConfirmEmailChangeMutation,
  useRequestEmailChangeMutation,
  useUpdateProfileMutation,
  useVerifyPhoneMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { useReseller, useSignOut } from "@/components/reseller";

/** Add or change the mobile number: send a code by text message, then confirm it. A confirmed number can be used to sign in. */
function MobileNumber() {
  const { user } = useReseller();
  const [editing, setEditing] = useState(!user.phone_verified);
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [addPhone, addState] = useAddPhoneMutation();
  const [verifyPhone, verifyState] = useVerifyPhoneMutation();
  const [done, setDone] = useState(false);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setDone(false);
    const notice = await addPhone({ phone: phone.trim() })
      .unwrap()
      .catch(() => null);
    if (notice) {
      setSentTo(phone.trim());
      setCode("");
    }
  };

  const confirm = async (value: string) => {
    if (verifyState.isLoading) return;
    const session = await verifyPhone({ code: value })
      .unwrap()
      .catch(() => null);
    if (session) {
      setDone(true);
      setSentTo(null);
      setPhone("");
      setEditing(false);
    } else setCode("");
  };

  return (
    <Card>
      <CardHeader
        title="Mobile number"
        description="Once confirmed, you can sign in with your mobile number and password."
        actions={user.phone ? <Badge tone={user.phone_verified ? "green" : "amber"}>{user.phone_verified ? "Confirmed" : "Not confirmed"}</Badge> : null}
      />
      <div className="space-y-4 p-5 sm:p-6">
        {done ? <Notice tone="green">Your mobile number is confirmed.</Notice> : null}
        {user.phone ? <p className="text-base font-semibold text-ink">{user.phone}</p> : <p className="text-sm text-muted">No mobile number yet.</p>}

        {!editing ? (
          <Button variant="secondary" size="sm" icon={<Smartphone className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
            Change mobile number
          </Button>
        ) : sentTo ? (
          <form
            onSubmit={event => {
              event.preventDefault();
              void confirm(code);
            }}
            className="space-y-4"
          >
            <p className="text-sm text-muted">
              Enter the 6-digit code we texted to <span className="font-semibold text-ink">{sentTo}</span>. It expires in 30 minutes.
            </p>
            {verifyState.error ? <Notice tone="red">{errorMessage(verifyState.error)}</Notice> : null}
            <CodeInput label="Confirmation code" value={code} onChange={setCode} onComplete={confirm} autoFocus disabled={verifyState.isLoading} invalid={Boolean(verifyState.error)} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={verifyState.isLoading} disabled={code.length !== 6}>
                Confirm number
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSentTo(null)}>
                Use a different number
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={send} className="space-y-4">
            {addState.error ? <Notice tone="red">{errorMessage(addState.error)}</Notice> : null}
            <Field label={user.phone ? "New mobile number" : "Mobile number"} htmlFor="profile-phone" hint="International format (for example +234…) or your business country's local format.">
              <Input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} minLength={6} maxLength={20} required />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={addState.isLoading} disabled={phone.trim().length < 6}>
                Send code
              </Button>
              {user.phone_verified ? (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

/** The name shown to your team and in emails. */
function NameForm({ onDone }: { onDone: () => void }) {
  const { user } = useReseller();
  const [name, setName] = useState(user.name);
  const [update, state] = useUpdateProfileMutation();
  return (
    <form
      onSubmit={async event => {
        event.preventDefault();
        if (await update({ name: name.trim() }).unwrap().catch(() => null)) onDone();
      }}
      className="space-y-3"
    >
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <Field label="Name" htmlFor="profile-name">
        <Input id="profile-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={state.isLoading} disabled={name.trim().length < 2 || name.trim() === user.name}>
          Save name
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Changing the sign-in email: the current password, then the code sent to the new address. The old address is told. */
function EmailForm({ onDone }: { onDone: (changed: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [request, requestState] = useRequestEmailChangeMutation();
  const [confirm, confirmState] = useConfirmEmailChangeMutation();

  const submitCode = async (value: string) => {
    if (confirmState.isLoading) return;
    if (await confirm({ code: value }).unwrap().catch(() => null)) onDone(true);
    else setCode("");
  };

  if (sentTo) {
    return (
      <form
        onSubmit={event => {
          event.preventDefault();
          void submitCode(code);
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted">
          Enter the 6-digit code we sent to <span className="font-semibold break-all text-ink">{sentTo}</span>. It expires in 30 minutes.
        </p>
        {confirmState.error ? <Notice tone="red">{errorMessage(confirmState.error)}</Notice> : null}
        <CodeInput label="Code from the email" value={code} onChange={setCode} onComplete={submitCode} autoFocus disabled={confirmState.isLoading} invalid={Boolean(confirmState.error)} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={confirmState.isLoading} disabled={code.length !== 6}>
            Confirm new email
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form
      onSubmit={async event => {
        event.preventDefault();
        const next = email.trim();
        if (await request({ email: next, password }).unwrap().catch(() => null)) {
          setSentTo(next);
          setPassword("");
          setCode("");
        }
      }}
      className="space-y-4"
    >
      {requestState.error ? <Notice tone="red">{errorMessage(requestState.error)}</Notice> : null}
      <Field label="New email" htmlFor="profile-email">
        <Input id="profile-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
      </Field>
      <Field label="Current password" htmlFor="profile-email-password" hint="To confirm it is you.">
        <Input id="profile-email-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={requestState.isLoading} disabled={!email.trim() || !password}>
          Send code
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A new password needs the current one; every other session is signed out. Accounts without one use Forgot password. */
function PasswordCard() {
  const { user } = useReseller();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [open, setOpen] = useState(false);
  const [change, state] = useChangePasswordMutation();
  return (
    <Card>
      <CardHeader title="Password" description="Changing it signs you out everywhere else." />
      <div className="space-y-4 p-5 sm:p-6">
        {state.isSuccess && !open ? <Notice tone="green">Your password was changed. Your other sessions were signed out.</Notice> : null}
        {!user.has_password ? (
          <>
            <p className="text-sm text-muted">You sign in with Google and have no password yet. Set one with a code sent to your email.</p>
            <AppLink href="/forgot-password" className="inline-flex min-h-11 items-center rounded-lg border border-brand-500 px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              Set a password
            </AppLink>
          </>
        ) : !open ? (
          <Button variant="secondary" size="sm" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            Change password
          </Button>
        ) : (
          <form
            onSubmit={async event => {
              event.preventDefault();
              if (await change({ current_password: current, new_password: next }).unwrap().catch(() => null)) {
                setOpen(false);
                setCurrent("");
                setNext("");
              }
            }}
            className="space-y-4"
          >
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            <Field label="Current password" htmlFor="password-current">
              <Input id="password-current" type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required />
            </Field>
            <Field label="New password" htmlFor="password-new" hint="At least 10 characters. Passwords found in data breaches are refused.">
              <Input id="password-new" type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} minLength={10} maxLength={128} required />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={state.isLoading} disabled={!current || next.length < 10}>
                Change password
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted">
              Forgotten it?{" "}
              <AppLink href="/forgot-password" className="font-semibold text-brand-600 hover:underline">
                Reset it by email
              </AppLink>
            </p>
          </form>
        )}
      </div>
    </Card>
  );
}

/** The signed-in person: their details, mobile number and signing out. */
export default function ProfilePage() {
  const { user, membership } = useReseller();
  const [signOut, signingOut] = useSignOut();
  const [editing, setEditing] = useState<"name" | "email" | null>(null);
  const [emailChanged, setEmailChanged] = useState(false);

  return (
    <ShqShell section="settings" current="/settings/profile" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Your profile" }]}>
      <PageHeader title="Your profile" description="Your own sign-in details. They apply to every reseller account you belong to." />

      <Card>
        <CardHeader
          title="Your details"
          actions={
            editing ? null : (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing("name")}>
                  Name
                </Button>
                <Button variant="ghost" size="sm" icon={<Mail className="size-4" aria-hidden />} onClick={() => setEditing("email")}>
                  Email
                </Button>
              </div>
            )
          }
        />
        <div className="space-y-4 p-5 sm:p-6">
          {emailChanged ? <Notice tone="green">Your sign-in email was changed. We told your old address too.</Notice> : null}
          {editing === "name" ? <NameForm onDone={() => setEditing(null)} /> : null}
          {editing === "email" ? (
            <EmailForm
              onDone={changed => {
                setEditing(null);
                setEmailChanged(changed);
              }}
            />
          ) : null}
          <KeyValue
            items={[
              { label: "Name", value: user.name },
              {
                label: "Email",
                value: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="break-all">{user.email}</span>
                    <Badge tone={user.email_verified ? "green" : "amber"}>{user.email_verified ? "Confirmed" : "Not confirmed"}</Badge>
                  </span>
                ),
              },
              { label: `Role at ${membership.reseller.name}`, value: humanise(membership.role) },
              { label: "Member since", value: formatDate(user.created_at) },
            ]}
          />
        </div>
      </Card>

      <MobileNumber />

      <PasswordCard />

      <Card>
        <CardHeader title="Sign out" description="Ends this session on this device." />
        <div className="flex flex-wrap items-center gap-3 p-5 sm:p-6">
          <Button variant="ghost" icon={<LogOut className="size-4" aria-hidden />} loading={signingOut} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </ShqShell>
  );
}
