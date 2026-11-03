"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, MessageSquareText, Send, Wand2 } from "lucide-react";
import { Badge, Button, Dialog, errorMessage, Field, Input, Notice, Select, Skeleton, Textarea } from "@bitocard/admin-ui";
import { useAdmin } from "@bitocard/admin-ui/shell";
import { type MarketingProspect, type MarketingSmsChannel, type MarketingSmsProvider, type MarketingSmsSent, useMarketingSmsSettingsQuery, useSendMarketingSmsMutation } from "@bitocard/api-client/admin";
import { udozoOrigin } from "@/components/theme";
import { dialled } from "./labels";
import { plainCharacters, smsParts, smsTemplatesFor } from "./sms";
import { fillTemplate } from "./templates";

const senderPattern = /^(?:[A-Za-z0-9][A-Za-z0-9 ]{1,9}[A-Za-z0-9]|\+?\d{3,15})$/;

/**
 * Texts a seller in Marketing through Africa's Talking or Termii: the provider (the market's own first), which of their
 * numbers, a ready message for their stage or one of the admin's own, the sender ID and, for Termii, its route. A sheet
 * pulled up from the bottom on phones. Mount it to open it; it closes through `onClose`.
 */
export function SmsDialog({ prospect, phone, text: given, onClose }: { prospect: MarketingProspect; phone?: string; text?: string; onClose: () => void }) {
  const id = useId();
  const admin = useAdmin();
  const settings = useMarketingSmsSettingsQuery(prospect.country);
  const [send, sending] = useSendMarketingSmsMutation();
  const templates = smsTemplatesFor(prospect.stage);
  const fill = (template: string) => fillTemplate(template, prospect, { name: admin?.name ?? "" }, udozoOrigin());
  const [template, setTemplate] = useState(given ? "" : templates[0]!.key);
  const [text, setText] = useState(() => given ?? fill(templates[0]!.text));
  const [chosen, setChosen] = useState<MarketingSmsProvider | null>(null);
  const [to, setTo] = useState<string[]>(() => [phone && prospect.phones.includes(phone) ? phone : prospect.phones[0]].filter((item): item is string => Boolean(item)));
  const [sender, setSender] = useState("");
  const [channel, setChannel] = useState<MarketingSmsChannel>("generic");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MarketingSmsSent["sms"] | null>(null);

  const data = settings.data;
  const provider = chosen ?? data?.default_provider ?? "africas_talking";
  const current = data?.providers.find(item => item.provider === provider);
  const max = data?.max_length ?? 640;
  const parts = smsParts(text);
  const fixable = parts.encoding === "unicode" && smsParts(plainCharacters(text)).encoding === "gsm";
  const blocked = Boolean(current && !current.configured && !data?.holds_without_keys);
  const senderValid = !sender.trim() || senderPattern.test(sender.trim());
  const ready = !prospect.do_not_contact && to.length > 0 && text.trim().length > 0 && text.length <= max && senderValid && !blocked && Boolean(data);

  const pick = (key: string) => {
    setTemplate(key);
    const item = templates.find(entry => entry.key === key);
    if (item) setText(fill(item.text));
  };
  const toggle = (number: string, on: boolean) => setTo(list => (on ? [...list, number] : list.filter(item => item !== number)));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      const answer = await send({ id: prospect.id, provider, text: text.trim(), to, ...(sender.trim() ? { sender_id: sender.trim() } : {}), ...(provider === "termii" ? { channel } : {}), ...(template ? { template } : {}) }).unwrap();
      setDone(answer.sms);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };

  const form = `${id}-form`;
  return (
    <Dialog
      open
      onClose={onClose}
      size="sheet"
      title={done ? "SMS sent" : `Text ${prospect.name}`}
      description={done ? undefined : "It is logged on their timeline. A message carrying their invite link counts as their invitation."}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={form} icon={<Send className="size-4" />} loading={sending.isLoading} disabled={!ready}>
              Send SMS
            </Button>
          </>
        )
      }
    >
      {done ? (
        <SentPanel sms={done} name={data?.providers.find(item => item.provider === done.provider)?.name ?? done.provider} />
      ) : prospect.do_not_contact ? (
        <Notice tone="red">They asked not to be contacted again, so no SMS can go to them.</Notice>
      ) : !prospect.phones.length ? (
        <Notice tone="amber">They have no mobile number yet. Add one on their page first.</Notice>
      ) : (
        <form id={form} onSubmit={submit} className="grid gap-5">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">Send through</legend>
            {data ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {data.providers.map(item => (
                  <label key={item.provider} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${item.provider === provider ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-line hover:border-brand-300"}`}>
                    <input type="radio" name={`${id}-provider`} value={item.provider} checked={item.provider === provider} onChange={() => setChosen(item.provider)} className="mt-1 accent-brand-500" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                        {item.name}
                        {item.provider === data.market_provider ? <Badge tone="blue" dot={false}>Market&apos;s</Badge> : null}
                        {item.sandbox ? <Badge tone="amber" dot={false}>Sandbox</Badge> : null}
                      </span>
                      <span className="block text-xs text-muted">{item.configured ? `Sender: ${item.sender_id ?? "shared"}` : "Not set up"}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <Skeleton className="mt-2 h-16 w-full" />
            )}
            {current && !current.configured ? (
              <div className="mt-2">
                <Notice tone={data?.holds_without_keys ? "amber" : "red"}>
                  {data?.holds_without_keys ? `${current.name} has no keys here, so the message is held for testing, not sent.` : `${current.name} is not set up. Add its keys in Settings > Integrations, or choose the other.`}
                </Notice>
              </div>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">To</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {prospect.phones.map(number => {
                const on = to.includes(number);
                return (
                  <label key={number} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink hover:border-brand-300"}`}>
                    <input type="checkbox" checked={on} onChange={event => toggle(number, event.target.checked)} className="accent-brand-500" />
                    {dialled(number)}
                  </label>
                );
              })}
            </div>
            {!to.length ? <p className="mt-1 text-xs text-red-600">Choose at least one number.</p> : null}
          </fieldset>

          <Field label="Message" htmlFor={`${id}-template`}>
            <Select id={`${id}-template`} value={template} onChange={event => pick(event.target.value)}>
              <option value="">My own message</option>
              {templates.map(item => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Field label="Text" htmlFor={`${id}-text`}>
              <Textarea id={`${id}-text`} rows={5} value={text} onChange={event => (setText(event.target.value), setTemplate(""))} aria-describedby={`${id}-count`} />
            </Field>
            <div id={`${id}-count`} className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite">
              <span className={text.length > max ? "font-semibold text-red-600" : "text-muted"}>
                {text.length} / {max} characters · {parts.parts} SMS {parts.parts === 1 ? "part" : "parts"}
                {parts.encoding === "unicode" ? " (Unicode)" : ""}
                {parts.parts ? ` · ${parts.left} left in this part` : ""}
              </span>
              {fixable ? (
                <button type="button" onClick={() => setText(plainCharacters(text))} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                  <Wand2 className="size-3.5" aria-hidden /> Use plain characters
                </button>
              ) : null}
            </div>
            {!text.includes(prospect.invite_code) && (prospect.stage === "reach_out" || prospect.stage === "invitation") ? (
              <p className="mt-1 text-xs text-muted">Add their invite link to count it as their invitation and track the sign-up.</p>
            ) : null}
          </div>

          <div className={`grid gap-3 ${provider === "termii" ? "sm:grid-cols-2" : ""}`}>
            <Field label="Sender ID (optional)" htmlFor={`${id}-sender`} hint={senderValid ? `Must be registered with ${current?.name ?? "the provider"}. Empty uses ${current?.sender_id ?? "its shared one"}.` : "3 to 11 letters and digits, or a short code."}>
              <Input id={`${id}-sender`} maxLength={15} value={sender} onChange={event => setSender(event.target.value)} placeholder={current?.sender_id ?? "Shared"} aria-invalid={!senderValid} />
            </Field>
            {provider === "termii" ? (
              <Field label="Route" htmlFor={`${id}-channel`} hint={channel === "generic" ? "Not delivered to numbers on Nigeria's do-not-disturb list." : "Reaches do-not-disturb numbers; costs more."}>
                <Select id={`${id}-channel`} value={channel} onChange={event => setChannel(event.target.value as MarketingSmsChannel)}>
                  <option value="generic">Promotional (generic)</option>
                  <option value="dnd">Transactional (DND)</option>
                </Select>
              </Field>
            ) : null}
          </div>
          {error ? <Notice tone="red">{error}</Notice> : null}
        </form>
      )}
    </Dialog>
  );
}

function SentPanel({ sms, name }: { sms: MarketingSmsSent["sms"]; name: string }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 className={`size-6 shrink-0 ${sms.held ? "text-amber-500" : "text-emerald-600"}`} aria-hidden />
        <p className="text-sm text-ink">
          {sms.held ? `Held, not sent: ${name} has no keys here.` : `Sent through ${name} to ${sms.sent.map(item => dialled(item.to)).join(" and ")}.`} It is on their timeline.
        </p>
      </div>
      {sms.failed.length ? (
        <Notice tone="amber">
          Not sent to {sms.failed.map(item => dialled(item.to)).join(" and ")}: {sms.failed[0]!.reason}
        </Notice>
      ) : null}
    </div>
  );
}

/** The "Send SMS" button for a seller, opening the dialog. */
export function SendSmsButton({ prospect, size = "md", variant = "primary", label = "Send SMS" }: { prospect: MarketingProspect; size?: "sm" | "md"; variant?: "primary" | "secondary" | "ghost"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={<MessageSquareText className="size-4" />} disabled={prospect.do_not_contact || !prospect.phones.length} title={prospect.do_not_contact ? "They asked not to be contacted" : !prospect.phones.length ? "No mobile number" : undefined} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <SmsDialog prospect={prospect} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
