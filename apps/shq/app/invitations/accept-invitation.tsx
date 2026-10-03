"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogOut, MailOpen, UserPlus } from "lucide-react";
import { Button, errorMessage, Notice, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { useAcceptInvitationMutation, useSessionQuery, useSignOutMutation } from "@bitocard/api-client/reseller";
import { goToSignIn } from "@/components/reseller";
import { mainSiteUrl } from "@/components/links";

/** The dashboard remembers the chosen reseller account under this key (see components/reseller.tsx). */
const resellerKey = "shq-reseller";

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
        <MailOpen className="size-6" aria-hidden />
      </span>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
      {children ? <p className="text-sm text-muted">{children}</p> : null}
    </div>
  );
}

/**
 * Accepting a team invitation from its emailed link (`?token=`). Signed-in people accept with the invited email; new
 * people sign up on the main site with the invitation, or sign in and come back here.
 */
export function AcceptInvitation() {
  const token = useSearchParams().get("token")?.trim() ?? "";
  const session = useSessionQuery();
  const [accept, acceptState] = useAcceptInvitationMutation();
  const [signOut] = useSignOutMutation();
  const [switching, setSwitching] = useState(false);
  const signedOut = session.error && "status" in session.error && session.error.status === 401;
  const here = `/invitations/accept?token=${encodeURIComponent(token)}`;

  if (!token) {
    return (
      <div className="w-full max-w-md space-y-6">
        <Heading title="Invitation link incomplete">Open the link from your invitation email again, or ask for a new invitation.</Heading>
        <AppLink href="/" className="text-sm font-semibold text-brand-600 underline-offset-2 hover:underline">
          Go to SHQ
        </AppLink>
      </div>
    );
  }

  if (session.isLoading) {
    return (
      <div className="w-full max-w-md space-y-4" aria-busy="true" aria-label="Checking your session">
        <Skeleton className="h-12 w-12" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (signedOut || !session.data) {
    return (
      <div className="w-full max-w-md space-y-6">
        <Heading title="You're invited to a team">Sign in with the email address the invitation was sent to, or create your account with it.</Heading>
        {session.error && !signedOut ? <Notice tone="red">{errorMessage(session.error, "Could not check your session.")}</Notice> : null}
        <div className="flex flex-col gap-3">
          <AppLink
            href={`/signin?next=${encodeURIComponent(here)}`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
          >
            I have an account: sign in
          </AppLink>
          <a
            href={mainSiteUrl(`/signup?invitation=${encodeURIComponent(token)}`)}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-500 px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50"
          >
            I&apos;m new: create an account
          </a>
        </div>
        <p className="text-xs text-muted">Invitations last 7 days. If yours has expired, ask the person who invited you to send a new one.</p>
      </div>
    );
  }

  const user = session.data.user;
  const mismatch = acceptState.error && "code" in acceptState.error && acceptState.error.code === "invitation_email_mismatch";

  const join = async () => {
    const result = await accept({ token })
      .unwrap()
      .catch(() => null);
    if (!result) return;
    try {
      window.localStorage.setItem(resellerKey, result.reseller_id);
    } catch {
      /* the dashboard opens the first account instead */
    }
    // A full page load, so the dashboard starts with the new membership.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  };

  const signInElsewhere = async () => {
    setSwitching(true);
    await signOut()
      .unwrap()
      .catch(() => undefined);
    goToSignIn();
  };

  return (
    <div className="w-full max-w-md space-y-6">
      <Heading title="Join the team">
        You&apos;re signed in as <span className="font-semibold break-all text-ink">{user.email}</span>. Accept to join the reseller account that invited you.
      </Heading>
      {acceptState.error ? <Notice tone="red">{errorMessage(acceptState.error)}</Notice> : null}
      <div className="flex flex-col gap-3">
        {!mismatch ? (
          <Button className="min-h-12" icon={<UserPlus className="size-4" aria-hidden />} loading={acceptState.isLoading || acceptState.isSuccess} onClick={join}>
            Accept invitation
          </Button>
        ) : null}
        <Button variant={mismatch ? "primary" : "ghost"} icon={<LogOut className="size-4" aria-hidden />} loading={switching} onClick={signInElsewhere}>
          Sign in with a different email
        </Button>
      </div>
    </div>
  );
}
