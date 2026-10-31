import type { PrismaService } from '../database/prisma.service.js';
import type { MfaMethod } from '../generated/prisma/client.js';
import { switchDefault } from '../settings/settings.service.js';

export const mfaMethods: readonly MfaMethod[] = ['authenticator', 'email', 'sms'];

/** The switch that makes two-step sign-in required (global, a market or one reseller). */
export const twoStepSwitch = 'reseller_two_step' as const;

/**
 * Whether a person must use two-step sign-in: the switch is on for any reseller account they belong to (its own value,
 * else its market's, else the global one). A person with no account yet follows the global switch.
 */
export async function twoStepRequired(prisma: PrismaService, userId: string) {
  const [memberships, switches] = await Promise.all([
    prisma.resellerMember.findMany({ where: { userId }, select: { resellerId: true, reseller: { select: { country: true } } } }),
    prisma.featureSwitch.findMany({ where: { key: twoStepSwitch } }),
  ]);
  const global = switches.find(row => row.countryCode === null && row.resellerId === null)?.enabled ?? switchDefault(twoStepSwitch);
  if (!memberships.length) return global;
  return memberships.some(
    item => switches.find(row => row.resellerId === item.resellerId)?.enabled ?? switches.find(row => row.countryCode !== null && row.countryCode === item.reseller.country)?.enabled ?? global,
  );
}

/** The methods a person may choose: those any of their accounts' markets allows (every method before they have one). */
export async function twoStepAllowed(prisma: PrismaService, userId: string): Promise<MfaMethod[]> {
  const memberships = await prisma.resellerMember.findMany({ where: { userId }, select: { reseller: { select: { country: true } } } });
  const countries = [...new Set(memberships.map(item => item.reseller.country).filter((code): code is string => Boolean(code)))];
  const markets = countries.length ? await prisma.country.findMany({ where: { code: { in: countries } }, select: { resellerMfaMethods: true } }) : [];
  return markets.length ? mfaMethods.filter(method => markets.some(market => market.resellerMfaMethods.includes(method))) : [...mfaMethods];
}

/**
 * Whether a reseller session still has to finish two-step sign-in: never once done on it; otherwise when the person has
 * two-step on, or must use it (`setup` then says they have to set it up first).
 */
export async function twoStepPending(
  prisma: PrismaService,
  session: { realm: string; mfaVerifiedAt: Date | null; userId: string; user: { mfaMethod: MfaMethod | null } },
): Promise<{ setup: boolean } | null> {
  if (session.realm !== 'reseller' || session.mfaVerifiedAt) return null;
  if (session.user.mfaMethod) return { setup: false };
  return (await twoStepRequired(prisma, session.userId)) ? { setup: true } : null;
}
