/**
 * Applying to run a Udozo Connect Centre (docs/UDOZO_CONNECT_PLAN.md, phase 2): the API's shapes and the words and
 * rules the pages share. Pure, so the browser's wizard and the server's pages use the same.
 */

export const applicationStatuses = ["draft", "submitted", "changes_requested", "visit_scheduled", "visited", "approved", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
export const photoKinds = ["shopfront", "counter", "storage", "other"] as const;
export type PhotoKind = (typeof photoKinds)[number];
export const requiredPhotoKinds: readonly PhotoKind[] = ["shopfront", "counter", "storage"];
export const requirementKeys = ["details", "photos", "state", "identity", "mobile", "agreement", "deposit"] as const;
export type RequirementKey = (typeof requirementKeys)[number];

export type Money = { amount: number; currency: string };
export type ConnectState = { id: string; name: string; slug: string; open: boolean };
export type Requirement = { key: RequirementKey; met: boolean; label: string };

export type ApplySettings = {
  object: "connect_apply_settings";
  country: string;
  open: boolean;
  deposit: Money | null;
  states: ConnectState[];
  agreement: { version: string; path: string; accepted: boolean };
  photos: { kinds: PhotoKind[]; required: PhotoKind[]; max: number };
  application_id: string | null;
};

export type Application = {
  object: "connect_application";
  id: string;
  number: string;
  status: ApplicationStatus;
  country: string;
  business_name: string | null;
  registration_number: string | null;
  state: { id: string; name: string } | null;
  area: { id: string; name: string } | null;
  address: string | null;
  landmark: string | null;
  hours: string | null;
  phone: string | null;
  capacity: number | null;
  person_name: string | null;
  person_role: string | null;
  photos: Array<{ id: string; url: string; kind: PhotoKind }>;
  deposit: { amount: number | null; currency: string; paid_at: string | null; returned_at: string | null };
  submitted_at: string | null;
  changes: { note: string; at: string | null } | null;
  visit: {
    at: string;
    note: string | null;
    visitor: { name: string; phone: string | null } | null;
    confirmed_at: string | null;
    reschedule_note: string | null;
    visited_at: string | null;
  } | null;
  decision: { at: string; reason: string | null } | null;
  withdrawn_at: string | null;
  centre: { id: string; number: string; status: string } | null;
  created_at: string;
  updated_at: string;
  /** Only on a single application (`GET /v1/connect/applications/:id` and its changes). */
  editable?: boolean;
  requirements?: Requirement[] | null;
};

/** A state with its areas, from the public `GET /v1/classifieds/areas`. */
export type AreaState = { id: string; name: string; areas: Array<{ id: string; name: string }> };

/** Still under way: the applicant can withdraw it. */
export const underWay = (status: ApplicationStatus) => ["draft", "submitted", "changes_requested", "visit_scheduled", "visited"].includes(status);
/** What the applicant can still change. */
export const isEditable = (status: ApplicationStatus) => status === "draft" || status === "changes_requested";

export const statusWords: Record<ApplicationStatus, string> = {
  draft: "Not sent yet",
  submitted: "Sent: Udozo is reviewing it",
  changes_requested: "Udozo asked for changes",
  visit_scheduled: "A visit is arranged",
  visited: "Visited: waiting for Udozo's decision",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};

export const photoWords: Record<PhotoKind, string> = {
  shopfront: "The shopfront",
  counter: "The counter",
  storage: "Where items are kept",
  other: "Anything else",
};

// ---- The wizard ----

export const steps = ["business", "office", "running", "photos", "send"] as const;
export type Step = (typeof steps)[number];
export const stepWords: Record<Step, string> = {
  business: "Your business",
  office: "The office",
  running: "Running it",
  photos: "Photos",
  send: "Check and send",
};

/** The fields each step saves, as the API names them. */
export const stepFields: Record<"business" | "office" | "running", readonly string[]> = {
  business: ["business_name", "registration_number"],
  office: ["area_id", "address", "landmark", "latitude", "longitude"],
  running: ["hours", "phone", "capacity", "person_name", "person_role"],
};

type Details = Pick<Application, "business_name" | "area" | "address" | "hours" | "phone" | "capacity" | "person_name">;

/** Whether a step still lacks details the application needs before it can be sent (the API's `details`). */
export function missingIn(step: Step, app: Details | null) {
  if (!app) return step !== "send";
  if (step === "business") return !app.business_name;
  if (step === "office") return !app.area || !app.address;
  if (step === "running") return !app.hours || !app.phone || !app.capacity || !app.person_name;
  return false;
}

/**
 * The step a refusal's `param` (a field, or a requirement's key) is put right on. `details` opens the first step still
 * missing something, so the applicant lands where the gap is.
 */
export function stepForParam(param: string | null | undefined, app?: Details | null): Step {
  if (!param) return "send";
  for (const [step, fields] of Object.entries(stepFields)) if (fields.includes(param)) return step as Step;
  if (param === "state") return "office";
  if (param === "photos" || param === "media_id" || param === "kind") return "photos";
  if (param === "details") return (["business", "office", "running"] as const).find(step => missingIn(step, app ?? null)) ?? "business";
  return "send";
}

/** The required photo kinds an application still lacks. */
export function photosMissing(app: Pick<Application, "photos">, required: readonly PhotoKind[] = requiredPhotoKinds) {
  const have = new Set(app.photos.map(photo => photo.kind));
  return required.filter(kind => !have.has(kind));
}

/** The step to open an application on: the first with something missing, else Check and send. */
export function firstStep(app: Application | null): Step {
  if (!app) return "business";
  const gap = (["business", "office", "running"] as const).find(step => missingIn(step, app));
  return gap ?? (photosMissing(app).length ? "photos" : "send");
}

/**
 * Where each requirement is put right: on udozo.com for the person's account (identity check, mobile, wallet, the
 * agreement's text), or in the wizard's own steps (`step`).
 */
export function requirementLink(key: RequirementKey, udozo: string, agreementPath = "/legal/connect-centres"): { href: string; label: string; step?: Step } {
  switch (key) {
    case "identity":
      return { href: `${udozo}/account/verification`, label: "Check your identity on udozo.com" };
    case "mobile":
      return { href: `${udozo}/account/profile#phone`, label: "Confirm your mobile on udozo.com" };
    case "deposit":
      return { href: `${udozo}/account/wallet`, label: "Top up your UdozoPay wallet" };
    case "agreement":
      return { href: `${udozo}${agreementPath}`, label: "Read the Connect Centre agreement" };
    case "details":
      return { href: "#business", label: "Add the missing details", step: "business" };
    case "photos":
      return { href: "#photos", label: "Add the photos", step: "photos" };
    case "state":
      return { href: "#office", label: "Choose an office in an open state", step: "office" };
  }
}

// ---- Words ----

/** Minor units as money. */
export function money(amount: number | null | undefined, currency: string) {
  if (amount === null || amount === undefined) return "Not set yet";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: amount % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

const zones: Record<string, string> = { NG: "Africa/Lagos", GH: "Africa/Accra", KE: "Africa/Nairobi" };

/** A date and time in the market's own time (UTC where it is not known). */
export function when(iso: string | null | undefined, country = "NG") {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zones[country] ?? "UTC" }).format(new Date(iso));
}

