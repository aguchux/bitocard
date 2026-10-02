/**
 * Identity check providers behind BitoCard-owned interfaces. Results are always re-read from the provider (never
 * taken from a webhook body). Providers return only what BitoCard keeps: the outcome, the verified name and the
 * document's country, never images, ID numbers or the BVN.
 */
export type CheckStatus = 'in_progress' | 'approved' | 'declined' | 'in_review' | 'expired';

export type CheckResult = { status: CheckStatus; firstName?: string; lastName?: string; documentCountry?: string; reason?: string };

/** ID document plus liveness and face match, completed by the person on the provider's page. */
export interface DocumentCheckProvider {
  readonly name: string;
  createSession(input: { reference: string; callbackUrl: string; email?: string; firstName?: string; lastName?: string; country?: string }): Promise<{ providerReference: string; url: string }>;
  result(providerReference: string): Promise<CheckResult>;
}

/** Nigerian BVN with the holder's consent (NIBSS consent page), returning the name on the BVN record. */
export interface BvnProvider {
  readonly name: string;
  startBvnConsent(input: { bvn: string; firstName: string; lastName: string; redirectUrl: string }): Promise<{ providerReference: string; url: string }>;
  /** `approved` here means the BVN record was released; the name match is BitoCard's decision. */
  bvnResult(providerReference: string): Promise<CheckResult>;
}

/** Names match when the verified record has the given first and last names, in any order, ignoring case and accents. */
export function namesMatch(expected: string, verified: string) {
  const words = (name: string) =>
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(word => word.length > 1);
  const found = new Set(words(verified));
  const wanted = words(expected);
  return wanted.length >= 2 && wanted.every(word => found.has(word));
}

/** Business suffixes ignored when matching a payout account name to the reseller. */
const businessWords = new Set(['ltd', 'limited', 'plc', 'llc', 'inc', 'co', 'company', 'enterprise', 'enterprises', 'ventures', 'global', 'nigeria', 'ng', 'services', 'and', 'the']);

/** A payout account belongs to the reseller when its name shares a distinctive word with the verified owner or the business. */
export function accountNameMatches(accountName: string, names: Array<string | null | undefined>) {
  const words = (name: string) =>
    new Set(
      name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(word => word.length > 2 && !businessWords.has(word)),
    );
  const account = words(accountName);
  return names.some(name => name && [...words(name)].some(word => account.has(word)));
}
