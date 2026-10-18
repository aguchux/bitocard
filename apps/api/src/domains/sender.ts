import type { PrismaService } from '../database/prisma.service.js';

/**
 * The from address for a reseller's store emails: `<Store> <orders@their domain>` once the domain is verified for sending
 * (Resend) and serving the store, else null (BitoCard's own sender is used).
 */
export async function domainSender(prisma: PrismaService, resellerId: string, displayName: string) {
  const domain = await prisma.storeDomain.findFirst({ where: { resellerId, status: 'active', emailStatus: 'verified' }, orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }], select: { name: true } });
  if (!domain) return null;
  return `${displayName.replace(/["<>\r\n]/g, '').trim() || domain.name} <orders@${domain.name}>`;
}
