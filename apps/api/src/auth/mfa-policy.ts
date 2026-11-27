import type { PrismaService } from '../database/prisma.service.js';
import type { MfaMethod } from '../generated/prisma/client.js';

export const mfaMethods: readonly MfaMethod[] = ['authenticator', 'email', 'sms'];
export const resellerMfaMethods: readonly MfaMethod[] = ['authenticator', 'email'];

/** The switch that makes two-step sign-in required (global, a market or one reseller). */
export const twoStepSwitch = 'reseller_two_step' as const;

/** Every SHQ account requires two-step sign-in. The old feature switch remains readable for migration compatibility. */
export async function twoStepRequired(_prisma: PrismaService, _userId: string) {
  return true;
}

/** SHQ permits only an authenticator app or codes sent to the account's email. */
export async function twoStepAllowed(_prisma: PrismaService, _userId: string): Promise<MfaMethod[]> {
  return [...resellerMfaMethods];
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
