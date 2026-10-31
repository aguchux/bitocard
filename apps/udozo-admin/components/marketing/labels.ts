import type { Tone } from "@bitocard/admin-ui";
import { formatInternational } from "@bitocard/ui/phone";
import type { MarketingChannel, MarketingOutcome, MarketingStage, MarketingStatus } from "@bitocard/api-client/admin";

/** Marketing's five stages, in order, with what each one is for. */
export const stageLabels: Record<MarketingStage, { title: string; text: string }> = {
  reach_out: { title: "Reach out", text: "First contact on WhatsApp (or Jiji chat). Open a conversation, not a hard sell." },
  invitation: { title: "Invitation", text: "Send their invite link: Safe pay, buyers near them, their own store." },
  onboarding: { title: "Onboarding", text: "Help them sign up, confirm their email and mobile, and post a first listing." },
  follow_up: { title: "Follow-up", text: "Check in on day 1, 3 and 7: posted, stuck or no reply, and the next touch." },
  feedback: { title: "Feedback", text: "What worked, what blocked them, would they recommend Udozo." },
};

export const statusLabels: Record<MarketingStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "grey" },
  in_progress: { label: "In progress", tone: "blue" },
  waiting: { label: "Waiting on seller", tone: "amber" },
  done: { label: "Done", tone: "green" },
  skipped: { label: "Skipped", tone: "grey" },
  failed: { label: "Failed", tone: "red" },
};

export const outcomeLabels: Record<MarketingOutcome, { label: string; tone: Tone }> = {
  signed_up: { label: "Signed up", tone: "blue" },
  first_post: { label: "First post", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  no_response: { label: "No response", tone: "grey" },
};

export const channelLabels: Record<MarketingChannel, string> = {
  whatsapp: "WhatsApp",
  jiji_chat: "Jiji chat",
  call: "Phone call",
  sms: "SMS",
  email: "Email",
  in_person: "In person",
  other: "Other",
};

/** What each logged step reads as in the timeline. */
export const activityLabels: Record<string, string> = {
  message: "Message",
  call: "Call",
  invite: "Invite",
  follow_up: "Follow-up",
  note: "Note",
  stage: "Stage",
  assigned: "Assigned",
  scheduled: "Next action",
  feedback: "Feedback",
  imported: "Added",
  opened: "Opened invite",
  signed_up: "Signed up",
  first_post: "First listing",
  linked: "Account",
  outcome: "Outcome",
};

export const stageOrder: MarketingStage[] = ["reach_out", "invitation", "onboarding", "follow_up", "feedback"];

/** The stage after this one (feedback is the last). */
export const nextStage = (stage: MarketingStage): MarketingStage | null => stageOrder[stageOrder.indexOf(stage) + 1] ?? null;

/** A phone with its country's dialling code, as WhatsApp and a call use it (`+233 24 123 4567`). */
export const dialled = formatInternational;
