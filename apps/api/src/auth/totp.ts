import { Secret, TOTP } from 'otpauth';
import type { PrismaService } from '../database/prisma.service.js';

/** An authenticator-app code generator: 6 digits every 30 seconds, as every authenticator app expects. */
export function totpFor(issuer: string, label: string, base32: string) {
  return new TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(base32) });
}

/** A new authenticator secret, in the base32 people type or scan. */
export const newTotpSecret = () => new Secret({ size: 20 }).base32;

/** The time step a code belongs to, accepting the current one or one either side (clock drift); null if it is wrong. */
export function totpStep(totp: TOTP, code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp.validate({ token: code, window: 1 });
  return delta === null ? null : BigInt(Math.floor(Date.now() / 30_000) + delta);
}

/**
 * Records a time step as used on the person's authenticator, refusing it if it (or a later one) was used already, in one
 * conditional statement, so two simultaneous requests cannot both use the same code.
 */
export async function claimTotpStep(prisma: PrismaService, userId: string, step: bigint) {
  const updated = await prisma.totpCredential.updateMany({
    where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
    data: { lastUsedStep: step },
  });
  return updated.count === 1;
}
