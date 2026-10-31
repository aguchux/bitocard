"use client";

import { useParams } from "next/navigation";
import { useId, useState } from "react";
import { CheckCircle2, Circle, Copy, ExternalLink, Mail, MessageCircle, Phone } from "lucide-react";
import { Badge, Button, Card, CardHeader, errorMessage, Field, formatDate, Input, Notice, PageHeader, QueryView, Select, Skeleton, Textarea, Toggle } from "@bitocard/admin-ui";
import { AppLink, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type MarketingChannel,
  type MarketingLoggedKind,
  type MarketingProspectDetail,
  type MarketingStage,
  type MarketingStatus,
  marketingChannels,
  useEmailMarketingInviteMutation,
  useLinkMarketingAccountMutation,
  useLogMarketingActivityMutation,
  useMarketingProspectQuery,
  useMarketingSummaryQuery,
  useSaveMarketingFeedbackMutation,
  useSetMarketingStageMutation,
  useUpdateMarketingProspectMutation,
} from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { udozoOrigin } from "@/components/theme";
import { activityLabels, channelLabels, dialled, nextStage, outcomeLabels, stageLabels, stageOrder, statusLabels } from "@/components/marketing/labels";
import { MarketSelect, useMarketName } from "@/components/marketing/market";
import { fillTemplate, templatesFor, whatsappMessage } from "@/components/marketing/templates";

/** `datetime-local` value for a date, in the browser's own time. */
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

/** One seller in Marketing: reach them, invite them, follow their onboarding, follow up and keep their feedback. */
export default function MarketingProspectPage() {
  const { id } = useParams<{ id: string }>();
  const prospect = useMarketingProspectQuery(id);
  return (
    <UdozoShell section="marketplace" current="/classifieds/marketing" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Marketing", href: "/classifieds/marketing" }, { label: prospect.data?.name ?? "Seller" }]}>
      <QueryView query={prospect} loading={<Skeleton className="h-96 w-full" />}>
        {data => <ProspectView prospect={data} />}
      </QueryView>
    </UdozoShell>
  );
}

