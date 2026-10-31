import type { PrismaService } from '../database/prisma.service.js';

/** How an admin can confirm a money action: their authenticator app (when set up), and always the emailed code. */
export type ConfirmMethod = 'authenticator' | 'email';

export async function confirmMethods(prisma: PrismaService, adminId: string): Promise<ConfirmMethod[]> {
  const totp = await prisma.totpCredential.findUnique({ where: { userId: adminId }, select: { confirmedAt: true } });
  return totp?.confirmedAt ? ['authenticator', 'email'] : ['email'];
}