export type TimelineItem = { key: string; title: string; at: string | null; body?: string };

/** What has happened to an application, in order. */
export function timeline(app: Application): TimelineItem[] {
  const items: TimelineItem[] = [{ key: "started", title: "Started", at: app.created_at }];
  if (app.submitted_at) items.push({ key: "sent", title: "Sent to Udozo", at: app.submitted_at });
  if (app.changes) items.push({ key: "changes", title: "Udozo asked for changes", at: app.changes.at, body: app.changes.note });
  if (app.visit) {
    items.push({ key: "visit", title: app.visit.confirmed_at ? "Visit confirmed" : "Visit arranged", at: app.visit.at, body: app.visit.visitor ? `By ${app.visit.visitor.name} from Udozo` : undefined });
    if (app.visit.visited_at) items.push({ key: "visited", title: "Udozo visited your office", at: app.visit.visited_at });
  }
  if (app.status === "approved" && app.decision) items.push({ key: "approved", title: "Approved", at: app.decision.at });
  if (app.status === "rejected" && app.decision) items.push({ key: "rejected", title: "Not approved", at: app.decision.at, body: app.decision.reason ?? undefined });
  if (app.withdrawn_at) items.push({ key: "withdrawn", title: "You withdrew it", at: app.withdrawn_at });
  return items;
}

/** Words for an API refusal that needs the person to do something on udozo.com first. */
export function accountProblem(code: string | null) {
  if (code === "phone_not_verified") return "Confirm your mobile number on udozo.com first, then come back.";
  if (code === "profile_incomplete") return "Finish setting up your Udozo account on udozo.com first, then come back.";
  if (code === "country_required") return "Choose your country on your Udozo account first.";
  return null;
}
