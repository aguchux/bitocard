/**
 * Invite links from Udozo's Marketing (udozo.com/i/<code>) and the referral code sign-up carries (`ref`): kept on the
 * account, so a campaign or an invitation can be traced to the sign-up it led to.
 */

/** A Marketing invite code. */
export const isInviteCode = (code: string) => /^[a-z0-9]{6,20}$/.test(code);

/** A referral or campaign code as sign-up accepts it (the API checks the same). */
export const cleanRef = (raw: string | string[] | undefined | null) => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && /^[\w.~-]{1,64}$/.test(value) ? value : null;
};

/** Where an invite link leads: sign-up with the code, then on to posting a first listing. */
export const inviteSignupPath = (code: string) => `/signup?${new URLSearchParams({ next: "/sell", ref: code }).toString()}`;
