"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CodeInput, errorMessage, humanise, Notice, PageHeader } from "@bitocard/admin-ui";
import { AdminShell, useAdmin } from "@bitocard/admin-ui/shell";
import { type MfaSetup, useAdminAuthenticatorConfirmMutation, useAdminAuthenticatorSetupMutation } from "@bitocard/api-client/admin";

/**
 * Turning on 2-step verification: an authenticator secret to scan, its first code, then the recovery codes once. Each
 * admin chooses it (off until they set it up, signing in with email and password); sensitive and money actions always
 * ask for it.
 */
function TwoStep() {
  const admin = useAdmin();
  const [setup, setupState] = useAdminAuthenticatorSetupMutation();
  const [confirm, confirmState] = useAdminAuthenticatorConfirmMutation();
  const [secret, setSecret] = useState<MfaSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    QRCode.toDataURL(secret.otpauth_uri, { margin: 1, width: 200 })
      .then(url => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [secret]);

  async function begin() {
    const made = await setup().unwrap().catch(() => null);
    if (made) setSecret(made);
  }

  async function finish() {
    if (code.length !== 6) return;
    const done = await confirm({ code }).unwrap().catch(() => null);
    if (!done) return setCode("");
    setRecoveryCodes(done.recovery_codes);
    setSecret(null);
  }

  const on = admin.authenticator !== false;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">2-step verification</h2>
        <Badge tone={on ? "green" : "amber"}>{on ? "On" : "Off"}</Badge>
      </div>

      {recoveryCodes ? (
        <div className="space-y-3">
          <Notice tone="green">2-step verification is on. From now on you enter a code from your authenticator app each time you sign in.</Notice>
          <p className="text-sm text-muted">Save these recovery codes somewhere safe. Each signs you in once if you lose your phone. They are shown only now.</p>
          <ol className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-canvas p-4 font-mono text-sm">
            {recoveryCodes.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <Button onClick={() => setRecoveryCodes(null)}>I have saved them</Button>
        </div>
      ) : on ? (
        <p className="text-sm text-muted">
          You enter a code from your authenticator app each time you sign in, and before sensitive or money actions. Lost your phone? Use a recovery code, or Forgot password on the sign-in page to reset it.
        </p>
      ) : secret ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">Scan this with an authenticator app (such as Google Authenticator or 1Password), then enter the 6-digit code it shows.</p>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-white p-5">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            {qr ? <img src={qr} alt="Authenticator QR code" className="size-48" /> : null}
            <p className="text-center text-xs text-muted">
              Can’t scan? Enter this key: <code className="font-mono break-all text-ink">{secret.secret}</code>
            </p>
          </div>
          {confirmState.error ? <Notice tone="red">{errorMessage(confirmState.error)}</Notice> : null}
          <CodeInput label="Code from your authenticator app" value={code} onChange={setCode} invalid={Boolean(confirmState.error)} disabled={confirmState.isLoading} />
          <div className="flex flex-wrap gap-2">
            <Button loading={confirmState.isLoading} disabled={code.length !== 6} icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void finish()}>
              Turn on
            </Button>
            <Button variant="ghost" onClick={() => setSecret(null)} disabled={confirmState.isLoading}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Off: you sign in with your email and password. Turn it on to ask for a code from an authenticator app too, so your password alone is never enough. Sensitive and money actions (refunds, wallet adjustments, pricing, integrations) always need it.
          </p>
          {setupState.error ? <Notice tone="red">{errorMessage(setupState.error)}</Notice> : null}
          <Button loading={setupState.isLoading} icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void begin()}>
            Turn on 2-step verification
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The signed-in admin's own account: who they are, their roles and their 2-step verification. */
export default function AccountPage() {
  const admin = useAdmin();
  return (
    <AdminShell section="home" current="/account" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Your account" }]}>
      <PageHeader title="Your account" description="Your sign-in to BitoCard's admin." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="text-lg font-bold text-ink">{admin.name}</h2>
          <p className="text-sm break-all text-muted">{admin.email}</p>
          <div className="flex flex-wrap gap-1.5">
            {admin.roles.map(role => (
              <Badge key={role} tone={role === "super_admin" ? "blue" : "grey"} dot={false}>
                {humanise(role)}
              </Badge>
            ))}
          </div>
        </Card>
        <TwoStep />
      </div>
    </AdminShell>
  );
}
