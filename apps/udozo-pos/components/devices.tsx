"use client";

/* eslint-disable @next/next/no-img-element -- the QR code is drawn in the browser as a data address. */
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import type { PosDeviceRow, PosLinkCode } from "@/lib/pos";
import { makeLinkCode, unlinkDevice } from "@/lib/staff-actions";

const quiet = "inline-flex h-10 items-center justify-center rounded-xl border border-pos-line bg-white px-3 text-sm font-semibold text-pos-ink hover:bg-pos-50 disabled:opacity-50";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

/** A one-time code (and its QR, which opens the link page with it filled in) linking a device to this till. */
export function LinkDevice({ tillId, tillName }: { tillId: string; tillName: string }) {
  const [code, setCode] = useState<PosLinkCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!code) return;
    let alive = true;
    void QRCode.toDataURL(code.link_url, { errorCorrectionLevel: "M", margin: 1, width: 240 }).then(url => {
      if (alive) setQr(url);
    });
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        className={quiet}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await makeLinkCode(tillId);
            if (!result.ok) setMessage(result.message);
            else {
              setMessage(null);
              setQr(null);
              setCode(result.data);
            }
          })
        }
      >
        {code ? "New code" : "Link a device"}
        <span className="sr-only"> to {tillName}</span>
      </button>
      {code ? (
        <div role="status" className="flex flex-wrap items-center gap-4 rounded-xl bg-pos-50 p-4">
          {qr ? <img src={qr} alt={`QR code to link a device to ${tillName}`} width={120} height={120} className="rounded-lg bg-white" /> : null}
          <div className="grid gap-1">
            <span className="text-sm text-pos-ink-2">On the device, open pos.udozo.com/link and type</span>
            <span className="font-display text-2xl font-bold tracking-widest text-pos-ink">{code.code}</span>
            <span className="text-sm text-pos-muted">Works once, until {when(code.expires_at)}.</span>
          </div>
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** The tills' linked devices, with Unlink: it sells nothing more and whoever is signed in on it is signed out. */
export function DeviceList({ devices }: { devices: PosDeviceRow[] }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!devices.length) return <p className="text-pos-ink-2">No device is linked yet.</p>;
  return (
    <>
      <ul className="grid gap-2">
        {devices.map(device => (
          <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pos-line p-3">
            <span className="min-w-0">
              <span className="block font-semibold text-pos-ink">
                {device.name ?? "Unnamed device"} <span className="font-normal text-pos-muted">· {device.till.name}</span>
              </span>
              <span className="block text-sm text-pos-muted">
                {device.revoked_at ? `Unlinked ${when(device.revoked_at)}` : `Last used ${when(device.last_seen_at)} · linked by ${device.linked_by}`}
              </span>
            </span>
            {!device.revoked_at ? (
              <button
                type="button"
                className={`${quiet} text-pos-error`}
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: `Unlink ${device.name ?? "this device"}?`, body: <p>It sells nothing more, and whoever is signed in on it is signed out at once.</p>, action: "Unlink", tone: "danger" }))) return;
                  start(async () => {
                    const result = await unlinkDevice(device.id);
                    if (!result.ok) setMessage(result.message);
                    else router.refresh();
                  });
                }}
              >
                Unlink<span className="sr-only"> {device.name ?? "device"}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? (
        <p role="alert" className="text-sm font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
