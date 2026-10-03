"use client";

import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Badge, Button, cn, Dialog } from "@bitocard/admin-ui";
import { type Mode, type WebhookEndpoint, type WebhookEventType, webhookEventTypes } from "@bitocard/api-client/reseller";

/** Copies text to the clipboard and says so for a moment. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setFailed(false);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setFailed(true);
        }
      }}
    >
      {copied ? "Copied" : failed ? "Select and copy" : label}
    </Button>
  );
}

/**
 * Shows a secret once, straight after it was created. It lives only in the parent's state and is dropped when the
 * dialog closes: BitoCard cannot show it again.
 */
export function SecretDialog({ secret, title, description, onClose }: { secret: string | null; title: string; description: string; onClose: () => void }) {
  return (
    <Dialog
      open={Boolean(secret)}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <Button type="button" onClick={onClose}>
          I have stored it safely
        </Button>
      }
    >
      {secret ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">This is the only time you will see it.</span> Copy it into your server&apos;s secret store now. Never put it in a website, app or public code.
            </p>
          </div>
          <code className="block select-all break-all rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-sm text-ink">{secret}</code>
          <CopyButton value={secret} />
        </div>
      ) : null}
    </Dialog>
  );
}

/** Live or sandbox, worded the way the dashboard switch is. */
export function ModeBadge({ mode }: { mode: Mode }) {
  return mode === "live" ? <Badge tone="green">Live</Badge> : <Badge tone="amber">Sandbox</Badge>;
}

/** Why an endpoint is switched off. */
export function disabledReason(endpoint: WebhookEndpoint) {
  if (endpoint.status !== "disabled") return null;
  if (endpoint.disabled_reason === "failing") return "Turned off after 3 days of failed deliveries. Fix your endpoint, then turn it back on.";
  if (endpoint.disabled_reason === "by_reseller") return "Turned off by your team.";
  return "Turned off.";
}

/** "All events" or the chosen types. */
export function eventsSummary(events: WebhookEndpoint["events"]) {
  if (events.includes("*")) return "All events";
  return events.length === 1 ? events[0] : `${events.length} event types`;
}

/** Picks the event types an endpoint receives: everything (including types added later) or a list. */
export function EventPicker({ value, onChange, idPrefix }: { value: Array<WebhookEventType | "*">; onChange: (value: Array<WebhookEventType | "*">) => void; idPrefix: string }) {
  const all = value.includes("*");
  const chosen = new Set(value);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">Events to send</legend>
      <label htmlFor={`${idPrefix}-all`} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm">
        <input id={`${idPrefix}-all`} type="checkbox" className="size-4 accent-brand-500" checked={all} onChange={event => onChange(event.target.checked ? ["*"] : [])} />
        <span>
          <span className="font-semibold">All events</span> <span className="text-muted">(including types added later)</span>
        </span>
      </label>
      {!all ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {webhookEventTypes.map(type => (
            <label key={type} htmlFor={`${idPrefix}-${type}`} className={cn("flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-canvas")}>
              <input
                id={`${idPrefix}-${type}`}
                type="checkbox"
                className="size-4 shrink-0 accent-brand-500"
                checked={chosen.has(type)}
                onChange={event => onChange(event.target.checked ? [...value, type] : value.filter(item => item !== type))}
              />
              <span className="break-all font-mono text-xs">{type}</span>
            </label>
          ))}
        </div>
      ) : null}
      {!value.length ? <p className="text-xs text-red-700">Choose at least one event type.</p> : null}
    </fieldset>
  );
}

/** A short explanation of live and sandbox for webhooks and events. */
export function ModeExplainer({ mode, subject }: { mode: Mode; subject: string }) {
  return (
    <p className="text-sm text-muted">
      {mode === "test" ? (
        <>
          You are seeing <span className="font-semibold text-ink">sandbox</span> {subject}: they carry test events only. Switch to live at the top to see live ones.
        </>
      ) : (
        <>
          You are seeing <span className="font-semibold text-ink">live</span> {subject}. Sandbox ones are kept separately: use the switch at the top to see them.
        </>
      )}
    </p>
  );
}
