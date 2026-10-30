import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** How many times each person is shown the guide to creating a first store, per reseller account. */
export const storeGuideLimit = 3;
/** The least time between two showings to the same person. */
export const storeGuideGapMs = 10 * 60_000;

type GuideCaller = { resellerId: string; userId: string; role: string | null };

/**
 * SHQ's guide to creating a first store. It is shown to a reseller's owner and admins (who can create stores) while the
 * account has none and the `shq_store_guide` switch is on: at most `storeGuideLimit` times each, at least
 * `storeGuideGapMs` apart. Every showing counts, whether it was closed or the page left, so a reload never shows it again
 * sooner; the third close is the last.
 */
@Injectable()
export class StoreGuideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Claims the next showing for this person, if one is due: `show` true means the app should open the guide now. */
  async claim(caller: GuideCaller, now = new Date()) {
    const member = await this.prisma.resellerMember.findUnique({
      where: { resellerId_userId: { resellerId: caller.resellerId, userId: caller.userId } },
      select: { storeGuideShown: true, storeGuideShownAt: true },
    });
    const shown = member?.storeGuideShown ?? 0;
    const answer = (show: boolean, timesShown: number, lastShownAt: Date | null) => {
      const finished = timesShown >= storeGuideLimit;
      return {
        object: 'store_guide' as const,
        show,
        times_shown: timesShown,
        limit: storeGuideLimit,
        // When it may be shown again (null once every showing is used).
        next_at: finished ? null : lastShownAt ? new Date(lastShownAt.getTime() + storeGuideGapMs).toISOString() : now.toISOString(),
      };
    };
    const off = () => ({ ...answer(false, shown, member?.storeGuideShownAt ?? null), next_at: null });

    if (!member || (caller.role !== 'owner' && caller.role !== 'admin')) return off();
    if (shown >= storeGuideLimit) return off();
    if (!(await this.settings.isOn('shq_store_guide', caller.resellerId))) return off();
    if (await this.prisma.store.count({ where: { resellerId: caller.resellerId } })) return off();

    // Claimed in one statement, so two tabs opening at once show it once.
    const claimed = await this.prisma.resellerMember.updateMany({
      where: {
        resellerId: caller.resellerId,
        userId: caller.userId,
        storeGuideShown: { lt: storeGuideLimit },
        OR: [{ storeGuideShownAt: null }, { storeGuideShownAt: { lte: new Date(now.getTime() - storeGuideGapMs) } }],
      },
      data: { storeGuideShown: { increment: 1 }, storeGuideShownAt: now },
    });
    if (claimed.count) return answer(true, shown + 1, now);
    return answer(false, shown, member.storeGuideShownAt);
  }
}
