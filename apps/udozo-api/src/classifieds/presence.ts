import type { PrismaService } from '../database/prisma.service.js';

/** Someone is online for this long after their last look at udozo.com (pages say so every few seconds). */
export const onlineMs = 60_000;

/** Which of these customers had udozo.com open in the last minute. */
export async function onlineAmong(prisma: PrismaService, customerIds: string[]) {
  if (!customerIds.length) return new Set<string>();
  const rows = await prisma.customerPresence.findMany({ where: { customerId: { in: [...new Set(customerIds)] }, seenAt: { gt: new Date(Date.now() - onlineMs) } }, select: { customerId: true } });
  return new Set(rows.map(row => row.customerId));
}