function ProspectView({ prospect }: { prospect: MarketingProspectDetail }) {
  const market = useMarketName(prospect.country);
  return (
    <>
      <PageHeader
        title={prospect.name}
        description={[prospect.store_name, prospect.location, market, `From ${prospect.source}`].filter(Boolean).join(" · ")}
        actions={
          <span className="flex flex-wrap gap-1.5">
            <Badge tone="pink" dot={false}>
              {stageLabels[prospect.stage].title}
            </Badge>
            <Badge tone={statusLabels[prospect.stage_status].tone}>{statusLabels[prospect.stage_status].label}</Badge>
            {prospect.outcome ? <Badge tone={outcomeLabels[prospect.outcome].tone}>{outcomeLabels[prospect.outcome].label}</Badge> : null}
            {prospect.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
          </span>
        }
      />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-6">
          {/* Remounted when the saved stage changes, so the form starts from it. */}
          <StageCard key={`${prospect.stage}-${prospect.stage_status}`} prospect={prospect} />
          <MessageCard prospect={prospect} />
          <OnboardingCard prospect={prospect} />
          <FeedbackCard prospect={prospect} />
          <Timeline prospect={prospect} />
        </div>
        <div className="grid min-w-0 gap-6">
          <ContactCard prospect={prospect} />
          <InviteCard prospect={prospect} />
          <NextActionCard key={`${prospect.next_action ?? ""}-${prospect.next_action_at ?? ""}`} prospect={prospect} />
        </div>
      </div>
    </>
  );
}

function StageCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const [setStage, saving] = useSetMarketingStageMutation();
  const [status, setStatus] = useState<MarketingStatus>(prospect.stage_status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const next = nextStage(prospect.stage);
  const save = async (stage: MarketingStage, value: MarketingStatus) => {
    setError(null);
    try {
      await setStage({ id: prospect.id, stage, status: value, reason: reason.trim() || undefined }).unwrap();
      setReason("");
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  const needsReason = status === "skipped" || status === "failed";
  return (
    <Card>
      <CardHeader title="Stage" description={stageLabels[prospect.stage].text} />
      <ol className="flex gap-1.5 overflow-x-auto px-5 pt-4 sm:px-6" aria-label="Stages">
        {stageOrder.map(stage => {
          const index = stageOrder.indexOf(stage);
          const current = stageOrder.indexOf(prospect.stage);
          return (
            <li key={stage} aria-current={stage === prospect.stage ? "step" : undefined} className={`min-w-28 flex-1 rounded-lg px-2.5 py-2 text-xs font-semibold ${stage === prospect.stage ? "bg-brand-500 text-white" : index < current ? "bg-brand-50 text-brand-700" : "bg-canvas text-muted"}`}>
              {index + 1}. {stageLabels[stage].title}
            </li>
          );
        })}
      </ol>
      <div className="grid gap-3 p-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:px-6">
        <Field label="Status" htmlFor={`${id}-status`}>
          <Select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value as MarketingStatus)}>
            {Object.entries(statusLabels).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={needsReason ? "Why" : "Note (optional)"} htmlFor={`${id}-reason`}>
          <Input id={`${id}-reason`} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder={needsReason ? "No WhatsApp on this number" : ""} />
        </Field>
        {error ? (
          <div className="sm:col-span-2">
            <Notice tone="red">{error}</Notice>
          </div>
        ) : null}
        {prospect.status_reason ? <p className="text-xs text-muted sm:col-span-2">Last reason: {prospect.status_reason}</p> : null}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button size="sm" variant="secondary" loading={saving.isLoading} disabled={status === prospect.stage_status || (needsReason && reason.trim().length < 3)} onClick={() => save(prospect.stage, status)}>
            Save status
          </Button>
          {next ? (
            <Button size="sm" loading={saving.isLoading} onClick={() => save(next, "in_progress")}>
              Move to {stageLabels[next].title}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function MessageCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const admin = useAdmin();
  const templates = templatesFor(prospect.stage);
  const [template, setTemplate] = useState(templates[0]!.key);
  const chosen = templates.find(item => item.key === template) ?? templates[0]!;
  const [text, setText] = useState(() => fillTemplate(chosen.text, prospect, { name: admin?.name ?? "" }, udozoOrigin()));
  const [channel, setChannel] = useState<MarketingChannel>("whatsapp");
  const [kind, setKind] = useState<MarketingLoggedKind>(prospect.stage === "follow_up" ? "follow_up" : prospect.stage === "invitation" ? "invite" : "message");
  const [replied, setReplied] = useState<"" | "yes" | "no">("");
  const [log, logging] = useLogMarketingActivityMutation();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const phone = prospect.phones[0];
  const pick = (key: string) => {
    setTemplate(key);
    const item = templates.find(entry => entry.key === key)!;
    setText(fillTemplate(item.text, prospect, { name: admin?.name ?? "" }, udozoOrigin()));
    if (item.key === "invitation") setKind("invite");
    else if (item.stage === "follow_up") setKind("follow_up");
  };
  const record = async () => {
    setError(null);
    try {
      await log({ id: prospect.id, kind, channel, template: template, body: text.trim() || undefined, ...(replied ? { replied: replied === "yes" } : {}) }).unwrap();
      setDone("Logged.");
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  const openWhatsapp = () => {
    if (!phone) return;
    window.open(whatsappMessage(phone, text), "_blank", "noopener");
    void record();
  };
  return (
    <Card>
      <CardHeader title="Send and log" description="Pick a message, edit it, then open it in WhatsApp (it is logged) or log a call, Jiji chat or note." />
      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
        <Field label="Message" htmlFor={`${id}-template`}>
          <Select id={`${id}-template`} value={template} onChange={event => pick(event.target.value)}>
            {templates.map(item => (
              <option key={item.key} value={item.key}>
                {stageLabels[item.stage].title}: {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Channel" htmlFor={`${id}-channel`}>
          <Select id={`${id}-channel`} value={channel} onChange={event => setChannel(event.target.value as MarketingChannel)}>
            {marketingChannels.map(value => (
              <option key={value} value={value}>
                {channelLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What it was" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value as MarketingLoggedKind)}>
            <option value="message">Message</option>
            <option value="invite">Invite</option>
            <option value="follow_up">Follow-up</option>
            <option value="call">Call</option>
            <option value="note">Note (no contact)</option>
          </Select>
        </Field>
        <div className="sm:col-span-3">
          <Field label="Text" htmlFor={`${id}-text`}>
            <Textarea id={`${id}-text`} rows={6} maxLength={2000} value={text} onChange={event => (setText(event.target.value), setDone(null))} />
          </Field>
        </div>
        <Field label="Did they reply?" htmlFor={`${id}-replied`}>
          <Select id={`${id}-replied`} value={replied} onChange={event => setReplied(event.target.value as typeof replied)}>
            <option value="">Not yet known</option>
            <option value="yes">Yes</option>
            <option value="no">No reply</option>
          </Select>
        </Field>
        {error ? (
          <div className="sm:col-span-3">
            <Notice tone="red">{error}</Notice>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          {phone && channel === "whatsapp" ? (
            <Button icon={<MessageCircle className="size-4" />} onClick={openWhatsapp} loading={logging.isLoading} disabled={prospect.do_not_contact}>
              Open in WhatsApp
            </Button>
          ) : null}
          <Button variant="secondary" onClick={record} loading={logging.isLoading}>
            Log it
          </Button>
          {done ? <span className="text-sm text-emerald-700">{done}</span> : null}
        </div>
      </div>
    </Card>
  );
}

function InviteCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const [email, setEmail] = useState(prospect.email ?? "");
  const [message, setMessage] = useState("");
  const [send, sending] = useEmailMarketingInviteMutation();
  const [state, setState] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    setState(null);
    try {
      const sent = await send({ id: prospect.id, email: email.trim() || undefined, message: message.trim() || undefined }).unwrap();
      setState(sent.email_sent === "outbox" ? { tone: "amber", text: "Held: no email provider is set up yet (Settings > Integrations)." } : { tone: "green", text: `Invitation sent to ${email.trim() || prospect.email}.` });
      setMessage("");
    } catch (problem) {
      setState({ tone: "red", text: errorMessage(problem) });
    }
  };
  return (
    <Card>
      <CardHeader title="Their invite link" description="Opening it is counted, and signing up with it links their account here." />
      <div className="grid gap-3 p-5 sm:px-6">
        <div className="flex items-center gap-2">
          <Input readOnly value={prospect.invite_link} aria-label="Invite link" className="font-mono text-xs" />
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="size-4" />}
            onClick={() => {
              void navigator.clipboard?.writeText(prospect.invite_link);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted">
          {prospect.clicked_at ? `Opened ${prospect.clicks} time${prospect.clicks === 1 ? "" : "s"}, first ${formatDate(prospect.clicked_at)}.` : "Not opened yet."}
          {prospect.invite_emailed_at ? ` Last emailed ${formatDate(prospect.invite_emailed_at)}.` : ""}
        </p>
        <Field label="Email the invitation" htmlFor={`${id}-email`}>
          <Input id={`${id}-email`} type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="seller@example.com" />
        </Field>
        <Field label="Your message (optional)" htmlFor={`${id}-message`} hint="Empty sends Udozo's standard invitation.">
          <Textarea id={`${id}-message`} rows={3} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} />
        </Field>
        {state ? <Notice tone={state.tone}>{state.text}</Notice> : null}
        <Button icon={<Mail className="size-4" />} onClick={go} loading={sending.isLoading} disabled={prospect.do_not_contact || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
          Email the invitation
        </Button>
      </div>
    </Card>
  );
}

function OnboardingCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const [link, linking] = useLinkMarketingAccountMutation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const account = prospect.account;
  const go = async (unlink = false) => {
    setError(null);
    try {
      const text = value.trim();
      await link(unlink ? { id: prospect.id, unlink: true } : { id: prospect.id, ...(text.includes("@") ? { email: text } : { phone: text }) }).unwrap();
      setValue("");
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  return (
    <Card>
      <CardHeader
        title="Onboarding"
        description={account ? `Their Udozo account: ${account.name} (${account.email}). ${account.listings.posted} listings posted, ${account.listings.live} live.` : "Not signed up yet. Signing up with their invite link, email or phone links their account here."}
        actions={account ? (
          <AppLink href={`/customers/${account.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
            Open the account
          </AppLink>
        ) : null}
      />
      <div className="grid gap-3 p-5 sm:px-6">
        {account ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {account.checks.map(check => (
              <li key={check.key} className="flex items-center gap-2 text-sm">
                {check.done ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <Circle className="size-4 text-muted" aria-hidden />}
                <span className={check.done ? "text-ink" : "text-muted"}>
                  {check.label}
                  {check.at ? <span className="block text-xs text-muted">{formatDate(check.at)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Field label="They signed up another way? Link their account" htmlFor={`${id}-link`}>
                <Input id={`${id}-link`} value={value} onChange={event => setValue(event.target.value)} placeholder="Their account's email or mobile" />
              </Field>
            </div>
            <Button variant="secondary" onClick={() => go()} loading={linking.isLoading} disabled={value.trim().length < 6}>
              Link
            </Button>
          </div>
        )}
        {error ? <Notice tone="red">{error}</Notice> : null}
        {account ? (
          <Button size="sm" variant="ghost" onClick={() => go(true)} loading={linking.isLoading} className="justify-self-start">
            Not their account? Unlink
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function FeedbackCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const [save, saving] = useSaveMarketingFeedbackMutation();
  const [rating, setRating] = useState(prospect.feedback.rating ? String(prospect.feedback.rating) : "");
  const [recommend, setRecommend] = useState(prospect.feedback.would_recommend === null ? "" : prospect.feedback.would_recommend ? "yes" : "no");
  const [notes, setNotes] = useState(prospect.feedback.notes ?? "");
  const [reason, setReason] = useState(prospect.status_reason ?? "");
  const [advocacy, setAdvocacy] = useState(prospect.feedback.advocacy ?? "");
  const [state, setState] = useState<string | null>(null);
  const go = async () => {
    setState(null);
    try {
      await save({ id: prospect.id, rating: rating ? Number(rating) : null, would_recommend: recommend ? recommend === "yes" : null, notes: notes.trim() || null, reason: reason.trim() || null, advocacy: (advocacy || null) as "advocate" | "nurture" | null }).unwrap();
      setState("Saved.");
    } catch (problem) {
      setState(errorMessage(problem));
    }
  };
  return (
    <Card>
      <CardHeader title="Feedback" description="What worked, what blocked them, and whether they would recommend Udozo." />
      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
        <Field label="Rating" htmlFor={`${id}-rating`}>
          <Select id={`${id}-rating`} value={rating} onChange={event => setRating(event.target.value)}>
            <option value="">Not given</option>
            {[5, 4, 3, 2, 1].map(value => (
              <option key={value} value={value}>
                {value} of 5
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Would recommend Udozo" htmlFor={`${id}-recommend`}>
          <Select id={`${id}-recommend`} value={recommend} onChange={event => setRecommend(event.target.value)}>
            <option value="">Not asked</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="Next" htmlFor={`${id}-advocacy`}>
          <Select id={`${id}-advocacy`} value={advocacy} onChange={event => setAdvocacy(event.target.value)}>
            <option value="">Not decided</option>
            <option value="advocate">Ready to advocate</option>
            <option value="nurture">Keep nurturing</option>
          </Select>
        </Field>
        <div className="sm:col-span-3">
          <Field label="What they said" htmlFor={`${id}-notes`}>
            <Textarea id={`${id}-notes`} rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="Win or loss reason" htmlFor={`${id}-reason`}>
            <Input id={`${id}-reason`} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Posted 12 phones the first week" />
          </Field>
        </div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button variant="secondary" onClick={go} loading={saving.isLoading}>
            Save feedback
          </Button>
          {state ? <span className="text-sm text-muted">{state}</span> : null}
        </div>
      </div>
    </Card>
  );
}

function ContactCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const [update, updating] = useUpdateMarketingProspectMutation();
  const [marketError, setMarketError] = useState<string | null>(null);
  const move = async (country: string) => {
    setMarketError(null);
    try {
      await update({ id: prospect.id, country }).unwrap();
    } catch (problem) {
      setMarketError(errorMessage(problem));
    }
  };
  return (
    <Card>
      <CardHeader title="Contact" description={prospect.source_notes ?? undefined} />
      <div className="grid gap-3 p-5 sm:px-6">
        <Field label="Country" htmlFor={`${id}-country`} hint="The market they are filed under. Saved numbers keep the dialling code they have.">
          <MarketSelect id={`${id}-country`} value={prospect.country} onChange={value => void move(value)} disabled={updating.isLoading} />
        </Field>
        {marketError ? <Notice tone="red">{marketError}</Notice> : null}
        {prospect.phones.map(phone => (
          <div key={phone} className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-ink">{dialled(phone)}</span>
            <span className="flex gap-2">
              <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold hover:border-brand-400">
                <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
              </a>
              <a href={`tel:${phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold hover:border-brand-400">
                <Phone className="size-3.5" aria-hidden /> Call
              </a>
            </span>
          </div>
        ))}
        {prospect.email ? (
          <a href={`mailto:${prospect.email}`} className="text-sm text-brand-600 hover:underline">
            {prospect.email}
          </a>
        ) : null}
        {prospect.categories.length ? <p className="text-sm text-muted">Sells {prospect.categories.join(", ")}</p> : null}
        {prospect.adverts.length ? (
          <div>
            <p className="text-xs font-semibold text-muted">Their adverts ({prospect.adverts.length}), where you can message them on Jiji</p>
            <ul className="mt-1 grid max-h-56 gap-1 overflow-y-auto">
              {prospect.adverts.map(advert => (
                <li key={advert.url}>
                  <a href={advert.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1.5 text-sm hover:underline">
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate">{advert.title && !/^-?\d+%$|^Locked$|^Replica$/i.test(advert.title) ? advert.title : advert.url.split("/").at(-1)}</span>
                      <span className="block text-xs text-muted">{[advert.price, advert.category].filter(Boolean).join(" · ")}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Toggle label="Asked not to be contacted again" checked={prospect.do_not_contact} disabled={updating.isLoading} onChange={checked => void update({ id: prospect.id, do_not_contact: checked })} />
      </div>
    </Card>
  );
}

function NextActionCard({ prospect }: { prospect: MarketingProspectDetail }) {
  const id = useId();
  const summary = useMarketingSummaryQuery();
  const [update, updating] = useUpdateMarketingProspectMutation();
  const [what, setWhat] = useState(prospect.next_action ?? "");
  const [when, setWhen] = useState(localInput(prospect.next_action_at));
  const [notes, setNotes] = useState(prospect.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof update>[0]) => {
    setError(null);
    try {
      await update(patch).unwrap();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  return (
    <Card>
      <CardHeader title="Owner and next action" />
      <div className="grid gap-3 p-5 sm:px-6">
        <Field label="Owner" htmlFor={`${id}-owner`}>
          <Select id={`${id}-owner`} value={prospect.owner?.id ?? ""} disabled={updating.isLoading} onChange={event => void save({ id: prospect.id, owner_id: event.target.value || null })}>
            <option value="">Unassigned</option>
            {(summary.data?.owners ?? []).map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next action" htmlFor={`${id}-what`}>
          <Input id={`${id}-what`} maxLength={200} value={what} onChange={event => setWhat(event.target.value)} placeholder="Day 3 follow-up" />
        </Field>
        <Field label="When" htmlFor={`${id}-when`}>
          <Input id={`${id}-when`} type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => save({ id: prospect.id, next_action: what.trim() || null, next_action_at: when ? new Date(when).toISOString() : null })} loading={updating.isLoading}>
            Save
          </Button>
          {[1, 3, 7].map(days => (
            <Button key={days} size="sm" variant="ghost" onClick={() => save({ id: prospect.id, next_action: what.trim() || `Day ${days} follow-up`, next_action_at: inDays(days) })}>
              In {days} day{days === 1 ? "" : "s"}
            </Button>
          ))}
        </div>
        <Field label="Notes" htmlFor={`${id}-notes`}>
          <Textarea id={`${id}-notes`} rows={3} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} onBlur={() => notes !== (prospect.notes ?? "") && void save({ id: prospect.id, notes: notes.trim() || null })} />
        </Field>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Card>
  );
}

function Timeline({ prospect }: { prospect: MarketingProspectDetail }) {
  return (
    <Card>
      <CardHeader title="Everything so far" description={`${prospect.follow_ups} follow-up${prospect.follow_ups === 1 ? "" : "s"}${prospect.last_contact_at ? `, last contact ${formatDate(prospect.last_contact_at)}` : ""}.`} />
      <ol className="grid gap-3 p-5 sm:px-6">
        {prospect.activities.map(item => (
          <li key={item.id} className="border-l-2 border-line pl-3">
            <p className="text-xs text-muted">
              <span className="font-semibold text-ink">{activityLabels[item.kind] ?? item.kind}</span>
              {item.channel ? ` · ${channelLabels[item.channel]}` : ""}
              {item.stage ? ` · ${stageLabels[item.stage].title}${item.status ? `, ${statusLabels[item.status].label.toLowerCase()}` : ""}` : ""}
              {item.outcome ? ` · ${outcomeLabels[item.outcome].label}` : ""}
              {item.replied === true ? " · replied" : item.replied === false ? " · no reply" : ""} · {item.actor?.name ?? "Udozo"} · {formatDate(item.created_at)}
            </p>
            {item.body ? <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{item.body}</p> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
