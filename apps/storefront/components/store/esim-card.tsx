"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { esimDetailLabels, esimInstall } from "@/lib/esim";

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
        <p className="font-mono text-sm font-bold break-all">{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // Shown on screen to copy by hand.
          }
        }}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:border-slate-300"
      >
        {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const date = (value: string) => {
  const parsed = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(parsed);
};

/**
 * One eSIM ready to install: its QR code (drawn here from the activation string, never fetched from anywhere), one-tap
 * install on iPhone and Android, and the SM-DP+ address and activation code to enter by hand, with its ICCID and plan.
 */
export function EsimCard({ code, iccid, details, title }: { code: string; iccid: string | null; details: Record<string, string>; title: string }) {
  const install = esimInstall(code);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(install?.lpa ?? code, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then(text => live && setSvg(text))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [code, install?.lpa]);

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-[11rem_1fr]">
        <div className="mx-auto w-44 sm:mx-0">
          {svg ? (
            <div role="img" aria-label="QR code to install this eSIM" className="aspect-square rounded-xl bg-white p-1 ring-1 ring-slate-200 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="aspect-square animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
          )}
          <p className="mt-2 text-center text-xs text-slate-500">Scan from another screen: Settings &gt; Mobile data &gt; Add eSIM</p>
        </div>
        <div className="min-w-0 space-y-3">
          {install ? (
            <div className="flex flex-wrap gap-2">
              <a href={install.apple} rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
                <Smartphone className="size-4" aria-hidden="true" /> Install on iPhone
              </a>
              <a href={install.android} rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold hover:border-slate-300">
                <Smartphone className="size-4" aria-hidden="true" /> Install on Android
              </a>
            </div>
          ) : null}
          {install ? (
            <>
              <Copyable label="SM-DP+ address" value={install.smdp} />
              <Copyable label="Activation code" value={install.activationCode} />
            </>
          ) : (
            <Copyable label="Activation code" value={code} />
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {iccid ? (
              <div className="col-span-2">
                <dt className="inline text-slate-500">ICCID: </dt>
                <dd className="inline font-mono">{iccid}</dd>
              </div>
            ) : null}
            {Object.entries(esimDetailLabels)
              .filter(([key]) => details[key])
              .map(([key, label]) => (
                <div key={key}>
                  <dt className="inline text-slate-500">{label}: </dt>
                  <dd className="inline font-semibold">{key === "install_by" ? date(details[key]) : details[key]}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">An eSIM can be installed only once: keep this private, and install it on the phone you will travel with.</p>
    </div>
  );
}
