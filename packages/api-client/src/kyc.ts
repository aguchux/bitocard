/**
 * BitoCard Verify: BitoCard's own identity (KYC) and business (KYB) checks, done on verify.bitocard.com and reviewed by
 * a person: BitoCard's admins, or a registered, KYB-verified reseller for their own customers.
 */

export type KycKind = 'kyc' | 'kyb';
export type KycSubject = 'reseller' | 'customer';
export type KycStatus = 'draft' | 'submitted' | 'approved' | 'declined' | 'resubmit';
export type KycBusinessType = 'unregistered' | 'registered';
export type KycReviewer = 'admin' | 'reseller';

/** What a case can need before it is submitted, in the order the applicant gives them. */
export const kycItems = [
  'consent',
  'business',
  'business_registration',
  'business_address',
  'business_directors',
  'identity',
  'id_front',
  'id_back',
  'selfie',
  'liveness',
] as const;
export type KycItem = (typeof kycItems)[number];

/** Items a reviewer can ask the applicant to do again. */
export const kycItemLabels: Record<string, string> = {
  consent: 'Consent',
  business: 'Business details',
  business_registration: 'Registration certificate',
  business_address: 'Proof of business address',
  business_directors: 'Directors and owners document',
  identity: 'ID details',
  id_front: 'Front of the ID',
  id_back: 'Back of the ID',
  selfie: 'Selfie',
  liveness: 'Liveness check',
};

/** Why a case was declined, as the applicant and reviewers read it. */
export const kycDeclineReasons = {
  document_unreadable: 'The document could not be read',
  document_expired: 'The document has expired',
  document_mismatch: 'The details do not match the document',
  face_mismatch: 'The face does not match the ID photo',
  liveness_failed: 'The liveness check was not passed',
  business_document_invalid: 'A business document is not valid',
  underage: 'The applicant is under age',
  suspected_fraud: 'Suspected fraud',
  other: 'Another reason',
} as const;
export type KycDeclineReason = keyof typeof kycDeclineReasons;

export type KycLivenessStep = { code: 'turn_left' | 'turn_right' | 'look_up' | 'smile' | 'closer' | (string & {}); label: string };
export type KycIdType = { code: string; label: string; back: boolean };
export type KycBusiness = { registered_name: string; registration_number: string; business_address: string };

/** A case as the applicant sees it (verify app, `GET /v1/kyc/case`). */
export type KycCase = {
  object: 'kyc_case';
  id: string;
  kind: KycKind;
  subject: KycSubject;
  mode: 'live' | 'test';
  country: string;
  country_name: string;
  /** The store's brand for customers, BitoCard for resellers. */
  brand: { name: string; logo_url: string | null };
  status: KycStatus;
  consented: boolean;
  business_type: KycBusinessType | null;
  business: KycBusiness | null;
  identity: { id_type: string; id_number_hint: string; full_name: string; date_of_birth: string } | null;
  id_types: KycIdType[];
  documents: Array<{ kind: string; content_type: string; size: number; uploaded_at: string }>;
  liveness: { steps: KycLivenessStep[]; frames_per_step: number } | null;
  required: string[];
  missing: string[];
  resubmit_items: string[];
  reason: string | null;
  /** The decline reason in words, from the API. */
  reason_text?: string | null;
  note: string | null;
  return_url: string | null;
  submitted_at: string | null;
  decided_at: string | null;
};

export type KycSession = { object: 'kyc_session'; session: { token: string; expires_at: string }; case: KycCase };

export type KycReviewDocument = { id: string; kind: string; content_type: string; size: number; uploaded_at: string; url: string };

/** A case as a reviewer sees it: an admin (`/v1/admin/kyc/cases`) or a reseller for their own customers (`/v1/kyc/reviews`). */
export type KycReviewCase = {
  object: 'kyc_review';
  id: string;
  kind: KycKind;
  subject: KycSubject;
  mode: 'live' | 'test';
  country: string;
  status: KycStatus;
  reviewer: KycReviewer;
  applicant: { type: KycSubject; id: string; name: string; email: string | null };
  store: { id: string; name: string; subdomain: string } | null;
  reseller: { id: string; name: string };
  business_type: KycBusinessType | null;
  business: KycBusiness | null;
  identity: { id_type: string; id_type_label: string; id_number: string; full_name: string; date_of_birth: string } | null;
  documents: KycReviewDocument[];
  liveness: { steps: KycLivenessStep[] } | null;
  duplicates: Array<{ case_id: string; status: KycStatus; created_at: string; same: 'id_number' | (string & {}) }>;
  /** Other cases with the same ID number that this reviewer cannot open (another seller's): counted only. */
  duplicates_elsewhere?: number;
  /** The documents were deleted under the retention rules. */
  purged?: boolean;
  required: string[];
  resubmit_items: string[];
  reason: string | null;
  note: string | null;
  verified_name: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: { realm: 'admin' | 'reseller'; name: string } | null;
};

export type KycReviewEligibility = {
  object: 'kyc_review_eligibility';
  eligible: boolean;
  reason: null | 'not_registered' | 'kyb_not_verified' | 'not_active' | 'role';
  reseller: { id: string; name: string };
};

export type KycDecision =
  | { action: 'approve'; verified_name: string }
  | { action: 'decline'; reason: KycDeclineReason; note?: string }
  | { action: 'resubmit'; items: string[]; note: string };

/** The body each decision endpoint takes. */
export function kycDecisionBody(decision: KycDecision): Record<string, unknown> {
  if (decision.action === 'approve') return { verified_name: decision.verified_name.trim() };
  if (decision.action === 'decline') return { reason: decision.reason, ...(decision.note?.trim() ? { note: decision.note.trim() } : {}) };
  return { items: decision.items, note: decision.note.trim() };
}

/** A document kind as a reviewer reads it ("Liveness, step 2, frame 3"). */
export function kycDocumentLabel(kind: string, steps?: KycLivenessStep[] | null): string {
  const live = /^liveness_(\d+)_(\d+)$/.exec(kind);
  if (live) {
    const step = Number(live[1]);
    const label = steps?.[step]?.label;
    return `${label ?? `Liveness step ${step + 1}`}, frame ${Number(live[2]) + 1}`;
  }
  return kycItemLabels[kind] ?? kind.replace(/_/g, ' ');
}

/** Liveness frames grouped by step, in order, each with the step's instruction. */
export function kycLivenessGroups<T extends { kind: string }>(documents: T[], steps?: KycLivenessStep[] | null) {
  const groups = new Map<number, Array<{ frame: number; document: T }>>();
  for (const document of documents) {
    const live = /^liveness_(\d+)_(\d+)$/.exec(document.kind);
    if (!live) continue;
    const step = Number(live[1]);
    groups.set(step, [...(groups.get(step) ?? []), { frame: Number(live[2]), document }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([step, frames]) => ({ step, label: steps?.[step]?.label ?? `Step ${step + 1}`, frames: frames.sort((a, b) => a.frame - b.frame).map(item => item.document) }));
}

export const kycStatusLabels: Record<KycStatus, string> = {
  draft: 'Not submitted',
  submitted: 'To review',
  approved: 'Approved',
  declined: 'Declined',
  resubmit: 'Asked to resubmit',
};
